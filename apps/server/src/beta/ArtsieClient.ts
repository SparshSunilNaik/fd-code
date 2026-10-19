// @effect-diagnostics globalTimers:off
// Local HTTP transport owns its AbortSignal; no editor process is started here.
import type { BetaArtsieInput, BetaBrainResponse } from "@t3tools/contracts";

const ORIGIN = "http://127.0.0.1:8743";
const MAX_BYTES = 4 * 1024 * 1024;
const ACTIONS = new Set([
  "apps",
  "files",
  "launch",
  "tools",
  "start_live",
  "import",
  "mkdir",
  "copy",
  "rename",
  "reveal",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reuses the existing hub and its documents. The per-run token stays on this server. */
export function createArtsieClient(fetch: typeof globalThis.fetch = globalThis.fetch) {
  return async (input: BetaArtsieInput): Promise<BetaBrainResponse> => {
    if (!ACTIONS.has(input.action)) {
      return { ok: false, error: { code: "not-allowed", message: "Unsupported ARTsie action." } };
    }
    const signal = AbortSignal.timeout(input.action === "import" ? 180_000 : 155_000);
    const read = async (response: Response): Promise<unknown> => {
      if (!response.body) throw new Error("ARTsie returned an empty response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_BYTES) {
            await reader.cancel();
            throw new Error("The ARTsie response is too large. Use the standalone tool explorer.");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
      if (!response.ok) {
        throw new Error(
          record(result) && typeof result.error === "string"
            ? result.error
            : "ARTsie refused the request.",
        );
      }
      return result;
    };
    try {
      // Never follow redirects: the session token belongs only to this loopback service.
      const status = await read(await fetch(`${ORIGIN}/api/status`, { signal, redirect: "error" }));
      if (!record(status) || status.service !== "ARTsie")
        throw new Error("The local service is not ARTsie.");
      const bootstrap = await read(
        await fetch(`${ORIGIN}/api/bootstrap`, { signal, redirect: "error" }),
      );
      if (
        !record(bootstrap) ||
        typeof bootstrap.token !== "string" ||
        !bootstrap.token ||
        /[\r\n]/.test(bootstrap.token)
      ) {
        throw new Error("ARTsie returned an invalid local session.");
      }
      const value = await read(
        await fetch(`${ORIGIN}/api/${input.action}`, {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "Content-Type": "application/json", "X-ARTsie-Token": bootstrap.token },
          body: JSON.stringify(input.args),
        }),
      );
      return { ok: true, value };
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: signal.aborted ? "timeout" : "unavailable",
          message: signal.aborted
            ? "ARTsie timed out. The action may have completed; check the files or editor before retrying."
            : cause instanceof TypeError
              ? "ARTsie is offline on this Beta host. Open ARTsie.app, then refresh."
              : cause instanceof Error
                ? cause.message
                : "ARTsie is unavailable.",
        },
      };
    }
  };
}
