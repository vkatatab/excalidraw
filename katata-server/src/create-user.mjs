import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import pg from "pg";
import { readConfig } from "./config.mjs";
import { createAuth } from "./auth.mjs";
import { migrate } from "./database.mjs";

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const auth = createAuth(pool, config);
let hidden = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) {
      process.stdout.write(chunk);
    }
    callback();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output,
  terminal: process.stdin.isTTY,
});
try {
  await migrate(pool, auth);
  const email = await prompt.question("E-mail: ");
  const name = await prompt.question("Nome: ");
  process.stdout.write("Senha (mínimo de 8 caracteres): ");
  hidden = true;
  const password = await prompt.question("");
  hidden = false;
  process.stdout.write("\n");
  const result = await auth.api.signUpEmail({
    body: { email: email.trim(), name: name.trim(), password },
  });
  console.info(`Conta criada para ${result.user.email}.`);
} finally {
  prompt.close();
  await pool.end();
}
