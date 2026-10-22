import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { chooseLayaDestination, makeLaya, validateLayaChoice } from "./Laya.ts";
const criteria = { general: "general", web: "web" };
const response = (
  choice = "web",
  probabilities: Record<string, number> = { general: 0.1, web: 0.9 },
  action: string | { act_probability: number } = { act_probability: 1 },
) => ({
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
      response("web", { general: 0.1, web: 0.9 }, { act_probability: 0.2 }),
      response("web", { general: 0.1, web: 0.9 }, { act_probability: 1.2 }),
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
            questions: { route: { criteria: { option_0: "general", option_1: "web" } } },
          });
          return Response.json(response("option_1", { option_0: 0.1, option_1: 0.9 }));
        });
        const client = makeLaya({ token: "local-test", fetch });
        expect(yield* client.choose("Find today's news", criteria)).toMatchObject({
          ok: true,
          choice: "web",
        });
        expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8773/v1/systemone");
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
        const unrelated = {
          choose: (_state: string, choices: Readonly<Record<string, string>>) =>
            Effect.succeed({
              ok: true as const,
              choice: Object.hasOwn(choices, "chat-44")
                ? "chat-44"
                : Object.keys(choices).find((key) => key !== "none")!,
              probability: Object.hasOwn(choices, "chat-44") ? 0.95 : 0.2,
            }),
        };
        expect(yield* chooseLayaDestination(unrelated, "Open chat 44", options)).toMatchObject({
          ok: true,
          choice: "chat-44",
          probability: 0.95,
        });
        const intentFirst = {
          choose: (state: string, choices: Readonly<Record<string, string>>) =>
            Object.hasOwn(choices, "specific")
              ? Effect.succeed({ ok: true as const, choice: "specific", probability: 0.9 })
              : client.choose(state, choices),
        };
        expect(
          yield* chooseLayaDestination(intentFirst, "Open chat 44", {
            general: "ordinary chat",
            web: "browse websites",
            ...options,
          }),
        ).toMatchObject({ ok: true, choice: "chat-44", probability: 0.9 });
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
