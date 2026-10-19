import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  HuggingFaceIcon,
  Icon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";

export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
  [ProviderDriverKind.make("antigravity")]: AntigravityIcon,
};

// Instances that front one upstream (an OpenCode instance scoped to Hugging Face)
// show that upstream's mark instead of the driver's.
const PROVIDER_ICON_BY_INSTANCE_ID: Partial<Record<ProviderInstanceId, Icon>> = {
  [ProviderInstanceId.make("huggingface")]: HuggingFaceIcon,
};

export function providerIconFor(
  driverKind: ProviderDriverKind,
  instanceId?: ProviderInstanceId | undefined,
): Icon | null {
  return (
    (instanceId !== undefined ? PROVIDER_ICON_BY_INSTANCE_ID[instanceId] : undefined) ??
    PROVIDER_ICON_BY_PROVIDER[driverKind] ??
    null
  );
}

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  aliases?: ReadonlyArray<string> | undefined;
  isDefault?: boolean | undefined;
  badge?: "new" | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const name = options?.preferShortName && model.shortName ? model.shortName : model.name;
  return stripLeadingQualifier(name, model.subProvider);
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  return getTriggerDisplayModelName(model);
}
