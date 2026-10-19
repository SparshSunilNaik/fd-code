import type { OrchestrationV2ContextHandoff } from "@t3tools/contracts";

// Tool transcripts remain pageable in Brain. Native injection carries conversation,
// plans and file references rather than filling the new model with process output.
export function retrievableHandoffs(handoffs: ReadonlyArray<OrchestrationV2ContextHandoff>) {
  return handoffs.map((handoff) => {
    const history = handoff.history;
    if (history === undefined) return handoff;
    const messages = history.messages.filter((message) =>
      ["user_message", "assistant_message", "proposed_plan", "file_change"].includes(message.kind),
    );
    const included = new Set(messages.map((message) => message.itemId));
    const omitted = history.messages.filter((message) => !included.has(message.itemId));
    return {
      ...handoff,
      history: {
        ...history,
        coverage: `${history.coverage}\nTool transcripts omitted from injection remain searchable with t3_rag and pageable with t3_brain_memory.`,
        messages,
        omittedItems: history.omittedItems + omitted.length,
        omittedItemIds: [
          ...new Set([
            ...(history.omittedItemIds ?? []),
            ...omitted.map((message) => message.itemId),
          ]),
        ],
      },
    };
  });
}
