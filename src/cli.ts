#!/usr/bin/env node
import { resolve } from "node:path";
import { createServer } from "node:http";
import { loadConfig, loadLocalEnv } from "./config.js";
import { Collector } from "./collector/collector.js";
import { createApp } from "./server/app.js";
import { ObservationStore } from "./state/store.js";

const command = process.argv[2] || "serve";
loadLocalEnv();
const config = loadConfig();
const store = new ObservationStore(resolve(config.dataDir, "acme-obs.db"));
store.registerSources(config.sources);
const collector = new Collector(store, config.sources);

if (command === "serve") {
  const app = await createApp({ config, store, collector, dev: process.env.ACME_OBS_DEV === "1" });
  const server = createServer(app);
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Acme Observability listening on http://127.0.0.1:${config.port}`);
    void collector.collect().then((results) => {
      const ready = results.filter((result) => result.ok).length;
      console.log(`Initial collection complete: ${ready}/${results.length} sources ready`);
    });
    collector.start();
  });
  const shutdown = () => {
    collector.stop();
    server.close(() => { store.close(); process.exit(0); });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else if (command === "collect") {
  const sourceId = process.argv[3];
  console.log(JSON.stringify(await collector.collect(sourceId), null, 2));
  store.close();
} else if (command === "rebuild") {
  if (!process.argv.includes("--yes")) {
    console.error("Rebuild deletes the derived observation projection. Re-run with --yes.");
    process.exitCode = 2;
  } else {
    store.clear();
    console.log(JSON.stringify(await collector.collect(), null, 2));
  }
  store.close();
} else if (command === "sources") {
  console.log(JSON.stringify(store.sourceStates(), null, 2));
  store.close();
} else {
  console.error("Usage: acme-obs [serve|collect [source-id]|rebuild --yes|sources]");
  store.close();
  process.exitCode = 2;
}
