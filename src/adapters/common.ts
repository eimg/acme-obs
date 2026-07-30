import type { AdapterContext, JsonValue } from "../types.js";

export async function getJson(ctx: AdapterContext, path: string): Promise<JsonValue> {
  const base = ctx.source.baseUrl;
  if (!base) throw new Error(`Source ${ctx.source.id} has no base URL`);
  const url = new URL(path, `${base}/`);
  if (url.origin !== new URL(base).origin) throw new Error("Adapter path escaped the configured source origin");
  const token = ctx.source.tokenEnv ? process.env[ctx.source.tokenEnv] : undefined;
  const response = await fetch(url, {
    signal: ctx.signal,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url.pathname}`);
  return await response.json() as JsonValue;
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown): string { return typeof value === "string" ? value : ""; }
export function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
export function iso(value: unknown, fallback = Date.now()): string {
  const parsed = number(value) ?? (typeof value === "string" ? Date.parse(value) : NaN);
  return new Date(Number.isFinite(parsed) ? parsed : fallback).toISOString();
}
