// @effect-diagnostics nodeBuiltinImport:off
import { BrainSessions, makeBrainSessions, BrainMemoryReadResult } from "./BrainSessions.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
const encodeMemory = Schema.encodeSync(Schema.fromJsonString(BrainMemoryReadResult));
const decodeMemoryEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ payload: Schema.Struct({ text: Schema.String }) })),
);
import { ServerConfig } from "../config.ts";
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
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { makeSessionBus, SessionBus } from "./SessionBus.ts";
import { BetaToolkit } from "../mcp/toolkits/beta/tools.ts";
import { BetaToolkitHandlersLive } from "../mcp/toolkits/beta/handlers.ts";
import { McpInvocationContext } from "../mcp/McpInvocationContext.ts";
import { BetaBrain, makeBrain } from "./Brain.ts";

const source = ThreadId.make("source");
const target = ThreadId.make("target");
const identity = { actor: "provider:codex", providerSessionId: "provider-session-1" };
const input = {
  sourceThreadId: source,
  targetThreadId: target,
  body: "Shared project context",
  idempotencyKey: "message-1",
};
const at = "2026-10-18T00:00:00.000Z";

const fixture = Effect.fn("BetaBusTest.fixture")(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-beta-bus-"))),
    (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
  );
  const services = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(makeSqlitePersistenceLive(NodePath.join(directory, "state.sqlite"))),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-beta-bus-config-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const context = yield* Layer.build(services);
  const engine = Context.get(context, OrchestrationEngineService);
  const snapshots = Context.get(context, ProjectionSnapshotQuery);
  const projectId = ProjectId.make("project");
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("project"),
    projectId,
    title: "Project",
    workspaceRoot: directory,
    createdAt: at,
  });
  for (const threadId of [source, target]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(threadId),
      threadId,
      projectId,
      title: threadId,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: at,
    });
  }
  const open = Effect.fn("BetaBusTest.open")(function* (
    dispatch: typeof engine.dispatch = engine.dispatch,
  ) {
    const scope = yield* Scope.make();
    const close = Scope.close(scope, Exit.void);
    yield* Effect.addFinalizer(() => close);
    const bus = yield* makeSessionBus(NodePath.join(directory, "beta-bus.sqlite")).pipe(
      Effect.provideService(OrchestrationEngineService, { ...engine, dispatch }),
      Effect.provideService(ProjectionSnapshotQuery, snapshots),
      Effect.provideService(Scope.Scope, scope),
    );
    return { bus, close };
  });
  const detail = snapshots
    .getThreadDetailSnapshot(target)
    .pipe(Effect.map((value) => Option.getOrThrow(value).thread));
  return { directory, engine, snapshots, open, detail };
});

