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

// A workspace-relative path: the ARTsie hub resolves it under its workspace, and this
// shape keeps absolute paths, traversal and odd separators from ever being forwarded.
export const ArtsieWorkspacePath = Schema.String.check(
  Schema.isMaxLength(512),
  Schema.makeFilter(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\u0000") &&
      !path.split("/").includes(".."),
    { expected: "a path inside the ARTsie workspace" },
  ),
);
export const ArtsieAppId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));
// Decoding drops unknown keys from objects with fields but keeps them on an empty object,
// so each object also checks its own key set: nothing undeclared reaches the hub.
const onlyKeys = (allowed: ReadonlyArray<string>) =>
  Schema.makeFilter((value: object) => Object.keys(value).every((key) => allowed.includes(key)), {
    expected: `only the keys ${allowed.join(", ") || "(none)"}`,
  });
const artsieAction = <A extends string, F extends Schema.Struct.Fields>(action: A, args: F) =>
  Schema.Struct({
    action: Schema.Literal(action),
    args: Schema.Struct(args).check(onlyKeys(Object.keys(args))),
  }).check(onlyKeys(["action", "args"]));
// Each action carries only its own fields.
export const BetaArtsieInput = Schema.Union([
  artsieAction("apps", {}),
  artsieAction("files", { path: Schema.optional(ArtsieWorkspacePath) }),
  artsieAction("tools", {
    app: ArtsieAppId,
    mode: Schema.optional(Schema.Literals(["headless", "live"])),
  }),
  artsieAction("mkdir", { path: ArtsieWorkspacePath }),
  artsieAction("copy", { source: ArtsieWorkspacePath, target: ArtsieWorkspacePath }),
  artsieAction("rename", { source: ArtsieWorkspacePath, target: ArtsieWorkspacePath }),
  artsieAction("import", { folder: Schema.optional(Schema.Boolean) }),
  artsieAction("launch", { app: ArtsieAppId, path: Schema.optional(ArtsieWorkspacePath) }),
  artsieAction("start_live", { app: ArtsieAppId }),
  artsieAction("reveal", { path: Schema.optional(ArtsieWorkspacePath) }),
]);
export type BetaArtsieInput = typeof BetaArtsieInput.Type;
