# Acme Observability agent guide

This repository is a documentation-complete implementation handoff for the optional Acme cross-product observability service.

## Read first

1. [`PROJECT_SPEC.md`](./PROJECT_SPEC.md)
2. [`docs/decisions.md`](./docs/decisions.md)
3. [`docs/architecture.md`](./docs/architecture.md)
4. [`docs/event-contract.md`](./docs/event-contract.md)
5. [`docs/implementation-plan.md`](./docs/implementation-plan.md)

Do not reopen settled product choices unless implementation evidence makes one impossible.

## Invariants

- Source products work with or without this service.
- Observation is read-only and never participates in source-product transactions.
- Source products remain authoritative; the local database is derived and rebuildable.
- Adapters use HTTP or exported public contracts. Never import sibling source code or read sibling SQLite files.
- A failed source poll cannot block another source or corrupt its committed cursor.
- Persist observations and cursor advancement atomically.
- Assume at-least-once acquisition and deduplicate by stable observation ID.
- Store server-side credentials only in environment variables; never expose them to the browser.
- Allowlist collected fields. Do not ingest raw prompts, model transcripts, source code, secrets, authorization headers, or unrestricted tool output.
- Preserve correlation and provenance without inventing a new shared workflow state machine.
- No Primer, embeddings, LLM summarization, recommendation, anomaly intelligence, or write-back in the MVP.
- No Kafka, OpenTelemetry backend, distributed queue, or microservice split in the MVP.

## Ownership

- `acme-obs` owns adapter polling, normalized observations, collection cursors, cross-source correlation views, operational timelines, and its own diagnostics.
- Helix owns runs, agent decisions, sessions, delivery, and PR-control evidence.
- Acme Issues owns issues, PR records, review history, and the human merge record.
- No observation can override or repair source state.

## Expected stack and structure

Use Node.js + TypeScript, Express, React/Vite, SQLite via `better-sqlite3`, and Node's built-in test runner. Keep domain/application logic independent from Express and React.

The planned structure is documented in [`docs/implementation-plan.md`](./docs/implementation-plan.md). Prefer small typed ports: `SourceAdapter`, `ObservationStore`, `Collector`, and query services.

## Validation target

The finished MVP should expose one command:

```bash
npm run verify
```

It must run type checks, unit/integration tests, and the production build without network access or live sibling services. Adapter fixtures and local fake HTTP servers must cover the contracts.

Browser verification should then exercise the representative Issues -> Helix -> PR/review timeline against local services.
