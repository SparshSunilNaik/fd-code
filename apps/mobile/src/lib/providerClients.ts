import { isProviderDriverKind } from "@fdcode/contracts";
import { acpRegistryClient } from "@fdcode/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@fdcode/provider-core/client";
import { cursorClient } from "@fdcode/provider-cursor/client";
import { grokClient } from "@fdcode/provider-grok/client";
import { museClient } from "@fdcode/provider-muse/client";
import { openCodeClient } from "@fdcode/provider-opencode/client";
import { piClient } from "@fdcode/provider-pi/client";

const providerClients = makeProviderClientRegistry([
  cursorClient,
  grokClient,
  museClient,
  openCodeClient,
  piClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}
