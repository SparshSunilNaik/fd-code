import type { BetaBrainResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type ArtsieAgentAction, createArtsieAgentClient } from "./ArtsieClient.ts";

export function makeArtsie(client = createArtsieAgentClient()) {
  return {
    request: (
      action: ArtsieAgentAction,
      args: Readonly<Record<string, unknown>>,
    ): Effect.Effect<BetaBrainResponse> => Effect.promise(() => client(action, args)),
  };
}

/** The local ARTsie hub, as reached by agent MCP tools. */
export class BetaArtsie extends Context.Service<BetaArtsie, ReturnType<typeof makeArtsie>>()(
  "t3/beta/Artsie/BetaArtsie",
) {
  static readonly layer = Layer.sync(BetaArtsie, () => makeArtsie());
}

export const layer = BetaArtsie.layer;
