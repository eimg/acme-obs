# Observation and adapter contracts

## Normalized observation

```ts
export interface Observation {
  schemaVersion: "acme.observation.v1";
  id: string;

  producer: {
    product: "helix" | "acme-issues" | "acme-projects" | "prelude" | string;
    instanceId: string;
    adapterVersion: string;
  };

  type: string;
  category: "health" | "work" | "decision" | "execution" | "delivery" | "review" | "human" | "collection";
  severity: "info" | "success" | "warning" | "error";
  occurredAt: string;
  observedAt: string;

  subject: ObservationRef;
  correlations: ObservationRef[];

  summary: string;
  details?: Record<string, JsonValue>;
  sourceUrl?: string;
}

export interface ObservationRef {
  kind: string;
  namespace: string;
  id: string;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
```

## Identity rules

- Prefer a source-native immutable event ID namespaced by source instance.
- Otherwise derive the ID from stable source facts, never collection time.
- Recommended format: `<instance-id>:<native-id>`.
- For snapshot-derived transitions, hash canonical JSON containing source identity, object identity, transition type, and source `updatedAt` or revision.
- `observedAt` must never participate in deduplication identity.
- `producer.instanceId` is the stable configured source ID, never a URL or port. It distinguishes multiple Helix instances; non-Helix kinds are singletons.

## Reference rules

- `subject` is the object whose state changed.
- `correlations` contain only explicit identifiers present in source data or configuration.
- Normalize the same logical reference consistently across adapters.
- Repository references use a configured logical repository ID, not a machine-specific filesystem path.
- Git commit references use the full SHA when available.

Initial namespaces:

| Kind | Namespace | Example |
|---|---|---|
| issue | `acme-issues.issue` | `42` |
| run | `helix.run` | UUID |
| pull request | `acme-issues.pull-request` | `7` |
| PR review | `helix.pr-review` | UUID |
| project | `acme-projects.project` | UUID |
| project card | `acme-projects.card` | UUID |
| inception | `prelude.inception` | UUID |
| bootstrap export | `prelude.bootstrap-export` | UUID |
| repository | `git.repository` | configured logical ID |
| commit | `git.commit` | full SHA |

## Adapter contract

```ts
export interface SourceAdapter {
  readonly kind: string;
  readonly version: string;

  checkHealth(ctx: AdapterContext): Promise<AdapterHealth>;
  poll(ctx: AdapterContext, cursor?: JsonValue): Promise<ObservationPage>;
}

export interface ObservationPage {
  observations: Observation[];
  nextCursor?: JsonValue;
  hasMore: boolean;
}
```

The cursor is opaque to the collector and meaningful only to the matching adapter version. Adapters must reject incompatible cursors with a categorized error that allows a deliberate full refresh.

## Initial Helix mapping

The Helix adapter should use durable run and PR-review APIs. At minimum map:

- run accepted/started;
- orchestrator decision summaries;
- specialist started/finished without raw output;
- pause requested, paused, resumed, interrupted, and retry confirmed;
- delivery pending/started/finished;
- run done/escalated/error;
- PR-review started, specialist evidence status, final readiness decision;
- run, parent/root run, issue, PR, repository, and commit references.

Allowlisted decision details may include decision kind, specialist names, reason summary, checkpoint phase, and result status. Exclude prompts, token deltas, raw agent output, tool commands, and tool output.

## Initial Acme Issues mapping

At minimum map source-owned transitions for:

- issue created and lifecycle state changes;
- Helix run linkage and continuation linkage;
- PR registered or revised with base/head identifiers;
- review requested and review result recorded;
- changes requested/readiness state;
- human merge recorded;
- issue reopened or completed.

The adapter must inspect and use actual public Issues API contracts. If required historical transitions are not available, propose the smallest optional read-only export endpoint in Acme Issues rather than reading its database.

## Acme Projects mapping

Map each collaboration card as a current-state snapshot with its project, column, comment count, and explicit Acme Issues link when an active implementation exists. Keep the card title for recognition, but exclude description, decisions, open questions, acceptance notes, and comment bodies.

## Prelude mapping

Map inception status and allowlisted operational counts, plus bootstrap-export availability/adoption status. Correlate exports to their inception. Exclude briefs, document bodies, artifact contents, and Primer-derived answers or evidence.

## Validation and bounds

- Validate all source payloads before normalization.
- Limit summary to 1,000 characters.
- Limit individual detail strings to 4,000 characters.
- Limit serialized details to 32 KiB per observation.
- Reject non-finite numbers, cyclic input, unsupported values, and invalid timestamps.
- Accept unknown safe observation types so producer evolution does not break the collector.
