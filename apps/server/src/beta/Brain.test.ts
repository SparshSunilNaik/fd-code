import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createBrainClient } from "./BrainClient.ts";
import { makeBrain } from "./Brain.ts";

function fixture() {
  const requests: Array<{ params: { name: string; arguments: Record<string, unknown> } }> = [];
  const fetch: typeof globalThis.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: '{"count":0}' }] },
    });
  });
  return {
    requests,
    brain: makeBrain(createBrainClient({ fetch, loadToken: async () => "test-only" })),
  };
}

describe("Beta Brain human and model boundaries", () => {
  it.effect("never lets an agent read call send, decide, reply, index or consume a mailbox", () =>
    Effect.gen(function* () {
      const f = fixture();
      for (const name of [
        "brain_bus_send",
        "brain_bus_decide",
        "brain_bus_reply",
        "brain_bus_inbox",
        "brain_add_note",
        "brain_index",
      ]) {
        expect(yield* f.brain.read({ name, args: {} })).toMatchObject({
          ok: false,
          error: { code: "not-allowed" },
        });
      }
      expect(f.requests).toHaveLength(0);
    }),
  );
  it.effect("validates explicit human decisions before contacting Brain", () =>
    Effect.gen(function* () {
      const f = fixture();
      for (const args of [
        { id: 2, agent: "codex", decision: "execute" },
        { id: -1, agent: "codex", decision: "approve" },
        { id: 2, agent: "unknown", decision: "approve" },
      ]) {
        expect(yield* f.brain.call({ name: "brain_bus_decide", args })).toMatchObject({
          ok: false,
        });
      }
      expect(f.requests).toHaveLength(0);
    }),
  );
  it.effect("attributes a human send to Beta and never auto-approves it", () =>
    Effect.gen(function* () {
      const f = fixture();
      expect(
        yield* f.brain.call({
          name: "brain_bus_send",
          args: { to: "claude", body: "Review the feature", sender: "spoof" },
        }),
      ).toMatchObject({ ok: true });
      expect(f.requests.map((request) => request.params)).toEqual([
        {
          name: "brain_bus_send",
          arguments: { to: "claude", body: "Review the feature", sender: "t3-beta" },
        },
      ]);
    }),
  );
  it.effect("keeps source evidence intact through the model read path", () =>
    Effect.gen(function* () {
      const f = fixture();
      expect(
        yield* f.brain.read({ name: "brain_search", args: { query: "session", limit: 3 } }),
      ).toMatchObject({ ok: true, value: { content: [{ type: "text", text: '{"count":0}' }] } });
      expect(f.requests[0]?.params.arguments).toEqual({ query: "session", limit: 3 });
    }),
  );
});
