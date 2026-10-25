// @effect-diagnostics nodeBuiltinImport:off -- Native process boundary for the installed, local Graphify CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type BrainGraphResult } from "@fdcode/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@fdcode/shared/HostProcess";
import * as BrainDirectory from "./BrainDirectory.ts";

export class GraphContext extends Context.Service<
  GraphContext,
  {
    readonly query: (query: string, sessionGraph: string) => Effect.Effect<BrainGraphResult>;
  }
>()("t3/brain/GraphContext") {}

export const layer = Layer.effect(
  GraphContext,
  Effect.gen(function* () {
    const home = yield* HostProcess.HomeDirectory;
    const executable = NodePath.join(home, ".graphify-venv", "bin", "graphify");
    // The curated graph belongs to the shared Brain; isolated compositions use the session graph.
    const sharedBrain = yield* BrainDirectory.BrainDirectory;
    const brainGraph =
      sharedBrain === undefined
        ? undefined
        : NodePath.join(sharedBrain, "graph", "brain-graph.json");
    return GraphContext.of({
      query: (query, sessionGraph) =>
        Effect.gen(function* () {
          const source =
            brainGraph !== undefined && NodeFS.existsSync(brainGraph) ? brainGraph : sessionGraph;
          if (!NodeFS.existsSync(executable) || !NodeFS.existsSync(source)) {
            return {
              status: "unavailable",
              source,
              text: "Local Graphify or its graph is unavailable. Session history is still searchable.",
            };
          }
          return yield* Effect.promise(
            (signal) =>
              new Promise<BrainGraphResult>((resolve) => {
                NodeChildProcess.execFile(
                  executable,
                  ["query", query, "--graph", source, "--budget", "1500"],
                  {
                    signal,
                    timeout: 15_000,
                    maxBuffer: 256_000,
                  },
                  (error, stdout) => {
                    const code = error?.code;
                    const status = !error
                      ? "ready"
                      : code === 4
                        ? "no-match"
                        : code === 3
                          ? "ambiguous"
                          : "error";
                    resolve({
                      status,
                      source,
                      text:
                        status === "error"
                          ? "The local Graphify query failed or timed out. Use session history retrieval."
                          : String(stdout).slice(0, 6_000),
                    });
                  },
                );
              }),
          );
        }),
    });
  }),
);
