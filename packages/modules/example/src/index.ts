import type { ModuleDefinition } from "@baseworks/shared";
import { exampleRoutes } from "./routes";
import { createExample } from "./commands/create-example";
import { listExamples } from "./queries/list-examples";

export default {
  name: "example",
  routes: exampleRoutes,
  commands: { "example:create": createExample },
  queries: { "example:list": listExamples },
  jobs: {},
  events: ["example.created"],
} satisfies ModuleDefinition;
