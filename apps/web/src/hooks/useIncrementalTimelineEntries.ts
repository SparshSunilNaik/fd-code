import { useState } from "react";
import {
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesInput,
  type TimelineEntriesProjection,
} from "../session-logic";

function sameItems<T>(
  left: ReadonlyArray<T> | undefined,
  right: ReadonlyArray<T> | undefined,
): boolean {
  return (
    left === right ||
    (left?.length === right?.length &&
      left !== undefined &&
      right !== undefined &&
      left.every((item, index) => item === right[index]))
  );
}

function sameAttachments(
  left: TimelineEntriesInput["attachmentUrlById"],
  right: TimelineEntriesInput["attachmentUrlById"],
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.size === right.size &&
      [...left].every(([key, value]) => right.get(key) === value))
  );
}

// Equivalent containers must settle without another render; item identity still detects updates.
function sameInput(left: TimelineEntriesInput, right: TimelineEntriesInput): boolean {
  return (
    sameItems(left.visibleTurnItems, right.visibleTurnItems) &&
    sameItems(left.optimisticMessages, right.optimisticMessages) &&
    sameItems(left.anchoredMessages, right.anchoredMessages) &&
    sameAttachments(left.attachmentUrlById, right.attachmentUrlById) &&
    sameItems(left.attempts, right.attempts) &&
    sameItems(left.nodes, right.nodes) &&
    sameItems(left.plans, right.plans)
  );
}

/**
 * Timeline entries for a thread, derived from the previous projection so
 * unchanged rows keep their identity and memoized rows skip rendering. A new
 * thread starts from scratch.
 */
export function useIncrementalTimelineEntries(
  threadKey: string | null,
  input: TimelineEntriesInput,
): TimelineEntriesProjection["entries"] {
  const [state, setState] = useState(() => ({
    threadKey,
    projection: deriveTimelineEntriesFromVisibleTurnItemsWithState(input),
  }));
  if (state.threadKey === threadKey && sameInput(state.projection.input, input)) {
    return state.projection.entries;
  }
  const projection = deriveTimelineEntriesFromVisibleTurnItemsWithState(
    input,
    state.threadKey === threadKey ? state.projection : null,
  );
  setState({ threadKey, projection });
  return projection.entries;
}
