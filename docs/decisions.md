# Settled decisions

These decisions are accepted for the MVP. A future implementation agent should execute them rather than repeat the architecture discussion.

## Product decisions

| Decision | Accepted direction |
|---|---|
| Product scope | Operational observability only |
| First sources | Helix and Acme Issues |
| Integration direction | Observer pulls from sources |
| Source dependency | None; source products never require the observer |
| Authority | Source products are authoritative |
| Observer state | Derived, disposable, and rebuildable SQLite projection |
| Writes to sources | Forbidden in the MVP |
| Intelligence | Deferred entirely |
| Primer | No MVP integration |
| Raw logs/transcripts | Not a general log collector; collect allowlisted domain observations only |
| Deployment | One local Node.js process |
| Default port | `8322` |
| Stack | TypeScript, Express, React/Vite, `better-sqlite3`, Node test runner |
| Authentication | Standalone local access; shared identity deferred |
| Acquisition guarantee | At least once with idempotent normalization |
| Cursor guarantee | Observations and cursor advancement commit atomically |
| Correlation | Typed source references, never title similarity |

## Adapter boundary

Source-specific adapters live in `acme-obs`. They consume stable public HTTP APIs and translate native source objects into `acme.observation.v1`.

Do not introduce a shared runtime library into every product. A JSON contract and fixture-based conformance tests are sufficient.

If an existing source API cannot expose a required transition, the preferred escalation is a minimal optional read-only event/export endpoint in that source. It must expose source-owned facts and must not call the observer. Direct access to a sibling SQLite database is not an acceptable shortcut.

## Observability versus intelligence

Decisions may appear as observed operational facts because they explain a run. The observer does not judge those decisions, derive lessons, compare precedents, generate summaries, or promote records into knowledge.

Future intelligence may consume an explicitly designed export after real observation data shows what is valuable. That future consumer is outside the MVP and must not shape the current schema into a speculative `WorkEpisode` model.

## Deliberately deferred choices

Do not decide these during the MVP unless a completion criterion requires them:

- retention and archival policy;
- Primer episode projection;
- semantic or full-text search beyond simple SQLite text filtering;
- OpenTelemetry export;
- service-to-service identity;
- alerting and notifications;
- hosted deployment;
- multi-user authorization;
- adapters beyond Helix and Acme Issues;
- generalized connector marketplace;
- event streaming, brokers, or webhooks.
