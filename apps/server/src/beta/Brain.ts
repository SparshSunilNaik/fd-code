import type { BetaBrainCallInput, BetaBrainResponse } from "@fdcode/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createBrainClient, type BrainClient } from "./BrainClient.ts";

const Agent = Schema.Literals(["claude", "codex", "grok"]);
const BoundedText = Schema.String.check(Schema.isMaxLength(4_000));
const HumanInbox = Schema.Struct({ agent: Agent });
const HumanSend = Schema.Struct({
  to: Schema.Literals(["claude", "codex", "grok", "any"]),
  body: BoundedText.check(Schema.isMinLength(1)),
});
const HumanDecide = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  agent: Agent,
  decision: Schema.Literals(["approve", "reject"]),
  note: Schema.optionalKey(BoundedText),
});
const HumanReply = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  agent: Agent,
  text: BoundedText,
});

const decodeHumanInbox = Schema.decodeUnknownEffect(HumanInbox);
const decodeHumanSend = Schema.decodeUnknownEffect(HumanSend);
const decodeHumanDecide = Schema.decodeUnknownEffect(HumanDecide);
const decodeHumanReply = Schema.decodeUnknownEffect(HumanReply);

const invalid: BetaBrainResponse = {
  ok: false,
  error: { code: "invalid-request", message: "Check the Brain request fields and try again." },
};

export function makeBrain(client: BrainClient = createBrainClient()) {
  const read = (input: BetaBrainCallInput): Effect.Effect<BetaBrainResponse> =>
    Effect.promise(() => client.callTool(input.name, input.args));
  // Only the authenticated human HTTP handler calls this boundary. Agent MCP tools
  // are wired to read(), whose transport allowlist rejects every Brain mutation.
  const call = Effect.fn("BetaBrain.call")(function* (input: BetaBrainCallInput) {
    return yield* Effect.gen(function* () {
      switch (input.name) {
        case "brain_bus_inbox": {
          const args = yield* decodeHumanInbox(input.args);
          return yield* Effect.promise(() => client.humanInbox(args));
        }
        case "brain_bus_send": {
          const args = yield* decodeHumanSend(input.args);
          return yield* Effect.promise(() =>
            client.sendHumanMessage({ ...args, sender: "t3-beta" }),
          );
        }
        case "brain_bus_decide": {
          const args = yield* decodeHumanDecide(input.args);
          return yield* Effect.promise(() => client.decideHumanMessage(args));
        }
        case "brain_bus_reply": {
          const args = yield* decodeHumanReply(input.args);
          return yield* Effect.promise(() => client.replyHumanMessage(args));
        }
        default:
          return yield* Effect.promise(() => client.callTool(input.name, input.args));
      }
    }).pipe(Effect.catch(() => Effect.succeed(invalid)));
  });
  return { health: Effect.promise(() => client.health()), read, call };
}

export class BetaBrain extends Context.Service<BetaBrain, ReturnType<typeof makeBrain>>()(
  "t3/beta/Brain/BetaBrain",
) {
  static readonly layer = Layer.sync(BetaBrain, () => makeBrain());
}

export const layer = BetaBrain.layer;
