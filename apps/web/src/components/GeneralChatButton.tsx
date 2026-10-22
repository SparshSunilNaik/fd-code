import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircleIcon, PinIcon } from "lucide-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { openGeneralChat } from "../rpc/generalChat";
import { usePrimaryEnvironmentId } from "../state/environments";
import { waitForThreadShell } from "../state/entities";
import { Button } from "./ui/button";

export function GeneralChatButton() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const canOpen = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    if (
      lock.current ||
      !environmentId ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await openGeneralChat();
      // The HTTP response can arrive before the websocket publishes the new thread.
      const ready = await waitForThreadShell({ environmentId, threadId: result.threadId });
      if (!ready) {
        setError("General chat was created, but hasn’t loaded yet. Try opening it again.");
        return;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.threadId },
      });
    } catch {
      setError("Couldn’t open General chat. Check your connection and try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="border-b px-3 py-2">
      <Button
        variant="ghost"
        size="compact"
        disabled={busy || !canOpen}
        onClick={() => void open()}
      >
        <MessageCircleIcon />
        {busy ? "Opening General…" : "General chat"}
        <PinIcon />
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
