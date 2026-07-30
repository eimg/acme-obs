import { jsonDetails, ref, stableId } from "../domain/observation.js";
import type { AdapterContext, Observation, ObservationRef, SourceAdapter } from "../types.js";
import { array, getJson, iso, object, text } from "./common.js";

export class PreludeAdapter implements SourceAdapter {
  readonly kind = "prelude" as const;
  readonly version = "1";

  async checkHealth(ctx: AdapterContext) {
    const health = object(await getJson(ctx, "/api/health"));
    return { ok: health?.ok === true, message: health?.ok === true ? "Prelude reachable" : "Unexpected health response" };
  }

  async poll(ctx: AdapterContext) {
    const observations: Observation[] = [];
    for (const value of array(await getJson(ctx, "/api/inceptions"))) {
      const inception = object(value);
      if (inception) observations.push(mapInception(ctx, inception));
    }
    for (const value of array(await getJson(ctx, "/api/exports"))) {
      const exportRecord = object(value);
      if (exportRecord) observations.push(mapExport(ctx, exportRecord));
    }
    return { observations, nextCursor: { snapshotAt: new Date().toISOString() }, hasMore: false };
  }
}

function mapInception(ctx: AdapterContext, inception: Record<string, unknown>): Observation {
  const id = String(inception.id);
  const status = text(inception.status) || "unknown";
  const occurredAt = iso(inception.updatedAt, Number(inception.createdAt));
  return {
    schemaVersion: "acme.observation.v1",
    id: `${ctx.source.id}:${stableId("inception", id, status, occurredAt)}`,
    producer: { product: "prelude", instanceId: ctx.source.id, adapterVersion: "1" },
    type: `inception.snapshot.${status}`,
    category: "work",
    severity: status === "exported" ? "success" : "info",
    occurredAt,
    observedAt: new Date().toISOString(),
    subject: ref("inception", "prelude.inception", id),
    correlations: [],
    summary: `Inception is ${status}: ${text(inception.name)}`.slice(0, 1000),
    details: jsonDetails({
      status: status === "accepted" ? "waiting" : status === "exported" ? "complete" : "active",
      inceptionStatus: status,
      documentCount: numberOrZero(inception.documentCount),
      artifactCount: numberOrZero(inception.artifactCount),
      primerNoteCount: numberOrZero(inception.primerNoteCount),
      latestExportVersion: numberOrZero(inception.latestExportVersion),
      stage: "Intent",
    }),
    sourceUrl: `${ctx.source.baseUrl}/?inception=${encodeURIComponent(id)}`,
  };
}

function mapExport(ctx: AdapterContext, exportRecord: Record<string, unknown>): Observation {
  const id = String(exportRecord.id);
  const inceptionId = String(exportRecord.inceptionId);
  const adoptionStatus = text(exportRecord.adoptionStatus) || (exportRecord.adoptedAt ? "adopted" : "available");
  const correlations: ObservationRef[] = [ref("inception", "prelude.inception", inceptionId)];
  const occurredAt = iso(exportRecord.adoptedAt ?? exportRecord.createdAt);
  return {
    schemaVersion: "acme.observation.v1",
    id: `${ctx.source.id}:${stableId("export", id, adoptionStatus, occurredAt)}`,
    producer: { product: "prelude", instanceId: ctx.source.id, adapterVersion: "1" },
    type: `bootstrap-export.snapshot.${adoptionStatus}`,
    category: "delivery",
    severity: adoptionStatus === "adopted" ? "success" : "info",
    occurredAt,
    observedAt: new Date().toISOString(),
    subject: ref("bootstrap-export", "prelude.bootstrap-export", id),
    correlations,
    summary: `Bootstrap export v${numberOrZero(exportRecord.version)} is ${adoptionStatus}: ${text(exportRecord.inceptionName)}`.slice(0, 1000),
    details: jsonDetails({
      adoptionStatus,
      version: numberOrZero(exportRecord.version),
      status: adoptionStatus === "adopted" ? "complete" : "waiting",
      stage: "Delivery",
    }),
    sourceUrl: `${ctx.source.baseUrl}/?inception=${encodeURIComponent(inceptionId)}`,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
