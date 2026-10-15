import pg from "pg";
import { readConfig } from "./config.mjs";
import { createAuth } from "./auth.mjs";
import { migrate } from "./database.mjs";
import { createApp } from "./app.mjs";

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
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
