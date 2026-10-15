import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "./config.mjs";
import { createAuth } from "./auth.mjs";
import { migrate } from "./database.mjs";
import { createApp } from "./app.mjs";

const config = readConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 2000,
});
// A created-but-not-started container can be removed by Coolify's cleanup
// while Compose waits on a health dependency. Start alongside the database.
for (let attempt = 1; ; attempt++) {
  try {
    await pool.query("SELECT 1");
    break;
  } catch (error) {
    if (attempt >= 15) {
      await pool.end();
      throw error;
    }
    if (attempt === 1) {
      console.info("Waiting for PostgreSQL to accept connections.");
    }
    await delay(1000);
  }
}
const auth = createAuth(pool, config);
await migrate(pool, auth);
const app = createApp({ pool, auth, config });
const server = app.listen(config.port, "0.0.0.0", () => {
  console.info(`Katata Draw listening on port ${config.port}`);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
