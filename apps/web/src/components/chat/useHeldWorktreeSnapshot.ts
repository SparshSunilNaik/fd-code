import type { WorktreeSetupSnapshot } from "@t3tools/contracts";
import { useState } from "react";

function snapshotKey(snapshot: WorktreeSetupSnapshot | null | undefined): string | null {
  return snapshot ? `${snapshot.threadId}:${snapshot.sequence}` : null;
}

/**
 * The last live worktree setup snapshot seen for a route. The server drops a
 * finished snapshot after a grace period and emits null; holding it bridges the
 * gap until the settled activity reaches the thread projection. A newer
 * snapshot replaces the held one, a late older one for the same thread does
 * not, and switching routes drops it.
 *
 * This syncs state during render, so every value it compares is a string.
 * Comparing objects here (a route ref, a query result) loops forever when the
 * caller builds an equal object on each render: React error #301.
 */
export function useHeldWorktreeSnapshot(
  routeKey: string,
  latest: WorktreeSetupSnapshot | null | undefined,
): WorktreeSetupSnapshot | null {
  const latestKey = snapshotKey(latest);
  const [state, setState] = useState<{
    readonly routeKey: string;
    readonly latestKey: string | null;
    readonly held: WorktreeSetupSnapshot | null;
  }>({ routeKey, latestKey: null, held: null });
  if (state.routeKey === routeKey && state.latestKey === latestKey) {
    return state.held;
  }
  let held: WorktreeSetupSnapshot | null;
  if (state.routeKey !== routeKey) {
    held = null;
  } else if (
    latest &&
    !(state.held?.threadId === latest.threadId && state.held.sequence > latest.sequence)
  ) {
    held = latest;
  } else {
    held = state.held;
  }
  setState({ routeKey, latestKey, held });
  return held;
}
