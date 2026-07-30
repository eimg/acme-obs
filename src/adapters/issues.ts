import { jsonDetails, ref, stableId } from "../domain/observation.js";
import type { AdapterContext, Observation, ObservationRef, SourceAdapter } from "../types.js";
import { array, getJson, iso, object, text } from "./common.js";

export class IssuesAdapter implements SourceAdapter {
  readonly kind = "acme-issues" as const;
  readonly version = "1";

  async checkHealth(ctx: AdapterContext) {
    const health = object(await getJson(ctx, "/api/health"));
    return { ok: health?.ok === true, message: health?.ok === true ? "Acme Issues reachable" : "Unexpected health response" };
  }

  async poll(ctx: AdapterContext) {
    const observations: Observation[] = [];
    const projects = array(await getJson(ctx, "/api/projects"));
    for (const value of projects) {
      const project = object(value);
      const slug = text(project?.slug);
      if (!slug) continue;
      const issuesResult = object(await getJson(ctx, `/api/projects/${encodeURIComponent(slug)}/issues?limit=100`));
      for (const issue of array(issuesResult?.items)) {
        const item = object(issue);
        if (item) observations.push(mapIssue(ctx, slug, item));
      }
      for (const value of array(await getJson(ctx, `/api/projects/${encodeURIComponent(slug)}/pull-requests`))) {
        const pr = object(value);
        if (!pr) continue;
        observations.push(mapPullRequest(ctx, slug, pr));
        const id = pr.id;
        if (id === undefined) continue;
        const detail = object(await getJson(ctx, `/api/projects/${encodeURIComponent(slug)}/pull-requests/${encodeURIComponent(String(id))}`));
        for (const review of array(detail?.reviews)) {
          const item = object(review);
          if (item) observations.push(mapReview(ctx, slug, pr, item));
        }
      }
    }
    return { observations, nextCursor: { snapshotAt: new Date().toISOString() }, hasMore: false };
  }
}

function mapIssue(ctx: AdapterContext, project: string, issue: Record<string, unknown>): Observation {
  const id = String(issue.id);
  const status = text(issue.status) || "unknown";
  const subject = ref("issue", "acme-issues.issue", id);
  return observation(ctx, `issue.snapshot.${status}`, subject, [ref("project", "acme-issues.project", project)], iso(issue.updatedAt, Number(issue.createdAt)), `Issue #${id} is ${status.replaceAll("_", " ")}: ${text(issue.title)}`, status === "closed" ? "success" : status === "in_progress" ? "info" : "info", {
    status, project, snapshot: "Current state from Acme Issues; historical transitions are not inferred",
  }, text(issue.url));
}

function mapPullRequest(ctx: AdapterContext, project: string, pr: Record<string, unknown>): Observation {
  const id = String(pr.id);
  const status = text(pr.status) || "unknown";
  const refs: ObservationRef[] = [ref("project", "acme-issues.project", project)];
  if (pr.issueId !== undefined) refs.push(ref("issue", "acme-issues.issue", String(pr.issueId)));
  if (text(pr.headSha)) refs.push(ref("commit", "git.commit", text(pr.headSha)));
  return observation(ctx, `pull-request.snapshot.${status}`, ref("pull-request", "acme-issues.pull-request", id), refs, iso(pr.updatedAt, Number(pr.createdAt)), `PR #${id} is ${status.replaceAll("_", " ")}: ${text(pr.title)}`, prSeverity(status), {
    status, project, headBranch: text(pr.headBranch), headSha: text(pr.headSha), snapshot: "Current source-owned PR state",
  }, `${ctx.source.baseUrl}/?project=${encodeURIComponent(project)}&pr=${id}`, status === "merged" ? "human" : "delivery");
}

function mapReview(ctx: AdapterContext, project: string, pr: Record<string, unknown>, review: Record<string, unknown>): Observation {
  const reviewId = text(review.reviewRunId) || String(review.id);
  const status = text(review.status) || "unknown";
  const decision = text(review.decision);
  const refs: ObservationRef[] = [ref("pull-request", "acme-issues.pull-request", String(pr.id)), ref("project", "acme-issues.project", project)];
  if (pr.issueId !== undefined) refs.push(ref("issue", "acme-issues.issue", String(pr.issueId)));
  return observation(ctx, `review.snapshot.${decision || status}`, ref("review", "helix.pr-review", reviewId), refs, iso(review.finishedAt, Number(review.startedAt)), decision ? `Review ${decision.replaceAll("_", " ")}: ${text(review.summary) || `PR #${pr.id}`}` : `Review ${status} for PR #${pr.id}`, decision === "ready_to_merge" ? "success" : decision || status === "error" ? "warning" : "info", {
    status, decision, findingCount: array(review.findings).length, checkCount: array(review.checks).length, headSha: text(review.headSha), snapshot: "Review result recorded by Acme Issues",
  }, `${ctx.source.baseUrl}/?project=${encodeURIComponent(project)}&pr=${pr.id}`, "review");
}

function observation(ctx: AdapterContext, type: string, subject: ObservationRef, correlations: ObservationRef[], occurredAt: string, summary: string, severity: Observation["severity"], details: Record<string, unknown>, sourceUrl?: string, category: Observation["category"] = "work"): Observation {
  return {
    schemaVersion: "acme.observation.v1",
    id: `${ctx.source.id}:${stableId(type, subject.namespace, subject.id, occurredAt)}`,
    producer: { product: "acme-issues", instanceId: ctx.source.id, adapterVersion: "1" },
    type, category, severity, occurredAt, observedAt: new Date().toISOString(), subject, correlations,
    summary: summary.slice(0, 1000), details: jsonDetails(details), ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function prSeverity(status: string): Observation["severity"] {
  if (status === "blocked" || status === "changes_requested") return "warning";
  if (status === "ready_to_merge" || status === "merged") return "success";
  return "info";
}
