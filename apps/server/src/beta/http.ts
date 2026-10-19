import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { BetaBrain } from "./Brain.ts";
import { createArtsieClient } from "./ArtsieClient.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "beta",
  Effect.fnUntraced(function* (handlers) {
    const brain = yield* BetaBrain;
    const artsie = createArtsieClient();
    return handlers
      .handle(
        "artsie",
        Effect.fn("beta.artsie")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(
            args.payload.action === "apps" || args.payload.action === "files"
              ? AuthOrchestrationReadScope
              : AuthOrchestrationOperateScope,
          );
          return yield* Effect.promise(() => artsie(args.payload));
        }),
      )
      .handle(
        "brainHealth",
        Effect.fn("beta.brainHealth")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* brain.health;
        }),
      )
      .handle(
        "brainCall",
        Effect.fn("beta.brainCall")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* brain.call(args.payload);
        }),
      );
  }),
);
