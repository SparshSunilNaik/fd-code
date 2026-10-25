import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@fdcode/contracts";
import { acpRegistryClient } from "@fdcode/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@fdcode/provider-core/client";
import { cursorClient } from "@fdcode/provider-cursor/client";
import { grokClient } from "@fdcode/provider-grok/client";
import { museClient } from "@fdcode/provider-muse/client";
import { openCodeClient } from "@fdcode/provider-opencode/client";
import { piClient } from "@fdcode/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
