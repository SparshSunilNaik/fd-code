import { expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId, type OrchestrationV2ContextHandoff } from "@t3tools/contracts";
import { retrievableHandoffs } from "./handoffHistory.ts";

it("keeps dialogue but records tool-output omissions for later retrieval without mutating saved history", () => {
  const threadId = ThreadId.make("handoff-brain");
  const base = {
    role: "assistant" as const,
    threadId,
    runId: null,
    providerThreadId: null,
    status: "completed" as const,
  };
  const user = {
    ...base,
    role: "user" as const,
    kind: "user_message" as const,
    itemId: TurnItemId.make("question"),
    text: "Keep the migration local.",
  };
  const tool = {
    ...base,
    kind: "command_execution" as const,
    itemId: TurnItemId.make("command"),
    text: "very large process output".repeat(1_000),
  };
  const answer = {
    ...base,
    kind: "assistant_message" as const,
    itemId: TurnItemId.make("answer"),
    text: "Use the SQLite outbox.",
  };
  const saved = {
    history: {
      messages: [user, tool, answer],
      coverage: "Thread handoff",
      omittedItems: 1,
      omittedItemIds: [TurnItemId.make("earlier-omission")],
    },
  } as unknown as OrchestrationV2ContextHandoff;
  const filtered = retrievableHandoffs([saved])[0]!;
  expect(filtered.history!.messages.map((message) => message.text)).toEqual([
    user.text,
    answer.text,
  ]);
  expect(filtered.history!.omittedItems).toBe(2);
  expect(filtered.history!.omittedItemIds).toContain(tool.itemId);
  expect(filtered.history!.coverage).toContain("t3_rag");
  expect(saved.history!.messages).toHaveLength(3);
});
