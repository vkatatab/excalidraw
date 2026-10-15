import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Excalidraw, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";

import type {
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import { api } from "./api";
import { Autosave } from "./autosave";

import "./katata.scss";

import type { Board, BoardDocument, Scene } from "./api";
import type { SaveStatus } from "./autosave";
import type { FormEvent } from "react";

const auth = createAuthClient();
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await auth.signIn.email({ email, password });
      if (result.error) {
        setError(
          "E-mail ou senha inválidos. Confira os dados e tente novamente.",
        );
      }
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="katata-login">
      <section className="katata-intro">
        <span className="katata-wordmark">✳ Katata Draw</span>
        <p className="katata-eyebrow">UM ESPAÇO PARA SUAS IDEIAS</p>
        <h1>
          Começa com
          <br />
          um rabisco.
        </h1>
        <p>
          Desenhe, organize e volte de onde parou.
          <br />
          Seus quadros, sempre com você.
        </p>
        <div className="katata-sketch" aria-hidden="true">
          <span>uma ideia</span>
          <b>⟶</b>
          <span>
            infinitas
            <br />
            possibilidades
          </span>
        </div>
      </section>
      <section className="katata-login-panel">
        <form onSubmit={submit} className="katata-form">
          <span className="katata-badge">SEU ATELIÊ DIGITAL</span>
          <h2>Entre e crie.</h2>
          <p>Use sua conta para acessar seus quadros.</p>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="katata-error" role="alert">
              {error}
            </p>
          )}
          <button className="katata-primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar →"}
          </button>
          <p className="katata-note">
            Acesso por convite. Peça sua conta ao administrador.
          </p>
        </form>
      </section>
    </main>
  );
}

