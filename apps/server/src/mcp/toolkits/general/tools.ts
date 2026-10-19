import {
  BetaBusError,
  GeneralChatDecision,
  GeneralChatHandoffInput,
  GeneralChatNavigation,
  McpCapabilityUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { GeneralChat } from "../../../beta/GeneralChat.ts";
import { McpInvocationContext, requireMcpCapability } from "../../McpInvocationContext.ts";

const dependencies = [GeneralChat, McpInvocationContext];
const failure = Schema.Union([BetaBusError, McpCapabilityUnavailableError]);
const Route = Tool.make("beta_route_request", {
  description:
    "In General chat, consult local Laya about the latest saved user question. Returns a typed general/web/existing-chat decision, confidence and limitations. Cannot invent a destination, start work, or open a chat. Unavailable/uncertain means continue in General. Laya classifies; it does not answer or browse.",
  // Empty Struct emits an object/array union, which MCP rejects during startup.
  parameters: Schema.Record(Schema.String, Schema.Never),
  success: GeneralChatDecision,
  failure,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);
const Handoff = Tool.make("beta_handoff_chat", {
  description:
    "Forward General chat's latest saved user question to the existing Beta chat identified by a retained confident Laya decision and open that chat. Only use when the user wants that work routed. Preserves the destination provider and permissions, refuses busy or archived targets and contextual attachments, and deduplicates retries. Does not grant permission to send external messages or perform unrelated actions. Do not repeat through the session bus.",
  parameters: GeneralChatHandoffInput,
  success: GeneralChatNavigation,
  failure,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
export const GeneralChatToolkit = Toolkit.make(Route, Handoff);
export const GeneralChatToolkitHandlersLive = GeneralChatToolkit.toLayer(
  Effect.gen(function* () {
    const chat = yield* GeneralChat;
    return GeneralChatToolkit.of({
      beta_route_request: Effect.fn("general.mcp.route")(function* () {
        const scope = yield* requireMcpCapability("beta");
        return yield* chat.route(scope.threadId);
      }),
      beta_handoff_chat: Effect.fn("general.mcp.handoff")(function* (input) {
        const scope = yield* requireMcpCapability("beta");
        return yield* chat.handoff(scope.threadId, input.decisionId);
      }),
    });
  }),
);
