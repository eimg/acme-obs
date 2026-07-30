import type { SourceAdapter, SourceKind } from "../types.js";
import { FixtureAdapter } from "./fixture.js";
import { HelixAdapter } from "./helix.js";
import { IssuesAdapter } from "./issues.js";
import { PreludeAdapter } from "./prelude.js";
import { ProjectsAdapter } from "./projects.js";

const adapters: Record<SourceKind, SourceAdapter> = {
  fixture: new FixtureAdapter(),
  helix: new HelixAdapter(),
  "acme-issues": new IssuesAdapter(),
  "acme-projects": new ProjectsAdapter(),
  prelude: new PreludeAdapter(),
};

export function adapterFor(kind: SourceKind): SourceAdapter { return adapters[kind]; }
