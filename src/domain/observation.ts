import { createHash } from "node:crypto";
import type { JsonValue, Observation, ObservationRef } from "../types.js";

export function ref(kind: string, namespace: string, id: string | number): ObservationRef {
  return { kind, namespace, id: String(id) };
}

export function stableId(...parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex").slice(0, 32);
}

export function validateObservation(value: Observation): Observation {
  if (value.schemaVersion !== "acme.observation.v1") throw new Error("Unsupported observation schema");
  if (!value.id || !value.type || !value.summary) throw new Error("Observation id, type, and summary are required");
  if (value.summary.length > 1000) throw new Error("Observation summary exceeds 1000 characters");
  if (!validDate(value.occurredAt) || !validDate(value.observedAt)) throw new Error("Observation timestamps must be valid ISO dates");
  const size = Buffer.byteLength(JSON.stringify(value.details ?? {}));
  if (size > 32 * 1024) throw new Error("Observation details exceed 32 KiB");
  if (value.sourceUrl && !/^https?:\/\//.test(value.sourceUrl)) throw new Error("Observation sourceUrl must be HTTP(S)");
  return value;
}

export function jsonDetails(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
