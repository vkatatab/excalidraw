export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

/** One request at a time; later edits never get replaced by an older response. */
export class Autosave {
  private saved: string;
  private latest: string;
  private version: number;
  private pending?: Promise<boolean>;
  private timer?: ReturnType<typeof setTimeout>;
  private conflict = false;
  private disposed = false;

  constructor(
    initial: string,
    version: number,
    private write: (snapshot: string, version: number) => Promise<number>,
    private notify: (status: SaveStatus, error?: string) => void,
    private delay = 1000,
  ) {
    this.saved = this.latest = initial;
    this.version = version;
  }

  get dirty() {
    return this.saved !== this.latest;
  }

  change(snapshot: string) {
    if (this.disposed || snapshot === this.latest) {
      return;
    }
    this.latest = snapshot;
    clearTimeout(this.timer);
    if (this.conflict) {
      return;
    }
    this.notify(this.dirty ? "pending" : "saved");
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.pending) {
      return this.pending;
    }
    if (this.conflict || this.disposed) {
      return !this.dirty;
    }
    const run = async () => {
      while (this.dirty && !this.disposed) {
        const snapshot = this.latest;
        this.notify("saving");
        try {
          this.version = await this.write(snapshot, this.version);
          this.saved = snapshot;
        } catch (error) {
          this.conflict = (error as { status?: number }).status === 409;
          this.notify(
            this.conflict ? "conflict" : "error",
            error instanceof Error ? error.message : "Falha ao salvar.",
          );
          return false;
        }
      }
      if (!this.disposed) {
        this.notify("saved");
      }
      return !this.dirty;
    };
    this.pending = run();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
