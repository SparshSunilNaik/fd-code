import { latestGeneralQuestion } from "./generalChatContext.ts";
import {
  BetaBusError,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  DEFAULT_MODEL,
  GENERAL_CHAT_THREAD_PREFIX,
  GeneralChatDecision,
  type GeneralChatNavigation,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { Laya, chooseLayaDestination } from "./Laya.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../persistence/Layers/ProjectionTurns.ts";

const failure = () =>
  new BetaBusError({
    message:
      "General chat could not complete this operation. Your saved conversations remain available; retry.",
  });
const decodeDecision = Schema.decodeUnknownOption(GeneralChatDecision);

export const makeGeneralChat = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settings = yield* ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const turns = yield* ProjectionTurnRepository;
  const laya = yield* Laya;
  const lock = yield* Semaphore.make(1);
  const routeLock = yield* Semaphore.make(1);
  const workspaceRoot = path.join(config.baseDir, "general-chat");
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const dispatch = (command: OrchestrationCommand) =>
    engine.dispatch(command).pipe(Effect.mapError(failure));
  const detail = Effect.fn("GeneralChat.detail")(function* (threadId: ThreadId) {
    const result = yield* snapshots
      .getThreadDetailSnapshot(threadId, { turnLimit: 20 })
      .pipe(Effect.mapError(failure));
    if (
      Option.isNone(result) ||
      result.value.thread.deletedAt !== null ||
      result.value.thread.archivedAt !== null
    )
      return yield* new BetaBusError({ message: "This conversation is unavailable or archived." });
    return result.value.thread;
  });
  const requireGeneral = Effect.fn("GeneralChat.requireGeneral")(function* (threadId: ThreadId) {
    const thread = yield* detail(threadId);
    const project = yield* snapshots
      .getProjectShellById(thread.projectId)
      .pipe(Effect.mapError(failure));
    if (
      !threadId.startsWith(GENERAL_CHAT_THREAD_PREFIX) ||
      Option.isNone(project) ||
      project.value.workspaceRoot !== workspaceRoot
    )
      return yield* new BetaBusError({
        message: "This operation is available only from General chat.",
      });
    return thread;
  });
  const open = Effect.fn("GeneralChat.open")(function* () {
    yield* laya.warm;
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        let project = yield* snapshots
          .getActiveProjectByWorkspaceRoot(workspaceRoot)
          .pipe(Effect.mapError(failure));
        const at = yield* now;
        if (Option.isNone(project)) {
          yield* fs
            .makeDirectory(workspaceRoot, { recursive: true })
            .pipe(Effect.mapError(failure));
          const projectId = ProjectId.make(`beta-general-project-${yield* crypto.randomUUIDv4}`);
          yield* dispatch({
            type: "project.create",
            commandId: CommandId.make(`general-project:${projectId}`),
            projectId,
            title: "General",
            workspaceRoot,
            createdAt: at,
          });
          project = yield* snapshots
            .getActiveProjectByWorkspaceRoot(workspaceRoot)
            .pipe(Effect.mapError(failure));
        }
        if (Option.isNone(project)) return yield* failure();
        const snapshot = yield* snapshots.getCommandReadModel().pipe(Effect.mapError(failure));
        const existing = snapshot.threads.find(
          (t) =>
            t.projectId === project.value.id &&
            t.deletedAt === null &&
            t.id.startsWith(GENERAL_CHAT_THREAD_PREFIX),
        );
        if (existing) {
          if (existing.archivedAt !== null)
            yield* dispatch({
              type: "thread.unarchive",
              commandId: CommandId.make(`general-restore:${yield* crypto.randomUUIDv4}`),
              threadId: existing.id,
            });
          return { threadId: existing.id };
        }
        const current = yield* settings.getSettings.pipe(Effect.mapError(failure));
        const threadId = ThreadId.make(
          `${GENERAL_CHAT_THREAD_PREFIX}${yield* crypto.randomUUIDv4}`,
        );
        yield* dispatch({
          type: "thread.create",
          commandId: CommandId.make(`general-create:${threadId}`),
          threadId,
          projectId: project.value.id,
          title: "General chat",
          modelSelection: current.defaultModelSelection ?? {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: at,
        });
        yield* dispatch({
          type: "thread.pin",
          commandId: CommandId.make(`general-pin:${threadId}`),
          threadId,
        });
        return { threadId };
      }),
    );
  });
  const route = Effect.fn("GeneralChat.route")(function* (threadId: ThreadId) {
    const thread = yield* requireGeneral(threadId);
    const message = latestGeneralQuestion(thread);
    if (!message)
      return yield* new BetaBusError({ message: "Send a question in General chat first." });
    const prior = thread.activities
      .map((a) => decodeDecision(a.payload))
      .find((d) => Option.isSome(d) && d.value.sourceMessageId === message.id);
    if (prior && Option.isSome(prior)) return prior.value;
    const snapshot = yield* snapshots.getShellSnapshot().pipe(Effect.mapError(failure));
    const candidates = snapshot.threads.filter(
      (t) =>
        t.id !== threadId && !t.id.startsWith(GENERAL_CHAT_THREAD_PREFIX) && t.archivedAt === null,
    );
    // Select the project before the chat. Large sets are compared in groups,
    // preserving coverage instead of dropping a hidden top-N subset.
    const projects = snapshot.projects.filter((p) => candidates.some((t) => t.projectId === p.id));
    let decision: GeneralChatDecision = {
      id: EventId.make(`general-route:${message.id}`),
      sourceMessageId: message.id,
      kind: "uncertain",
      targetThreadId: null,
      targetTitle: null,
      confidence: null,
      detail: "No clear existing chat match; continue here.",
    };
    const criteria: Record<string, string> = {
      general: "An ordinary question or conversation with no particular project",
      web: "Search the web, browse sites, or retrieve current public information",
      none: "Unclear request, a contextual follow-up, or no matching destination",
    };
    for (const project of projects)
      criteria[`project:${project.id}`] = `Work in project ${project.title.slice(0, 256)}`;
    if ((message.attachments?.length ?? 0) > 0 || message.context !== undefined) {
      decision = {
        ...decision,
        kind: "general",
        detail: "Keep attachments and their context in General chat.",
      };
    } else {
      const first = yield* chooseLayaDestination(laya, message.text, criteria);
      if (!first.ok)
        decision = {
          ...decision,
          kind: first.reason === "uncertain" ? "uncertain" : "unavailable",
          detail: first.detail,
        };
      else if (first.probability >= 0.75) {
        decision = { ...decision, confidence: first.probability };
        if (first.choice === "general" || first.choice === "web")
          decision = {
            ...decision,
            kind: first.choice,
            detail:
              first.choice === "web"
                ? "Browse with the available web or preview tools and cite the results."
                : "Answer in General chat.",
          };
        else if (first.choice.startsWith("project:")) {
          const projectId = first.choice.slice("project:".length);
          const chats = candidates.filter((t) => t.projectId === projectId);
          const choices: Record<string, string> = {
            none: "No existing chat matches; keep the question in General",
          };
          for (const chat of chats) choices[chat.id] = chat.title.slice(0, 256);
          const second = yield* chooseLayaDestination(laya, message.text, choices);
          if (second.ok && second.choice !== "none" && second.probability >= 0.75) {
            const target = chats.find((t) => t.id === second.choice);
            if (target)
              decision = {
                ...decision,
                kind: "chat",
                targetThreadId: target.id,
                targetTitle: target.title,
                confidence: Math.min(first.probability, second.probability),
                detail:
                  "A matching existing chat was found. Handoff forwards the saved user question using that chat's current provider and permissions.",
              };
          }
        }
      }
    }
    const at = yield* now;
    yield* dispatch({
      type: "thread.activity.append",
      commandId: CommandId.make(decision.id),
      threadId,
      createdAt: at,
      activity: {
        id: decision.id,
        tone: "info",
        kind: "general-chat.route",
        summary:
          decision.kind === "chat" ? `Laya suggests ${decision.targetTitle}` : decision.detail,
        payload: decision,
        turnId: thread.latestTurn?.turnId ?? null,
        createdAt: at,
      },
    });
    return decision;
  }, routeLock.withPermits(1));
  const handoff = Effect.fn("GeneralChat.handoff")(function* (
    threadId: ThreadId,
    decisionId: EventId,
  ) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const source = yield* requireGeneral(threadId);
        const saved = source.activities.find(
          (a) => a.kind === "general-chat.route" && a.id === decisionId,
        );
        const result = saved ? decodeDecision(saved.payload) : Option.none();
        if (Option.isNone(result) || result.value.kind !== "chat" || !result.value.targetThreadId)
          return yield* new BetaBusError({
            message: "A retained, confident Laya chat decision is required. Stay in General chat.",
          });
        const decision = result.value;
        const message = latestGeneralQuestion(source);
        if (
          !message ||
          message.id !== decision.sourceMessageId ||
          (message.attachments?.length ?? 0) > 0 ||
          message.context !== undefined
        )
          return yield* new BetaBusError({
            message: "The question changed. Route the current question again.",
          });
        const targetId = decision.targetThreadId!;
        const target = yield* detail(targetId);
        const targetShell = yield* snapshots
          .getThreadShellById(targetId)
          .pipe(Effect.mapError(failure));
        if (Option.isNone(targetShell)) return yield* failure();
        if (targetId.startsWith(GENERAL_CHAT_THREAD_PREFIX) || targetId === threadId)
          return yield* new BetaBusError({ message: "General chat cannot hand off to itself." });
        const messageId = MessageId.make(`general-handoff:${message.id}`);
        const at = yield* now;
        if (!target.messages.some((m) => m.id === messageId)) {
          const pending = yield* turns
            .getPendingTurnStartByThreadId({ threadId: targetId })
            .pipe(Effect.mapError(failure));
          if (
            Option.isSome(pending) ||
            target.latestTurn?.state === "running" ||
            target.session?.status === "running" ||
            target.session?.status === "starting" ||
            targetShell.value.hasPendingApprovals ||
            targetShell.value.hasPendingUserInput
          )
            return yield* new BetaBusError({
              message:
                "The matching chat is busy or needs your input. Continue here or open it from the sidebar.",
            });
          yield* dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(messageId),
            threadId: targetId,
            message: { messageId, role: "user", text: message.text, attachments: [] },
            runtimeMode: target.runtimeMode,
            interactionMode: target.interactionMode,
            createdAt: at,
          });
        }
        const navigation: GeneralChatNavigation = {
          targetThreadId: targetId,
          sourceMessageId: message.id,
        };
        yield* dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(`general-open:${message.id}`),
          threadId,
          createdAt: at,
          activity: {
            id: EventId.make(`general-open:${message.id}`),
            tone: "info",
            kind: "general-chat.handoff",
            summary: `Question sent to ${target.title}`,
            payload: navigation,
            turnId: source.latestTurn?.turnId ?? null,
            createdAt: at,
          },
        });
        return navigation;
      }),
    );
  });
  return { open: () => open().pipe(Effect.mapError(failure)), route, handoff };
});
export class GeneralChat extends Context.Service<
  GeneralChat,
  Effect.Success<typeof makeGeneralChat>
>()("t3/beta/GeneralChat") {
  static readonly layer = Layer.effect(GeneralChat, makeGeneralChat).pipe(
    Layer.provide(Laya.layer),
    Layer.provide(ProjectionTurnRepositoryLive),
  );
}