describe("T3 Beta durable session bus", () => {
  it.effect(
    "persists pending requests, deduplicates by authenticated identity, and rejects key conflicts",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.open();
        const message = yield* first.bus.send(input, identity);
        expect(message.status).toBe("pending");
        expect(yield* first.bus.send(input, identity)).toEqual(message);
        expect(
          yield* first.bus.send({ ...input, body: "Different" }, identity).pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        const other = yield* first.bus.send(input, {
          ...identity,
          providerSessionId: "different-session",
        });
        expect(other.id).not.toBe(message.id);
        yield* first.close;
        const second = yield* f.open();
        expect(
          (yield* second.bus.inbox({ threadId: target, direction: "incoming" })).messages,
        ).toHaveLength(2);
        expect((yield* f.detail).messages).toHaveLength(0);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "approves and appends exactly once without starting a provider turn, including retries after restart",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.open();
        const message = yield* first.bus.send(input, identity);
        const delivered = yield* first.bus.decide(
          { id: message.id, decision: "approve" },
          "human:faheem",
        );
        expect(delivered).toMatchObject({
          status: "delivered",
          decidedBy: "human:faheem",
          lastError: null,
        });
        expect(delivered.deliverySequence).toBeGreaterThan(0);
        yield* first.close;
        const second = yield* f.open();
        expect(
          yield* second.bus.decide({ id: message.id, decision: "approve" }, "human:faheem"),
        ).toEqual(delivered);
        const detail = yield* f.detail;
        expect(detail.messages).toHaveLength(1);
        expect(detail.messages[0]?.text).toContain(input.body);
        expect(detail.latestTurn).toBeNull();
        expect(
          yield* second.bus
            .decide({ id: message.id, decision: "reject" }, "human:faheem")
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reconciles the crash window after orchestration commit but before outbox delivery confirmation",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const dispatched: Array<OrchestrationCommand> = [];
        const first = yield* f.open((command) =>
          f.engine.dispatch(command).pipe(
            Effect.flatMap(() => {
              dispatched.push(command);
              return Effect.fail(
                new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "Simulated lost confirmation after commit",
                }),
              );
            }),
          ),
        );
        const message = yield* first.bus.send(input, identity);
        const uncertain = yield* first.bus.decide(
          { id: message.id, decision: "approve" },
          "human:faheem",
        );
        expect(uncertain.status).toBe("approved");
        expect(uncertain.lastError).toContain("not confirmed");
        yield* first.close;
        const second = yield* f.open();
        expect(
          (yield* second.bus.decide({ id: message.id, decision: "approve" }, "human:faheem"))
            .status,
        ).toBe("delivered");
        expect(dispatched[0]?.type).toBe("thread.message.user.append");
        expect((yield* f.detail).messages).toHaveLength(1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "keeps rejection terminal and validates archived destinations and bounded requests",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.open();
        const bus = first.bus;
        const message = yield* bus.send(input, identity);
        const rejected = yield* bus.decide({ id: message.id, decision: "reject" }, "human:faheem");
        expect(yield* bus.decide({ id: message.id, decision: "reject" }, "human:faheem")).toEqual(
          rejected,
        );
        expect(
          yield* bus
            .decide({ id: message.id, decision: "approve" }, "human:faheem")
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect(
          yield* bus.send({ ...input, body: "x".repeat(16001) }, identity).pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect(yield* bus.inbox({ limit: 101 }).pipe(Effect.flip)).toMatchObject({
          _tag: "BetaBusError",
        });
        const pending = yield* bus.send({ ...input, idempotencyKey: "archive" }, identity);
        yield* f.engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("archive"),
          threadId: target,
        });
        const failed = yield* bus.decide({ id: pending.id, decision: "approve" }, "human:faheem");
        expect(failed.status).toBe("approved");
        expect(failed.lastError).toContain("archived");
        expect((yield* bus.threads({})).threads.map((t) => t.id)).toEqual([source]);
        const db = new NodeSqlite.DatabaseSync(NodePath.join(f.directory, "beta-bus.sqlite"), {
          readOnly: true,
        });
        try {
          expect(db.prepare("SELECT COUNT(*) AS n FROM bus_audit").get()?.n).toBeGreaterThan(0);
        } finally {
          db.close();
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "binds MCP relay/inbox to authenticated provider identity and never exposes an agent approval tool",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const opened = yield* f.open();
        const dependencies = Layer.mergeAll(
          Layer.succeed(SessionBus, opened.bus),
          Layer.succeed(BetaBrain, makeBrain()),
        );
        const toolkit = yield* BetaToolkit.pipe(
          Effect.provide(
            BetaToolkitHandlersLive.pipe(
              Layer.provide(Layer.mock(BrainSessions)({})),
              Layer.provide(dependencies),
            ),
          ),
        );
        const scope: McpInvocationContext["Service"] = {
          environmentId: EnvironmentId.make("beta-environment"),
          threadId: source,
          providerInstanceId: ProviderInstanceId.make("claude"),
          providerSessionId: "authenticated-session",
          capabilities: new Set(["beta"]),
          issuedAt: 1,
        };
        const forged = {
          targetThreadId: target,
          body: "Agent context request",
          idempotencyKey: "tool-request",
          sourceThreadId: target,
          sourceActor: "human:faheem",
          providerSessionId: "forged",
        };
        yield* toolkit
          .handle("beta_session_send", forged)
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provide(dependencies),
            Effect.provideService(McpInvocationContext, scope),
          );
        expect(
          (yield* opened.bus.inbox({ threadId: target, direction: "incoming" })).messages[0],
        ).toMatchObject({
          sourceThreadId: source,
          sourceActor: "provider:claude",
          sourceProviderSessionId: "authenticated-session",
          status: "delivered",
          decidedBy: "auto:provider:claude",
        });
        expect(Object.keys(BetaToolkit.tools)).not.toContain("beta_session_decide");
        const denied = yield* toolkit.handle("beta_session_send", forged).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.provide(dependencies),
          Effect.provideService(McpInvocationContext, {
            ...scope,
            capabilities: new Set<"beta">(),
          }),
          Effect.flip,
        );
        expect(denied).toMatchObject({ _tag: "McpCapabilityUnavailableError", capability: "beta" });
        const incoming = yield* toolkit
          .handle("beta_session_inbox", { direction: "incoming" })
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provide(dependencies),
            Effect.provideService(McpInvocationContext, scope),
          );
        expect(incoming.at(-1)?.result).toMatchObject({ messages: [] });
        expect(
          (yield* f.detail).messages.some((message) =>
            message.text.includes("Agent context request"),
          ),
        ).toBe(true);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "offers delivered context once per target and persists acknowledgement without hiding undecided requests",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.open();
        const pending = yield* first.bus.send(input, identity);
        const rejected = yield* first.bus.send({ ...input, idempotencyKey: "rejected" }, identity);
        yield* first.bus.decide({ id: rejected.id, decision: "reject" }, "human:faheem");
        const delivered = yield* first.bus.send(
          { ...input, idempotencyKey: "delivered" },
          identity,
        );
        yield* first.bus.decide({ id: delivered.id, decision: "approve" }, "human:faheem");
        expect((yield* first.bus.pendingContext(target)).messages.map((m) => m.id)).toEqual([
          delivered.id,
        ]);
        expect((yield* first.bus.pendingContext(source)).messages).toEqual([]);
        // A batch containing a pending or foreign message cannot consume valid rows.
        expect(
          yield* first.bus
            .consumedContext(target, [delivered.id, pending.id], "turn-user-message")
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect(
          yield* first.bus
            .consumedContext(source, [delivered.id], "turn-user-message")
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "BetaBusError" });
        expect((yield* first.bus.pendingContext(target)).messages).toHaveLength(1);
        yield* first.bus.consumedContext(target, [delivered.id], "turn-user-message");
        yield* first.bus.consumedContext(target, [delivered.id], "retry-user-message");
        yield* first.close;
        const second = yield* f.open();
        expect((yield* second.bus.pendingContext(target)).messages).toEqual([]);
        expect((yield* second.bus.inbox({ threadId: target })).messages).toHaveLength(3);
        yield* second.bus.decide({ id: pending.id, decision: "approve" }, "human:faheem");
        expect((yield* second.bus.pendingContext(target)).messages.map((m) => m.id)).toEqual([
          pending.id,
        ]);
        expect(
          (yield* second.bus.read({ threadId: target, limit: 1 })).messages[0]?.text,
        ).toContain(input.body);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "retains uncertain approvals outside provider context until committed delivery is confirmed",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.open((command) =>
          Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Simulated unavailable engine before commit",
            }),
          ),
        );
        const message = yield* first.bus.send(input, identity);
        expect(
          (yield* first.bus.decide({ id: message.id, decision: "approve" }, "human:faheem")).status,
        ).toBe("approved");
        expect((yield* first.bus.pendingContext(target)).messages).toEqual([]);
        expect((yield* f.detail).messages).toHaveLength(0);
        yield* first.close;
        const second = yield* f.open();
        expect(
          (yield* second.bus.decide({ id: message.id, decision: "approve" }, "human:faheem"))
            .status,
        ).toBe("delivered");
        expect((yield* second.bus.pendingContext(target)).messages.map((m) => m.id)).toEqual([
          message.id,
        ]);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect("relays agent messages without approval and wakes the idle target once", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const woke = yield* Deferred.make<OrchestrationCommand>();
      const opened = yield* f.open((command) =>
        f.engine
          .dispatch(command)
          .pipe(
            Effect.tap(() =>
              command.type === "thread.turn.start" ? Deferred.succeed(woke, command) : Effect.void,
            ),
          ),
      );
      const delivered = yield* opened.bus.relay(input, identity);
      expect(delivered).toMatchObject({ status: "delivered", decidedBy: "auto:provider:codex" });
      const wake = yield* Deferred.await(woke);
      expect(wake).toMatchObject({ threadId: target, runtimeMode: "full-access" });
      expect(wake.type === "thread.turn.start" && wake.message.text).toContain(
        `targetThreadId ${source}`,
      );
      expect(yield* opened.bus.relay(input, identity)).toEqual(delivered);
      expect((yield* opened.bus.pendingContext(target)).messages.map((m) => m.id)).toEqual([
        delivered.id,
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("caps relays per session pair and leaves the overflow for a human", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opened = yield* f.open();
      const statuses: Array<string> = [];
      for (let index = 0; index < 13; index++) {
        statuses.push(
          (yield* opened.bus.relay({ ...input, idempotencyKey: `relay-${index}` }, identity))
            .status,
        );
      }
      expect(statuses.slice(0, 12).every((status) => status === "delivered")).toBe(true);
      expect(statuses[12]).toBe("pending");
      // The reverse direction has its own budget.
      expect(
        (yield* opened.bus.relay(
          { ...input, sourceThreadId: target, targetThreadId: source, idempotencyKey: "reply" },
          identity,
        )).status,
      ).toBe("delivered");
      expect(
        yield* opened.bus
          .relay({ ...input, targetThreadId: source, idempotencyKey: "self" }, identity)
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "BetaBusError" });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("permits cancellation after commit and reconciles the approved outbox safely", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const committed = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* f.open((command) =>
        f.engine.dispatch(command).pipe(
          Effect.tap(() => Deferred.succeed(committed, undefined)),
          Effect.tap(() => Deferred.await(release)),
        ),
      );
      const message = yield* first.bus.send(input, identity);
      const pending = yield* first.bus
        .decide({ id: message.id, decision: "approve" }, "human:faheem")
        .pipe(Effect.forkChild);
      yield* Deferred.await(committed);
      yield* Fiber.interrupt(pending);
      expect((yield* first.bus.inbox({ threadId: target })).messages[0]?.status).toBe("approved");
      yield* first.close;
      const second = yield* f.open();
      expect(
        (yield* second.bus.decide({ id: message.id, decision: "approve" }, "human:faheem")).status,
      ).toBe("delivered");
      expect((yield* f.detail).messages).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("Brain-owned continuous session memory", () => {
  it.effect("does not acknowledge a later append excluded from the current turn", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const memory = yield* makeBrainSessions(":memory:", "deferred-test").pipe(
        Effect.provideService(OrchestrationEngineService, f.engine),
      );
      const append = (id: string, text: string) =>
        f.engine.dispatch({
          type: "thread.message.user.append",
          commandId: CommandId.make(id),
          threadId: target,
          message: { messageId: MessageId.make(id), text, attachments: [] },
          createdAt: at,
        });
      yield* append("current", "First provider turn");
      yield* append("later-context", "A concurrent append that must stay unseen");
      const first = yield* memory.prepare({
        threadId: target,
        key: "a",
        messageId: "current",
        maxChars: 64000,
      });
      expect(first.text).toBe("");
      expect(first.seenThrough).toBeLessThan(first.revision);
      yield* memory.accepted(target, "a", first.seenThrough);
      yield* append("next", "Next provider turn");
      const next = yield* memory.prepare({
        threadId: target,
        key: "a",
        messageId: "next",
        maxChars: 64000,
      });
      expect(next.text).toContain("A concurrent append that must stay unseen");
    }),
  );

  it.effect("persists full context and each provider bookmark across switch-back and reopen", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const path = NodePath.join(f.directory, "brain-sessions.sqlite");
      const open = Effect.fn("BrainMemoryTest.open")(function* () {
        const scope = yield* Scope.make();
        const close = Scope.close(scope, Exit.void);
        yield* Effect.addFinalizer(() => close);
        const memory = yield* makeBrainSessions(path, "beta-test").pipe(
          Effect.provideService(OrchestrationEngineService, f.engine),
          Effect.provideService(Scope.Scope, scope),
        );
        return { memory, close };
      });
      const append = (id: string, text: string) =>
        f.engine.dispatch({
          type: "thread.message.user.append",
          commandId: CommandId.make(id),
          threadId: target,
          message: { messageId: MessageId.make(id), text, attachments: [] },
          createdAt: at,
        });
      const first = yield* open();
      yield* append("opening", "Remember the blue teapot decision");
      yield* append("turn-a", "Use provider A");
      const a = yield* first.memory.prepare({
        threadId: target,
        key: "provider-a",
        messageId: "turn-a",
        maxChars: 64000,
      });
      expect(a.text).toContain("blue teapot");
      yield* first.memory.park(target, "provider-a", { nativeId: "private-a-cursor" });
      yield* first.memory.accepted(target, "provider-a", a.revision);
      yield* append("turn-b", "Provider B added the green notebook decision");
      const b = yield* first.memory.prepare({
        threadId: target,
        key: "provider-b",
        messageId: "turn-b",
        maxChars: 64000,
      });
      expect(b.text).toContain("blue teapot");
      yield* first.memory.park(target, "provider-b", { nativeId: "private-b-cursor" });
      yield* first.memory.accepted(target, "provider-b", b.revision);
      yield* append("back-a", "Return to provider A");
      const back = yield* first.memory.prepare({
        threadId: target,
        key: "provider-a",
        messageId: "back-a",
        maxChars: 64000,
      });
      expect(back.text).toContain("green notebook");
      expect(back.text).not.toContain("private-a-cursor");
      expect(yield* first.memory.connection(target, "provider-a")).toMatchObject({
        cursor: { nativeId: "private-a-cursor" },
      });
      // A failed/unaccepted provider send must not consume shared context.
      expect(
        (yield* first.memory.prepare({
          threadId: target,
          key: "provider-a",
          messageId: "back-a",
          maxChars: 64000,
        })).text,
      ).toBe(back.text);
      yield* first.close;
      const reopened = yield* open();
      expect(yield* reopened.memory.connection(target, "provider-a")).toMatchObject({
        cursor: { nativeId: "private-a-cursor" },
        seen: a.revision,
      });
      const history = yield* reopened.memory.read(target, { query: "blue teapot" });
      expect(history.events).toHaveLength(1);
      expect(encodeMemory(history)).not.toContain("private-a-cursor");
      expect((yield* reopened.memory.read(source, { query: "blue teapot" })).events).toEqual([]);
      yield* reopened.memory.connected(target, "provider-a", { nativeId: "replacement-a-cursor" });
      const recovered = yield* reopened.memory.prepare({
        threadId: target,
        key: "provider-a",
        messageId: "back-a",
        maxChars: 64000,
      });
      expect(recovered.text).toContain("blue teapot");
      yield* reopened.memory.accepted(target, "provider-a", recovered.revision);
      yield* f.engine.dispatch({
        type: "thread.revert.complete",
        commandId: CommandId.make("rewind"),
        threadId: target,
        turnCount: 0,
        createdAt: at,
      });
      yield* reopened.memory.sync(target);
      expect(yield* reopened.memory.connection(target, "provider-a")).toMatchObject({
        cursor: undefined,
        invalidated: true,
      });
      const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
      try {
        const counts = db
          .prepare(
            "SELECT count(*) AS total,count(DISTINCT event_id) AS unique_events FROM brain_session_events",
          )
          .get();
        expect(counts?.total).toBe(counts?.unique_events);
      } finally {
        db.close();
      }
    }),
  );

  it.effect(
    "retains oversized history with exact event paging instead of dropping it at a handoff",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const memory = yield* makeBrainSessions(
          NodePath.join(f.directory, "brain.sqlite"),
          "beta",
        ).pipe(Effect.provideService(OrchestrationEngineService, f.engine));
        const text = "large-history " + "a".repeat(20000) + " final-needle";
        yield* f.engine.dispatch({
          type: "thread.message.user.append",
          commandId: CommandId.make("large"),
          threadId: target,
          message: { messageId: MessageId.make("large"), text, attachments: [] },
          createdAt: at,
        });
        let page = (yield* memory.read(target, { query: "final-needle", limit: 1 })).events[0]!;
        let serialized = page.text;
        while (page.nextTextOffset !== null) {
          page = (yield* memory.read(target, {
            eventSequence: page.sequence,
            textOffset: page.nextTextOffset,
            limit: 1,
          })).events[0]!;
          serialized += page.text;
        }
        expect(decodeMemoryEvent(serialized).payload.text).toBe(text);
        yield* f.engine.dispatch({
          type: "thread.message.user.append",
          commandId: CommandId.make("current"),
          threadId: target,
          message: { messageId: MessageId.make("current"), text: "current", attachments: [] },
          createdAt: at,
        });
        const context = yield* memory.prepare({
          threadId: target,
          key: "new-provider",
          messageId: "current",
          maxChars: 1500,
        });
        expect(context.text).toContain('"omittedRecords":1');
        expect(context.text.length).toBeLessThanOrEqual(1500);
        expect((yield* memory.read(target, { query: "final-needle" })).events).toHaveLength(1);
      }),
  );
});
