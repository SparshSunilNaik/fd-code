import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  type BetaBrainResponse,
  EnvironmentId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import * as BetaArtsie from "../../../beta/Artsie.ts";
import * as ArtsieCli from "../../../beta/ArtsieCli.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import { ArtsieToolkit } from "./tools.ts";

const threadId = ThreadId.make("artsie-calling-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("artsie-test-env"),
  requestNamespace: "artsie-test-session",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  client: undefined,
  thread: {
    threadId,
    providerSessionId: "artsie-test-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "artsie-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "artsie-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

interface Harness {
  readonly requests: Array<{ action: string; args: unknown }>;
  runtimeMode: RuntimeMode;
  response: BetaBrainResponse;
}

const call = (
  name: string,
  args: Record<string, unknown>,
  caller: McpInvocationContext.McpInvocationScope = scope,
) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

const withToolkit = <A, E>(
  harness: Harness,
  body: (callTool: typeof call) => Effect.Effect<A, E, McpServer.McpServer>,
) =>
  body(call).pipe(
    Effect.provide(
      McpHttpServer.layerArtsieToolkit.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(
          Layer.succeed(ArtsieCli.ArtsieCli, {
            run: (argv) =>
              Effect.sync(() => {
                harness.requests.push({ action: "cli", args: argv });
                return { exitCode: 0, result: { ok: true } };
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.sync(() => liveThreadShell(id, { runtimeMode: harness.runtimeMode })),
          }),
        ),
        Layer.provide(
          Layer.succeed(BetaArtsie.BetaArtsie, {
            request: (action, args) =>
              Effect.sync(() => {
                harness.requests.push({ action, args });
                return harness.response;
              }),
          }),
        ),
      ),
    ),
  );

const makeHarness = (): Harness => ({
  requests: [],
  runtimeMode: "full-access",
  response: { ok: true, value: { apps: [{ id: "photocraft", name: "PhotoCraft" }] } },
});

it("exposes ARTsie's gateway actions, without the human-only picker or Finder", () => {
  expect(Object.keys(ArtsieToolkit.tools).toSorted()).toEqual([
    "t3_artsie_apps",
    "t3_artsie_call",
    "t3_artsie_cli",
    "t3_artsie_copy",
    "t3_artsie_files",
    "t3_artsie_launch",
    "t3_artsie_mkdir",
    "t3_artsie_rename",
    "t3_artsie_start_live",
    "t3_artsie_tools",
  ]);
});

it.effect(
  "enforces capabilities and a thread caller for ARTsie reads through production MCP registration",
  () => {
    const harness = makeHarness();
    return withToolkit(harness, (call) =>
      Effect.gen(function* () {
        expect(
          (yield* call("t3_artsie_apps", {}, { ...scope, capabilities: new Set() })).isError,
        ).toBe(true);
        expect((yield* call("t3_artsie_apps", {}, { ...scope, thread: undefined })).isError).toBe(
          true,
        );
        expect(harness.requests).toEqual([]);
        const result = yield* call("t3_artsie_apps", {});
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: true,
          value: { apps: [{ id: "photocraft" }] },
        });
        expect(harness.requests).toEqual([{ action: "apps", args: {} }]);
      }),
    );
  },
);

it.effect("rejects paths outside the ARTsie workspace before reaching the hub", () => {
  const harness = makeHarness();
  return withToolkit(harness, (call) =>
    Effect.gen(function* () {
      // Rejected as invalid MCP params by the advertised schema; the hub never sees them.
      for (const [name, args] of [
        ["t3_artsie_files", { path: "../secrets" }],
        ["t3_artsie_files", { path: "/etc" }],
        ["t3_artsie_copy", { source: "a.png", target: "../b.png" }],
        ["t3_artsie_call", { app: "../photocraft", tool: "document_info" }],
      ] as const) {
        const error = yield* Effect.flip(call(name, args));
        expect(String(error)).toContain("Invalid parameters");
      }
      expect(harness.requests).toEqual([]);
      expect((yield* call("t3_artsie_files", { path: "Exports" })).isError).not.toBe(true);
      expect(harness.requests).toEqual([{ action: "files", args: { path: "Exports" } }]);
    }),
  );
});

it.effect(
  "lets only a live full-access thread discover and call native app tools, forwarding exact arguments",
  () => {
    const harness = makeHarness();
    const nativeCall = {
      app: "photocraft",
      tool: "document_open",
      arguments: { path: "/tmp/in.png", layers: [1, 2] },
      mode: "headless",
    };
    return withToolkit(harness, (call) =>
      Effect.gen(function* () {
        harness.runtimeMode = "approval-required";
        const supervised = yield* call("t3_artsie_call", nativeCall);
        expect(supervised.isError).toBe(true);
        expect(JSON.stringify(supervised.content)).toContain("full-access");
        expect((yield* call("t3_artsie_tools", { app: "photocraft" })).isError).toBe(true);
        harness.runtimeMode = "full-access";
        const readOnlyClient = yield* call("t3_artsie_call", nativeCall, {
          ...scope,
          thread: undefined,
          client: { sessionId: "client", label: "client", access: "read-only" },
        });
        expect(readOnlyClient.isError).toBe(true);
        expect(harness.requests).toEqual([]);

        harness.response = { ok: true, value: { content: [{ type: "text", text: "opened" }] } };
        const result = yield* call("t3_artsie_call", nativeCall);
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          value: { content: [{ type: "text", text: "opened" }] },
        });
        expect(harness.requests).toEqual([{ action: "call", args: nativeCall }]);
      }),
    );
  },
);

it.effect("reports hub failures to the model as tool errors", () => {
  const harness = makeHarness();
  harness.response = {
    ok: false,
    error: { code: "unavailable", message: "ARTsie is offline on this host." },
  };
  return withToolkit(harness, (call) =>
    Effect.gen(function* () {
      const result = yield* call("t3_artsie_apps", {});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("ARTsie is offline on this host.");
    }),
  );
});

it.effect("gates the unified CLI and forwards argv without shell interpretation", () => {
  const harness = makeHarness();
  return withToolkit(harness, (call) =>
    Effect.gen(function* () {
      const argv = [
        "call",
        "photocraft",
        "doc_export",
        "--input",
        '{"path":"/Exports/a $(touch nope).png"}',
      ];
      harness.runtimeMode = "approval-required";
      expect((yield* call("t3_artsie_cli", { argv })).isError).toBe(true);
      expect(harness.requests).toEqual([]);
      harness.runtimeMode = "full-access";
      const result = yield* call("t3_artsie_cli", { argv });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        value: { exitCode: 0, result: { ok: true } },
      });
      expect(harness.requests).toEqual([{ action: "cli", args: argv }]);
    }),
  );
});
