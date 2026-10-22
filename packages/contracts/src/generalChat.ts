import * as Schema from "effect/Schema";
import { MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode, ProviderInteractionMode } from "./providerPolicy.ts";

export const GENERAL_CHAT_THREAD_PREFIX = "general-chat-";
export const GeneralChatRoute = Schema.Struct({
  targetThreadId: ThreadId,
  targetTitle: Schema.String,
});
export const GeneralChatLocation = Schema.Struct({ threadId: ThreadId });
export const GeneralChatSendInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type GeneralChatSendInput = typeof GeneralChatSendInput.Type;
export const GeneralChatSendResult = Schema.Struct({
  threadId: ThreadId,
  routed: Schema.Boolean,
  detail: Schema.String,
});
export type GeneralChatSendResult = typeof GeneralChatSendResult.Type;
export class GeneralChatError extends Schema.TaggedError<GeneralChatError>()(
  "GeneralChatError",
  {
    reason: Schema.Literals(["unavailable", "changed_request", "busy", "operation_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    switch (this.reason) {
      case "unavailable":
        return "Open General chat again before sending.";
      case "changed_request":
        return "This message changed after routing. Send it as a new question.";
      case "busy":
        return "This conversation is busy or needs your input. Open it to continue.";
      case "operation_failed":
        return "General chat could not send this question. Your draft is preserved; try again.";
    }
  }
}
