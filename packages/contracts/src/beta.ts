import * as Schema from "effect/Schema";
import { ThreadId, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BetaBusBody = TrimmedNonEmptyString.check(Schema.isMaxLength(16_000));
export const BetaBusKey = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export const BetaBusLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));
export const BetaBusStatus = Schema.Literals(["pending", "approved", "rejected", "delivered"]);
export const BetaBusMessage = Schema.Struct({
  id: Schema.String,
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  sourceActor: Schema.String,
  sourceProviderSessionId: Schema.NullOr(Schema.String),
  body: BetaBusBody,
  status: BetaBusStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  decidedBy: Schema.NullOr(Schema.String),
  deliverySequence: Schema.NullOr(Schema.Int),
  lastError: Schema.NullOr(Schema.String),
});
export type BetaBusMessage = typeof BetaBusMessage.Type;
export const BetaBusSendInput = Schema.Struct({
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  body: BetaBusBody,
  idempotencyKey: BetaBusKey,
});
export type BetaBusSendInput = typeof BetaBusSendInput.Type;
export const BetaBusInboxInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  direction: Schema.optional(Schema.Literals(["incoming", "outgoing", "all"])),
  limit: Schema.optional(BetaBusLimit),
});
export type BetaBusInboxInput = typeof BetaBusInboxInput.Type;
export const BetaBusInboxResult = Schema.Struct({
  messages: Schema.Array(BetaBusMessage),
  truncated: Schema.Boolean,
});
export const BetaBusDecideInput = Schema.Struct({
  id: BetaBusKey,
  decision: Schema.Literals(["approve", "reject"]),
});
export type BetaBusDecideInput = typeof BetaBusDecideInput.Type;
export const BetaThreadsInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
});
export type BetaThreadsInput = typeof BetaThreadsInput.Type;
export const BetaThreadsResult = Schema.Struct({
  threads: Schema.Array(
    Schema.Struct({
      id: ThreadId,
      projectId: ProjectId,
      title: Schema.String,
      projectTitle: Schema.String,
    }),
  ),
  truncated: Schema.Boolean,
});
export const BetaReadSessionInput = Schema.Struct({
  threadId: ThreadId,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
});
export type BetaReadSessionInput = typeof BetaReadSessionInput.Type;
export const BetaReadSessionResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      role: Schema.String,
      text: Schema.String,
      createdAt: Schema.String,
      truncated: Schema.Boolean,
    }),
  ),
  truncated: Schema.Boolean,
});
export class BetaBusError extends Schema.TaggedError<BetaBusError>()(
  "BetaBusError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const BetaBrainCallInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  args: Schema.Record(Schema.String, Schema.Unknown),
});
export type BetaBrainCallInput = typeof BetaBrainCallInput.Type;
export const BetaBrainResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  }),
]);
export type BetaBrainResponse = typeof BetaBrainResponse.Type;

export const BetaArtsieInput = Schema.Struct({
  action: Schema.Literals([
    "apps",
    "files",
    "launch",
    "tools",
    "start_live",
    "import",
    "mkdir",
    "copy",
    "rename",
    "reveal",
  ]),
  args: Schema.Record(Schema.String, Schema.Unknown),
});
export type BetaArtsieInput = typeof BetaArtsieInput.Type;
