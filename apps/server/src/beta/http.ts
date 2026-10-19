import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { GeneralChat } from "./GeneralChat.ts";
import { SessionBus } from "./SessionBus.ts";
import { BetaBrain } from "./Brain.ts";
import { createArtsieClient } from "./ArtsieClient.ts";

export const betaHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "beta",
  Effect.fnUntraced(function* (handlers) {
    const bus = yield* SessionBus;
    const general = yield* GeneralChat;
    const brain = yield* BetaBrain;
    const artsie = createArtsieClient();
    return handlers
      .handle(
        "generalChat",
        Effect.fn("beta.generalChat")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* general.open();
        }),
      )
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
        "threads",
        Effect.fn("beta.threads")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* bus.threads(args.payload);
        }),
      )
      .handle(
        "inbox",
        Effect.fn("beta.inbox")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* bus.inbox(args.payload);
        }),
      )
      .handle(
        "send",
        Effect.fn("beta.send")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const principal = yield* EnvironmentAuthenticatedPrincipal;
          return yield* bus.send(args.payload, {
            actor: `human:${principal.subject}`,
            providerSessionId: null,
          });
        }),
      )
      .handle(
        "decide",
        Effect.fn("beta.decide")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const principal = yield* EnvironmentAuthenticatedPrincipal;
          return yield* bus.decide(args.payload, `human:${principal.subject}`);
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
