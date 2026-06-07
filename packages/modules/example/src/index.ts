import type { ModuleDefinition } from "@baseworks/shared";
import { createExample } from "./commands/create-example";
import { processFollowup } from "./jobs/process-followup";
import { listExamples } from "./queries/list-examples";
import { exampleRoutes } from "./routes";

export { registerExampleHooks } from "./hooks/on-example-created";

export default {
  name: "example",
  routes: exampleRoutes,
  commands: { "example:create": createExample },
  queries: { "example:list": listExamples },
  jobs: {
    "example-process-followup": {
      queue: "example-process-followup",
      handler: processFollowup,
    },
  },
  events: ["example.created"],
} satisfies ModuleDefinition;
