import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { ApiError, api, collect, getAuthSession, getDashboard, type AuthSession, type Dashboard, type Observation, type Source, type State, type Trace } from "./api";

type Tab = "overview" | "activity" | "sources";

function useOutsideDismissDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const menu = ref.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, []);
  return ref;
}

export function App() {
  const accountMenuRef = useOutsideDismissDetails();
  const [session, setSession] = useState<AuthSession>();
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const refreshSession = async () => {
    setAuthLoading(true);
    try { setSession(await getAuthSession()); setAuthError(""); }
    catch (reason) {
      setSession(undefined);
      setAuthError(reason instanceof ApiError && reason.status === 401 ? "" : reason instanceof Error ? reason.message : String(reason));
    } finally { setAuthLoading(false); }
  };

  const refresh = async () => {
    try { setData(await getDashboard()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!session?.capabilities.read) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [session?.capabilities.read]);

  const selectedTrace = useMemo(() => data?.traces.find((trace) => trace.id === selected) ?? data?.traces[0], [data, selected]);

  const collectNow = async (sourceId?: string) => {
    setRefreshing(true);
    try { await collect(sourceId); await refresh(); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRefreshing(false); }
  };

  if (authLoading) return <AuthLoading />;
  if (!session) return <Login error={authError} onSignedIn={refreshSession} />;
  if (!session.capabilities.read) return <AccessDenied session={session} onSignOut={refreshSession} />;

  const signOut = async () => {
    setSigningOut(true);
    try { await api("/api/auth/session", { method: "DELETE" }); }
    finally { setData(undefined); await refreshSession(); setSigningOut(false); }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab("overview")}>
          <span className="brand-mark"><span /><span /><span /></span>
          <span><strong>Acme</strong><small>Observability</small></span>
        </a>
        <nav aria-label="Primary navigation">
          {(["overview", "activity", "sources"] as Tab[]).map((item) => (
            <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>
          ))}
        </nav>
        <div className="top-actions">
          <span className="live-chip"><i /> Local observer</span>
          {session.capabilities.collect && <button className="icon-button" aria-label="Collect now" title="Collect now" disabled={refreshing} onClick={() => void collectNow()}><Icon name="refresh" /></button>}
          <details className="account-menu" ref={accountMenuRef}>
            <summary className="account-trigger" aria-label={`Account: ${session.principal.displayName}`}>
              <span className="account-avatar" aria-hidden="true">{session.principal.displayName.charAt(0).toUpperCase()}</span>
              <span className="account-trigger-name">{session.principal.displayName}</span>
            </summary>
            <div className="account-popover">
              <div className="account-heading"><strong>{session.principal.displayName}</strong><span>@{session.principal.username}</span></div>
              <div className="account-context">
                <span className={`account-status ${session.authMode === "off" ? "development" : "connected"}`} />
                <div><strong>{session.authMode === "off" ? "Authentication off" : "Acme Identity"}</strong><span>{session.authMode === "off" ? "Development admin access" : "Suite observability access"}</span></div>
              </div>
              {session.accountUrl && <a className="account-action" href={session.accountUrl} target="_blank" rel="noreferrer">My identity account <span aria-hidden="true">↗</span></a>}
              {session.authMode === "local" && <button className="account-action" type="button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</button>}
            </div>
          </details>
        </div>
      </header>

      <main>
        {error && <div className="error-banner"><Icon name="alert" /> {error}</div>}
        {!data ? <Loading /> : tab === "overview" ? (
          <Overview data={data} selectedTrace={selectedTrace} onSelect={setSelected} />
        ) : tab === "activity" ? (
          <Activity observations={data.activity} />
        ) : (
          <Sources sources={data.sources} refreshing={refreshing} canCollect={session.capabilities.collect} onCollect={collectNow} />
        )}
      </main>
    </div>
  );
}

function Overview({ data, selectedTrace, onSelect }: { data: Dashboard; selectedTrace?: Trace; onSelect: (id: string) => void }) {
  const hasAttention = data.summary.attention > 0;
  const simulationOnly = data.sources.some((source) => source.kind === "fixture" && source.status === "ready")
    && !data.sources.some((source) => source.kind !== "fixture" && source.status === "ready");
  return <>
    <section className="page-heading">
      <div>
        <p className="eyebrow">Factory pulse {simulationOnly && <b>sample data</b>} <span>updated {relative(data.generatedAt)}</span></p>
        <h1>{hasAttention ? "One workflow needs your attention." : simulationOnly ? "The sample factory is moving." : "The factory is moving."}</h1>
        <p className="lede">A live, read-only view of work moving from intent to human decision.</p>
      </div>
      <div className={`system-posture ${hasAttention ? "warn" : simulationOnly ? "demo" : "good"}`}>
        <span className="posture-icon"><Icon name={hasAttention ? "alert" : simulationOnly ? "spark" : "check"} /></span>
        <div><small>{simulationOnly ? "Viewing mode" : "System posture"}</small><strong>{hasAttention ? "Attention needed" : simulationOnly ? "Simulation only" : "Operating normally"}</strong></div>
        <span className="source-ratio">{data.summary.sourcesReady}/{data.summary.sourcesTotal} sources</span>
      </div>
    </section>

    <section className="metric-grid" aria-label="Workflow summary">
      <Metric label="In motion" value={data.summary.active} icon="pulse" tone="blue" note="actively progressing" />
      <Metric label="Needs attention" value={data.summary.attention} icon="alert" tone="amber" note="blocked or uncertain" />
      <Metric label="Human decision" value={data.summary.waiting} icon="person" tone="purple" note="ready for your call" />
      <Metric label="Completed" value={data.summary.complete} icon="check" tone="green" note="finished workflows" />
    </section>

    <div className="overview-grid">
      <section className="panel workflow-panel">
        <div className="panel-heading"><div><p className="eyebrow">Work in focus</p><h2>Workflow map</h2></div><span className="count-chip">{data.traces.length} trace{data.traces.length === 1 ? "" : "s"}</span></div>
        <div className="trace-list">
          {data.traces.map((trace) => <TraceCard key={trace.id} trace={trace} active={selectedTrace?.id === trace.id} onClick={() => onSelect(trace.id)} />)}
          {data.traces.length === 0 && <Empty title="No observable work yet" body="The observer is ready. Keep the simulation enabled or connect a source to populate this view." />}
        </div>
      </section>

      <aside className="panel source-panel">
        <div className="panel-heading"><div><p className="eyebrow">Connections</p><h2>Source health</h2></div><span className="quiet">auto-refresh</span></div>
        <div className="source-stack">{data.sources.map((source) => <SourceRow key={source.id} source={source} />)}</div>
        <div className="read-only-note"><Icon name="eye" /><div><strong>Observe, never operate</strong><p>Source systems remain authoritative. No workflow action is available here.</p></div></div>
      </aside>
    </div>

    {selectedTrace && <section className="panel trace-detail">
      <div className="panel-heading trace-heading">
        <div><p className="eyebrow">Selected trace</p><h2>{selectedTrace.title}</h2></div>
        <StatePill state={selectedTrace.state} />
      </div>
      <div className="trace-summary-line"><span>{selectedTrace.observationCount} observed moments</span><i /><span>{selectedTrace.sourceCount} source{selectedTrace.sourceCount === 1 ? "" : "s"}</span><i /><span>Latest {relative(selectedTrace.latestAt)}</span></div>
      <div className="timeline">
        {selectedTrace.observations.map((event, index) => <TimelineItem event={event} key={event.id} last={index === selectedTrace.observations.length - 1} />)}
      </div>
    </section>}
  </>;
}

function Metric({ label, value, icon, tone, note }: { label: string; value: number; icon: IconName; tone: string; note: string }) {
  return <article className={`metric ${tone}`}><span className="metric-icon"><Icon name={icon} /></span><div><strong>{value}</strong><span>{label}</span><small>{note}</small></div></article>;
}

function TraceCard({ trace, active, onClick }: { trace: Trace; active: boolean; onClick: () => void }) {
  return <button className={`trace-card ${active ? "selected" : ""}`} onClick={onClick}>
    <div className="trace-card-top"><StatePill state={trace.state} /><span>{relative(trace.latestAt)}</span></div>
    <h3>{trace.title}</h3>
    <p>{trace.latestSummary}</p>
    <div className="stage-track" aria-label="Workflow stages">
      {trace.stages.map((stage, index) => <div className="stage-wrap" key={stage.name} title={`${stage.name}: ${stage.state}`}><span className={`stage-dot ${stage.state}`}>{stage.state === "complete" && <Icon name="check" />}</span>{index < trace.stages.length - 1 && <i className={stage.state === "complete" ? "complete" : ""} />}</div>)}
    </div>
    <div className="stage-labels">{trace.stages.map((stage) => <span key={stage.name}>{stage.name}</span>)}</div>
  </button>;
}

function SourceRow({ source }: { source: Source }) {
  const isDemo = source.kind === "fixture";
  return <div className="source-row">
    <span className={`source-icon ${source.kind}`}><Icon name={sourceIconName(source.kind)} /></span>
    <div><strong>{source.displayName}</strong><span>{isDemo ? "sample story" : source.kind.replace("acme-", "")}</span></div>
    <span className={`source-state ${source.status}`}><i />{source.status === "error" ? "offline" : source.status.replace("_", " ")}</span>
  </div>;
}

function TimelineItem({ event, last }: { event: Observation; last: boolean }) {
  const stage = String(event.details?.stage ?? event.category);
  return <div className={`timeline-item ${event.severity}`}>
    <div className="timeline-rail"><span><Icon name={event.severity === "warning" || event.severity === "error" ? "alert" : event.severity === "success" ? "check" : "pulse"} /></span>{!last && <i />}</div>
    <div className="timeline-time">{formatTime(event.occurredAt)}<small>{formatDay(event.occurredAt)}</small></div>
    <div className="timeline-copy"><div><span className="event-stage">{stage}</span><span className="event-source">{event.producer.product}</span></div><p>{event.summary}</p></div>
    {event.sourceUrl && <a className="source-link" href={event.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open source"><Icon name="arrow" /></a>}
  </div>;
}

function Activity({ observations }: { observations: Observation[] }) {
  return <section className="full-page">
    <div className="page-heading compact"><div><p className="eyebrow">Signal stream</p><h1>Recent activity</h1><p className="lede">A curated operational stream—not raw logs or agent transcripts.</p></div></div>
    <div className="panel activity-panel">{observations.map((event, index) => <TimelineItem event={event} key={event.id} last={index === observations.length - 1} />)}{observations.length === 0 && <Empty title="No activity yet" body="Collect a configured source to see its allowlisted operational events." />}</div>
  </section>;
}

function Sources({ sources, refreshing, canCollect, onCollect }: { sources: Source[]; refreshing: boolean; canCollect: boolean; onCollect: (id?: string) => Promise<void> }) {
  return <section className="full-page">
    <div className="page-heading compact"><div><p className="eyebrow">Adapter registry</p><h1>Sources</h1><p className="lede">Each source is polled independently. An outage here never affects the source product.</p></div>{canCollect && <button className="primary-button" disabled={refreshing} onClick={() => void onCollect()}><Icon name="refresh" />{refreshing ? "Collecting…" : "Collect all"}</button>}</div>
    <div className="source-cards">{sources.map((source) => <article className="panel source-card" key={source.id}><div className="source-card-top"><span className={`source-icon ${source.kind}`}><Icon name={sourceIconName(source.kind)} /></span><StatePill state={source.status === "error" ? "attention" : source.status === "ready" ? "complete" : "active"} label={source.status === "error" ? "offline" : source.status.replace("_", " ")} /></div><h2>{source.displayName}</h2><p>{source.kind === "fixture" ? "Deterministic sample data for the standalone experience." : `External ${source.kind} adapter using its public HTTP API.`}</p><dl><div><dt>Observations</dt><dd>{source.observationCount}</dd></div><div><dt>Last success</dt><dd>{source.lastSuccessAt ? relative(source.lastSuccessAt) : "Not yet"}</dd></div></dl>{source.lastError && <div className="source-error">{source.lastError}</div>}{canCollect && <button className="secondary-button" disabled={refreshing} onClick={() => void onCollect(source.id)}><Icon name="refresh" />Collect now</button>}</article>)}</div>
  </section>;
}

function AuthLoading() {
  return <div className="auth-page"><div className="auth-card compact-auth"><BrandMark /><p>Resolving Acme identity…</p></div></div>;
}

function Login({ error, onSignedIn }: { error?: string; onSignedIn: () => Promise<void> }) {
  const [message, setMessage] = useState(error ?? "");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await api("/api/auth/session", { method: "POST", body: JSON.stringify({ username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") }) });
      await onSignedIn();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmitting(false); }
  };
  return <div className="auth-page"><form className="auth-card" onSubmit={(event) => void submit(event)}>
    <BrandMark />
    <div><p className="auth-eyebrow">Acme Identity</p><h1>Sign in to Observability</h1><p className="auth-copy">A privileged, read-only view across the software factory.</p></div>
    <label>Username<input name="username" autoComplete="username" autoFocus required /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {message && <p className="form-error" role="alert">{message}</p>}
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
  </form></div>;
}

function AccessDenied({ session, onSignOut }: { session: AuthSession; onSignOut: () => Promise<void> }) {
  const signOut = async () => { await api("/api/auth/session", { method: "DELETE" }); await onSignOut(); };
  return <div className="auth-page"><div className="auth-card compact-auth"><BrandMark /><p className="auth-eyebrow">Access restricted</p><h1>Observability permission required</h1><p className="auth-copy">{session.principal.displayName} does not have <code>observability.read</code>.</p>{session.authMode === "local" && <button className="secondary-button" onClick={() => void signOut()}>Sign out</button>}</div></div>;
}

function BrandMark() {
  return <div className="auth-brand"><span className="brand-mark"><span /><span /><span /></span><span><strong>Acme</strong><small>Observability</small></span></div>;
}

function StatePill({ state, label }: { state: State; label?: string }) { return <span className={`state-pill ${state}`}><i />{label ?? state}</span>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><span><Icon name="pulse" /></span><h3>{title}</h3><p>{body}</p></div>; }
function Loading() { return <div className="loading"><span /><p>Reading the factory pulse…</p></div>; }

type IconName = "refresh" | "alert" | "check" | "pulse" | "person" | "eye" | "helix" | "issues" | "projects" | "prelude" | "spark" | "arrow";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactElement> = {
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></>,
    alert: <><path d="M10.3 3.5 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>, pulse: <path d="M3 12h4l2.2-5 4.1 10 2.2-5H21"/>,
    person: <><circle cx="12" cy="8" r="3"/><path d="M5 20c.8-4 3.2-6 7-6s6.2 2 7 6"/></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    helix: <><path d="M7 3c7 4 3 14 10 18M17 3C10 7 14 17 7 21"/><path d="M8.5 7h7M8.5 17h7"/></>,
    issues: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    projects: <><path d="M4 5h16v14H4z"/><path d="M9.3 5v14M14.7 5v14M6.2 9h1M11.5 12h1M16.8 8h1M16.8 15h1"/></>,
    prelude: <><path d="M6 4h9l3 3v13H6z"/><path d="M14 4v4h4M9 12h6M9 16h4"/></>,
    spark: <><path d="m12 2 1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
    arrow: <><path d="M7 17 17 7M8 7h9v9"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function sourceIconName(kind: string): IconName {
  if (kind === "helix") return "helix";
  if (kind === "acme-issues") return "issues";
  if (kind === "acme-projects") return "projects";
  if (kind === "prelude") return "prelude";
  return "spark";
}

function relative(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function formatTime(value: string) { return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDay(value: string) { return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(new Date(value)); }
