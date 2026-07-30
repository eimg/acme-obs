# Implementation plan

**Current first-pass status:** Phases 0 and 1 are implemented, including the fixture-first dashboard. External Helix, Acme Issues, Acme Projects, and Prelude adapters are implemented without source-product changes. Acme Identity integration supports standalone `off` mode and shared-session `local` mode with separate read, collect, and manage gates. Configuration permits multiple Helix instances but only one instance of each other source kind; all service addresses are configurable. Snapshot-based adapters describe current source state honestly rather than inventing lifecycle transitions. Cursor-backed SSE and a configuration/settings UI are accepted later directions, not current behavior. The remaining MVP hardening and live acceptance journeys are still open.

Implement in this order. Each phase should leave `npm run verify` passing.

## Phase 0: repository foundation

Create:

```text
package.json
tsconfig.json
tsconfig.test.json
vite.config.ts
src/
  domain/
  adapters/
  collector/
  state/
  services/
  server/
web/src/
test/
fixtures/
```

Use ESM TypeScript, Express, React/Vite, `better-sqlite3`, and Node's test runner. Provide `dev`, `typecheck`, `test`, `build`, and `verify` scripts. Tests must not require live services.

Exit:

- health API;
- empty UI shell;
- SQLite migration runner;
- safe configuration snapshot;
- `npm run verify` passes.

## Phase 1: contracts and store

Implement:

- `Observation` runtime validation;
- `SourceAdapter` port;
- source registry configuration;
- SQLite schema from `architecture.md`;
- transactional `savePage(sourceId, observations, nextCursor)`;
- observation list/detail and source diagnostics services;
- deterministic fake adapter and fixtures.

Essential tests:

- duplicate IDs are idempotent;
- observation insertion and cursor advancement are atomic;
- malformed observations cannot advance a cursor;
- source credentials do not appear in safe configuration or serialized source rows;
- database rebuild from fixtures is deterministic.

## Phase 2: Helix vertical slice

Inspect the current Helix public APIs before coding the adapter. Prefer existing `/runs`, `/runs/:id`, `/runs/:id/events`, `/pr-reviews`, and review-detail/event surfaces.

Implement backfill and incremental polling with fixture-captured responses. Map only allowlisted fields from [`event-contract.md`](./event-contract.md).

Exit:

- run timeline displays decisions, specialists, pause/recovery, delivery, and completion;
- PR-review observations correlate to run/PR/repository/revision where source data supports it;
- no raw model/tool output is stored;
- Helix unavailability is isolated and visible.

## Phase 3: Acme Issues adapter and cross-product correlation

Inspect actual Issues APIs and lifecycle persistence. Use existing public APIs where they preserve sufficient history. If they do not, add a minimal read-only, cursor-based event export to Acme Issues in a separate repository change.

Implement typed references shared with the Helix mapping. Add bounded correlation traversal.

Exit:

- one trace connects issue, Helix run, PR, review, and human outcome using explicit identifiers;
- missing correlation data is visible rather than guessed;
- repeated polling and observer outages create no duplicates.

## Phase 4: operator UI

Build the four specified surfaces:

- Overview;
- Activity;
- Work trace;
- Sources.

Use server-side filtering/pagination. Keep URLs shareable for an observation and a trace seed reference. Show source links, exact timestamps, collection lag, and explicit error states.

Exit:

- desktop and narrow viewport journeys pass;
- no console errors;
- observer and individual source outages are understandable from the UI;
- manual collection does not imply source mutation.

## Phase 5: hardening and handoff

Add:

- categorized adapter/collection errors;
- bounded retry/backoff;
- diagnostics and schema version;
- reset/rebuild command with explicit confirmation;
- fixture refresh instructions;
- complete configuration and operation docs;
- browser acceptance runbook.

Run the five acceptance journeys in `PROJECT_SPEC.md` against local sources, with Helix and Acme Issues providing the correlated workflow journey.

## Suggested configuration

Use a checked-in, non-secret JSON file:

```json
{
  "sources": [
    {
      "id": "issues-local",
      "kind": "acme-issues",
      "displayName": "Acme Issues",
      "baseUrl": "http://127.0.0.1:8320",
      "pollIntervalMs": 5000,
      "tokenEnv": "ACME_OBS_ISSUES_TOKEN"
    },
    {
      "id": "helix-todo",
      "kind": "helix",
      "displayName": "Helix - Acme Todo",
      "baseUrl": "http://127.0.0.1:8319",
      "repositoryId": "acme-todo",
      "pollIntervalMs": 5000,
      "tokenEnv": "ACME_OBS_HELIX_TODO_TOKEN"
    }
  ]
}
```

Environment:

```text
PORT=8322
ACME_OBS_DATA_DIR=./data
ACME_OBS_CONFIG=./acme-obs.config.json
```

Do not put tokens in the JSON file.

## Implementation cautions

- Keep the Helix and Issues workflow slice coherent as additional snapshot sources are added.
- Do not make source products emit synchronous telemetry calls.
- Do not introduce a shared package dependency into source repositories.
- Do not confuse operational correlation with a learning episode.
- Do not use titles or timestamps to invent cross-product links.
- Do not expose full Helix event details without an allowlist.
- Do not claim a snapshot poll captures transitions that the source no longer exposes.
- Do not add Primer merely because the stored observations could someday be useful there.