function Editor({
  board,
  onBack,
}: {
  board: BoardDocument;
  onBack: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const save = useRef<Autosave | undefined>(undefined);
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const titleRef = useRef(board.title);
  const [title, setTitle] = useState(board.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);

  const snapshot = (scene: Scene) =>
    JSON.stringify({ title: titleRef.current.trim() || "Sem título", scene });
  const getScene = (api: ExcalidrawImperativeAPI): Scene => {
    const { elements, appState, files } = JSON.parse(
      serializeAsJSON(
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
        "local",
      ),
    );
    return { elements, appState, files };
  };
  const initialize = (api: ExcalidrawImperativeAPI) => {
    editor.current = api;
    save.current?.dispose();
    save.current = new Autosave(
      snapshot(getScene(api)),
      board.version,
      async (body, version) => {
        const updated = await apiRequest(body, version);
        return updated.version;
      },
      (next, reason = "") => {
        setStatus(next);
        setError(reason);
      },
    );
  };
  const apiRequest = (body: string, version: number) =>
    api<Board>(`/api/boards/${board.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...JSON.parse(body), version }),
    });
  const onChange: ExcalidrawProps["onChange"] = (elements, appState, files) => {
    if (!save.current) {
      return;
    }
    const data = JSON.parse(
      serializeAsJSON(elements, appState, files, "local"),
    );
    save.current.change(
      snapshot({
        elements: data.elements,
        appState: data.appState,
        files: data.files,
      }),
    );
  };
  useEffect(() => {
    const view = root.current?.ownerDocument.defaultView;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (save.current?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const online = () => void save.current?.flush();
    view?.addEventListener("beforeunload", beforeUnload);
    view?.addEventListener("online", online);
    return () => {
      view?.removeEventListener("beforeunload", beforeUnload);
      view?.removeEventListener("online", online);
      save.current?.dispose();
    };
  }, []);
  const leave = async () => {
    setLeaving(true);
    if ((await save.current?.flush()) ?? true) {
      onBack();
    }
    setLeaving(false);
  };
  const exportCopy = () => {
    const node = root.current;
    if (!node || !editor.current) {
      return;
    }
    const view = node.ownerDocument.defaultView!;
    const url = view.URL.createObjectURL(
      new Blob(
        [
          serializeAsJSON(
            editor.current.getSceneElementsIncludingDeleted(),
            editor.current.getAppState(),
            editor.current.getFiles(),
            "local",
          ),
        ],
        { type: "application/vnd.excalidraw+json" },
      ),
    );
    const link = node.ownerDocument.createElement("a");
    link.href = url;
    link.download = `${title.trim() || "quadro"}.excalidraw`;
    link.click();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  };
  const labels: Record<SaveStatus, string> = {
    saved: "✓ Salvo",
    pending: "Alterações pendentes",
    saving: "Salvando…",
    error: "Falha ao salvar",
    conflict: "Conflito entre abas",
  };
  return (
    <div className="katata-editor" ref={root}>
      <header className="katata-editor-bar">
        <button onClick={() => void leave()} disabled={leaving}>
          ← Meus quadros
        </button>
        <input
          aria-label="Nome do quadro"
          maxLength={160}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            titleRef.current = event.target.value;
            if (editor.current) {
              save.current?.change(snapshot(getScene(editor.current)));
            }
          }}
        />
        <span role="status" className={`katata-save-${status}`}>
          {labels[status]}
        </span>
        <button onClick={exportCopy}>Exportar cópia</button>
      </header>
      {error && (
        <div className="katata-save-error" role="alert">
          <span>{error}</span>
          {status !== "conflict" && (
            <button onClick={() => void save.current?.flush()}>
              Tentar novamente
            </button>
          )}
          {status === "conflict" && (
            <button onClick={() => setLeaving(true)}>Sair sem salvar…</button>
          )}
        </div>
      )}
      {leaving && status === "conflict" && (
        <div className="katata-modal-shade">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-title"
            className="katata-modal"
          >
            <h2 id="discard-title">Sair sem salvar?</h2>
            <p>
              Exporte uma cópia antes de sair. As alterações desta aba serão
              descartadas.
            </p>
            <div className="katata-actions">
              <button onClick={() => setLeaving(false)}>
                Continuar editando
              </button>
              <button className="katata-danger" onClick={onBack}>
                Descartar e sair
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="katata-canvas">
        <Excalidraw
          initialData={board.scene}
          onInitialize={initialize}
          onChange={onChange}
          langCode="pt-BR"
        >
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (confirmation !== newPassword) {
      setError("As novas senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await auth.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError("Não foi possível alterar a senha. Confira a senha atual.");
      } else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setSuccess(true);
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="katata-modal-shade">
      <section
        className="katata-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
      >
        <form className="katata-form" onSubmit={submit}>
          <h2 id="password-title">Alterar senha</h2>
          {success ? (
            <p role="status">
              Senha alterada. Suas outras sessões foram encerradas.
            </p>
          ) : (
            <>
              <label>
                Senha atual
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                Nova senha
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                Confirmar nova senha
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <p className="katata-note">Use pelo menos 8 caracteres.</p>
            </>
          )}
          {error && (
            <p className="katata-error" role="alert">
              {error}
            </p>
          )}
          <div className="katata-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {success ? "Fechar" : "Cancelar"}
            </button>
            {!success && (
              <button className="katata-primary" disabled={busy}>
                Salvar senha
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function Dashboard({
  name,
  onSignOut,
}: {
  name: string;
  onSignOut: () => void;
}) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [active, setActive] = useState<BoardDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [remove, setRemove] = useState<Board | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError("");
      try {
        const result = await api<{ boards: Board[]; hasMore: boolean }>(
          `/api/boards?q=${encodeURIComponent(search)}&offset=${offset}`,
        );
        setBoards((old) =>
          offset ? [...old, ...result.boards] : result.boards,
        );
        setHasMore(result.hasMore);
      } catch (error) {
        setError(message(error));
      } finally {
        setLoading(false);
      }
    },
    [search],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      setActive(
        await api<BoardDocument>("/api/boards", {
          method: "POST",
          body: JSON.stringify({ title: "Sem título" }),
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  const open = async (board: Board) => {
    setBusy(true);
    setError("");
    try {
      setActive(await api<BoardDocument>(`/api/boards/${board.id}`));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  const destroy = async () => {
    if (!remove) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/boards/${remove.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: remove.version }),
      });
      setRemove(null);
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  if (active) {
    return (
      <Editor
        key={active.id}
        board={active}
        onBack={() => {
          setActive(null);
          void load();
        }}
      />
    );
  }
  return (
    <div className="katata-dashboard">
      <header className="katata-topbar">
        <span className="katata-wordmark">✳ Katata Draw</span>
        <div>
          <span>{name}</span>
          <button onClick={() => setShowPassword(true)}>Minha conta</button>
          <button onClick={onSignOut}>Sair</button>
        </div>
      </header>
      <main className="katata-workspace">
        <p className="katata-eyebrow">SEU ESPAÇO CRIATIVO</p>
        <div className="katata-workspace-title">
          <div>
            <h1>
              Meus quadros<span>.</span>
            </h1>
            <p>Ideias soltas. Pensamentos conectados. Tudo no seu lugar.</p>
          </div>
          <button
            className="katata-primary"
            disabled={busy}
            onClick={() => void create()}
          >
            ＋ Novo quadro
          </button>
        </div>
        <form
          className="katata-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (query === search) {
              void load();
            } else {
              setSearch(query);
            }
          }}
        >
          <input
            aria-label="Buscar quadros"
            placeholder="Buscar um quadro…"
            value={query}
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button disabled={loading}>Buscar</button>
        </form>
        {error && (
          <p className="katata-error" role="alert">
            {error}
            <button onClick={() => void load()}>Tentar novamente</button>
          </p>
        )}
        {loading && !boards.length ? (
          <p role="status">Carregando seus quadros…</p>
        ) : (
          <div className="katata-board-grid">
            <button
              className="katata-new-card"
              disabled={busy}
              onClick={() => void create()}
            >
              <span>＋</span>Criar um quadro
            </button>
            {boards.map((board, index) => (
              <article className="katata-board-card" key={board.id}>
                <button
                  className={`katata-board-preview katata-color-${index % 4}`}
                  disabled={busy}
                  onClick={() => void open(board)}
                  aria-label={`Abrir ${board.title}`}
                >
                  <span aria-hidden="true">
                    {["✳", "↗", "◇", "⌁"][index % 4]}
                  </span>
                </button>
                <div className="katata-board-details">
                  <button disabled={busy} onClick={() => void open(board)}>
                    {board.title}
                  </button>
                  <p>
                    Atualizado em{" "}
                    {new Date(board.updated_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <button
                    className="katata-delete"
                    aria-label={`Excluir ${board.title}`}
                    onClick={() => setRemove(board)}
                  >
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {!loading && !boards.length && (
          <p className="katata-empty">
            {query
              ? "Nenhum quadro encontrado."
              : "Seu próximo projeto começa em uma tela em branco."}
          </p>
        )}
        {hasMore && (
          <button disabled={loading} onClick={() => void load(boards.length)}>
            Carregar mais
          </button>
        )}
        <footer className="katata-workspace-footer">
          Feito para pensar com as mãos.{" "}
          <span>Seus quadros são privados e salvos automaticamente.</span>
        </footer>
      </main>
      {showPassword && (
        <PasswordDialog onClose={() => setShowPassword(false)} />
      )}
      {remove && (
        <div className="katata-modal-shade">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="katata-modal"
          >
            <h2 id="delete-title">Excluir “{remove.title}”?</h2>
            <p>
              O quadro será removido permanentemente. Exporte uma cópia antes,
              se quiser guardar.
            </p>
            <div className="katata-actions">
              <button disabled={busy} onClick={() => setRemove(null)}>
                Cancelar
              </button>
              <button
                className="katata-danger"
                disabled={busy}
                onClick={() => void destroy()}
              >
                Excluir quadro
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function KatataApp() {
  const { data: session, isPending, error } = auth.useSession();
  if (isPending) {
    return (
      <div className="katata-loading" role="status">
        Abrindo seu espaço…
      </div>
    );
  }
  if (error) {
    return (
      <div className="katata-loading" role="alert">
        Não foi possível verificar sua sessão. Atualize a página para tentar
        novamente.
      </div>
    );
  }
  return session ? (
    <Dashboard
      key={session.user.id}
      name={session.user.name}
      onSignOut={() => void auth.signOut()}
    />
  ) : (
    <Login />
  );
}
