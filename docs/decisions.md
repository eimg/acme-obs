# Settled decisions

These decisions are accepted for the MVP. A future implementation agent should execute them rather than repeat the architecture discussion.

## Product decisions

| Decision | Accepted direction |
|---|---|
| Product scope | Operational observability only |
| Shipped sources | Helix, Acme Issues, Acme Projects, and Prelude |
| Source cardinality | Multiple Helix instances; one instance for every other source kind |
| Service addresses | Configured base URLs; default ports are examples, never service identity |
| Integration direction | Observer pulls from sources |
| Source dependency | None; source products never require the observer |
| Authority | Source products are authoritative |
| Observer state | Derived, disposable, and rebuildable SQLite projection |
| Writes to sources | Forbidden in the MVP |
| Intelligence | Out of Observability scope; Acme Intel is the separate optional think-lab that may pull allowlisted observations |
| Primer | No MVP integration |
| Acme Steering | No shipped adapter; a later adapter may project allowlisted operational facts but never provide decision or action authority |
| Raw logs/transcripts | Not a general log collector; collect allowlisted domain observations only |
| Deployment | One local Node.js process |
| Default port | `8322` |
| Stack | TypeScript, Express, React/Vite, `better-sqlite3`, Node test runner |
| Authentication | Standalone `off` mode or shared Acme Identity sessions in `local` mode |
| Authorization | `observability.read`, `observability.collect`, and `observability.manage`; no row-level ACLs |
| Acquisition guarantee | At least once with idempotent normalization |
| Cursor guarantee | Observations and cursor advancement commit atomically |
| Later real-time direction | Durable cursor history plus optional source-owned SSE and polling reconciliation |
| WebSockets | Not needed for the accepted one-way observation flow |
| Correlation | Typed source references, never title similarity |

## Adapter boundary

Source-specific adapters live in `acme-obs`. They consume stable public HTTP APIs and translate native source objects into `acme.observation.v1`.

Do not introduce a shared runtime library into every product. A JSON contract and fixture-based conformance tests are sufficient.

If an existing source API cannot expose a required transition, the preferred escalation is a minimal optional read-only event/export endpoint in that source. It must expose source-owned facts and must not call the observer. Direct access to a sibling SQLite database is not an acceptable shortcut.

Helix is the only source kind with multiple configured instances because instances run against different target repositories. Acme Issues, Acme Projects, Prelude, and future non-Helix suite services are single-instance connections even when their configured host or port changes.

Polling remains the shipped baseline. A later low-latency adapter may connect to a source-owned SSE feed after replaying durable cursor-based history, then use polling to reconcile after disconnection. This remains observer-initiated and optional for every source. Do not add source-to-observer webhooks or bidirectional WebSockets merely to claim real-time behavior.

## Observability versus intelligence

Decisions may appear as observed operational facts because they explain a run. The observer does not judge those decisions, derive lessons, compare precedents, generate summaries, or promote records into knowledge.

Future intelligence may consume an explicitly designed export after real observation data shows what is valuable. That future consumer is outside the MVP and must not shape the current schema into a speculative `WorkEpisode` model.

## Deliberately deferred choices

Do not decide these during the MVP unless a completion criterion requires them:

- retention and archival policy;
- Primer episode projection;
- semantic or full-text search beyond simple SQLite text filtering;
- OpenTelemetry export;
- automatic service-token provisioning beyond the initial local source edges;
- alerting and notifications;
- hosted deployment;
- row-level or per-source user authorization;
- adapters beyond Helix, Acme Issues, Acme Projects, and Prelude;
- read-only Acme Steering projection;
- generalized connector marketplace;
- source configuration/settings UI;
- implementation of optional cursor-history and SSE endpoints;
- event brokers or source-to-observer webhooks.
