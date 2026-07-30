# Acme Observability MVP specification

**Status:** accepted implementation scope

**Product:** `acme-obs`

**Default port:** `8322`

## 1. Objective

Build an optional local observability service for the Acme Software Factory. It collects read-only operational observations from independent products and presents a correlated cross-product timeline without becoming a runtime dependency or source of truth.

The MVP proves the correlated workflow mechanism using Helix and Acme Issues, with compact operational snapshots from Acme Projects and Prelude. It does not attempt intelligence, learning, or comprehensive suite integration.

## 2. Primary users and questions

The primary user is a domain expert demonstrating or inspecting the software-factory mechanism.

The product must answer:

1. Are the configured source services reachable, and when were they last collected successfully?
2. What work is active, paused, interrupted, failed, awaiting review, or completed?
3. What happened in time order across an issue, Helix run, deliverable, PR, and review?
4. Which decisions or state transitions explain the current state?
5. Where did a workflow stop, and what source object should the operator inspect?
6. How long did observable stages take?

## 3. MVP scope

### 3.1 Sources

- One or more Helix instances, each representing a target repository.
- One Acme Issues instance.
- One Acme Projects instance.
- One Prelude instance.
- At most one configured instance for every non-Helix source kind.
- Fully configurable source base URLs; known suite ports are defaults, not identities.
- Source registration through a local configuration file and environment-provided credentials.
- Independent polling, cursor state, health, and error reporting per registered source.

### 3.2 Collection

- Pull-only acquisition over HTTP.
- Initial backfill followed by incremental polling.
- Stable normalized observation IDs and idempotent writes.
- Atomic commit of a poll's observations and its next cursor.
- Bounded exponential backoff after source failure.
- Manual `collect now` operation for one source or all sources.
- Rebuild command that recreates the derived database from configured sources.

### 3.3 Observable data

Collect allowlisted operational facts:

- source health and collection outcomes;
- issue identity, title, lifecycle state, timestamps, and links;
- Helix run identity, status, lineage, timestamps, durable lifecycle events, checkpoint phase, and summarized decisions;
- deliverable and PR references;
- PR-review identity, exact revision references, lifecycle status, decision, findings/check summaries, and timestamps;
- human merge or requested-change state exposed by Acme Issues;
- Acme Projects card column, comment count, and explicit implementation issue linkage;
- Prelude inception state/counts and bootstrap-export adoption state;
- typed correlation references between these objects.

Do not collect raw Pi transcripts, raw prompts, source-code bodies, environment values, tokens, authorization headers, or unrestricted tool output.

### 3.4 User interface

The web UI contains four surfaces:

1. **Overview** — source health, last collection, active/failing counts, and recent activity.
2. **Activity** — newest-first normalized observations with source, type, status/severity, time, and filters.
3. **Work trace** — a chronological correlated view for an issue/run/PR/review, with links back to source systems.
4. **Sources** — configured sources, reachability, cursor, last success/error, and manual collection.

Required filters:

- source instance;
- product kind;
- observation type/category;
- status/severity;
- repository/project reference;
- time range;
- free-text match over allowlisted summary/title fields.

### 3.5 HTTP API

Provide JSON APIs for:

- health and safe configuration;
- source list/detail and manual collection;
- observation list/detail;
- correlated work-trace lookup;
- overview counts and stage-duration summaries;
- database reset/rebuild only through a clearly destructive local operator endpoint or CLI command.

Exact routes may follow the repository's implementation conventions, but UI and CLI must use the same application services.

## 4. Required behavior

### Independence

- Helix, Acme Issues, Acme Projects, and Prelude behave identically when `acme-obs` is stopped or absent.
- Source transactions never wait for or call `acme-obs`.
- No source imports an `acme-obs` package.
- Observation failures never write back to sources.

### Collection correctness

- Repeating the same page does not create duplicate observations.
- A failed page does not advance its source cursor.
- Failure of one adapter does not stop other adapters.
- Unknown event types remain inspectable as generic observations rather than crashing collection.
- Source timestamps and collection timestamps remain distinct.
- Every observation names its producer, adapter version, source object, and source URL when available.

### Correlation

- Correlation uses typed external references, not title matching.
- A work trace may begin from any known issue, run, PR, or review reference.
- The UI labels missing links honestly; it does not infer unproven relationships.
- Long-lived business correlation is not represented as an OpenTelemetry trace ID.

### Safety

- Credentials remain server-side.
- Human API access requires `observability.read`, collection requires `observability.collect`, and rebuild/reset requires `observability.manage` when shared Identity is enabled.
- Identity failure in `local` mode fails closed; public health remains available.
- The observer is a privileged suite-wide projection and does not claim row-level source authorization.
- Payload collection is allowlist-based.
- Malformed source payloads produce adapter diagnostics and do not enter normalized storage.
- UI renders observation content as data, never trusted HTML.
- Source links are validated HTTP(S) URLs from configured origins.

## 5. Non-functional expectations

- Local-first and independently runnable.
- One Node.js process and one SQLite database for the MVP.
- No required cloud services or paid APIs.
- Useful with a few thousand observations; scale engineering is deferred.
- Responsive desktop UI with a functional narrow viewport.
- Deterministic offline tests.
- Clear diagnostics for database path, schema version, source status, counts, and last collection.

## 6. Explicit non-goals

- Intelligence, learning, recommendations, or automatic lessons.
- Primer ingestion or query integration.
- Embeddings, semantic search, or an LLM dependency.
- Automated remediation or writes to source products.
- Alerts, paging, notification routing, or incident management.
- Full log aggregation or arbitrary stdout/stderr ingestion.
- Distributed tracing infrastructure or an OpenTelemetry backend.
- Metrics infrastructure such as Prometheus or Grafana.
- Event brokers, queues, or multi-process workers.
- Row-level or per-source user authorization within the privileged projection.
- Adapters for Primer, Identity, or arbitrary third parties.

## 7. Acceptance journeys

### Journey A: normal lifecycle

1. An issue exists in Acme Issues.
2. A related Helix run executes and delivers a PR.
3. PR control records review evidence.
4. Acme Issues records the human outcome.
5. The observer shows one chronological trace with explicit source links and stage durations.

### Journey B: interruption and recovery

1. A Helix run pauses or becomes interrupted/uncertain.
2. The observer shows the transition and checkpoint context without exposing raw agent content.
3. After the operator resumes or retries in Helix, later polling adds the recovery events to the same trace.
4. The observer performs no recovery action itself.

### Journey C: observer outage

1. Stop `acme-obs` while source products continue changing.
2. Restart it.
3. Collection resumes without duplicates and catches up where source history permits.
4. Source products show no failure caused by the outage.

### Journey D: source outage

1. Stop one configured Helix source.
2. Issues collection and the UI continue.
3. The unavailable source shows its last success and current error.
4. Restart Helix and verify that its adapter recovers independently.

### Journey E: rebuild

1. Export or note the current observation count and representative trace.
2. Delete the observer's derived database through the supported local reset path.
3. Run full collection.
4. The representative trace is reconstructed without changing either source.

## 8. Completion gate

The MVP is complete only when:

- all acceptance journeys are demonstrated;
- `npm run verify` passes offline;
- the production web build succeeds;
- no sibling repository is a runtime import;
- source services remain independently runnable;
- docs match shipped API, configuration, and limitations;
- a clean database can be rebuilt from configured sources.
