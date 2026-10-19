import * as Schema from "effect/Schema";

export const BrainMemoryReadInput = Schema.Struct({
  afterSequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  eventSequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  textOffset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
});
export type BrainMemoryReadInput = typeof BrainMemoryReadInput.Type;
export const BrainMemoryReadResult = Schema.Struct({
  sessionId: Schema.String,
  revision: Schema.Number,
  events: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number,
      type: Schema.String,
      text: Schema.String,
      textOffset: Schema.Number,
      nextTextOffset: Schema.NullOr(Schema.Number),
    }),
  ),
  nextSequence: Schema.NullOr(Schema.Number),
});
export type BrainMemoryReadResult = typeof BrainMemoryReadResult.Type;

export const BrainRagInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(300)),
  mode: Schema.optional(Schema.Literals(["hybrid", "session", "graphify"])),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
});
export type BrainRagInput = typeof BrainRagInput.Type;
export const BrainGraphResult = Schema.Struct({
  status: Schema.Literals(["ready", "unavailable", "no-match", "ambiguous", "error"]),
  source: Schema.String,
  text: Schema.String,
});
export type BrainGraphResult = typeof BrainGraphResult.Type;
export const BrainRagResult = Schema.Struct({
  sessionId: Schema.String,
  revision: Schema.Number,
  query: Schema.String,
  session: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number,
      type: Schema.String,
      snippet: Schema.String,
    }),
  ),
  graph: BrainGraphResult,
});
export type BrainRagResult = typeof BrainRagResult.Type;
