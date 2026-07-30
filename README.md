# Acme Observability

Acme Observability (`acme-obs`) is an optional, read-only view across the independent products in the Acme Software Factory. It answers what is running, what changed, where work stopped, and how related objects such as an issue, Helix run, pull request, and review connect.

**Status:** first runnable observability slice. It includes the standalone SQLite projection, an at-a-glance dashboard, a deterministic sample workflow, and read-only adapters for current Helix, Acme Issues, Acme Projects, and Prelude public APIs.

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

## Quick start

```bash
npm install
npm run verify
npm run dev
```

Open `http://127.0.0.1:8322`. The checked-in `fixture-demo` source immediately seeds a simulated Issues → Helix → PR → review timeline. Helix, Acme Issues, Acme Projects, and Prelude are also polled when present; unavailable sources are shown as offline without making the observer unusable.

The default `ACME_AUTH_MODE=off` resolves the local caller as an admin without requiring Identity. To exercise shared sessions and permissions, run Identity and start the observer with:

```bash
ACME_AUTH_MODE=local ACME_IDENTITY_URL=http://127.0.0.1:8316 npm run dev
```

The web UI uses `observability.read`, manual collection uses `observability.collect`, and rebuild/reset uses `observability.manage`. The projection is a privileged suite-wide view: Identity authenticates and gates capabilities, but this pass does not provide row-level source ACLs. The CLI loads an optional local `.env` before configuration, so credentials provisioned by Identity are available without shell exports.

Configure additional target-repository Helix instances in [`acme-obs.config.json`](./acme-obs.config.json). Each instance gets a stable source ID and logical `repositoryId`. Put tokens only in the environment variable named by `tokenEnv`.

Helix is the only multi-instance source kind: one Helix service may run for each observed target repository. Acme Issues and every other non-Helix service kind are single-instance connections. All service addresses, including ports, come from configuration; the local suite ports below are examples and defaults, never service identity.

Operator commands:

```bash
npx tsx src/cli.ts collect
npx tsx src/cli.ts collect helix-local
npx tsx src/cli.ts sources
npx tsx src/cli.ts rebuild --yes
```

## First vertical slice

The workflow vertical slice still centers on Helix and Acme Issues:

```text
Acme Issues issue
  -> Helix run and specialist activity
  -> interruption, pause, retry, or completion
  -> deliverable and pull request
  -> independent review
  -> human merge or requested changes
```

The fixture tells this story without requiring a real run. Live Helix collection reads durable run and PR-review events. Live Issues collection reads project, issue, PR, and recorded review state through public HTTP APIs.

Acme Projects adds the upstream collaboration-board view, including explicit card-to-issue links when a card has an active implementation. Prelude adds inception and bootstrap-export status. Both adapters intentionally collect compact operational snapshots rather than collaboration prose, briefs, documents, or artifact contents.

The current Issues adapter intentionally labels its records as snapshots. The existing API exposes current state and recorded review history, but not a complete cursor-based transition history; the observer does not invent missing transitions. A source-owned read-only export can be added later if real usage proves it necessary.

## Local defaults

- Web and HTTP API: `http://127.0.0.1:8322`
- Storage: `${ACME_OBS_DATA_DIR:-./data}/acme-obs.db`
- Poll interval: five seconds, independently configurable per source
- Runtime: Node.js, TypeScript, Express, React/Vite, and SQLite
- Authentication: replaceable `off` or Acme Identity `local` mode

These choices match the local suite while keeping this repository independently runnable. Human sessions resolve server-side through Acme Identity in `local` mode. Source bearer tokens remain optional, server-side, and bound to each adapter's configured origin; `npm run provision:suite-auth` in Acme Identity can provision the four initial read-only observer edges.

The first pass uses polling. The accepted later real-time direction is durable cursor-based HTTP history plus an optional source-owned SSE feed, with reconciliation polling after reconnects. The observer initiates those read-only connections; source products do not depend on or call the observer. WebSockets and the settings UI are not implemented in this pass.

## Documents

- [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) — product requirements and acceptance criteria
- [`AGENTS.md`](./AGENTS.md) — implementation entrypoint for future agents
- [`docs/architecture.md`](./docs/architecture.md) — components, data flow, storage, and failure model
- [`docs/event-contract.md`](./docs/event-contract.md) — normalized observation and adapter contracts
- [`docs/decisions.md`](./docs/decisions.md) — settled decisions and explicitly deferred questions
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — ordered implementation and verification plan

## Suite registration

This checkout is an independent local Git repository, but it has no published remote or suite gitlink yet. After it is intentionally published, add it to the Acme root as a real Git submodule and then update the root product map. Do not commit it as ordinary root-repository content. The observer should remain optional even if the suite launcher later offers it as a selection.

## Independence test

The defining acceptance test is simple:

1. Run any configured source products without Acme Observability; their behavior is unchanged.
2. Start Acme Observability; it catches up through read-only polling.
3. Stop it during collection; source products continue normally.
4. Restart it; idempotent polling resumes from the last committed cursor.
5. Delete its database; a full refresh rebuilds the observable projection.
