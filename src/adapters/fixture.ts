import { ref, stableId } from "../domain/observation.js";
import type { AdapterContext, Observation, SourceAdapter } from "../types.js";

export class FixtureAdapter implements SourceAdapter {
  readonly kind = "fixture" as const;
  readonly version = "1";

  async checkHealth(): Promise<{ ok: boolean; message: string }> { return { ok: true, message: "Built-in simulation ready" }; }

  async poll(ctx: AdapterContext, cursor?: unknown) {
    if (cursor && typeof cursor === "object" && (cursor as { seeded?: unknown }).seeded === true) {
      return { observations: [], nextCursor: { seeded: true }, hasMore: false };
    }
    return { observations: fixtureStory(ctx.source.id), nextCursor: { seeded: true }, hasMore: false };
  }
}

export function fixtureStory(instanceId = "fixture-demo", now = Date.now()): Observation[] {
  const minute = 60_000;
  const issue = ref("issue", "acme-issues.issue", "42");
  const run = ref("run", "helix.run", "run-demo-42");
  const pr = ref("pull-request", "acme-issues.pull-request", "17");
  const review = ref("review", "helix.pr-review", "review-demo-17");
  const repository = ref("repository", "git.repository", "acme-todo");
  const events: Array<[number, string, Observation["category"], Observation["severity"], typeof issue, typeof issue[], string, Record<string, string>]> = [
    [68, "issue.created", "work", "info", issue, [repository], "Issue #42 opened: Make checkout retries safe", { stage: "Intent", status: "complete" }],
    [61, "run.started", "execution", "info", run, [issue, repository], "Helix accepted the work and started a planner", { stage: "Planning", status: "active" }],
    [54, "orchestrator.decided", "decision", "info", run, [issue, repository], "Plan approved: isolate retry state before changing the checkout flow", { stage: "Planning", status: "complete" }],
    [43, "specialist.finished", "execution", "success", run, [issue, repository], "Developer completed the retry-state implementation", { stage: "Implementation", status: "complete" }],
    [35, "delivery.finished", "delivery", "success", pr, [issue, run, repository], "Local PR #17 registered with 6 files changed", { stage: "Delivery", status: "complete" }],
    [27, "review.started", "review", "info", review, [issue, run, pr, repository], "Independent review started at the exact head revision", { stage: "Review", status: "active" }],
    [18, "review.finding", "review", "warning", review, [issue, run, pr, repository], "Verifier found a missing timeout regression case", { stage: "Review", status: "attention" }],
    [8, "review.completed", "review", "success", review, [issue, run, pr, repository], "Review passed after the timeout coverage was added", { stage: "Review", status: "complete" }],
    [3, "pr.ready_to_merge", "human", "success", pr, [issue, run, review, repository], "PR #17 is ready for a human merge decision", { stage: "Human decision", status: "waiting" }],
  ];
  return events.map(([minutesAgo, type, category, severity, subject, correlations, summary, details], index) => ({
    schemaVersion: "acme.observation.v1",
    id: `${instanceId}:${stableId(type, subject.id, index)}`,
    producer: { product: index === 0 || index === 4 || index === 8 ? "acme-issues" : "helix", instanceId, adapterVersion: "fixture-1" },
    type, category, severity,
    occurredAt: new Date(now - minutesAgo * minute).toISOString(),
    observedAt: new Date(now).toISOString(),
    subject, correlations, summary, details,
    sourceUrl: undefined,
  }));
}
