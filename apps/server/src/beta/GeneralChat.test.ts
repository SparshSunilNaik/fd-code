import { ProjectionTurnRepositoryLive } from "../persistence/Layers/ProjectionTurns.ts";
import {
  GeneralChatToolkit,
  GeneralChatToolkitHandlersLive,
} from "../mcp/toolkits/general/tools.ts";
import { GeneralChat } from "./GeneralChat.ts";
import { McpInvocationContext } from "../mcp/McpInvocationContext.ts";
import * as Stream from "effect/Stream";
import * as Exit from "effect/Exit";
import { EnvironmentId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeGeneralChat } from "./GeneralChat.ts";
import { Laya, type LayaChoice } from "./Laya.ts";
const at = "2026-10-19T04:00:00.000Z";
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-general-test-" });
  const services = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ProjectionTurnRepositoryLive),
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(makeSqlitePersistenceLive(path.join(directory, "state.sqlite"))),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-beta-bus-config-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const context = yield* Layer.build(services);
  const engine = Context.get(context, OrchestrationEngineService);
  const snapshots = Context.get(context, ProjectionSnapshotQuery);
  let calls = 0;
  let mode: "match" | "offline" | "uncertain" = "match";
  const laya = Laya.of({
    warm: Effect.void,
    choose: (_state, criteria) => {
      calls++;
      const choice = Object.keys(criteria).find((key) => key.startsWith("project:")) ?? "target";
      const result: LayaChoice =
        mode === "offline"
          ? { ok: false, detail: "offline" }
          : { ok: true, choice, probability: mode === "uncertain" ? 0.4 : 0.95 };
      return Effect.succeed(result);
    },
  });
  const openService = makeGeneralChat.pipe(
    Effect.provide(context),
    Effect.provideService(Laya, laya),
    Effect.provide(
      Layer.mock(ServerSettingsService)({ getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS) }),
    ),
  );
  const chat = yield* openService;
  const general = yield* chat.open();
  const projectId = ProjectId.make("project");
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-project"),
    projectId,
    title: "Sunflower",
    workspaceRoot: directory,
    createdAt: at,
  });
  const targetId = ThreadId.make("target");
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("target-create"),
    threadId: targetId,
    projectId,
    title: "Sunflower message delivery",
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet-4-6" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: at,
  });
  let questionSequence = 0;
  const question = (id: string, text = "Fix message delivery in Sunflower") =>
    engine.dispatch({
      type: "thread.message.user.append",
      commandId: CommandId.make(id),
      threadId: general.threadId,
      message: { messageId: MessageId.make(id), text, attachments: [] },
      createdAt: at.replace(".000Z", `.${String(++questionSequence).padStart(3, "0")}Z`),
    });
  return {
    chat,
    general,
    openService,
    engine,
    snapshots,
    targetId,
    question,
    calls: () => calls,
    setMode: (next: typeof mode) => {
      mode = next;
    },
  };
}).pipe(Effect.provide(NodeServices.layer));

