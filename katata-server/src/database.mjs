import { getMigrations } from "better-auth/db/migration";

export async function migrate(pool, auth) {
  // Serialize startup migrations when two containers overlap during a deploy.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(54928631)");
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    await client.query(`
      CREATE TABLE IF NOT EXISTS katata_boards (
        id uuid PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        scene jsonb NOT NULL DEFAULT '{"elements":[],"appState":{},"files":{}}',
        version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS katata_boards_owner_updated
        ON katata_boards (owner_id, updated_at DESC, id);
    `);
  } finally {
    await client.query("SELECT pg_advisory_unlock(54928631)");
    client.release();
  }
}
