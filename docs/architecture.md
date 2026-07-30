# Architecture

## Shape

```text
Helix HTTP APIs -----> Helix adapters ----\
Issues HTTP API -----> Issues adapter -----+-> collector -> SQLite -> query services -> HTTP API -> React UI
Projects HTTP API ---> Projects adapter ---+
Prelude HTTP API ----> Prelude adapter ----/
```

The arrows are pull-only. Nothing in a source product points to `acme-obs`.

## Components

### Source registry

Loads non-secret source configuration. A source has:

- stable local source ID;
- adapter kind (`helix`, `acme-issues`, `acme-projects`, or `prelude`);
- base URL;
- display name;
- poll interval and enabled flag;
- optional repository/project metadata;
- environment-variable name containing a server-side token, if required.

The registry permits multiple `helix` entries, normally one per target repository. Every other source kind is a singleton. Base URLs are complete configured addresses; ports are not embedded in adapter logic and never identify an instance.

The configuration file remains authoritative for this pass. A future settings UI may edit the same non-secret configuration atomically, but it must not move tokens into browser-visible state or make the derived observation database authoritative for configuration.

The browser receives safe source metadata, never credentials.

### Adapters

Each adapter implements the contract in [`event-contract.md`](./event-contract.md). It owns:

- source API calls and pagination;
- native payload validation;
- incremental cursor interpretation;
- allowlist/redaction policy;
- normalization into observations;
- deterministic IDs when the source lacks native event IDs;
- source-specific correlation references.

Adapters do not persist data themselves.

Polling is the current acquisition mechanism. The accepted later streaming seam is an optional adapter subscription to a source-owned SSE feed backed by durable cursor history. Reconciliation polling remains required so disconnects cannot create permanent gaps. WebSockets are not part of the current one-way contract.

### Collector

The collector runs adapters independently. For each page it:

1. loads the last committed cursor;
2. requests one bounded page;
3. validates every normalized observation;
4. inserts observations idempotently;
5. records the collection attempt;
6. advances the cursor in the same SQLite transaction;
7. schedules the next page or poll.

One source failure records a failed collection run and backoff without affecting other sources.

### Observation store

The store is a derived projection. Suggested tables:

```text
sources
  id, kind, display_name, base_url, enabled, poll_interval_ms

source_cursors
  source_id, cursor_json, updated_at

collection_runs
  id, source_id, started_at, finished_at, status,
  fetched_count, inserted_count, error_code, error_summary

observations
  id, schema_version, source_id, producer, adapter_version,
  type, category, severity, occurred_at, observed_at,
  subject_kind, subject_id, summary, payload_json, source_url

observation_refs
  observation_id, ref_kind, ref_namespace, ref_id
```

Use foreign keys and WAL mode. A uniqueness constraint on `observations.id` provides deduplication. Cursor advancement and observation insertion must share one transaction.

### Correlation query

Correlation is a graph traversal over typed references:

```text
issues.issue:42
helix.run:run-123
issues.pull-request:7
helix.pr-review:review-9
git.repository:/logical/repo-id
git.commit:<sha>
```

Starting from any reference, find observations sharing that reference, collect their other references, and repeat with a conservative depth/breadth bound. Return the chronological observations and the explicit references that connected them.

Do not infer relationships from similar titles, timestamps, or model-generated guesses.

### Query services and API

Application services provide overview, observation search, source diagnostics, manual collection, and correlated traces. Express is only an adapter over these services. React consumes the same JSON API.

## Failure and recovery model

| Failure | Required behavior |
|---|---|
| Observer stopped | Sources are unaffected; collection catches up after restart |
| One source unavailable | Other sources continue; last success and current error remain visible |
| Malformed source item | Fail that page, record a categorized diagnostic, do not advance cursor |
| Duplicate page/event | Unique observation ID turns it into a no-op |
| Process dies during commit | SQLite transaction preserves the previous cursor and observations |
| Database deleted | Full collection rebuilds the projection |
| Unknown event type | Store it as a generic valid observation if the envelope is safe |

## Security boundary

- `ACME_AUTH_MODE=off` preserves standalone development; `local` resolves browser sessions and bearer principals through Acme Identity.
- Dashboard and trace APIs require `observability.read`; manual collection requires `observability.collect`; rebuild/reset requires `observability.manage`.
- Identity outages fail closed in `local` mode. Liveness endpoints remain public.
- The projection is privileged and suite-wide. It does not filter observations by source ACL or actor.
- Source adapters execute server-side.
- Configure trusted source origins explicitly.
- Attach credentials only to the exact configured origin.
- Use allowlists for payload fields.
- Truncate bounded text fields and record truncation metadata.
- Never render source HTML.
- Do not expose filesystem paths unless they are deliberately classified as safe local diagnostics.
- Preserve source authorization classifications if supplied, but do not claim the MVP is a cross-user authorization system.

## Standalone behavior

The observer should start with no configured sources and present setup guidance. Fake fixture adapters must allow a complete demonstration without Helix, Issues, Projects, Prelude, network access, or credentials.
