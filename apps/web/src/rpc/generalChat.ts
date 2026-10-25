import type { GeneralChatSendInput } from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

export const openGeneralChat = () =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.beta.generalChat({ headers: {} })),
    ),
  );
export const sendGeneralChat = (payload: GeneralChatSendInput) =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.beta.generalChatSend({ headers: {}, payload })),
    ),
  );
