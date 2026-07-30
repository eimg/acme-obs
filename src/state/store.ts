import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { validateObservation } from "../domain/observation.js";
import type { JsonValue, Observation, SourceConfig, SourceState } from "../types.js";

interface SourceRow {
  id: string;
  config_json: string;
  status: SourceState["status"];
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  cursor_json: string | null;
}

interface ObservationRow { json: string }

export class ObservationStore {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void { this.db.close(); }

  registerSources(sources: SourceConfig[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO sources (id, config_json, status)
      VALUES (?, ?, 'not_ready')
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json
    `);
    const active = new Set(sources.map((source) => source.id));
    const transaction = this.db.transaction(() => {
      for (const source of sources) upsert.run(source.id, JSON.stringify(source));
      const existing = this.db.prepare("SELECT id FROM sources").all() as Array<{ id: string }>;
      for (const row of existing) if (!active.has(row.id)) this.db.prepare("DELETE FROM sources WHERE id = ?").run(row.id);
    });
    transaction();
  }

  cursor(sourceId: string): JsonValue | undefined {
    const row = this.db.prepare("SELECT cursor_json FROM sources WHERE id = ?").get(sourceId) as { cursor_json: string | null } | undefined;
    return row?.cursor_json ? JSON.parse(row.cursor_json) as JsonValue : undefined;
  }

  markCollecting(sourceId: string): void {
    this.db.prepare("UPDATE sources SET status = 'collecting', last_attempt_at = ?, last_error = NULL WHERE id = ?")
      .run(new Date().toISOString(), sourceId);
  }

  markError(sourceId: string, message: string): void {
    this.db.prepare("UPDATE sources SET status = 'error', last_error = ?, last_attempt_at = ? WHERE id = ?")
      .run(message.slice(0, 1000), new Date().toISOString(), sourceId);
  }

  savePage(sourceId: string, observations: Observation[], nextCursor: JsonValue | undefined): number {
    observations.forEach(validateObservation);
    const insertObservation = this.db.prepare(`
      INSERT INTO observations (id, source_id, occurred_at, category, severity, json)
      VALUES (@id, @sourceId, @occurredAt, @category, @severity, @json)
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, severity = excluded.severity
    `);
    const insertRef = this.db.prepare(`
      INSERT OR IGNORE INTO observation_refs (observation_id, ref_key) VALUES (?, ?)
    `);
    const transaction = this.db.transaction(() => {
      let changed = 0;
      for (const observation of observations) {
        const result = insertObservation.run({
          id: observation.id,
          sourceId,
          occurredAt: observation.occurredAt,
          category: observation.category,
          severity: observation.severity,
          json: JSON.stringify(observation),
        });
        if (result.changes > 0) changed += 1;
        this.db.prepare("DELETE FROM observation_refs WHERE observation_id = ?").run(observation.id);
        for (const item of [observation.subject, ...observation.correlations]) {
          insertRef.run(observation.id, `${item.namespace}:${item.id}`);
        }
      }
      this.db.prepare(`
        UPDATE sources SET status = 'ready', last_success_at = ?, last_error = NULL, cursor_json = ? WHERE id = ?
      `).run(new Date().toISOString(), nextCursor === undefined ? null : JSON.stringify(nextCursor), sourceId);
      return changed;
    });
    return transaction();
  }

  listObservations(limit = 500): Observation[] {
    const rows = this.db.prepare("SELECT json FROM observations ORDER BY occurred_at DESC, id DESC LIMIT ?").all(limit) as ObservationRow[];
    return rows.map((row) => JSON.parse(row.json) as Observation);
  }

  getObservation(id: string): Observation | undefined {
    const row = this.db.prepare("SELECT json FROM observations WHERE id = ?").get(id) as ObservationRow | undefined;
    return row ? JSON.parse(row.json) as Observation : undefined;
  }

  sourceStates(): SourceState[] {
    const rows = this.db.prepare("SELECT * FROM sources ORDER BY id").all() as SourceRow[];
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM observations WHERE source_id = ?");
    return rows.map((row) => {
      const config = JSON.parse(row.config_json) as SourceConfig;
      const total = count.get(row.id) as { count: number };
      return {
        ...config,
        status: row.status,
        ...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
        ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
        ...(row.last_error ? { lastError: row.last_error } : {}),
        ...(row.cursor_json ? { cursor: JSON.parse(row.cursor_json) as JsonValue } : {}),
        observationCount: total.count,
      };
    });
  }

  clear(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM observation_refs").run();
      this.db.prepare("DELETE FROM observations").run();
      this.db.prepare("UPDATE sources SET status = 'not_ready', cursor_json = NULL, last_error = NULL, last_success_at = NULL").run();
    })();
  }

  private migrate(): void {
    const sourceColumns = this.db.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>;
    if (sourceColumns.length > 0 && !sourceColumns.some((column) => column.name === "config_json")) {
      this.db.exec(`
        DROP TABLE IF EXISTS observation_refs;
        DROP TABLE IF EXISTS observations;
        DROP TABLE IF EXISTS collection_runs;
        DROP TABLE IF EXISTS source_cursors;
        DROP TABLE IF EXISTS sources;
      `);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready', 'not_ready', 'collecting', 'error')),
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        cursor_json TEXT
      );
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        occurred_at TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observations_time ON observations(occurred_at DESC);
      CREATE TABLE IF NOT EXISTS observation_refs (
        observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        ref_key TEXT NOT NULL,
        PRIMARY KEY (observation_id, ref_key)
      );
      CREATE INDEX IF NOT EXISTS idx_observation_refs_key ON observation_refs(ref_key);
    `);
  }
}
