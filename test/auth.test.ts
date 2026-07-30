import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";
import { IdentityClientError, type Principal, type ResolveOptions } from "acme-identity/client";
import { Collector } from "../src/collector/collector.js";
import { createApp } from "../src/server/app.js";
import { ObservationStore } from "../src/state/store.js";
import type { AppConfig, SourceConfig } from "../src/types.js";

const HEADER = "x-acme-dev-user";
const permissions: Record<string, string[]> = {
  admin: ["*"],
  reader: ["observability.read"],
  collector: ["observability.read", "observability.collect"],
  manager: ["observability.*"],
  unrelated: ["issues.read"],
};

const principalResolver = async (options: ResolveOptions): Promise<Principal> => {
  const username = options.devUser ?? "admin";
  if (username === "signed-out") throw new IdentityClientError("Authentication required", "unauthenticated");
  if (username === "outage") throw new IdentityClientError("Identity service unreachable", "unavailable");
  return principal(username, permissions[username] ?? []);
};

describe("Acme Observability identity permissions", () => {
  test("keeps health public and fails closed for protected observations", async () => {
    const ctx = await testApp();
    await request(ctx.app).get("/api/health").set(HEADER, "signed-out").expect(200);
    await request(ctx.app).get("/api/dashboard").set(HEADER, "signed-out").expect(401);
    await request(ctx.app).get("/api/dashboard").set(HEADER, "outage").expect(503);
    await request(ctx.app).get("/api/dashboard").set(HEADER, "unrelated").expect(403);
    await request(ctx.app).get("/api/dashboard").set(HEADER, "reader").expect(200);
    ctx.close();
  });

  test("separates read, collect, and manage capabilities", async () => {
    const ctx = await testApp();
    await request(ctx.app).post("/api/collect").set(HEADER, "reader").send({}).expect(403);
    await request(ctx.app).post("/api/collect").set(HEADER, "collector").send({}).expect(200);
    await request(ctx.app).post("/api/rebuild").set(HEADER, "collector").send({}).expect(403);
    await request(ctx.app).post("/api/rebuild").set(HEADER, "manager").send({}).expect(200);
    const session = await request(ctx.app).get("/api/auth/session").set(HEADER, "collector").expect(200);
    assert.deepEqual(session.body.capabilities, { read: true, collect: true, manage: false });
    ctx.close();
  });

  test("proxies browser sessions and blocks cross-origin writes", async () => {
    const ctx = await testApp(async (_input, init) => new Response(
      JSON.stringify({ principal: principal("reader", permissions.reader) }),
      {
        status: init?.method === "DELETE" ? 200 : 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "acme_identity_session=sess_obs; HttpOnly; SameSite=Lax; Path=/",
        },
      },
    ));
    const signedIn = await request(ctx.app)
      .post("/api/auth/session")
      .send({ username: "reader", password: "reader" })
      .expect(201);
    assert.match(String(signedIn.headers["set-cookie"]), /acme_identity_session=sess_obs/);
    await request(ctx.app)
      .post("/api/auth/session")
      .set("origin", "https://malicious.example")
      .send({ username: "reader", password: "reader" })
      .expect(403);
    ctx.close();
  });
});

async function testApp(identityFetchFn: typeof fetch = fetch) {
  const fixture: SourceConfig = {
    id: "fixture-demo",
    kind: "fixture",
    displayName: "Fixture",
    enabled: true,
    pollIntervalMs: 60_000,
  };
  const config: AppConfig = { sources: [fixture], configPath: "fixture", dataDir: ".", port: 8322 };
  const store = new ObservationStore(":memory:");
  store.registerSources(config.sources);
  const collector = new Collector(store, config.sources);
  await collector.collect();
  const app = await createApp({ config, store, collector, authMode: "off", principalResolver, identityFetchFn });
  return { app, close: () => store.close() };
}

function principal(username: string, granted: string[]): Principal {
  return {
    schemaVersion: "acme.principal.v1",
    sub: `dev:${username}`,
    iss: "acme-identity",
    username,
    displayName: username,
    email: `${username}@acme.local`,
    roles: [username],
    permissions: granted,
    kind: "dev",
    authMode: "off",
  };
}
