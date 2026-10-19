import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircleIcon } from "lucide-react";
import * as Effect from "effect/Effect";
import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";
import { usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";

export function GeneralChatButton() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    if (lock.current || !environmentId) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await runPrimaryHttp(
        PrimaryEnvironmentHttpClient.pipe(
          Effect.flatMap((client) => client.beta.generalChat({ headers: {} })),
          Effect.timeout("20 seconds"),
        ),
      );
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.threadId },
      });
    } catch {
      setError("Couldn’t open General chat. Try again when Beta is connected.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div>
      <Button
        variant="ghost"
        size="compact"
        className="no-drag relative z-10 w-full justify-start"
        disabled={busy || !environmentId}
        onClick={() => void open()}
      >
        <MessageCircleIcon />
        {busy ? "Opening General…" : "General chat"}
      </Button>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
