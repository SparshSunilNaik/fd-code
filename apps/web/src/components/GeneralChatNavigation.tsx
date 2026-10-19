import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  GENERAL_CHAT_THREAD_PREFIX,
  GeneralChatNavigation as Navigation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useThreadDetail } from "../state/entities";

const decode = Schema.decodeUnknownOption(Navigation);
export function GeneralChatNavigation({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadDetail(threadRef);
  const navigate = useNavigate();
  const seen = useRef(new Set<string>());
  const [openedAt] = useState(() => Date.now());
  const general = threadRef.threadId.startsWith(GENERAL_CHAT_THREAD_PREFIX);
  const receipt = general
    ? thread?.activities.findLast((a) => a.kind === "general-chat.handoff")
    : undefined;
  const parsed = receipt ? decode(receipt.payload) : Option.none();
  const targetThreadId = Option.isSome(parsed) ? parsed.value.targetThreadId : null;
  useEffect(() => {
    // History is never replayed as navigation. Only a new handoff while the user
    // is actually viewing General may move this client; the receipt remains a link.
    if (
      !receipt ||
      !targetThreadId ||
      Date.parse(receipt.createdAt) <= openedAt ||
      seen.current.has(receipt.id)
    )
      return;
    seen.current.add(receipt.id);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: threadRef.environmentId, threadId: targetThreadId },
    }).catch(() => {});
  }, [navigate, openedAt, receipt, targetThreadId, threadRef.environmentId]);
  if (!general) return null;
  return (
    <div className="no-drag flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
      <span>General chat · Ask anything, browse, or continue in the right Beta chat.</span>
      {targetThreadId && (
        <Link
          className="ml-auto shrink-0 underline"
          to="/$environmentId/$threadId"
          params={{ environmentId: threadRef.environmentId, threadId: targetThreadId }}
        >
          Open last routed chat
        </Link>
      )}
    </div>
  );
}
