import * as Schema from "effect/Schema";
import { ThreadId, MessageId, EventId } from "./baseSchemas.ts";

export const GENERAL_CHAT_THREAD_PREFIX = "beta-general-";
export const GeneralChatLocation = Schema.Struct({ threadId: ThreadId });
export const GeneralChatDecision = Schema.Struct({
  id: EventId,
  sourceMessageId: MessageId,
  kind: Schema.Literals(["general", "web", "chat", "unavailable", "uncertain"]),
  targetThreadId: Schema.NullOr(ThreadId),
  targetTitle: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Finite),
  detail: Schema.String,
});
export type GeneralChatDecision = typeof GeneralChatDecision.Type;
export const GeneralChatHandoffInput = Schema.Struct({ decisionId: EventId });
export const GeneralChatNavigation = Schema.Struct({
  targetThreadId: ThreadId,
  sourceMessageId: MessageId,
});
export type GeneralChatNavigation = typeof GeneralChatNavigation.Type;
