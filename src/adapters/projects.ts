import { jsonDetails, ref, stableId } from "../domain/observation.js";
import type { AdapterContext, Observation, ObservationRef, SourceAdapter } from "../types.js";
import { array, getJson, iso, object, text } from "./common.js";

export class ProjectsAdapter implements SourceAdapter {
  readonly kind = "acme-projects" as const;
  readonly version = "1";

  async checkHealth(ctx: AdapterContext) {
    const health = object(await getJson(ctx, "/api/health"));
    return { ok: health?.ok === true, message: health?.ok === true ? "Acme Projects reachable" : "Unexpected health response" };
  }

  async poll(ctx: AdapterContext) {
    const observations: Observation[] = [];
    for (const value of array(await getJson(ctx, "/api/projects"))) {
      const project = object(value);
      if (!project || project.id === undefined) continue;
      const board = object(await getJson(ctx, `/api/projects/${encodeURIComponent(String(project.id))}/board`));
      for (const columnValue of array(board?.columns)) {
        const column = object(columnValue);
        const columnId = text(column?.id) || "unknown";
        for (const cardValue of array(column?.cards)) {
          const card = object(cardValue);
          if (card) observations.push(mapCard(ctx, project, columnId, card));
        }
      }
    }
    return { observations, nextCursor: { snapshotAt: new Date().toISOString() }, hasMore: false };
  }
}

function mapCard(ctx: AdapterContext, project: Record<string, unknown>, columnId: string, card: Record<string, unknown>): Observation {
  const cardId = String(card.id);
  const projectId = String(project.id);
  const subject = ref("card", "acme-projects.card", cardId);
  const correlations: ObservationRef[] = [ref("project", "acme-projects.project", projectId)];
  const attempt = object(card.activeImplementation);
  if (attempt?.issueId !== undefined) correlations.push(ref("issue", "acme-issues.issue", String(attempt.issueId)));
  const occurredAt = iso(card.updatedAt, Number(card.createdAt));
  return {
    schemaVersion: "acme.observation.v1",
    id: `${ctx.source.id}:${stableId("card", cardId, columnId, occurredAt)}`,
    producer: { product: "acme-projects", instanceId: ctx.source.id, adapterVersion: "1" },
    type: `project-card.snapshot.${columnId.replaceAll("_", "-")}`,
    category: "work",
    severity: columnId === "done" ? "success" : "info",
    occurredAt,
    observedAt: new Date().toISOString(),
    subject,
    correlations,
    summary: `Project card is ${columnId.replaceAll("_", " ")}: ${text(card.title)}`.slice(0, 1000),
    details: jsonDetails({
      columnId,
      projectName: text(project.name),
      commentCount: typeof card.commentCount === "number" ? card.commentCount : 0,
      implementationLinked: Boolean(attempt),
      status: columnId === "done" ? "complete" : columnId === "ready" ? "waiting" : "active",
      stage: "Intent",
    }),
    sourceUrl: `${ctx.source.baseUrl}/?project=${encodeURIComponent(projectId)}&card=${encodeURIComponent(cardId)}`,
  };
}
