export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ObservationRef {
  kind: string;
  namespace: string;
  id: string;
}

export interface Observation {
  schemaVersion: "acme.observation.v1";
  id: string;
  producer: { product: string; instanceId: string; adapterVersion: string };
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

export type SourceKind = "fixture" | "helix" | "acme-issues" | "acme-projects" | "prelude";

export interface SourceConfig {
  id: string;
  kind: SourceKind;
  displayName: string;
  baseUrl?: string;
  repositoryId?: string;
  enabled: boolean;
  pollIntervalMs: number;
  tokenEnv?: string;
}

export interface AppConfig {
  sources: SourceConfig[];
  configPath: string;
  dataDir: string;
  port: number;
}

export interface ObservationPage {
  observations: Observation[];
  nextCursor?: JsonValue;
  hasMore: boolean;
}

export interface AdapterContext {
  source: SourceConfig;
  signal?: AbortSignal;
}

export interface SourceAdapter {
  readonly kind: SourceKind;
  readonly version: string;
  checkHealth(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;
  poll(ctx: AdapterContext, cursor?: JsonValue): Promise<ObservationPage>;
}

export interface SourceState extends SourceConfig {
  status: "ready" | "not_ready" | "collecting" | "error";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  cursor?: JsonValue;
  observationCount: number;
}
