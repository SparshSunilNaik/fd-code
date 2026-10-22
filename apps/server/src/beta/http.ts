import {
  AuthEnvironmentMaintainScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  type BetaArtsieInput,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { BetaBrain } from "./Brain.ts";
import { GeneralChat } from "./GeneralChat.ts";
import { createArtsieClient } from "./ArtsieClient.ts";

// Reading the workspace is a filesystem read and changing it a filesystem write. Actions
// that start editor processes (tools starts a headless or live session) or open apps,
// a native picker or Finder on the host need the owner-level scope.
const artsieScope = (action: BetaArtsieInput["action"]) => {
  switch (action) {
    case "apps":
    case "files":
      return AuthFilesystemReadScope;
    case "mkdir":
    case "copy":
    case "rename":
      return AuthFilesystemWriteScope;
    case "tools":
    case "import":
    case "launch":
    case "start_live":
    case "reveal":
      return AuthEnvironmentMaintainScope;
  }
};

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "beta",
  Effect.fnUntraced(function* (handlers) {
    const brain = yield* BetaBrain;
    const general = yield* GeneralChat;
    const artsie = createArtsieClient();
    return handlers
      .handle(
        "generalChat",
        Effect.fn("general.open")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* general.open;
        }),
      )
      .handle(
        "generalChatSend",
        Effect.fn("general.send")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* general.send(args.payload);
        }),
      )
      .handle(
        "artsie",
        Effect.fn("beta.artsie")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(artsieScope(args.payload.action));
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
          // Brain calls reach private records and the agent bus: owner-level only.
          yield* requireEnvironmentScope(AuthEnvironmentMaintainScope);
          return yield* brain.call(args.payload);
        }),
      );
  }),
);
