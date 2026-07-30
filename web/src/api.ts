export type State = "active" | "attention" | "waiting" | "complete";

export interface Observation {
  id: string;
  type: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  occurredAt: string;
  summary: string;
  producer: { product: string; instanceId: string };
  details?: Record<string, unknown>;
  sourceUrl?: string;
}

export interface Trace {
  id: string;
  title: string;
  state: State;
  latestAt: string;
  latestSummary: string;
  observationCount: number;
  sourceCount: number;
  stages: Array<{ name: string; state: State | "pending" }>;
  observations: Observation[];
}

export interface Source {
  id: string;
  kind: string;
  displayName: string;
  status: "ready" | "not_ready" | "collecting" | "error";
  lastSuccessAt?: string;
  lastError?: string;
  observationCount: number;
}

export interface Dashboard {
  generatedAt: string;
  summary: { active: number; attention: number; waiting: number; complete: number; sourcesReady: number; sourcesTotal: number };
  sources: Source[];
  traces: Trace[];
  activity: Observation[];
}

export type Principal = {
  sub: string;
  username: string;
  displayName: string;
  permissions: string[];
};

export interface AuthSession {
  schemaVersion: "acme.session.v1";
  authMode: "off" | "local";
  accountUrl?: string;
  principal: Principal;
  capabilities: { read: boolean; collect: boolean; manage: boolean };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new ApiError(body.error || response.statusText, response.status);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export function getAuthSession(): Promise<AuthSession> {
  return api<AuthSession>("/api/auth/session");
}

export async function getDashboard(): Promise<Dashboard> {
  return api<Dashboard>("/api/dashboard");
}

export async function collect(sourceId?: string): Promise<void> {
  await api("/api/collect", { method: "POST", body: JSON.stringify({ sourceId }) });
}
