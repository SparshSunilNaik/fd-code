import type { WorktreeSetupSnapshot } from "@fdcode/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { useHeldWorktreeSnapshot } from "./useHeldWorktreeSnapshot";

function snapshot(threadId: string, sequence: number) {
  return { threadId, sequence, phase: "running" } as unknown as WorktreeSetupSnapshot;
}

it("settles when the caller passes an equal fresh snapshot every render", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const held: (WorktreeSetupSnapshot | null)[] = [];
  function Probe({ routeKey, sequence }: { routeKey: string; sequence: number | null }) {
    // A query or route ref rebuilt on each render: equal content, new identity.
    const latest = sequence === null ? null : snapshot("thread-a", sequence);
    held.push(useHeldWorktreeSnapshot(routeKey, latest));
    return null;
  }
  try {
    await act(() => root.render(<Probe routeKey="env:thread-a" sequence={2} />));
    const rendersBefore = held.length;
    await act(() => root.render(<Probe routeKey="env:thread-a" sequence={2} />));
    expect(held.length - rendersBefore).toBe(1);
    expect(held.at(-1)?.sequence).toBe(2);

    // The stream emits null after a finished setup; the held snapshot bridges it.
    await act(() => root.render(<Probe routeKey="env:thread-a" sequence={null} />));
    expect(held.at(-1)?.sequence).toBe(2);

    // A late, older snapshot for the same thread does not replace a newer one.
    await act(() => root.render(<Probe routeKey="env:thread-a" sequence={1} />));
    expect(held.at(-1)?.sequence).toBe(2);
    await act(() => root.render(<Probe routeKey="env:thread-a" sequence={3} />));
    expect(held.at(-1)?.sequence).toBe(3);

    await act(() => root.render(<Probe routeKey="env:thread-b" sequence={null} />));
    expect(held.at(-1)).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
