import { describe, expect, it } from "@effect/vitest";
import { createArtsieClient } from "./ArtsieClient.ts";

describe("ARTsie host connection", () => {
  it("reuses the host service, sends its token only to the action endpoint, and returns no bootstrap credentials", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createArtsieClient(async (url, init) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return Response.json(
        String(url).endsWith("status")
          ? { service: "ARTsie" }
          : String(url).endsWith("bootstrap")
            ? { token: "private-hub-token", apps: [] }
            : { path: ".", entries: [{ name: "Projects", directory: true }] },
      );
    });
    const result = await client({ action: "files", args: { path: "." } });
    expect(result).toEqual({
      ok: true,
      value: { path: ".", entries: [{ name: "Projects", directory: true }] },
    });
    expect(JSON.stringify(result)).not.toContain("private-hub-token");
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8743/api/status",
      "http://127.0.0.1:8743/api/bootstrap",
      "http://127.0.0.1:8743/api/files",
    ]);
    expect(calls[2]?.init).toMatchObject({
      redirect: "error",
      method: "POST",
      headers: { "X-ARTsie-Token": "private-hub-token" },
      body: '{"path":"."}',
    });
  });

  it("refuses arbitrary tool execution before any network request", async () => {
    let called = false;
    const client = createArtsieClient(async () => {
      called = true;
      return Response.json({});
    });
    // Exercise the runtime boundary as well as the wire schema.
    const result = await client({ action: "call" as "tools", args: { tool: "anything" } });
    expect(result).toMatchObject({ ok: false, error: { code: "not-allowed" } });
    expect(called).toBe(false);
  });

  it("does not send a token to a service that fails the identity check", async () => {
    const calls: string[] = [];
    const result = await createArtsieClient(async (url) => {
      calls.push(String(url));
      return Response.json({ service: "other" });
    })({ action: "apps", args: {} });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });

  it("preserves the hub's overwrite refusal and never retries a mutation", async () => {
    let mutations = 0;
    const result = await createArtsieClient(async (url) => {
      if (String(url).endsWith("status")) return Response.json({ service: "ARTsie" });
      if (String(url).endsWith("bootstrap")) return Response.json({ token: "test-token" });
      mutations++;
      return Response.json(
        { error: "Destination already exists; choose a new name" },
        { status: 400 },
      );
    })({ action: "copy", args: { source: "Inbox/a.png", target: "Exports/a.png" } });
    expect(result).toMatchObject({
      ok: false,
      error: { message: "Destination already exists; choose a new name" },
    });
    expect(mutations).toBe(1);
  });

  it("returns a recoverable offline error", async () => {
    const result = await createArtsieClient(async () => {
      throw new TypeError("fetch failed");
    })({ action: "apps", args: {} });
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Open ARTsie.app") },
    });
  });

  it("bounds the received response", async () => {
    const result = await createArtsieClient(
      async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
    )({ action: "apps", args: {} });
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("too large") },
    });
  });
});
