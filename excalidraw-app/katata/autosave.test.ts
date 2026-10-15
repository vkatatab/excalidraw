import { describe, expect, it } from "vitest";

import { Autosave } from "./autosave";

describe("Katata autosave", () => {
  it("serializes in-flight changes and advances the server version", async () => {
    const writes: [string, number][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = new Autosave(
      "initial",
      3,
      async (snapshot, version) => {
        writes.push([snapshot, version]);
        if (writes.length === 1) {
          await gate;
        }
        return version + 1;
      },
      () => {},
      60000,
    );
    save.change("first");
    const pending = save.flush();
    save.change("second");
    release();
    expect(await pending).toBe(true);
    expect(writes).toEqual([
      ["first", 3],
      ["second", 4],
    ]);
    expect(save.dirty).toBe(false);
    save.dispose();
  });

  it("keeps unsaved changes after a failed request and retries explicitly", async () => {
    let fail = true;
    const versions: number[] = [];
    const save = new Autosave(
      "initial",
      0,
      async (_snapshot, version) => {
        versions.push(version);
        if (fail) {
          throw new Error("offline");
        }
        return version + 1;
      },
      () => {},
      60000,
    );
    save.change("draft");
    expect(await save.flush()).toBe(false);
    expect(save.dirty).toBe(true);
    fail = false;
    expect(await save.flush()).toBe(true);
    expect(versions).toEqual([0, 0]);
    save.dispose();
  });

  it("never retries a conflicting write against another tab", async () => {
    let writes = 0;
    const save = new Autosave(
      "initial",
      0,
      async () => {
        writes++;
        throw Object.assign(new Error("conflict"), { status: 409 });
      },
      () => {},
      60000,
    );
    save.change("draft");
    expect(await save.flush()).toBe(false);
    save.change("more edits");
    expect(await save.flush()).toBe(false);
    expect(writes).toBe(1);
    expect(save.dirty).toBe(true);
    save.dispose();
  });
});