describe("General chat with real orchestration persistence", () => {
  it.effect("reuses one pinned chat across concurrent opens, service recreation and archival", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const opened = yield* Effect.all([f.chat.open(), f.chat.open()], { concurrency: 2 });
      expect(opened).toEqual([f.general, f.general]);
      const second = yield* f.openService;
      expect(yield* second.open()).toEqual(f.general);
      const shell = Option.getOrThrow(yield* f.snapshots.getThreadShellById(f.general.threadId));
      expect(shell.pinnedAt).toBeTruthy();
      yield* f.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive"),
        threadId: f.general.threadId,
      });
      expect(yield* f.chat.open()).toEqual(f.general);
      expect(
        Option.getOrThrow(yield* f.snapshots.getThreadShellById(f.general.threadId)).archivedAt,
      ).toBeNull();
    }),
  );
  it.effect(
    "retains the decision, hands off the exact question once, and preserves destination settings",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.question("question-1");
        const decision = yield* f.chat.route(f.general.threadId);
        expect(decision).toMatchObject({
          kind: "chat",
          targetThreadId: f.targetId,
          confidence: 0.95,
        });
        expect(yield* f.chat.route(f.general.threadId)).toEqual(decision);
        expect(f.calls()).toBe(2);
        const navigation = yield* f.chat.handoff(f.general.threadId, decision.id);
        expect(yield* f.chat.handoff(f.general.threadId, decision.id)).toEqual(navigation);
        const target = Option.getOrThrow(
          yield* f.snapshots.getThreadDetailSnapshot(f.targetId),
        ).thread;
        expect(target.messages.filter((m) => m.role === "user")).toHaveLength(1);
        expect(target.messages[0]?.text).toBe("Fix message delivery in Sunflower");
        expect(target.modelSelection).toMatchObject({
          instanceId: "claude",
          model: "claude-sonnet-4-6",
        });
        expect(target.runtimeMode).toBe("approval-required");
        const source = Option.getOrThrow(
          yield* f.snapshots.getThreadDetailSnapshot(f.general.threadId),
        ).thread;
        expect(source.activities.filter((a) => a.kind === "general-chat.handoff")).toHaveLength(1);
      }),
  );
  it.effect(
    "keeps offline or uncertain routing in General and refuses stale or forged handoffs",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.question("first");
        f.setMode("offline");
        expect(yield* f.chat.route(f.general.threadId)).toMatchObject({
          kind: "unavailable",
          targetThreadId: null,
        });
        yield* f.question("second");
        f.setMode("uncertain");
        expect(yield* f.chat.route(f.general.threadId)).toMatchObject({
          kind: "uncertain",
          targetThreadId: null,
        });
        yield* f.question("third");
        f.setMode("match");
        const decision = yield* f.chat.route(f.general.threadId);
        yield* f.question("fourth", "Stay here and explain it");
        expect(
          yield* f.chat.handoff(f.general.threadId, decision.id).pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect(
          yield* f.chat.handoff(f.general.threadId, EventId.make("forged")).pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect(yield* f.chat.route(f.targetId).pipe(Effect.flip)).toMatchObject({
          _tag: "BetaBusError",
        });
        expect(
          Option.getOrThrow(yield* f.snapshots.getThreadDetailSnapshot(f.targetId)).thread.messages,
        ).toHaveLength(0);
      }),
  );
  it.effect("refuses an archived destination without writing a question", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.question("route-busy");
      const decision = yield* f.chat.route(f.general.threadId);
      yield* f.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-target"),
        threadId: f.targetId,
      });
      expect(
        yield* f.chat.handoff(f.general.threadId, decision.id).pipe(Effect.flip),
      ).toMatchObject({ _tag: "BetaBusError" });
      yield* f.engine.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make("restore-target"),
        threadId: f.targetId,
      });
      expect(
        Option.getOrThrow(yield* f.snapshots.getThreadDetailSnapshot(f.targetId)).thread.messages,
      ).toHaveLength(0);
    }),
  );
  it.effect("does not guess which timestamp-tied question should be forwarded", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.question("tie-first");
      yield* f.engine.dispatch({
        type: "thread.message.user.append",
        commandId: CommandId.make("tie-second"),
        threadId: f.general.threadId,
        message: {
          messageId: MessageId.make("tie-second"),
          text: "A different question",
          attachments: [],
        },
        createdAt: "2026-10-19T04:00:00.001Z",
      });
      expect(yield* f.chat.route(f.general.threadId).pipe(Effect.flip)).toMatchObject({
        _tag: "BetaBusError",
      });
      expect(f.calls()).toBe(0);
    }),
  );

  it.effect("does not replace a destination turn waiting for its provider", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.question("route-pending");
      const decision = yield* f.chat.route(f.general.threadId);
      yield* f.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("pending-target"),
        threadId: f.targetId,
        message: {
          messageId: MessageId.make("pending-target"),
          role: "user",
          text: "Existing user task",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: at,
      });
      expect(
        yield* f.chat.handoff(f.general.threadId, decision.id).pipe(Effect.flip),
      ).toMatchObject({ _tag: "BetaBusError" });
      const target = Option.getOrThrow(
        yield* f.snapshots.getThreadDetailSnapshot(f.targetId),
      ).thread;
      expect(target.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual([
        "Existing user task",
      ]);
    }),
  );
  it.effect(
    "binds routing tools to the authenticated General chat and requires the Beta capability",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.question("tool-question");
        const service = Layer.succeed(GeneralChat, f.chat);
        const toolkit = yield* GeneralChatToolkit.pipe(
          Effect.provide(GeneralChatToolkitHandlersLive.pipe(Layer.provide(service))),
        );
        const scope: McpInvocationContext["Service"] = {
          environmentId: EnvironmentId.make("test-environment"),
          threadId: f.general.threadId,
          providerSessionId: "test-session",
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: new Set(),
          issuedAt: 1,
        };
        const invoke = (capabilities: ReadonlySet<"beta">, args: Record<string, unknown> = {}) =>
          toolkit
            .handle("beta_route_request", args as Record<string, never>)
            .pipe(
              Stream.unwrap,
              Stream.runCollect,
              Effect.provide(service),
              Effect.provideService(McpInvocationContext, { ...scope, capabilities }),
            );
        expect(Exit.isFailure(yield* invoke(new Set()).pipe(Effect.exit))).toBe(true);
        expect(f.calls()).toBe(0);
        expect(
          Exit.isFailure(
            yield* invoke(new Set(["beta"]), { threadId: f.targetId }).pipe(Effect.exit),
          ),
        ).toBe(true);
        expect(f.calls()).toBe(0);
        yield* invoke(new Set(["beta"]));
        expect(f.calls()).toBe(2);
        expect(
          Option.getOrThrow(yield* f.snapshots.getThreadDetailSnapshot(f.targetId)).thread
            .activities,
        ).toHaveLength(0);
      }),
  );
});
