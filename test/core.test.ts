import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import request from "supertest";
import { FixtureAdapter, fixtureStory } from "../src/adapters/fixture.js";
import { HelixAdapter } from "../src/adapters/helix.js";
import { IssuesAdapter } from "../src/adapters/issues.js";
import { PreludeAdapter } from "../src/adapters/prelude.js";
import { ProjectsAdapter } from "../src/adapters/projects.js";
import { Collector } from "../src/collector/collector.js";
import { loadLocalEnv, validateSourceCardinality } from "../src/config.js";
import { createApp } from "../src/server/app.js";
import { buildDashboard } from "../src/services/overview.js";
import { ObservationStore } from "../src/state/store.js";
import type { AppConfig, SourceConfig } from "../src/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function source(kind: SourceConfig["kind"], id: string = kind): SourceConfig {
  return { id, kind, displayName: id, baseUrl: kind === "fixture" ? undefined : "http://source.test", enabled: true, pollIntervalMs: 5000 };
}

describe("standalone projection", () => {
  test("loads optional provisioned source credentials from local .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "acme-obs-env-"));
    const key = "ACME_OBS_TEST_PROVISIONED_TOKEN";
    delete process.env[key];
    writeFileSync(join(cwd, ".env"), `${key}=svc_test\n`);
    loadLocalEnv(cwd);
    assert.equal(process.env[key], "svc_test");
    delete process.env[key];
    rmSync(cwd, { recursive: true, force: true });
  });

  test("only Helix may have multiple configured instances", () => {
    assert.doesNotThrow(() => validateSourceCardinality([
      source("helix", "helix-todo"),
      source("helix", "helix-checkout"),
      source("acme-issues", "issues-local"),
      source("acme-projects", "projects-local"),
      source("prelude", "prelude-local"),
      source("fixture", "fixture-demo"),
    ]));
    assert.throws(() => validateSourceCardinality([
      source("acme-issues", "issues-a"),
      source("acme-issues", "issues-b"),
    ]), /Only one acme-issues source/);
    assert.throws(() => validateSourceCardinality([
      source("fixture", "fixture-a"),
      source("fixture", "fixture-b"),
    ]), /Only one fixture source/);
  });

  test("fixture seeding is deterministic and idempotent", async () => {
    const adapter = new FixtureAdapter();
    const first = await adapter.poll({ source: source("fixture") });
    const second = await adapter.poll({ source: source("fixture") }, first.nextCursor);
    assert.equal(first.observations.length, 9);
    assert.equal(second.observations.length, 0);
    assert.deepEqual(fixtureStory("demo", 1000).map((item) => item.id), fixtureStory("demo", 2000).map((item) => item.id));
  });

  test("invalid observations cannot advance a cursor", () => {
    const store = new ObservationStore(":memory:");
    store.registerSources([source("fixture")]);
    const invalid = { ...fixtureStory("fixture", 1000)[0], occurredAt: "not-a-date" };
    assert.throws(() => store.savePage("fixture", [invalid], { page: 2 }), /timestamps/);
    assert.equal(store.cursor("fixture"), undefined);
    assert.equal(store.listObservations().length, 0);
    store.close();
  });

  test("repeated pages do not duplicate the projection", () => {
    const store = new ObservationStore(":memory:");
    store.registerSources([source("fixture")]);
    const story = fixtureStory("fixture", 1000);
    store.savePage("fixture", story, { seeded: true });
    store.savePage("fixture", story, { seeded: true });
    assert.equal(store.listObservations().length, story.length);
    store.close();
  });

  test("dashboard correlates the sample lifecycle into one at-a-glance trace", () => {
    const story = fixtureStory("fixture", Date.now());
    const dashboard = buildDashboard(story, []);
    assert.equal(dashboard.traces.length, 1);
    assert.equal(dashboard.traces[0].state, "waiting");
    assert.deepEqual(dashboard.traces[0].stages.map((stage) => stage.state), ["complete", "complete", "complete", "complete", "complete", "waiting"]);
  });

  test("HTTP app is useful with only the fixture source", async () => {
    const config: AppConfig = { sources: [source("fixture")], configPath: "fixture", dataDir: ".", port: 8322 };
    const store = new ObservationStore(":memory:");
    store.registerSources(config.sources);
    const collector = new Collector(store, config.sources);
    await collector.collect();
    const app = await createApp({ config, store, collector });
    const response = await request(app).get("/api/dashboard").expect(200);
    assert.equal(response.body.summary.sourcesReady, 1);
    assert.equal(response.body.traces.length, 1);
    store.close();
  });
});

