import { jsonDetails, ref, stableId } from "../domain/observation.js";
import type { AdapterContext, Observation, ObservationRef, SourceAdapter } from "../types.js";
import { array, getJson, iso, object, text } from "./common.js";

export class HelixAdapter implements SourceAdapter {
  readonly kind = "helix" as const;
  readonly version = "1";

  async checkHealth(ctx: AdapterContext) {
    const health = object(await getJson(ctx, "/health"));
    return { ok: health?.ok === true, message: health?.ok === true ? "Helix reachable" : "Unexpected health response" };
  }

  async poll(ctx: AdapterContext) {
    const observations: Observation[] = [];
    const summaries = array(await getJson(ctx, "/runs?limit=100"));
    for (const summary of summaries) {
      const item = object(summary);
      const id = text(item?.id);
      if (!id) continue;
      const run = object(await getJson(ctx, `/runs/${encodeURIComponent(id)}`));
      if (run) observations.push(...mapRun(ctx, run));
    }
    try {
      const reviews = array(await getJson(ctx, "/pr-reviews?limit=100"));
      for (const value of reviews) {
        const summary = object(value);
        const id = text(summary?.id);
        if (!id) continue;
        const review = object(await getJson(ctx, `/pr-reviews/${encodeURIComponent(id)}`));
        if (review) observations.push(...mapReview(ctx, review));
      }
    } catch (error) {
      if (!String(error).includes("501")) throw error;
    }
    return { observations, nextCursor: { snapshotAt: new Date().toISOString() }, hasMore: false };
  }
}

function mapRun(ctx: AdapterContext, run: Record<string, unknown>): Observation[] {
  const runId = text(run.id);
  const issue = object(run.issue);
  const external = object(issue?.external);
  const runRef = ref("run", "helix.run", runId);
  const refs: ObservationRef[] = [];
  if (external?.issueId !== undefined) refs.push(ref("issue", "acme-issues.issue", String(external.issueId)));
  if (ctx.source.repositoryId) refs.push(ref("repository", "git.repository", ctx.source.repositoryId));
  if (run.parentRunId) refs.push(ref("run", "helix.run", text(run.parentRunId)));
  const pr = object(run.pullRequest);
  if (pr?.number !== undefined) refs.push(ref("pull-request", "acme-issues.pull-request", String(pr.number)));
  const events = array(run.events);
  if (events.length === 0) {
    const status = text(run.status) || "unknown";
    return [make(ctx, `run.${status}`, runRef, refs, iso(run.startedAt), `Helix run ${status}: ${text(issue?.title) || runId}`, statusSeverity(status), { status })];
  }
  return events.flatMap((value, index) => {
    const event = object(value);
    if (!event) return [];
    const eventType = text(event.type) || "unknown";
    if (eventType.endsWith("output_delta") || eventType === "specialist_activity") return [];
    return [make(ctx, eventType.replaceAll("_", "."), runRef, refs, iso(event.ts, Number(run.startedAt)), text(event.summary) || `Helix ${eventType}`, eventSeverity(eventType), {
      status: text(run.status),
      eventIndex: index,
      checkpointPhase: text(object(run.checkpoint)?.phase),
    }, `${runId}:${index}:${event.ts ?? ""}:${eventType}`)];
  });
}

function mapReview(ctx: AdapterContext, review: Record<string, unknown>): Observation[] {
  const reviewId = text(review.id);
  const request = object(review.request);
  const pullRequest = object(request?.pullRequest);
  const subject = ref("review", "helix.pr-review", reviewId);
  const refs: ObservationRef[] = [];
  if (pullRequest?.id !== undefined) refs.push(ref("pull-request", "acme-issues.pull-request", String(pullRequest.id)));
  const issue = object(pullRequest?.issue);
  if (issue?.id !== undefined) refs.push(ref("issue", "acme-issues.issue", String(issue.id)));
  if (ctx.source.repositoryId) refs.push(ref("repository", "git.repository", ctx.source.repositoryId));
  return array(review.events).flatMap((value, index) => {
    const event = object(value);
    if (!event) return [];
    const type = text(event.type) || "unknown";
    return [make(ctx, type.replaceAll("_", "."), subject, refs, iso(event.ts, Number(review.startedAt)), text(event.summary) || `Review ${type}`, eventSeverity(type), {
      decision: text(review.decision), status: text(review.status), specialist: text(event.specialist), eventIndex: index,
    }, `${reviewId}:${index}:${event.ts ?? ""}:${type}`, "review")];
  });
}

function make(ctx: AdapterContext, type: string, subject: ObservationRef, correlations: ObservationRef[], occurredAt: string, summary: string, severity: Observation["severity"], details: Record<string, unknown>, identity = `${subject.id}:${occurredAt}:${type}`, category: Observation["category"] = categoryFor(type)): Observation {
  return {
    schemaVersion: "acme.observation.v1",
    id: `${ctx.source.id}:${stableId(identity)}`,
    producer: { product: "helix", instanceId: ctx.source.id, adapterVersion: "1" },
    type, category, severity, occurredAt, observedAt: new Date().toISOString(), subject, correlations,
    summary: summary.slice(0, 1000), details: jsonDetails(details),
    sourceUrl: `${ctx.source.baseUrl}/?run=${encodeURIComponent(subject.id)}`,
  };
}

function categoryFor(type: string): Observation["category"] {
  if (type.includes("review")) return "review";
  if (type.includes("delivery")) return "delivery";
  if (type.includes("decid")) return "decision";
  return "execution";
}

function eventSeverity(type: string): Observation["severity"] {
  if (/error|escalated|blocked/.test(type)) return "error";
  if (/interrupted|pause|retry|finding/.test(type)) return "warning";
  if (/finished|done|completed|prepared/.test(type)) return "success";
  return "info";
}

function statusSeverity(status: string): Observation["severity"] {
  return /error|escalated/.test(status) ? "error" : /paused|interrupted/.test(status) ? "warning" : /done/.test(status) ? "success" : "info";
}
