import { GeneralChat } from "./GeneralChat.ts";
import { ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type BetaBusMessage,
  type BetaBusSendInput,
  type BetaBusDecideInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as Etag from "effect/unstable/http/Etag";
import { expect, it } from "@effect/vitest";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { authHttpApiLayer, environmentAuthenticatedAuthLayer } from "../auth/http.ts";
import { SessionBus, type BetaBusIdentity } from "./SessionBus.ts";
import { BetaBrain } from "./Brain.ts";
import { betaHttpApiLayer } from "./http.ts";

const TOKEN = "t3-beta-http-test-token-that-is-long-enough";
class TestApi extends HttpApi.make("environment")
  .add(EnvironmentHttpApi.groups.beta)
  .add(EnvironmentHttpApi.groups.auth) {}
const config = Layer.effect(
  ServerConfig,
  ServerConfig.pipe(
    Effect.map((config) => ({
      ...config,
      mode: "web" as const,
      devUrl: new URL("http://127.0.0.1:5173"),
      devAuthToken: Redacted.make(TOKEN),
    })),
  ),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-beta-http-" })));
const auth = EnvironmentAuth.layer.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.identityLayer),
  Layer.provide(config),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const post = (path: string, payload: unknown, cookie?: string) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
    body: encodeJson(payload),
  });

