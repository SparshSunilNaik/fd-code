import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { BrainToolkit } from "./tools.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as BrainMemory from "../../../brain/BrainMemory.ts";
import * as BetaBrain from "../../../beta/Brain.ts";

const brainCaller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.requireMcpCapability("orchestration").pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Brain retrieval requires the orchestration capability.",
        }),
    ),
  );
  return yield* McpInvocationContext.requireThreadScope(scope, "Brain retrieval");
});

const handlers = {
  t3_brain_memory: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* brainCaller;
      const brain = yield* BrainMemory.BrainMemory;
      return yield* brain.read(caller.thread.threadId, input).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Brain session memory is temporarily unavailable.",
            }),
        ),
      );
    }),
  ),
  t3_rag: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* brainCaller;
      const brain = yield* BrainMemory.BrainMemory;
      return yield* brain.rag(caller.thread.threadId, input).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Brain retrieval is temporarily unavailable.",
            }),
        ),
      );
    }),
  ),
  t3_brain_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      yield* brainCaller;
      const brain = yield* BetaBrain.BetaBrain;
      return yield* brain.read(input);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof BrainToolkit.tools>;
export const layer = McpToolAccess.toLayer(BrainToolkit, handlers);
