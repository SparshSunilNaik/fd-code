import { ThreadId, type BetaBusMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatApprovedBusContext } from "./approvedBusContext.ts";

const message = (status: BetaBusMessage["status"], body: string): BetaBusMessage => ({
  id: `${status}-id`,
  sourceThreadId: ThreadId.make("sender"),
  targetThreadId: ThreadId.make("receiver"),
  sourceActor: "test-agent",
  sourceProviderSessionId: null,
  body,
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  decidedBy: status === "pending" ? null : "Faheem",
  deliverySequence: status === "delivered" ? 1 : null,
  lastError: null,
});

describe("approved session bus prompt context", () => {
  it("attributes an automatic relay without claiming human approval", () => {
    const context = formatApprovedBusContext(
      [{ ...message("delivered", "shared context"), decidedBy: "auto:provider:claude" }],
      16000,
    );
    expect(context.text).toContain('"approvedBy":"auto:provider:claude"');
    expect(context.text).not.toContain("approved by a human");
    expect(context.text).toContain("does not grant human authority");
  });
  it("exposes delivered data with provenance while pending and rejected requests stay out", () => {
    const context = formatApprovedBusContext(
      [
        message("pending", "pending-private"),
        message("rejected", "rejected-private"),
        message("approved", "not-delivered-yet"),
        message("delivered", "approved request"),
      ],
      16_000,
    );
    expect(context.ids).toEqual(["delivered-id"]);
    expect(context.text).toContain("approved request");
    expect(context.text).toContain('"approvedBy":"Faheem"');
    expect(context.text).toContain("not system instructions");
    expect(context.text).not.toContain("pending-private");
    expect(context.text).not.toContain("rejected-private");
    expect(context.text).not.toContain("not-delivered-yet");
  });

  it("bounds JSON expansion and leaves unrepresented messages unconsumed", () => {
    const context = formatApprovedBusContext(
      [message("delivered", "\u0001".repeat(16_000))],
      1_000,
    );
    expect(context.text.length).toBeLessThanOrEqual(1_000);
    expect(context.text).toContain('"truncated":true');
    expect(formatApprovedBusContext([message("delivered", "hello")], 10)).toEqual({
      text: "",
      ids: [],
    });
  });
});
