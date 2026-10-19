import { useCallback, useRef, useState } from "react";
import { BrainIcon, NetworkIcon, RefreshCwIcon } from "lucide-react";
import type { BetaBusMessage, BetaThreadsResult, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";
import { randomUUID } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

type BetaApi = PrimaryEnvironmentHttpClient["Service"]["beta"];
type Thread = (typeof BetaThreadsResult.Type.threads)[number];
const call = <A, E>(request: (api: BetaApi) => Effect.Effect<A, E>): Promise<A> =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => request(client.beta)),
      Effect.timeout("15 seconds"),
    ),
  );

const BrainText = Schema.Struct({ content: Schema.Array(Schema.Struct({ text: Schema.String })) });
const SearchResults = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      kind: Schema.String,
      title: Schema.String,
      snippet: Schema.String,
      collection: Schema.optional(Schema.NullOr(Schema.String)),
      domain: Schema.optional(Schema.NullOr(Schema.String)),
      modified: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
type SearchHit = (typeof SearchResults.Type.results)[number];
const BrainInbox = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      from: Schema.String,
      to: Schema.String,
      message: Schema.String,
      sent: Schema.String,
    }),
  ),
});
type BrainMessage = (typeof BrainInbox.Type.messages)[number];
const BrainDocument = Schema.Struct({
  title: Schema.String,
  text: Schema.String,
  truncated: Schema.Boolean,
  next_offset: Schema.NullOr(Schema.Int),
});

const decodeBrainText = Schema.decodeUnknownSync(BrainText);
const decodeSearchResults = Schema.decodeUnknownSync(SearchResults);
const decodeBrainInbox = Schema.decodeUnknownSync(BrainInbox);
const decodeBrainDocument = Schema.decodeUnknownSync(BrainDocument);

async function brain(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await call((api) => api.brainCall({ headers: {}, payload: { name, args } }));
  if (!result.ok) throw new Error(result.error.message);
  const content = decodeBrainText(result.value);
  const data: unknown = JSON.parse(content.content.map((block) => block.text).join("\n"));
  if (typeof data === "object" && data !== null && "error" in data) {
    throw new Error(String(data.error));
  }
  return data;
}

const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

