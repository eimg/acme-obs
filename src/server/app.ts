import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { hasPermission, identityBaseUrl, type AuthMode } from "acme-identity/client";
import type { AppConfig } from "../types.js";
import { Collector } from "../collector/collector.js";
import { buildDashboard } from "../services/overview.js";
import { ObservationStore } from "../state/store.js";
import {
  authenticateRequests,
  authMode as resolveAuthMode,
  principalFrom,
  proxyIdentitySession,
  requirePermission,
  sameOriginWrites,
  type PrincipalResolver,
} from "./auth.js";

export interface AppContext {
  config: AppConfig;
  store: ObservationStore;
  collector: Collector;
  dev?: boolean;
  authMode?: AuthMode;
  principalResolver?: PrincipalResolver;
  identityFetchFn?: typeof fetch;
}

export async function createApp(ctx: AppContext): Promise<Express> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    next();
  });
  app.use("/api", sameOriginWrites());

  const mode = ctx.authMode ?? resolveAuthMode();
  const authenticate = authenticateRequests(ctx.principalResolver, mode);
  const identityFetch = ctx.identityFetchFn ?? fetch;

  app.get("/health", (_req, res) => res.json({ ok: true, product: "acme-obs" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, product: "acme-obs", schemaVersion: 1 }));
  app.get("/api/auth/session", authenticate, (_req, res) => {
    const principal = principalFrom(res)!;
    res.json({
      schemaVersion: "acme.session.v1",
      authMode: mode,
      accountUrl: mode === "local" ? `${identityBaseUrl()}/?tab=account` : undefined,
      principal,
      capabilities: {
        read: hasPermission(principal, "observability.read"),
        collect: hasPermission(principal, "observability.collect"),
        manage: hasPermission(principal, "observability.manage"),
      },
    });
  });
  app.post("/api/auth/session", async (req, res) => {
    await proxyIdentitySession(identityFetch, req, res, "POST");
  });
  app.delete("/api/auth/session", async (req, res) => {
    await proxyIdentitySession(identityFetch, req, res, "DELETE");
  });

  app.get("/api/dashboard", authenticate, requirePermission("observability.read"), (_req, res) => {
    res.json(buildDashboard(ctx.store.listObservations(1000), ctx.store.sourceStates()));
  });
  app.get("/api/sources", authenticate, requirePermission("observability.read"), (_req, res) => res.json(ctx.store.sourceStates()));
  app.get("/api/observations", authenticate, requirePermission("observability.read"), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json(ctx.store.listObservations(limit));
  });
  app.get("/api/observations/:id", authenticate, requirePermission("observability.read"), (req, res) => {
    const observation = ctx.store.getObservation(String(req.params.id));
    if (!observation) return res.status(404).json({ error: "Observation not found" });
    res.json(observation);
  });
  app.post("/api/collect", authenticate, requirePermission("observability.collect"), async (req, res) => {
    const sourceId = typeof req.body?.sourceId === "string" ? req.body.sourceId : undefined;
    try {
      const results = await ctx.collector.collect(sourceId);
      res.status(results.every((result) => result.ok) ? 200 : 207).json({ results });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post("/api/rebuild", authenticate, requirePermission("observability.manage"), async (_req, res) => {
    ctx.store.clear();
    const results = await ctx.collector.collect();
    res.status(results.every((result) => result.ok) ? 200 : 207).json({ results });
  });

  if (ctx.dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({ root: resolve(process.cwd(), "web"), server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const webDir = resolve(currentDir, "../web");
    if (existsSync(webDir)) {
      app.use(express.static(webDir));
      app.get("/{*path}", (_req, res) => res.sendFile(resolve(webDir, "index.html")));
    }
  }
  return app;
}
