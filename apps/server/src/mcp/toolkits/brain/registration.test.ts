import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import * as BrainMemory from "../../../brain/BrainMemory.ts";
import * as BetaBrain from "../../../beta/Brain.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const threadId = ThreadId.make("brain-calling-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("brain-test-env"),
  requestNamespace: "brain-test-session",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  client: undefined,
  thread: {
    threadId,
    providerSessionId: "brain-test-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "brain-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "brain-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

it.effect(
  "enforces capabilities and binds Brain reads to the authenticated caller through production MCP registration",
  () => {
    const reads: string[] = [];
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const call = (caller: McpInvocationContext.McpInvocationScope) =>
        server
          .callTool({
            name: "t3_brain_memory",
            arguments: { threadId: "foreign-thread", limit: 1 },
          })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
      expect((yield* call({ ...scope, capabilities: new Set() })).isError).toBe(true);
      expect((yield* call({ ...scope, thread: undefined })).isError).toBe(true);
      expect(reads).toEqual([]);
      const result = yield* call(scope);
      expect(result.isError).not.toBe(true);
      expect(reads).toEqual([threadId]);
    }).pipe(
      Effect.provide(
        McpHttpServer.layerBrainToolkit.pipe(
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(
            Layer.mock(BrainMemory.BrainMemory)({
              read: (thread) =>
                Effect.sync(() => {
                  reads.push(thread);
                  return { sessionId: thread, revision: 1, events: [], nextSequence: null };
                }),
            }),
          ),
          Layer.provide(Layer.mock(BetaBrain.BetaBrain)({})),
        ),
      ),
    );
  },
);
