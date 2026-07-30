import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, SourceConfig, SourceKind } from "./types.js";

const sourceKinds = new Set<SourceKind>(["fixture", "helix", "acme-issues", "acme-projects", "prelude"]);

export function loadLocalEnv(cwd = process.cwd()): void {
  try {
    process.loadEnvFile(resolve(cwd, ".env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const configPath = resolve(cwd, env.ACME_OBS_CONFIG || "acme-obs.config.json");
  let raw: unknown = { sources: [] };
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (env.ACME_OBS_CONFIG) throw error;
  }
  const list = typeof raw === "object" && raw && Array.isArray((raw as { sources?: unknown }).sources)
    ? (raw as { sources: unknown[] }).sources
    : [];
  const sources = list.map(parseSource);
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  validateSourceCardinality(sources);
  return {
    sources,
    configPath,
    dataDir: resolve(cwd, env.ACME_OBS_DATA_DIR || "data"),
    port: parsePort(env.PORT),
  };
}

export function validateSourceCardinality(sources: SourceConfig[]): void {
  const singletonKinds = new Set<SourceKind>();
  for (const source of sources) {
    if (source.kind === "helix") continue;
    if (singletonKinds.has(source.kind)) {
      throw new Error(`Only one ${source.kind} source may be configured; only Helix supports multiple instances`);
    }
    singletonKinds.add(source.kind);
  }
}

function parseSource(value: unknown): SourceConfig {
  if (!value || typeof value !== "object") throw new Error("Each source must be an object");
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const kind = text(row.kind) as SourceKind;
  const displayName = text(row.displayName);
  if (!id || !sourceKinds.has(kind) || !displayName) throw new Error("Source id, kind, and displayName are required");
  const baseUrl = text(row.baseUrl);
  if (kind !== "fixture" && !baseUrl) throw new Error(`Source ${id} requires baseUrl`);
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) throw new Error(`Source ${id} baseUrl must be HTTP(S)`);
  return {
    id,
    kind,
    displayName,
    ...(baseUrl ? { baseUrl: baseUrl.replace(/\/$/, "") } : {}),
    ...(text(row.repositoryId) ? { repositoryId: text(row.repositoryId) } : {}),
    enabled: row.enabled !== false,
    pollIntervalMs: finite(row.pollIntervalMs, 5000, 1000, 300000),
    ...(text(row.tokenEnv) ? { tokenEnv: text(row.tokenEnv) } : {}),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function parsePort(value: string | undefined): number {
  const port = Number(value || 8322);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 8322;
}
