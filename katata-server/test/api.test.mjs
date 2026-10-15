import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { readConfig } from "../src/config.mjs";
import { createAuth } from "../src/auth.mjs";
import { migrate } from "../src/database.mjs";
import { createApp } from "../src/app.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = { skip: !databaseUrl };
let pool, adminPool, auth, server, base, alice, bob;
const schema = `katata_test_${randomBytes(12).toString("hex")}`;
const config = {
  origin: "http://localhost:3000",
  secret: randomBytes(48).toString("base64url"),
  production: false,
};
const password = randomBytes(24).toString("base64url");

async function request(
  url,
  { method = "GET", body, cookie, origin = config.origin } = {},
) {
  return fetch(`${base}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function account(prefix) {
  const email = `${prefix}-${randomBytes(8).toString("hex")}@example.com`;
  await auth.api.signUpEmail({ body: { name: prefix, email, password } });
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  return { cookie, email };
}
before(async () => {
  if (!databaseUrl) {
    return;
  }
  adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  });
  auth = createAuth(pool, config);
  await migrate(pool, auth);
  server = createApp({ pool, auth, config }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  alice = await account("alice");
  bob = await account("bob");
});
after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (pool) {
    await pool.end();
  }
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  }
});

test("production configuration requires a strong secret and HTTPS", () => {
  assert.throws(
    () => readConfig({ DATABASE_URL: "postgresql://localhost/db" }),
    /32/,
  );
  assert.throws(
    () =>
      readConfig({
        DATABASE_URL: "postgresql://localhost/db",
        BETTER_AUTH_SECRET: config.secret,
        NODE_ENV: "production",
        APP_URL: "http://example.com",
      }),
    /HTTPS/,
  );
});
test(
  "health reports the actual database and APIs are private and uncached",
  integration,
  async () => {
    assert.equal((await request("/api/health")).status, 200);
    for (const [method, url] of [
      ["GET", "/api/boards"],
      ["POST", "/api/boards"],
      ["GET", `/api/boards/${crypto.randomUUID()}`],
    ]) {
      const response = await request(url, {
        method,
        body: method === "POST" ? { title: "private" } : undefined,
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  },
);
test(
  "public account creation is blocked, including mixed case and slash variants",
  integration,
  async () => {
    for (const url of [
      "/api/auth/sign-up/email",
      "/API/AUTH/SIGN-UP/email",
      "/api/auth/sign-up/email/",
      "/api/auth/%73ign-up/email",
    ]) {
      const response = await request(url, {
        method: "POST",
        body: { name: "intruder", email: "intruder@example.com", password },
      });
      assert.equal(response.status, 404);
    }
  },
);
test(
  "invalid passwords and untrusted origins cannot authenticate",
  integration,
  async () => {
    const wrong = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: alice.email, password: "wrong-password-123" },
    });
    assert.equal(wrong.status, 401);
    const origin = await request("/api/auth/sign-in/email", {
      method: "POST",
      origin: "https://attacker.example",
      body: { email: alice.email, password },
    });
    assert.equal(origin.status, 403);
  },
);
test(
  "boards, images and titles persist; other users cannot read, modify or delete them",
  integration,
  async () => {
    const created = await request("/api/boards", {
      method: "POST",
      cookie: alice.cookie,
      body: { title: "Meu projeto" },
    });
    assert.equal(created.status, 201);
    const board = await created.json();
    const scene = {
      elements: [{ id: "image-1", type: "image", fileId: "asset-1" }],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {
        "asset-1": {
          id: "asset-1",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,dGVzdA==",
          created: 1,
        },
      },
    };
    const saved = await request(`/api/boards/${board.id}`, {
      method: "PATCH",
      cookie: alice.cookie,
      body: { version: 0, scene, title: "Projeto salvo" },
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).version, 1);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const other = await request(`/api/boards/${board.id}`, {
        method,
        cookie: bob.cookie,
        body:
          method === "GET"
            ? undefined
            : {
                version: 1,
                ...(method === "PATCH" ? { title: "stolen" } : {}),
              },
      });
      assert.equal(other.status, method === "DELETE" ? 409 : 404);
    }
    const otherList = await (
      await request("/api/boards", { cookie: bob.cookie })
    ).json();
    assert.equal(
      otherList.boards.some((b) => b.id === board.id),
      false,
    );
    const loaded = await (
      await request(`/api/boards/${board.id}`, { cookie: alice.cookie })
    ).json();
    assert.deepEqual(loaded.scene, scene);
    assert.equal(loaded.title, "Projeto salvo");
    const conflict = await request(`/api/boards/${board.id}`, {
      method: "PATCH",
      cookie: alice.cookie,
      body: { version: 0, title: "old tab" },
    });
    assert.equal(conflict.status, 409);
    const staleDelete = await request(`/api/boards/${board.id}`, {
      method: "DELETE",
      cookie: alice.cookie,
      body: { version: 0 },
    });
    assert.equal(staleDelete.status, 409);
    const deleted = await request(`/api/boards/${board.id}`, {
      method: "DELETE",
      cookie: alice.cookie,
      body: { version: 1 },
    });
    assert.equal(deleted.status, 204);
    assert.equal(
      (await request(`/api/boards/${board.id}`, { cookie: alice.cookie }))
        .status,
      404,
    );
  },
);
test(
  "mutation requests reject cross-site or absent origins and malformed scenes",
  integration,
  async () => {
    for (const origin of [undefined, "https://attacker.example"]) {
      const response = await request("/api/boards", {
        method: "POST",
        cookie: alice.cookie,
        origin: origin || "",
        body: { title: "CSRF" },
      });
      assert.equal(response.status, 403);
    }
    assert.equal(
      (
        await request("/api/boards", {
          method: "POST",
          cookie: alice.cookie,
          body: { title: " " },
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/boards/not-a-uuid", { cookie: alice.cookie }))
        .status,
      400,
    );
  },
);
test("sign out revokes the server session", integration, async () => {
  const response = await request("/api/auth/sign-out", {
    method: "POST",
    cookie: bob.cookie,
    body: {},
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await request("/api/boards", { cookie: bob.cookie })).status,
    401,
  );
});

test("changing a password revokes other sessions", integration, async () => {
  const response = await auth.api.signInEmail({
    body: { email: alice.email, password },
    asResponse: true,
  });
  const otherCookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.equal(
    (await request("/api/boards", { cookie: otherCookie })).status,
    200,
  );
  const changed = await request("/api/auth/change-password", {
    method: "POST",
    cookie: alice.cookie,
    body: {
      currentPassword: password,
      newPassword: randomBytes(24).toString("base64url"),
      revokeOtherSessions: true,
    },
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await request("/api/boards", { cookie: otherCookie })).status,
    401,
  );
});

test("repeated password attempts are rate limited", integration, async () => {
  let status;
  for (let attempt = 0; attempt < 6; attempt++) {
    status = (
      await request("/api/auth/sign-in/email", {
        method: "POST",
        body: { email: alice.email, password: "wrong-password-again" },
      })
    ).status;
    if (status === 429) {
      break;
    }
  }
  assert.equal(status, 429);
});
