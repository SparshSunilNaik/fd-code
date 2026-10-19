import * as Effect from "effect/Effect";
import { SessionBus } from "../../../beta/SessionBus.ts";
import { BetaBrain } from "../../../beta/Brain.ts";
import { BrainSessions } from "../../../beta/BrainSessions.ts";
import { BetaBusError } from "@t3tools/contracts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { BetaToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const bus = yield* SessionBus;
  const brain = yield* BetaBrain;
  const memory = yield* BrainSessions;
  return BetaToolkit.of({
    beta_session_memory: Effect.fn("beta.mcp.sessionMemory")(function* (input) {
      const scope = yield* requireMcpCapability("beta");
      return yield* memory
        .read(scope.threadId, input)
        .pipe(Effect.mapError((error) => new BetaBusError({ message: error.message })));
    }),
    beta_rag: Effect.fn("beta.mcp.rag")(function* (input) {
      const scope = yield* requireMcpCapability("beta");
      return yield* memory
        .rag(scope.threadId, input)
        .pipe(Effect.mapError((error) => new BetaBusError({ message: error.message })));
    }),
    beta_sessions_list: Effect.fn("beta.mcp.list")(function* (input) {
      yield* requireMcpCapability("beta");
      return yield* bus.threads(input);
    }),
    beta_session_read: Effect.fn("beta.mcp.read")(function* (input) {
      yield* requireMcpCapability("beta");
      return yield* bus.read(input);
    }),
    beta_session_inbox: Effect.fn("beta.mcp.inbox")(function* (input) {
      const scope = yield* requireMcpCapability("beta");
      return yield* bus.inbox({ ...input, threadId: scope.threadId });
    }),
    beta_session_send: Effect.fn("beta.mcp.send")(function* (input) {
      const scope = yield* requireMcpCapability("beta");
      return yield* bus.relay(
        { ...input, sourceThreadId: scope.threadId },
        {
          actor: `provider:${scope.providerInstanceId}`,
          providerSessionId: scope.providerSessionId,
        },
      );
    }),
    beta_brain_read: Effect.fn("beta.mcp.brainRead")(function* (input) {
      yield* requireMcpCapability("beta");
      return yield* brain.read(input);
    }),
  });
});
export const BetaToolkitHandlersLive = BetaToolkit.toLayer(make);
