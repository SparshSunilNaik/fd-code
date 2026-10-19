import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { chooseLayaDestination, makeLaya, validateLayaChoice } from "./Laya.ts";
const criteria = { general: "general", web: "web" };
const response = (choice = "web", probabilities = { general: 0.1, web: 0.9 }, action?: string) => ({
  answers: { route: { type: "choice", choice, probabilities, ...(action ? { action } : {}) } },
});
describe("Laya decision boundary", () => {
  it("accepts only offered argmax choices and complete probability distributions", () => {
    expect(validateLayaChoice(response(), criteria)).toEqual({
      ok: true,
      choice: "web",
      probability: 0.9,
    });
    for (const raw of [
      response("invented"),
      response("general"),
      response("web", { general: 0.1, web: 1.2 }),
      response("web", { general: 0.1, web: 0.1 }),
      response("web", { general: NaN, web: 0.9 }),
      response("web", { general: 0.1, web: 0.9 }, "abstain"),
      { answers: {} },
      { answers: { route: { type: "choice", choice: "web", probabilities: { web: 1 } } } },
    ]) {
      expect(validateLayaChoice(raw, criteria).ok).toBe(false);
    }
  });
  it.effect(
    "uses the local authenticated upstream wire contract and cancels oversized responses",
    () =>
      Effect.gen(function* () {
        const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
          expect(init?.redirect).toBe("error");
          expect(init?.headers).toMatchObject({ authorization: "Bearer local-test" });
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: "multilingual",
            questions: { route: { criteria } },
          });
          return Response.json(response());
        });
        const client = makeLaya({ token: "local-test", fetch });
        expect(yield* client.choose("Find today's news", criteria)).toMatchObject({
          ok: true,
          choice: "web",
        });
        expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8772/v1/systemone");
        const huge = makeLaya({
          token: "test",
          fetch: async () => new Response("x".repeat(65537)),
        });
        expect(yield* huge.choose("hello", criteria)).toMatchObject({ ok: false });
        const offline = makeLaya({
          token: "test",
          fetch: async () => {
            throw new Error("offline");
          },
        });
        expect(yield* offline.choose("hello", criteria)).toMatchObject({ ok: false });
        expect(yield* client.choose("x".repeat(6001), criteria)).toMatchObject({ ok: false });
        expect(
          yield* client.choose(
            "hello",
            Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i), "option"])),
          ),
        ).toMatchObject({ ok: false });
        expect(fetch).toHaveBeenCalledTimes(1);
      }),
  );
  it.effect(
    "compares all destinations above the model option limit and abstains on incomplete certainty",
    () =>
      Effect.gen(function* () {
        const options = Object.fromEntries(
          Array.from({ length: 45 }, (_, i) => [`chat-${i}`, `Chat ${i}`]),
        );
        const examined = new Set<string>();
        const client = {
          choose: (_state: string, criteria: Readonly<Record<string, string>>) => {
            expect(Object.keys(criteria).length).toBeLessThanOrEqual(20);
            Object.keys(criteria).forEach((key) => examined.add(key));
            return Effect.succeed({
              ok: true as const,
              choice: Object.hasOwn(criteria, "chat-44") ? "chat-44" : "none",
              probability: 0.95,
            });
          },
        };
        expect(yield* chooseLayaDestination(client, "Open chat 44", options)).toMatchObject({
          ok: true,
          choice: "chat-44",
        });
        expect([...examined].filter((key) => key.startsWith("chat-"))).toHaveLength(45);
        const uncertain = {
          choose: () => Effect.succeed({ ok: true as const, choice: "none", probability: 0.4 }),
        };
        expect(yield* chooseLayaDestination(uncertain, "Open a chat", options)).toMatchObject({
          ok: false,
          reason: "uncertain",
        });
      }),
  );
});
