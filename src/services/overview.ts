import type { Observation, ObservationRef, SourceState } from "../types.js";

export interface TraceSummary {
  id: string;
  title: string;
  state: "active" | "attention" | "waiting" | "complete";
  latestAt: string;
  latestSummary: string;
  observationCount: number;
  sourceCount: number;
  stages: Array<{ name: string; state: "complete" | "active" | "attention" | "waiting" | "pending" }>;
  refs: ObservationRef[];
  observations: Observation[];
}

const stages = ["Intent", "Planning", "Implementation", "Delivery", "Review", "Human decision"];

export function buildDashboard(observations: Observation[], sources: SourceState[]) {
  const traces = buildTraces(observations);
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      active: traces.filter((trace) => trace.state === "active").length,
      attention: traces.filter((trace) => trace.state === "attention").length,
      waiting: traces.filter((trace) => trace.state === "waiting").length,
      complete: traces.filter((trace) => trace.state === "complete").length,
      sourcesReady: sources.filter((source) => source.status === "ready").length,
      sourcesTotal: sources.length,
    },
    sources,
    traces,
    activity: observations.slice(0, 40),
  };
}

export function buildTraces(observations: Observation[]): TraceSummary[] {
  if (observations.length === 0) return [];
  const parent = observations.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (a: number, b: number) => { const x = find(a); const y = find(b); if (x !== y) parent[y] = x; };
  const refs = new Map<string, number>();
  observations.forEach((observation, index) => {
    for (const item of [observation.subject, ...observation.correlations]) {
      if (item.kind === "repository" || item.kind === "project" || item.kind === "commit") continue;
      const key = `${item.namespace}:${item.id}`;
      const previous = refs.get(key);
      if (previous === undefined) refs.set(key, index); else union(previous, index);
    }
  });
  const groups = new Map<number, Observation[]>();
  observations.forEach((observation, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), observation]);
  });
  return [...groups.values()].map(toTrace).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

function toTrace(items: Observation[]): TraceSummary {
  const ordered = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const latest = ordered.at(-1)!;
  const allRefs = uniqueRefs(ordered.flatMap((item) => [item.subject, ...item.correlations]));
  const issue = allRefs.find((item) => item.kind === "issue");
  const issueObservation = ordered.find((item) => item.subject.kind === "issue");
  const title = issueObservation?.summary.replace(/^Issue #\d+ (opened|is \w+): /, "") || (issue ? `Issue #${issue.id}` : latest.summary);
  const latestStatus = String(latest.details?.status ?? "");
  const lastAttention = ordered.reduce((last, item, index) => item.severity === "warning" || item.severity === "error" ? index : last, -1);
  const lastResolution = ordered.reduce((last, item, index) => item.severity === "success" ? index : last, -1);
  const state: TraceSummary["state"] = /merged|closed/.test(latestStatus) ? "complete"
    : /waiting|ready_to_merge/.test(latestStatus) || latest.type.includes("ready.to.merge") || (latest.severity === "success" && latest.category === "human") ? "waiting"
      : lastAttention > lastResolution ? "attention" : "active";
  const stageState = stages.map((name) => {
    const matching = ordered.filter((item) => item.details?.stage === name);
    const last = matching.at(-1);
    let value: TraceSummary["stages"][number]["state"] = "pending";
    if (last) {
      const status = String(last.details?.status ?? "");
      value = status === "complete" ? "complete" : status === "attention" ? "attention" : status === "waiting" ? "waiting" : "active";
    } else if (name === "Intent" && issue) value = "complete";
    else if (name === "Delivery" && allRefs.some((item) => item.kind === "pull-request")) value = "complete";
    else if (name === "Review" && allRefs.some((item) => item.kind === "review")) value = state === "attention" ? "attention" : "complete";
    else if (name === "Human decision" && state === "waiting") value = "waiting";
    return { name, state: value };
  });
  return {
    id: issue ? `issue:${issue.id}` : `${latest.subject.namespace}:${latest.subject.id}`,
    title, state, latestAt: latest.occurredAt, latestSummary: latest.summary,
    observationCount: ordered.length,
    sourceCount: new Set(ordered.map((item) => item.producer.instanceId)).size,
    stages: stageState, refs: allRefs, observations: ordered,
  };
}

function uniqueRefs(items: ObservationRef[]): ObservationRef[] {
  return [...new Map(items.map((item) => [`${item.namespace}:${item.id}`, item])).values()];
}
