import { ArtsieAppId, ArtsieWorkspacePath, OrchestratorMcpFailure } from "@fdcode/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as BetaArtsie from "../../../beta/Artsie.ts";
import * as ArtsieCli from "../../../beta/ArtsieCli.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Hub results are ARTsie's own JSON (catalog, listings, native MCP results).
// They are data for the model, never instructions.
const ArtsieResult = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown });
const ArtsieMode = Schema.Literals(["headless", "live"]);
const ArtsieToolName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/));

const shared = {
  success: ArtsieResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    BetaArtsie.BetaArtsie,
  ],
};

const ArtsieAppsTool = Tool.make("t3_artsie_apps", {
  ...shared,
  description:
    "List Faheem's local ARTsie creative apps (PhotoCraft, FilmCraft, LightCraft, EffectCraft, SoundCraft, VectorCraft, DesignCraft, DeckCraft, GridCraft, PdfCraft, WordCraft, CADCraft, FigCraft): ids, versions, whether each is installed with a CLI, its filesystem_scope and native session status. Start here, then t3_artsie_tools.",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ArtsieFilesTool = Tool.make("t3_artsie_files", {
  ...shared,
  description:
    "List a folder in the shared ARTsie workspace. path is workspace-relative (default the root); symlinks are skipped.",
  parameters: Schema.Struct({ path: Schema.optional(ArtsieWorkspacePath) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ArtsieMkdirTool = Tool.make("t3_artsie_mkdir", {
  ...shared,
  description:
    "Create a folder in the ARTsie workspace (workspace-relative path). Refuses existing paths.",
  parameters: Schema.Struct({ path: ArtsieWorkspacePath }),
}).annotate(Tool.Destructive, false);

const ArtsieCopyTool = Tool.make("t3_artsie_copy", {
  ...shared,
  description:
    "Copy a workspace file or folder to a new workspace-relative path. Refuses to overwrite. Copy originals before editing them.",
  parameters: Schema.Struct({ source: ArtsieWorkspacePath, target: ArtsieWorkspacePath }),
}).annotate(Tool.Destructive, false);

const ArtsieRenameTool = Tool.make("t3_artsie_rename", {
  ...shared,
  description:
    "Rename or move a workspace file or folder to a new workspace-relative path. Refuses to overwrite.",
  parameters: Schema.Struct({ source: ArtsieWorkspacePath, target: ArtsieWorkspacePath }),
}).annotate(Tool.Destructive, true);

const ArtsieLaunchTool = Tool.make("t3_artsie_launch", {
  ...shared,
  description:
    "Open an ARTsie app on the host desktop, optionally with a workspace file. The desktop document is separate from headless native sessions. Requires a full-access thread.",
  parameters: Schema.Struct({ app: ArtsieAppId, path: Schema.optional(ArtsieWorkspacePath) }),
}).annotate(Tool.Destructive, false);

const ArtsieStartLiveTool = Tool.make("t3_artsie_start_live", {
  ...shared,
  description:
    "Launch a separate visible PhotoCraft or FilmCraft window under agent control and return its native tools. Then use mode=live with t3_artsie_tools/t3_artsie_call. The window stays open; it is closed normally by the user. Requires a full-access thread.",
  parameters: Schema.Struct({ app: Schema.Literals(["photocraft", "filmcraft"]) }),
}).annotate(Tool.Destructive, false);

const ArtsieToolsTool = Tool.make("t3_artsie_tools", {
  ...shared,
  description:
    "Discover an ARTsie app's native MCP tool schemas. Starts (or reuses) the app's persistent headless engine; mode=live targets a window from t3_artsie_start_live. Call before t3_artsie_call. Requires a full-access thread.",
  parameters: Schema.Struct({ app: ArtsieAppId, mode: Schema.optional(ArtsieMode) }),
}).annotate(Tool.Destructive, false);

const ArtsieCallTool = Tool.make("t3_artsie_call", {
  ...shared,
  description:
    "Call one discovered native tool of an ARTsie app with its exact arguments (schemas from t3_artsie_tools). The engine keeps its document between calls. Use absolute file paths, work on copies, and save results in workspace/Exports. FilmCraft, LightCraft, CADCraft and GridCraft use the Mac account's file permissions; the other headless engines are confined to the ARTsie workspace. Requires a full-access thread.",
  parameters: Schema.Struct({
    app: ArtsieAppId,
    tool: ArtsieToolName,
    arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    mode: Schema.optional(ArtsieMode),
  }),
}).annotate(Tool.Destructive, true);

const ArtsieCliTool = Tool.make("t3_artsie_cli", {
  ...shared,
  description:
    'Run the unified local ARTsie CLI for all 13 creative apps, sharing their persistent hub sessions. argv is an argument array, never a shell command. Examples: ["apps"], ["search","crop"], ["schema","photocraft","doc_export"], ["photocraft","doc_export","--input","{\\"path\\":\\"/absolute/Exports/result.png\\"}"]. JSON output is automatic. Inspect exitCode and result.ok before claiming success. Discover schemas before editing, preserve originals, and use --mode live only for a window started with t3_artsie_start_live. Supports import, files, copy, move, mkdir, launch, catalog refresh and every native app command. Requires a live full-access/default thread.',
  parameters: Schema.Struct({
    argv: Schema.Array(Schema.String.check(Schema.isMaxLength(8192))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
    ),
  }),
  dependencies: [...shared.dependencies, ArtsieCli.ArtsieCli],
}).annotate(Tool.Destructive, true);

export const ArtsieToolkit = Toolkit.make(
  ArtsieAppsTool,
  ArtsieFilesTool,
  ArtsieMkdirTool,
  ArtsieCopyTool,
  ArtsieRenameTool,
  ArtsieLaunchTool,
  ArtsieStartLiveTool,
  ArtsieToolsTool,
  ArtsieCallTool,
  ArtsieCliTool,
);
