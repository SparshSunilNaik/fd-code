// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// This Promise transport owns credential-file reads and AbortController timers.
// Brain.ts supplies the Effect-facing service without leaking either resource.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const ENDPOINT = "http://127.0.0.1:8766/mcp";
const READ_TOOLS = new Set([
  "brain_guide",
  "brain_essence",
  "brain_search",
  "brain_browse",
  "brain_get_document",
  "brain_get_note",
  "brain_status",
  "brain_activity_search",
  "brain_bus_status",
  "brain_session_list",
  "brain_session_read",
]);

export type BrainErrorCode =
  | "not-allowed"
  | "credentials-unavailable"
  | "disconnected"
  | "unauthorized"
  | "timeout"
  | "response-too-large"
  | "invalid-response"
  | "tool-error";

export type BrainResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: BrainErrorCode; readonly message: string };
    };

export interface BrainToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly isError: false;
}

type BrainAgent = "claude" | "codex" | "grok";

export interface BrainClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly loadToken?: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const fail = (code: BrainErrorCode, message: string): BrainResult<never> => ({
  ok: false,
  error: { code, message },
});

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function boundedOption(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

/** Backend only: credentials never cross the IDE's renderer/model boundary. */
export function createBrainClient(options: BrainClientOptions = {}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const loadToken =
    options.loadToken ??
    (() =>
      NodeFSP.readFile(NodePath.join(NodeOS.homedir(), ".faheems-brain", "mcp-token"), "utf8"));
  const timeoutMs = boundedOption(options.timeoutMs, 5_000, 30_000);
  const maxResponseBytes = boundedOption(options.maxResponseBytes, 1_000_000, 4_000_000);
  let nextId = 0;

  async function request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<BrainResult<unknown>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<BrainResult<never>>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(fail("timeout", "The local Brain did not respond in time."));
      }, timeoutMs);
    });

    const run = async (): Promise<BrainResult<unknown>> => {
      let token: string;
      try {
        token = (await loadToken()).trim();
        if (!token || /[\r\n]/.test(token)) {
          return fail("credentials-unavailable", "Local Brain credentials are unavailable.");
        }
      } catch {
        return fail("credentials-unavailable", "Local Brain credentials are unavailable.");
      }
      if (controller.signal.aborted) {
        return fail("timeout", "The local Brain did not respond in time.");
      }
      const id = ++nextId;
      try {
        const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        if (Buffer.byteLength(body) > 1_000_000) {
          return fail("not-allowed", "The Brain request exceeds the local transport limit.");
        }
        const response = await fetch(ENDPOINT, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body,
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          return fail("unauthorized", "The local Brain refused authentication.");
        }
        if (!response.ok) {
          return fail("disconnected", "The local Brain request failed.");
        }
        if (!response.body) {
          return fail("invalid-response", "The local Brain returned an invalid response.");
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (declaredLength > maxResponseBytes) {
          await response.body.cancel();
          return fail("response-too-large", "The local Brain response exceeds the size limit.");
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maxResponseBytes) {
              await reader.cancel();
              return fail("response-too-large", "The local Brain response exceeds the size limit.");
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        let envelope: unknown;
        try {
          envelope = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
        } catch {
          return fail("invalid-response", "The local Brain returned an invalid response.");
        }
        if (
          !record(envelope) ||
          envelope.jsonrpc !== "2.0" ||
          envelope.id !== id ||
          !("result" in envelope) ||
          "error" in envelope
        ) {
          return fail("invalid-response", "The local Brain returned an invalid response.");
        }
        return { ok: true, value: envelope.result };
      } catch {
        return controller.signal.aborted
          ? fail("timeout", "The local Brain did not respond in time.")
          : fail("disconnected", "The local Brain is unavailable.");
      }
    };

    try {
      return await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async function tool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<BrainResult<BrainToolResult>> {
    const response = await request("tools/call", { name, arguments: args });
    if (!response.ok) return response;
    const result = response.value;
    if (!record(result) || !Array.isArray(result.content)) {
      return fail("invalid-response", "The local Brain returned an invalid tool response.");
    }
    if (result.isError === true) {
      return fail("tool-error", "The local Brain could not complete that tool request.");
    }
    if (result.isError !== undefined && result.isError !== false) {
      return fail("invalid-response", "The local Brain returned an invalid tool response.");
    }
    const content: Array<{ type: "text"; text: string }> = [];
    for (const block of result.content) {
      if (!record(block) || block.type !== "text" || typeof block.text !== "string") {
        return fail("invalid-response", "The local Brain returned an invalid tool response.");
      }
      content.push({ type: "text", text: block.text });
    }
    return { ok: true, value: { content, isError: false } };
  }

  return {
    async health(): Promise<BrainResult<{ connected: true }>> {
      const result = await request("ping", {});
      if (!result.ok) return result;
      return record(result.value)
        ? { ok: true, value: { connected: true } }
        : fail("invalid-response", "The local Brain returned an invalid health response.");
    },
    async callTool(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<BrainResult<BrainToolResult>> {
      if (!READ_TOOLS.has(name)) {
        return fail("not-allowed", "This Brain tool is not available through the read interface.");
      }
      return tool(name, args);
    },
    // Wire these only to authenticated, explicit human actions, never the model tool catalogue.
    humanInbox(args: { agent: BrainAgent }) {
      return tool("brain_bus_inbox", args);
    },
    sendHumanMessage(args: { to: BrainAgent | "any"; body: string; sender?: string }) {
      return tool("brain_bus_send", { ...args, sender: args.sender ?? "t3-beta" });
    },
    decideHumanMessage(args: {
      id: number;
      agent: BrainAgent;
      decision: "approve" | "reject";
      note?: string;
    }) {
      return tool("brain_bus_decide", args);
    },
    replyHumanMessage(args: { id: number; agent: BrainAgent; text: string }) {
      return tool("brain_bus_reply", args);
    },
  };
}

export type BrainClient = ReturnType<typeof createBrainClient>;
