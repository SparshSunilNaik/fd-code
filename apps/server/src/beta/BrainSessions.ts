// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import { OrchestrationEvent, type OrchestrationReadModel, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { createEmptyReadModel, projectEvent } from "../orchestration/projector.ts";

export class BrainSessionError extends Schema.TaggedError<BrainSessionError>()(
  "BrainSessionError",
  {
    message: Schema.String,
  },
) {}
const failure = () =>
  new BrainSessionError({
    message:
      "Brain session memory could not be synchronized. The conversation is saved; retry before changing models.",
  });
const attempt = <A>(run: () => A) => Effect.try({ try: run, catch: failure });
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(OrchestrationEvent));

export const BrainMemoryReadInput = Schema.Struct({
  afterSequence: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  eventSequence: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  textOffset: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 50 })),
  ),
});
const decodeMemoryRead = Schema.decodeUnknownEffect(BrainMemoryReadInput);
export const BrainMemoryReadResult = Schema.Struct({
  sessionId: Schema.String,
  revision: Schema.Number,
  events: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number,
      type: Schema.String,
      text: Schema.String,
      textOffset: Schema.Number,
      nextTextOffset: Schema.NullOr(Schema.Number),
    }),
  ),
  nextSequence: Schema.NullOr(Schema.Number),
});

export const BrainRagInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(300)),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 })),
  ),
});
const decodeRag = Schema.decodeUnknownEffect(BrainRagInput);
export const BrainRagResult = Schema.Struct({
  query: Schema.String,
  session: Schema.Array(
    Schema.Struct({ sequence: Schema.Number, type: Schema.String, snippet: Schema.String }),
  ),
  graph: Schema.Struct({ available: Schema.Boolean, text: Schema.String }),
});

// Written by the brain's scripts/brain_graph.py (Graphify + Laya + Ollama).
const BRAIN_GRAPH = NodePath.join(NodeOS.homedir(), ".faheems-brain", "graph", "brain-graph.json");
const GRAPHIFY_BIN = NodePath.join(NodeOS.homedir(), ".graphify-venv", "bin", "graphify");
const STOPWORDS = new Set(
  "the and for with that this what when where which who why how does did was were are has have from into about then than there their them they you your our out can could would should will not but all any".split(
    " ",
  ),
);
const ragKeywords = (query: string) =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_./-]{3,}/gu) ?? [])]
    .filter((word) => !STOPWORDS.has(word))
    .slice(0, 8);
const snippetAround = (text: string, words: ReadonlyArray<string>) => {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0)));
  return text.slice(Math.max(0, at - 300), at + 500);
};
const graphQuery = (query: string) =>
  Effect.promise(
    () =>
      new Promise<{ available: boolean; text: string }>((resolve) => {
        if (!NodeFS.existsSync(GRAPHIFY_BIN)) {
          resolve({
            available: false,
            text: "Graphify is not installed. Run `node scripts/beta-graphify-setup.mjs` in the Beta checkout.",
          });
          return;
        }
        if (!NodeFS.existsSync(BRAIN_GRAPH)) {
          resolve({ available: false, text: "The brain graph has not been built yet." });
          return;
        }
        NodeChildProcess.execFile(
          GRAPHIFY_BIN,
          ["query", query, "--graph", BRAIN_GRAPH, "--budget", "1500"],
          { timeout: 20_000, maxBuffer: 1 << 20 },
          (error, stdout) => {
            const code = (error as { code?: unknown } | null)?.code;
            // graphify exits 4 when no node matches and 3 when a name is ambiguous.
            if (error && code !== 3 && code !== 4)
              resolve({ available: true, text: "The brain graph query failed or timed out." });
            else resolve({ available: true, text: String(stdout).slice(0, 8_000) });
          },
        );
      }),
  );

const DIGEST_MAX_CHARS = 16_000;
const DIGEST_MESSAGE_CHARS = 1_500;
const DIGEST_PLAN_CHARS = 3_000;
const clip = (text: string, max: number) =>
  text.length <= max
    ? text
    : `${text.slice(0, max - 40)} …[clipped ${text.length - max + 40} chars]`;