describe("external adapters", () => {
  test("Helix adapter maps durable events and excludes raw streaming deltas", async () => {
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      const payload = path === "/health" ? { ok: true }
        : path === "/runs" ? [{ id: "run-1" }]
          : path === "/runs/run-1" ? {
              id: "run-1", status: "done", startedAt: 1000,
              issue: { title: "Safe retries", external: { issueId: 42 } },
              events: [
                { ts: 1100, type: "run_started", summary: "Run started" },
                { ts: 1200, type: "specialist_output_delta", summary: "secret stream" },
                { ts: 1300, type: "run_done", summary: "Run done" },
              ],
            }
            : [];
      return Response.json(payload);
    };
    const adapter = new HelixAdapter();
    const page = await adapter.poll({ source: source("helix") });
    assert.equal(page.observations.length, 2);
    assert.equal(page.observations.some((item) => item.summary.includes("secret")), false);
    assert.equal(page.observations[0].correlations.some((item) => item.namespace === "acme-issues.issue" && item.id === "42"), true);
  });

  test("Issues adapter uses snapshots honestly and includes recorded review outcome", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const payload = path === "/api/health" ? { ok: true }
        : path === "/api/projects" ? [{ slug: "todo" }]
          : path.endsWith("/issues") ? { items: [{ id: 42, title: "Safe retries", status: "in_progress", createdAt: 1000, updatedAt: 2000, url: "http://issues.test/?issue=42" }] }
            : path.endsWith("/pull-requests") ? [{ id: 17, issueId: 42, title: "Safe retries", status: "ready_to_merge", createdAt: 2000, updatedAt: 3000, headSha: "abc" }]
              : { reviews: [{ id: 1, reviewRunId: "review-1", status: "completed", decision: "ready_to_merge", summary: "Looks good", startedAt: 3000, finishedAt: 4000, findings: [], checks: [] }] };
      return Response.json(payload);
    };
    const adapter = new IssuesAdapter();
    const page = await adapter.poll({ source: source("acme-issues") });
    assert.equal(page.observations.length, 3);
    assert.match(String(page.observations[0].details?.snapshot), /not inferred/);
    assert.equal(page.observations.some((item) => item.type === "review.snapshot.ready_to_merge"), true);
  });

  test("Projects adapter maps board stage and explicit issue linkage without private card content", async () => {
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      const payload = path === "/api/projects" ? [{ id: 7, name: "Checkout" }]
        : {
            columns: [{
              id: "in_progress",
              cards: [{
                id: 5,
                title: "Safer retries",
                decisions: "private decision detail",
                commentCount: 3,
                createdAt: 1000,
                updatedAt: 2000,
                activeImplementation: { issueId: 42 },
              }],
            }],
          };
      return Response.json(payload);
    };
    const adapter = new ProjectsAdapter();
    const page = await adapter.poll({ source: source("acme-projects") });
    assert.equal(page.observations.length, 1);
    assert.equal(page.observations[0].type, "project-card.snapshot.in-progress");
    assert.equal(page.observations[0].correlations.some((item) => item.namespace === "acme-issues.issue" && item.id === "42"), true);
    assert.equal(JSON.stringify(page.observations[0]).includes("private decision detail"), false);
  });

  test("Prelude adapter maps inception and bootstrap adoption snapshots", async () => {
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      const payload = path === "/api/inceptions" ? [{
        id: 9,
        name: "Returns portal",
        status: "exported",
        documentCount: 4,
        artifactCount: 1,
        primerNoteCount: 2,
        latestExportVersion: 3,
        createdAt: 1000,
        updatedAt: 3000,
      }] : [{
        id: 12,
        inceptionId: 9,
        inceptionName: "Returns portal",
        version: 3,
        adoptionStatus: "adopted",
        createdAt: 3000,
        adoptedAt: 4000,
      }];
      return Response.json(payload);
    };
    const adapter = new PreludeAdapter();
    const page = await adapter.poll({ source: source("prelude") });
    assert.equal(page.observations.length, 2);
    assert.equal(page.observations.some((item) => item.type === "inception.snapshot.exported"), true);
    assert.equal(page.observations.some((item) => item.type === "bootstrap-export.snapshot.adopted"), true);
    assert.equal(page.observations[1].correlations.some((item) => item.namespace === "prelude.inception" && item.id === "9"), true);
  });
});