it.effect(
  "protects Beta HTTP routes with normal auth and scope checks and uses authenticated human identity",
  () =>
    Effect.gen(function* () {
      const sends: Array<BetaBusIdentity> = [];
      const decisions: Array<string> = [];
      const brainCalls: Array<string> = [];
      const bus = Layer.mock(SessionBus)({
        threads: () => Effect.succeed({ threads: [], truncated: false }),
        inbox: () => Effect.succeed({ messages: [], truncated: false }),
        send: (input: BetaBusSendInput, identity: BetaBusIdentity) => {
          sends.push(identity);
          return Effect.succeed({
            id: "request-1",
            ...input,
            sourceActor: identity.actor,
            sourceProviderSessionId: identity.providerSessionId,
            status: "pending",
            createdAt: "2026-10-18T00:00:00.000Z",
            updatedAt: "2026-10-18T00:00:00.000Z",
            decidedBy: null,
            deliverySequence: null,
            lastError: null,
          } satisfies BetaBusMessage);
        },
        decide: (_input: BetaBusDecideInput, actor: string) => {
          decisions.push(actor);
          return Effect.die("Not called in scope tests");
        },
      });
      const brain = Layer.succeed(BetaBrain, {
        health: Effect.succeed({ ok: true as const, value: { connected: true as const } }),
        read: () => Effect.succeed({ ok: true as const, value: [] }),
        call: ({ name }) => {
          brainCalls.push(name);
          return Effect.succeed({ ok: true as const, value: [] });
        },
      });
      const routes = HttpApiBuilder.layer(TestApi).pipe(
        Layer.provide(authHttpApiLayer),
        Layer.provide(betaHttpApiLayer),
        Layer.provide(environmentAuthenticatedAuthLayer),
        Layer.provide(bus),
        Layer.provide(brain),
        Layer.provide(
          Layer.mock(GeneralChat)({
            open: () => Effect.succeed({ threadId: ThreadId.make("general-test") }),
          }),
        ),
        Layer.provideMerge(auth),
        Layer.provide(config),
        Layer.provide(
          HttpPlatform.layer.pipe(
            Layer.provideMerge(NodeServices.layer),
            Layer.provideMerge(Etag.layerWeak),
          ),
        ),
        Layer.provide(NodeServices.layer),
      );
      const crypto = yield* Crypto.Crypto;
      const unusedSecretStore = ServerSecretStore.ServerSecretStore.of({
        get: () => Effect.succeed(Option.none()),
        set: () => Effect.void,
        create: () => Effect.void,
        getOrCreateRandom: () => Effect.die("Not used by these routes"),
        remove: () => Effect.void,
      });
      const requestContext = Context.make(Crypto.Crypto, crypto).pipe(
        Context.add(ServerSecretStore.ServerSecretStore, unusedSecretStore),
      );
      const app = HttpRouter.toWebHandler(routes, { disableLogger: true });
      yield* Effect.acquireUseRelease(
        Effect.succeed(app),
        () =>
          Effect.tryPromise(async () => {
            expect(
              (
                await app.handler(
                  post("/api/beta/artsie", { action: "apps", args: {} }),
                  requestContext,
                )
              ).status,
            ).toBe(401);
            expect(
              (await app.handler(post("/api/beta/general-chat", {}), requestContext)).status,
            ).toBe(401);
            expect((await app.handler(post("/api/beta/threads", {}), requestContext)).status).toBe(
              401,
            );
            expect(
              (
                await app.handler(
                  post("/api/beta/decide", { id: "request-1", decision: "approve" }),
                  requestContext,
                )
              ).status,
            ).toBe(401);
            const login = await app.handler(
              post("/api/auth/browser-session", { credential: TOKEN }),
              requestContext,
            );
            expect(login.status).toBe(200);
            const cookie = login.headers
              .getSetCookie()
              .find((value) => value.startsWith("t3_dev_session_"))
              ?.split(";", 1)[0];
            expect(cookie).toBeTruthy();
            expect(
              (await app.handler(post("/api/beta/threads", {}, cookie), requestContext)).status,
            ).toBe(200);
            const sent = await app.handler(
              post(
                "/api/beta/send",
                {
                  sourceThreadId: "source",
                  targetThreadId: "target",
                  body: "Context",
                  idempotencyKey: "http-1",
                  sourceActor: "spoofed",
                },
                cookie,
              ),
              requestContext,
            );
            expect(
              (await app.handler(post("/api/beta/general-chat", {}, cookie), requestContext))
                .status,
            ).toBe(200);
            expect(sent.status).toBe(200);
            expect(sends).toHaveLength(1);
            expect(sends[0]?.actor).toMatch(/^human:/);
            expect(sends[0]?.actor).not.toContain("spoofed");
            expect(sends[0]?.providerSessionId).toBeNull();
            const pairing = await app.handler(
              post("/api/auth/pairing-token", { scopes: [AuthOrchestrationReadScope] }, cookie),
              requestContext,
            );
            expect(pairing.status).toBe(200);
            const credential = (await pairing.json()) as { credential: string };
            // Browser pairing issues a scope-limited independent session.
            const limitedLogin = await app.handler(
              post("/api/auth/browser-session", { credential: credential.credential }),
              requestContext,
            );
            expect(limitedLogin.status).toBe(200);
            const limitedCookie = limitedLogin.headers
              .getSetCookie()
              .find((value) => value.startsWith("t3_session_"))
              ?.split(";", 1)[0];
            expect(limitedCookie).toBeTruthy();
            for (const action of [
              "launch",
              "tools",
              "start_live",
              "copy",
              "rename",
              "mkdir",
              "import",
              "reveal",
            ]) {
              const artsieDenied = await app.handler(
                post("/api/beta/artsie", { action, args: {} }, limitedCookie),
                requestContext,
              );
              expect(artsieDenied.status).toBe(403);
            }
            const denied = await app.handler(
              post("/api/beta/decide", { id: "request-1", decision: "approve" }, limitedCookie),
              requestContext,
            );
            expect(
              (await app.handler(post("/api/beta/general-chat", {}, limitedCookie), requestContext))
                .status,
            ).toBe(403);
            expect(denied.status).toBe(403);
            expect(await denied.json()).toMatchObject({
              requiredScope: AuthOrchestrationOperateScope,
            });
            expect(
              (
                await app.handler(
                  post(
                    "/api/beta/brain/call",
                    { name: "brain_bus_send", args: { to: "claude", body: "Hello" } },
                    limitedCookie,
                  ),
                  requestContext,
                )
              ).status,
            ).toBe(403);
            expect(decisions).toEqual([]);
            expect(brainCalls).toEqual([]);
          }),
        () => Effect.promise(() => app.dispose()),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
