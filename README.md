# Acme Observability

Acme Observability (`acme-obs`) is an optional, read-only view across the independent products in the Acme Software Factory. It answers what is running, what changed, where work stopped, and how related objects such as an issue, Helix run, pull request, and review connect.

**Status:** documentation-only implementation handoff. No runtime has been built yet.

Read [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) for the accepted MVP, [`docs/decisions.md`](./docs/decisions.md) for settled boundaries, and [`docs/implementation-plan.md`](./docs/implementation-plan.md) for the build sequence.

## Product boundary

Acme Observability is:

- optional: every observed product works normally when it is absent;
- read-only: it never triggers, approves, retries, merges, or mutates source products;
- non-authoritative: source products remain the owners of their domain state;
- derived and rebuildable: its SQLite database may be deleted and reconstructed;
- adapter-based: integrations use HTTP contracts, never sibling source imports or private database reads;
- operational: it presents activity, state transitions, failures, timing, and correlation.

It is not an intelligence or knowledge product. The MVP does not generate lessons, recommendations, summaries, embeddings, or Primer records.

## First vertical slice

The MVP observes only Helix and Acme Issues:

```text
Acme Issues issue
  -> Helix run and specialist activity
  -> interruption, pause, retry, or completion
  -> deliverable and pull request
  -> independent review
  -> human merge or requested changes
```

Other products are added later through independent adapters after this path proves the contract.

## Planned local defaults

- Web and HTTP API: `http://127.0.0.1:8322`
- Storage: `${ACME_OBS_DATA_DIR:-./data}/acme-obs.db`
- Poll interval: five seconds, independently configurable per source
- Runtime: Node.js, TypeScript, Express, React/Vite, and SQLite
- Authentication: standalone local access for the MVP; optional identity integration is deferred

These choices match the local suite while keeping this repository independently runnable.

## Documents

- [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) — product requirements and acceptance criteria
- [`AGENTS.md`](./AGENTS.md) — implementation entrypoint for future agents
- [`docs/architecture.md`](./docs/architecture.md) — components, data flow, storage, and failure model
- [`docs/event-contract.md`](./docs/event-contract.md) — normalized observation and adapter contracts
- [`docs/decisions.md`](./docs/decisions.md) — settled decisions and explicitly deferred questions
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — ordered implementation and verification plan

## Suite registration

This checkout is an independent local Git repository, but it has no published remote or suite gitlink yet. After the MVP repository is intentionally published, add it to the Acme root as a real Git submodule and then update the root product map and launcher. Do not commit it as ordinary root-repository content or make the suite launcher depend on it before the standalone service works.

## Independence test

The defining acceptance test is simple:

1. Run Helix and Acme Issues without Acme Observability; their behavior is unchanged.
2. Start Acme Observability; it catches up through read-only polling.
3. Stop it during collection; source products continue normally.
4. Restart it; idempotent polling resumes from the last committed cursor.
5. Delete its database; a full refresh rebuilds the observable projection.