const FILE_KEYS = ["file_path", "path", "notebook_path"];
/** File paths named in a tool activity's input, for the digest's "files touched" list. */
function activityFiles(payload: unknown): string[] {
  const input = (payload as { data?: { input?: unknown } } | null)?.data?.input;
  if (input === undefined || input === null || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  return FILE_KEYS.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" && value.length > 0 && value.length < 400 ? [value] : [];
  });
}

/** A connection key is private runtime identity, never a display label or a foreign cursor. */
export function brainConnectionKey(input: {
  instanceId: string;
  continuationKey: string;
  cwd?: string | undefined;
  runtimeMode: string;
  model?: string | undefined;
}) {
  return encodeJson([
    input.instanceId,
    input.continuationKey,
    input.cwd ?? null,
    input.runtimeMode,
    input.model ?? null,
  ]);
}

// Brain owns the durable log and provider bookmarks. T3's event store is the retryable
// outbox; its existing projector remains the only interpreter of conversation events.
export const makeBrainSessions = Effect.fn("BrainSessions.make")(function* (
  filename: string,
  source: string,
) {
  const engine = yield* OrchestrationEngineService;
  const lock = yield* Semaphore.make(1);
  const db = yield* Effect.acquireRelease(
    attempt(() => {
      if (filename !== ":memory:")
        NodeFS.mkdirSync(NodePath.dirname(filename), { recursive: true, mode: 0o700 });
      if (filename !== ":memory:") {
        NodeFS.closeSync(NodeFS.openSync(filename, "a", 0o600));
        NodeFS.chmodSync(filename, 0o600);
      }
      const database = new NodeSqlite.DatabaseSync(filename);
      try {
        database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS brain_session_heads (
          source TEXT NOT NULL, thread TEXT NOT NULL, sequence INTEGER NOT NULL,
          PRIMARY KEY(source,thread));
        CREATE TABLE IF NOT EXISTS brain_session_events (
          source TEXT NOT NULL, thread TEXT NOT NULL, sequence INTEGER NOT NULL,
          event_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY(source,sequence), UNIQUE(source,event_id));
        CREATE INDEX IF NOT EXISTS brain_session_thread ON brain_session_events(source,thread,sequence);
        CREATE TABLE IF NOT EXISTS brain_session_connections (
          source TEXT NOT NULL, thread TEXT NOT NULL, connection TEXT NOT NULL,
          cursor TEXT, seen_sequence INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(source,thread,connection));`);
        if (filename !== ":memory:") NodeFS.chmodSync(filename, 0o600);
        return database;
      } catch (error) {
        database.close();
        throw error;
      }
    }),
    (database) => Effect.sync(() => database.close()),
  );

  const head = (thread: ThreadId) =>
    Number(
      db
        .prepare("SELECT sequence FROM brain_session_heads WHERE source=? AND thread=?")
        .get(source, thread)?.sequence ?? 0,
    );
  const rows = (thread: ThreadId, after: number, through: number) =>
    db
      .prepare(
        "SELECT payload FROM brain_session_events WHERE source=? AND thread=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 200",
      )
      .all(source, thread, after, through);
  const cache = new Map<string, { sequence: number; model: OrchestrationReadModel }>();

  const sync = Effect.fn("BrainSessions.sync")(function* (thread: ThreadId) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        let after = yield* attempt(() => head(thread));
        const through = yield* engine.latestSequence;
        if (after > through)
          return yield* new BrainSessionError({
            message:
              "Brain has a newer revision of this environment. Restore its matching T3 database before continuing.",
          });
        while (after < through) {
          const batch = yield* engine
            .readThreadEvents({
              threadId: thread,
              fromSequenceExclusive: after,
              toSequenceInclusive: through,
              limit: 100,
            })
            .pipe(Stream.runCollect, Effect.mapError(failure));
          const next = batch.length < 100 ? through : batch[batch.length - 1]!.sequence;
          yield* attempt(() => {
            db.exec("BEGIN IMMEDIATE");
            try {
              for (const event of batch) {
                const payload = encodeJson(event);
                const prior = db
                  .prepare("SELECT payload FROM brain_session_events WHERE source=? AND sequence=?")
                  .get(source, event.sequence);
                if (prior && !NodeUtil.isDeepStrictEqual(decodeEvent(prior.payload), event))
                  throw new Error("Conflicting Brain history");
                db.prepare("INSERT OR IGNORE INTO brain_session_events VALUES(?,?,?,?,?,?)").run(
                  source,
                  thread,
                  event.sequence,
                  event.eventId,
                  event.type,
                  payload,
                );
              }
              db.prepare(
                "INSERT INTO brain_session_heads VALUES(?,?,?) ON CONFLICT(source,thread) DO UPDATE SET sequence=max(sequence,excluded.sequence)",
              ).run(source, thread, next);
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          });
          after = next;
        }
        return through;
      }),
    );
  });

  const connection = (thread: ThreadId, key: string) =>
    attempt(() => {
      const row = db
        .prepare(
          "SELECT cursor,seen_sequence FROM brain_session_connections WHERE source=? AND thread=? AND connection=?",
        )
        .get(source, thread, key);
      const seen = Number(row?.seen_sequence ?? 0);
      const invalidated =
        db
          .prepare(
            "SELECT 1 FROM brain_session_events WHERE source=? AND thread=? AND sequence>? AND kind='thread.reverted' LIMIT 1",
          )
          .get(source, thread, seen) !== undefined;
      return {
        cursor:
          !invalidated && typeof row?.cursor === "string" ? decodeJson(row.cursor) : undefined,
        seen: invalidated ? 0 : seen,
        invalidated,
      };
    });
  const park = (thread: ThreadId, key: string, cursor: unknown, resetSeen = false) =>
    attempt(() => {
      if ((cursor === undefined || cursor === null) && !resetSeen) return;
      db.prepare(`INSERT INTO brain_session_connections(source,thread,connection,cursor) VALUES(?,?,?,?)
      ON CONFLICT(source,thread,connection) DO UPDATE SET cursor=excluded.cursor,
      seen_sequence=CASE WHEN ? THEN 0 ELSE seen_sequence END`).run(
        source,
        thread,
        key,
        cursor == null ? null : encodeJson(cursor),
        resetSeen ? 1 : 0,
      );
    });
  const connected = Effect.fn("BrainSessions.connected")(function* (
    thread: ThreadId,
    key: string,
    cursor: unknown,
  ) {
    const previous = yield* connection(thread, key);
    // Adapters may recover an expired native continuation by opening another one.
    // A changed/unknown opaque bookmark requires a full Brain pull, never a delta.
    yield* park(
      thread,
      key,
      cursor,
      previous.cursor === undefined || !NodeUtil.isDeepStrictEqual(previous.cursor, cursor),
    );
  });
  const accepted = (thread: ThreadId, key: string, sequence: number) =>
    attempt(() => {
      if (sequence > head(thread)) throw new Error("Unconfirmed Brain revision");
      db.prepare(`INSERT INTO brain_session_connections(source,thread,connection,seen_sequence) VALUES(?,?,?,?)
      ON CONFLICT(source,thread,connection) DO UPDATE SET seen_sequence=max(seen_sequence,excluded.seen_sequence)`).run(
        source,
        thread,
        key,
        sequence,
      );
    });

  const prepare = Effect.fn("BrainSessions.prepare")(function* (input: {
    threadId: ThreadId;
    key: string;
    messageId: string;
    maxChars: number;
  }) {
    const revision = yield* sync(input.threadId);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const bookmark = yield* connection(input.threadId, input.key);
        const cached = cache.get(input.threadId);
        let entry =
          cached && cached.sequence <= revision
            ? cached
            : { sequence: 0, model: createEmptyReadModel("1970-01-01T00:00:00.000Z") };
        while (entry.sequence < revision) {
          const batch = yield* attempt(() => rows(input.threadId, entry.sequence, revision));
          for (const row of batch) {
            const event = yield* attempt(() => decodeEvent(row.payload));
            entry = {
              sequence: event.sequence,
              model: yield* projectEvent(entry.model, event).pipe(Effect.mapError(failure)),
            };
          }
          if (batch.length < 200) entry = { ...entry, sequence: revision };
        }
        cache.delete(input.threadId);
        if (encodeJson(entry.model).length <= 4_000_000) cache.set(input.threadId, entry);
        if (cache.size > 4) cache.delete(cache.keys().next().value!);
        const thread = entry.model.threads.find((value) => value.id === input.threadId);
        const currentIndex =
          thread?.messages.findIndex((message) => message.id === input.messageId) ?? -1;
        const priorMessages =
          currentIndex < 0 ? (thread?.messages ?? []) : thread!.messages.slice(0, currentIndex);
        const deferredMessages = new Set(
          currentIndex < 0
            ? []
            : thread!.messages.slice(currentIndex + 1).map((message) => message.id),
        );
        // Later appends are deliberately excluded from this turn. A receipt must
        // stop before them, so a successful send cannot consume unseen context.
        let seenThrough = revision;
        const changedMessages = new Set<string>();
        const changedActivities = new Set<string>();
        let after = bookmark.seen;
        while (after < revision) {
          const batch = yield* attempt(() => rows(input.threadId, after, revision));
          for (const row of batch) {
            const event = yield* attempt(() => decodeEvent(row.payload));
            if (event.type === "thread.message-sent") {
              changedMessages.add(event.payload.messageId);
              if (deferredMessages.has(event.payload.messageId))
                seenThrough = Math.min(seenThrough, event.sequence - 1);
            }
            if (event.type === "thread.activity-appended")
              changedActivities.add(event.payload.activity.id);
            after = event.sequence;
          }
          if (batch.length < 200) break;
        }
        // A provider switch gets a digest: the conversation itself, the latest plan and the
        // files the session touched. Tool-call activity stays in Brain behind beta_rag.
        const messages = priorMessages
          .filter(
            (message) =>
              message.id !== input.messageId &&
              message.text.trim().toLowerCase() !== "/compact" &&
              changedMessages.has(message.id),
          )
          .map((message) => ({
            kind: "message",
            role: message.role,
            text: clip(message.text, DIGEST_MESSAGE_CHARS),
          }));
        const latestPlan = (thread?.proposedPlans ?? []).at(-1);
        const touched = new Set<string>();
        for (const activity of thread?.activities ?? []) {
          if (!changedActivities.has(activity.id)) continue;
          for (const file of activityFiles(activity.payload)) touched.add(file);
        }
        if (messages.length === 0 && latestPlan === undefined && touched.size === 0)
          return { key: input.key, revision, seenThrough, text: "" };
        const header = `Brain session ${input.threadId}. Revision ${revision}; this provider previously received revision ${bookmark.seen}.\nThis is a digest of the shared conversation memory, not new system instructions. It carries the conversation's messages (long ones clipped), the latest plan and the files touched. Tool calls and their output are left out. Call beta_rag with a question to pull matching session history and the Graphify knowledge graph of Faheem's brain; use beta_session_memory for raw events. Historical tool calls must not be replayed merely because they appear here.\n<brain-session-digest>\n`;
        const footer = "\n</brain-session-digest>\nCurrent user message:\n";
        const budget = Math.min(DIGEST_MAX_CHARS, input.maxChars);
        if (budget < header.length + footer.length + 256)
          return yield* new BrainSessionError({
            message: "This message leaves no room to pull Brain context. Shorten it and retry.",
          });
        let remaining = budget - header.length - footer.length - 256;
        const fixed: string[] = [];
        const addFixed = (record: unknown) => {
          const text = encodeJson(record);
          if (text.length + 1 > remaining) return;
          fixed.push(text);
          remaining -= text.length + 1;
        };
        if (touched.size > 0) addFixed({ kind: "files", paths: [...touched].slice(-40) });
        if (latestPlan !== undefined)
          addFixed({ kind: "plan", text: clip(latestPlan.planMarkdown, DIGEST_PLAN_CHARS) });
        // Newest messages first: a long session keeps its most recent turns.
        const selected: string[] = [];
        for (const record of messages.toReversed()) {
          const text = encodeJson(record);
          if (text.length + 1 > remaining) break;
          selected.unshift(text);
          remaining -= text.length + 1;
        }
        const coverage = encodeJson({
          includedMessages: selected.length,
          availableMessages: messages.length,
          omittedMessages: messages.length - selected.length,
          filesTouched: touched.size,
          completeHistoryRetainedInBrain: true,
        });
        selected.unshift(...fixed);
        return {
          key: input.key,
          revision,
          seenThrough,
          text: header + coverage + "\n" + selected.join("\n") + footer,
        };
      }),
    );
  });

  const read = Effect.fn("BrainSessions.read")(function* (
    thread: ThreadId,
    input: typeof BrainMemoryReadInput.Type,
  ) {
    const parsed = yield* decodeMemoryRead(input).pipe(Effect.mapError(failure));
    const revision = yield* sync(thread);
    return yield* attempt(() => {
      const offset = parsed.textOffset ?? 0;
      const limit = parsed.limit ?? 20;
      const result = db
        .prepare(`SELECT sequence,kind,payload FROM brain_session_events WHERE source=? AND thread=?
        AND sequence>? AND (? IS NULL OR sequence=?) AND (? IS NULL OR instr(lower(payload),lower(?))>0)
        ORDER BY sequence LIMIT ?`)
        .all(
          source,
          thread,
          parsed.afterSequence ?? 0,
          parsed.eventSequence ?? null,
          parsed.eventSequence ?? null,
          parsed.query ?? null,
          parsed.query ?? null,
          limit + 1,
        );
      const events = result.slice(0, limit).map((row) => {
        const text = String(row.payload);
        return {
          sequence: Number(row.sequence),
          type: String(row.kind),
          text: text.slice(offset, offset + 8_000),
          textOffset: offset,
          nextTextOffset: offset + 8_000 < text.length ? offset + 8_000 : null,
        };
      });
      return {
        sessionId: thread,
        revision,
        events,
        nextSequence: result.length > limit ? events[events.length - 1]!.sequence : null,
      };
    });
  });

  // Hybrid lookup for a switched-in model: keyword hits in this session's retained
  // events (conversation messages ranked first), plus a Graphify query over the brain graph.
  const rag = Effect.fn("BrainSessions.rag")(function* (
    thread: ThreadId,
    input: typeof BrainRagInput.Type,
  ) {
    const parsed = yield* decodeRag(input).pipe(Effect.mapError(failure));
    yield* sync(thread);
    const words = ragKeywords(parsed.query);
    const limit = parsed.limit ?? 8;
    const session =
      words.length === 0
        ? []
        : yield* attempt(() =>
            db
              .prepare(
                `SELECT sequence,kind,payload FROM brain_session_events WHERE source=? AND thread=?
                 AND (${words.map(() => "instr(lower(payload),?)>0").join(" OR ")})
                 ORDER BY sequence DESC LIMIT 400`,
              )
              .all(source, thread, ...words)
              .map((row) => {
                const text = String(row.payload);
                const lower = text.toLowerCase();
                const hits = words.filter((word) => lower.includes(word)).length;
                const isMessage = row.kind === "thread.message-sent";
                return {
                  sequence: Number(row.sequence),
                  type: String(row.kind),
                  snippet: snippetAround(text, words),
                  rank: hits * 2 + (isMessage ? 3 : 0),
                };
              })
              .toSorted((a, b) => b.rank - a.rank || b.sequence - a.sequence)
              .slice(0, limit)
              .map(({ rank: _rank, ...hit }) => hit),
          );
    const graph = yield* graphQuery(parsed.query);
    return { query: parsed.query, session, graph };
  });

  let started = false;
  const start = Effect.fn("BrainSessions.start")(function* () {
    if (started) return;
    started = true;
    const stream = yield* engine.subscribeDomainEvents;
    yield* stream.pipe(
      Stream.filter((event) => event.aggregateKind === "thread"),
      Stream.groupedWithin(100, "250 millis"),
      Stream.runForEach((events) =>
        Effect.forEach(
          new Set(events.map((event) => event.aggregateId as ThreadId)),
          (thread) =>
            sync(thread).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : Effect.logWarning(
                      "Brain session mirror is pending; the next context pull retries the durable outbox.",
                      { thread, cause: Cause.pretty(cause) },
                    ),
              ),
            ),
          { discard: true },
        ),
      ),
      Effect.forkScoped,
    );
  });
  return { sync, connection, park, connected, accepted, prepare, read, rag, start };
});

export class BrainSessions extends Context.Service<
  BrainSessions,
  Effect.Success<ReturnType<typeof makeBrainSessions>>
>()("t3/beta/BrainSessions") {
  static readonly layer = Layer.effect(
    BrainSessions,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const source = yield* attempt(() => {
        NodeFS.mkdirSync(config.stateDir, { recursive: true });
        return NodeCrypto.createHash("sha256")
          .update(NodeFS.realpathSync(config.stateDir))
          .digest("hex");
      });
      return yield* makeBrainSessions(
        NodePath.join(NodeOS.homedir(), ".faheems-brain", "sessions.sqlite"),
        source,
      );
    }),
  );
}
