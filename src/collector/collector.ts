import { adapterFor } from "../adapters/registry.js";
import { ObservationStore } from "../state/store.js";
import type { SourceConfig } from "../types.js";

export class Collector {
  private timers = new Map<string, NodeJS.Timeout>();
  private active = new Set<string>();

  constructor(private readonly store: ObservationStore, private readonly sources: SourceConfig[]) {}

  async collect(sourceId?: string): Promise<Array<{ sourceId: string; ok: boolean; count: number; error?: string }>> {
    const selected = this.sources.filter((source) => source.enabled && (!sourceId || source.id === sourceId));
    if (sourceId && selected.length === 0) throw new Error(`Unknown or disabled source: ${sourceId}`);
    return await Promise.all(selected.map((source) => this.collectOne(source)));
  }

  start(): void {
    for (const source of this.sources.filter((item) => item.enabled)) {
      const tick = () => void this.collectOne(source);
      this.timers.set(source.id, setInterval(tick, source.pollIntervalMs));
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  private async collectOne(source: SourceConfig) {
    if (this.active.has(source.id)) return { sourceId: source.id, ok: true, count: 0 };
    this.active.add(source.id);
    this.store.markCollecting(source.id);
    try {
      const adapter = adapterFor(source.kind);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      let count = 0;
      try {
        const health = await adapter.checkHealth({ source, signal: controller.signal });
        if (!health.ok) throw new Error(health.message);
        let cursor = this.store.cursor(source.id);
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const page = await adapter.poll({ source, signal: controller.signal }, cursor);
          count += this.store.savePage(source.id, page.observations, page.nextCursor);
          cursor = page.nextCursor;
          if (!page.hasMore) break;
        }
      } finally {
        clearTimeout(timeout);
      }
      return { sourceId: source.id, ok: true, count };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = error instanceof Error && error.name === "AbortError" ? "Source did not respond within 4 seconds"
        : raw === "fetch failed" ? "Source is not reachable at its configured URL" : raw;
      this.store.markError(source.id, message);
      return { sourceId: source.id, ok: false, count: 0, error: message };
    } finally {
      this.active.delete(source.id);
    }
  }
}
