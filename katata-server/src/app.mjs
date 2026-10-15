import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { z } from "zod";

const titleSchema = z.string().trim().min(1).max(160);
const sceneSchema = z
  .object({
    elements: z.array(z.record(z.string(), z.unknown())).max(100000),
    appState: z.record(z.string(), z.unknown()),
    files: z.record(
      z.string(),
      z
        .object({
          id: z.string(),
          mimeType: z.string(),
          dataURL: z.string(),
          created: z.number(),
        })
        .passthrough(),
    ),
  })
  .strict();
const updateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    title: titleSchema.optional(),
    scene: sceneSchema.optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.scene !== undefined);
const summary = "id, title, version, created_at, updated_at";
const defaultBuildDir = fileURLToPath(
  new URL("../../excalidraw-app/build", import.meta.url),
);

export function createApp({ pool, auth, config, buildDir = defaultBuildDir }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.production ? 1 : false);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/api/")) {
      res.set("Cache-Control", "no-store");
    }
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  // Accounts are provisioned by the server CLI, never by public registration.
  // Keep Better Auth's internal signUpEmail API available to that CLI only.
  app.use("/api/auth/sign-up", (_req, res) => {
    res.status(404).json({ message: "O cadastro público está desativado." });
  });
  app.all("/api/auth/{*path}", toNodeHandler(auth));
  app.use(
    "/api/boards",
    async (req, res, next) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        return res
          .status(401)
          .json({ message: "Entre na sua conta para continuar." });
      }
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.get("origin") !== config.origin
      ) {
        return res.status(403).json({ message: "Origem não permitida." });
      }
      res.locals.userId = session.user.id;
      next();
    },
    express.json({ limit: "25mb" }),
  );
  app.get("/api/boards", async (req, res) => {
    const query = z
      .object({
        q: z.string().max(160).default(""),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    const rows = await pool.query(
      `SELECT ${summary} FROM katata_boards
       WHERE owner_id = $1 AND title ILIKE $2
       ORDER BY updated_at DESC, id LIMIT 101 OFFSET $3`,
      [
        res.locals.userId,
        `%${query.q.replace(/[\\%_]/g, "\\$&")}%`,
        query.offset,
      ],
    );
    res.json({
      boards: rows.rows.slice(0, 100),
      hasMore: rows.rows.length > 100,
    });
  });
  app.post("/api/boards", async (req, res) => {
    const { title } = z.object({ title: titleSchema }).strict().parse(req.body);
    const result = await pool.query(
      `INSERT INTO katata_boards(id, owner_id, title) VALUES ($1, $2, $3) RETURNING ${summary}, scene`,
      [randomUUID(), res.locals.userId, title],
    );
    res.status(201).json(result.rows[0]);
  });
  app.param("boardId", (req, _res, next, id) => {
    req.params.boardId = z.uuid().parse(id);
    next();
  });
  app.get("/api/boards/:boardId", async (req, res) => {
    const result = await pool.query(
      `SELECT ${summary}, scene FROM katata_boards WHERE id = $1 AND owner_id = $2`,
      [req.params.boardId, res.locals.userId],
    );
    if (!result.rowCount) {
      return res.status(404).json({ message: "Quadro não encontrado." });
    }
    res.json(result.rows[0]);
  });
  app.patch("/api/boards/:boardId", async (req, res) => {
    const update = updateSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE katata_boards SET title = COALESCE($1, title), scene = COALESCE($2::jsonb, scene),
       version = version + 1, updated_at = now()
       WHERE id = $3 AND owner_id = $4 AND version = $5 RETURNING ${summary}`,
      [
        update.title ?? null,
        update.scene ? JSON.stringify(update.scene) : null,
        req.params.boardId,
        res.locals.userId,
        update.version,
      ],
    );
    if (!result.rowCount) {
      const existing = await pool.query(
        "SELECT id FROM katata_boards WHERE id = $1 AND owner_id = $2",
        [req.params.boardId, res.locals.userId],
      );
      return res.status(existing.rowCount ? 409 : 404).json({
        message: existing.rowCount
          ? "Este quadro mudou em outra aba. Exporte suas alterações antes de reabrir."
          : "Quadro não encontrado.",
      });
    }
    res.json(result.rows[0]);
  });
  app.delete("/api/boards/:boardId", async (req, res) => {
    const { version } = z
      .object({ version: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    const result = await pool.query(
      "DELETE FROM katata_boards WHERE id = $1 AND owner_id = $2 AND version = $3 RETURNING id",
      [req.params.boardId, res.locals.userId, version],
    );
    if (!result.rowCount) {
      return res.status(409).json({
        message: "O quadro mudou ou já foi removido. Atualize a lista.",
      });
    }
    res.status(204).end();
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ message: "Rota não encontrada." }),
  );
  app.use(express.static(buildDir, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(buildDir, "index.html"));
  });
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError || error.type === "entity.parse.failed") {
      return res
        .status(400)
        .json({ message: "Dados inválidos. Confira os campos enviados." });
    }
    if (error.type === "entity.too.large") {
      return res
        .status(413)
        .json({ message: "Este quadro excede o limite de 25 MB." });
    }
    console.error("Request failed", { name: error.name, code: error.code });
    res
      .status(500)
      .json({ message: "Não foi possível concluir. Tente novamente." });
  });
  return app;
}