/** Local environment controls; the backend resolves all Brain credentials and session identities. */
export function BetaWorkspacePanel({
  threadId,
  compact = false,
}: {
  threadId?: ThreadId;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"sessions" | "brain">("sessions");
  const [threads, setThreads] = useState<readonly Thread[]>([]);
  const [messages, setMessages] = useState<readonly BetaBusMessage[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [source, setSource] = useState<string>(threadId ?? "");
  const [target, setTarget] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [document, setDocument] = useState<{
    hit: SearchHit;
    text: string;
    next: number | null;
  } | null>(null);
  const [agent, setAgent] = useState<"codex" | "claude" | "grok">("codex");
  const [brainMessages, setBrainMessages] = useState<readonly BrainMessage[]>([]);
  const [recipient, setRecipient] = useState("claude");
  const [brainBody, setBrainBody] = useState("");
  const sendKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const actionLock = useRef(false);
  const viewEpoch = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = ++viewEpoch.current;
    const [threadList, inbox, health] = await Promise.all([
      call((api) => api.threads({ headers: {}, payload: { limit: 500 } })),
      call((api) => api.inbox({ headers: {}, payload: { direction: "all", limit: 100 } })),
      call((api) => api.brainHealth({ headers: {} })).catch(() => ({ ok: false as const })),
    ]);
    if (epoch !== viewEpoch.current) return;
    setThreads(threadList.threads);
    setMessages(inbox.messages);
    setTruncated(threadList.truncated || inbox.truncated);
    setConnected(health.ok);
    setSource((current) =>
      threadList.threads.some((thread) => thread.id === current)
        ? current
        : (threadList.threads.find((thread) => thread.id === threadId)?.id ??
          threadList.threads[0]?.id ??
          ""),
    );
  }, [threadId]);

  const act = useCallback(async (run: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed. Try again.");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }, []);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) void act(refresh);
    else viewEpoch.current++;
  };

  const title = (id: string) => threads.find((thread) => thread.id === id)?.title ?? id;
  const send = async () => {
    const fingerprint = JSON.stringify([source, target, body]);
    if (sendKey.current?.fingerprint !== fingerprint) {
      sendKey.current = { fingerprint, key: randomUUID() };
    }
    await call((api) =>
      api.send({
        headers: {},
        payload: {
          sourceThreadId: source as ThreadId,
          targetThreadId: target as ThreadId,
          body,
          idempotencyKey: sendKey.current!.key,
        },
      }),
    );
    sendKey.current = null;
    setBody("");
    await refresh();
    setNotice("Request saved. Review it below, then approve delivery to the destination chat.");
  };
  const decide = async (id: string, decision: "approve" | "reject") => {
    const result = await call((api) => api.decide({ headers: {}, payload: { id, decision } }));
    await refresh();
    setNotice(
      result.status === "delivered"
        ? "Appended to the destination chat. No agent turn was started."
        : result.status === "approved"
          ? "Approved. Delivery needs a retry; the request is saved."
          : "Request rejected.",
    );
  };
  const search = async () => {
    const result = decodeSearchResults(await brain("brain_search", { query, limit: 12 }));
    setHits(result.results);
    setDocument(null);
    if (result.results.length === 0) setNotice("No matches. Try fewer words.");
  };
  const readDocument = async (hit: SearchHit, offset = 0) => {
    const result = decodeBrainDocument(
      await brain(hit.kind === "note" ? "brain_get_note" : "brain_get_document", {
        id: hit.id,
        offset,
        max_chars: 12_000,
      }),
    );
    setDocument((previous) => ({
      hit,
      text: offset === 0 ? result.text : (previous?.text ?? "") + result.text,
      next: result.next_offset,
    }));
  };
  const loadBrainInbox = async () => {
    const result = decodeBrainInbox(await brain("brain_bus_inbox", { agent }));
    setBrainMessages(result.messages);
    if (result.messages.length === 0) setNotice("No pending Brain messages.");
  };

  return (
    <>
      <Button
        variant="ghost"
        size="compact"
        className="no-drag relative z-10"
        aria-label="Open Beta session bus and Brain"
        onClick={() => changeOpen(true)}
      >
        <NetworkIcon />
        {compact ? "Bus + Brain" : "Session bus + Brain"}
      </Button>
      {open ? (
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogPopup className="flex max-h-[85dvh] w-[min(92vw,56rem)] max-w-none flex-col overflow-hidden p-0">
            <DialogHeader className="border-b p-5 pr-12">
              <DialogTitle>Beta workspace</DialogTitle>
              <DialogDescription>
                Connect local sessions across projects and search Faheem’s Brain.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 border-b px-5 py-3">
              <Button
                size="sm"
                variant={tab === "sessions" ? "secondary" : "ghost"}
                onClick={() => setTab("sessions")}
              >
                <NetworkIcon />
                Session bus
              </Button>
              <Button
                size="sm"
                variant={tab === "brain" ? "secondary" : "ghost"}
                onClick={() => setTab("brain")}
              >
                <BrainIcon />
                Brain
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {connected === null
                  ? "Checking Brain…"
                  : connected
                    ? "Brain connected · local"
                    : "Brain offline"}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh workspace"
                disabled={busy}
                onClick={() => void act(refresh)}
              >
                <RefreshCwIcon />
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              {error && (
                <p
                  role="alert"
                  className="mb-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mb-3 rounded-md border p-3 text-sm">
                  {notice}
                </p>
              )}
              {tab === "sessions" ? (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Messages preserve their source. Approval adds context to the destination
                    history; its agent runs only when you send a chat message.
                  </p>
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(send);
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        From session
                        <select
                          className={fieldClass}
                          value={source}
                          onChange={(event) => setSource(event.target.value)}
                          required
                        >
                          <option value="">Choose a session</option>
                          {threads.map((thread) => (
                            <option key={thread.id} value={thread.id}>
                              {thread.projectTitle} / {thread.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-sm">
                        To session
                        <select
                          className={fieldClass}
                          value={target}
                          onChange={(event) => setTarget(event.target.value)}
                          required
                        >
                          <option value="">Choose a destination</option>
                          {threads
                            .filter((thread) => thread.id !== source)
                            .map((thread) => (
                              <option key={thread.id} value={thread.id}>
                                {thread.projectTitle} / {thread.title}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <label className="block space-y-1 text-sm">
                      Message
                      <textarea
                        className={fieldClass}
                        rows={4}
                        value={body}
                        maxLength={16_000}
                        required
                        onChange={(event) => setBody(event.target.value)}
                        placeholder="Share a finding, ask a question, or hand over context…"
                      />
                    </label>
                    <Button
                      type="submit"
                      disabled={busy || !source || !target || source === target || !body.trim()}
                    >
                      Queue request
                    </Button>
                  </form>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Requests and delivery history</h3>
                    {truncated && (
                      <p className="text-xs text-muted-foreground">
                        Showing a bounded recent page. Older requests remain saved on this machine.
                      </p>
                    )}
                    {!messages.length && (
                      <p className="text-sm text-muted-foreground">
                        No requests yet. Agents can also use the built-in session bus tools.
                      </p>
                    )}
                    {messages.map((message) => (
                      <article key={message.id} className="space-y-2 rounded-lg border p-3">
                        <div className="flex justify-between gap-3 text-xs">
                          <span>
                            {title(message.sourceThreadId)} → {title(message.targetThreadId)}
                          </span>
                          <strong>{message.status}</strong>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {message.sourceActor} · {new Date(message.createdAt).toLocaleString()}
                        </p>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                          {message.body}
                        </pre>
                        {message.lastError && (
                          <p className="text-xs text-destructive">{message.lastError}</p>
                        )}
                        {(message.status === "pending" || message.status === "approved") && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => void act(() => decide(message.id, "approve"))}
                            >
                              {message.status === "approved"
                                ? "Retry delivery"
                                : "Approve and append"}
                            </Button>
                            {message.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void act(() => decide(message.id, "reject"))}
                              >
                                Reject
                              </Button>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Local knowledge includes dated snapshots. Source dates and collection labels
                    stay visible. Search does not sync or import your chats.
                  </p>
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(search);
                    }}
                  >
                    <input
                      className={fieldClass}
                      aria-label="Search Faheem’s Brain"
                      placeholder="Search your local Brain…"
                      value={query}
                      required
                      maxLength={500}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <Button type="submit" disabled={busy || !query.trim()}>
                      Search
                    </Button>
                  </form>
                  <div className="space-y-2">
                    {hits.map((hit) => (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        className="block w-full space-y-1 rounded-lg border p-3 text-left hover:bg-accent"
                        disabled={busy}
                        onClick={() => void act(() => readDocument(hit))}
                      >
                        <strong className="text-sm">{hit.title}</strong>
                        <p className="text-xs text-muted-foreground">
                          {hit.collection} · {hit.domain} · {hit.modified}
                        </p>
                        <p className="text-sm">{hit.snippet}</p>
                      </button>
                    ))}
                  </div>
                  {document && (
                    <article className="space-y-3 rounded-lg border p-3">
                      <h3 className="font-semibold">{document.hit.title}</h3>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                        {document.text}
                      </pre>
                      {document.next !== null && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void act(() => readDocument(document.hit, document.next!))}
                        >
                          Read next page
                        </Button>
                      )}
                    </article>
                  )}
                  <section className="space-y-3 border-t pt-4">
                    <h3 className="text-sm font-semibold">Brain agent mailbox</h3>
                    <p className="text-xs text-muted-foreground">
                      These requests address an agent, not a particular session. Your approval
                      records a decision; it does not execute the request.
                    </p>
                    <div className="flex items-center gap-2">
                      <label className="text-sm">
                        Agent
                        <select
                          className={`${fieldClass} ml-2 w-auto`}
                          value={agent}
                          onChange={(event) => {
                            setAgent(event.target.value as typeof agent);
                            setBrainMessages([]);
                          }}
                        >
                          {["codex", "claude", "grok"].map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <Button size="sm" disabled={busy} onClick={() => void act(loadBrainInbox)}>
                        Check inbox
                      </Button>
                    </div>
                    {brainMessages.map((message) => (
                      <article key={message.id} className="space-y-2 rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                          #{message.id} · {message.from} → {message.to} · {message.sent}
                        </p>
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                          {message.message}
                        </pre>
                        <div className="flex gap-2">
                          {(["approve", "reject"] as const).map((decision) => (
                            <Button
                              key={decision}
                              size="sm"
                              variant={decision === "approve" ? "default" : "outline"}
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await brain("brain_bus_decide", {
                                    id: message.id,
                                    agent,
                                    decision,
                                  });
                                  await loadBrainInbox();
                                  setNotice(
                                    `Decision recorded: ${decision}. No request was executed.`,
                                  );
                                })
                              }
                            >
                              {decision === "approve" ? "Approve request" : "Reject request"}
                            </Button>
                          ))}
                        </div>
                      </article>
                    ))}
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act(async () => {
                          await brain("brain_bus_send", { to: recipient, body: brainBody });
                          setBrainBody("");
                          setNotice(
                            "Brain message queued. Delivery and action depend on the receiving agent.",
                          );
                        });
                      }}
                    >
                      <label className="block text-sm">
                        Recipient
                        <select
                          className={`${fieldClass} mt-1`}
                          value={recipient}
                          onChange={(event) => setRecipient(event.target.value)}
                        >
                          {["claude", "codex", "grok", "any"].map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <textarea
                        aria-label="Message to Brain agent"
                        className={fieldClass}
                        rows={3}
                        maxLength={4_000}
                        value={brainBody}
                        required
                        onChange={(event) => setBrainBody(event.target.value)}
                        placeholder="Write a request for another agent…"
                      />
                      <Button type="submit" size="sm" disabled={busy || !brainBody.trim()}>
                        Send Brain request
                      </Button>
                    </form>
                  </section>
                </div>
              )}
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
