import { useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  PaletteIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { BetaArtsieInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

const App = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  version: Schema.String,
  monogram: Schema.String,
  installed: Schema.Boolean,
  cli: Schema.Boolean,
  filesystem_scope: Schema.String,
  session: Schema.String,
});
type App = typeof App.Type;
const Catalog = Schema.Struct({ apps: Schema.Array(App) });
const File = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  directory: Schema.Boolean,
  bytes: Schema.NullOr(Schema.Int),
});
type File = typeof File.Type;
const Files = Schema.Struct({ path: Schema.String, entries: Schema.Array(File) });
const Tools = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      inputSchema: Schema.Unknown,
    }),
  ),
});
type Tools = typeof Tools.Type;
const decodeCatalog = Schema.decodeUnknownSync(Catalog);
const decodeFiles = Schema.decodeUnknownSync(Files);
const decodeTools = Schema.decodeUnknownSync(Tools);
const field =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const groups: Record<string, readonly string[]> = {
  image: ["photocraft", "vectorcraft", "lightcraft", "designcraft", "figcraft"],
  video: ["filmcraft", "effectcraft", "soundcraft"],
  document: ["pdfcraft", "wordcraft", "deckcraft", "cadcraft", "gridcraft"],
};
const categoryLabels = [
  ["all", "All apps"],
  ["image", "Image & design"],
  ["video", "Video & audio"],
  ["document", "Documents & data"],
] as const;

async function request(
  action: BetaArtsieInput["action"],
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.beta.artsie({ headers: {}, payload: { action, args } })),
    ),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Theme, dialogs, focus handling, and connection authentication belong to Beta. */
export function ArtsiePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"apps" | "files" | "tools">("apps");
  const [apps, setApps] = useState<readonly App[]>([]);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [folder, setFolder] = useState(".");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [appId, setAppId] = useState("photocraft");
  const [tools, setTools] = useState<Tools | null>(null);
  const [toolMode, setToolMode] = useState<"headless" | "live">("headless");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<{
    action: "copy" | "rename" | "mkdir";
    source?: string;
  } | null>(null);
  const [destination, setDestination] = useState("");
  const lock = useRef(false);
  const act = async (run: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ARTsie could not complete this request.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const loadFiles = async (path: string) => {
    const result = decodeFiles(await request("files", { path }));
    setFolder(result.path);
    setFiles(result.entries);
    setOperation(null);
  };
  const refresh = async () => {
    try {
      const catalog = decodeCatalog(await request("apps"));
      setApps(catalog.apps.filter((app) => app.id !== "craft-launcher"));
      setConnected(true);
    } catch (cause) {
      setConnected(false);
      throw cause;
    }
    if (tab === "files") await loadFiles(folder);
  };
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (value) void act(refresh);
  };
  const selectedApp = apps.find((app) => app.id === appId);
  const discover = async (live: boolean) => {
    setTools(null);
    const result = decodeTools(await request(live ? "start_live" : "tools", { app: appId }));
    setTools(result);
    setToolMode(live ? "live" : "headless");
    setNotice(
      live
        ? "Visible agent window ready. Use mode=live to edit this window."
        : "Headless tools ready. This document is separate from ordinary desktop windows.",
    );
  };
  const filtered = apps.filter(
    (app) =>
      (group === "all" || groups[group]?.includes(app.id)) &&
      `${app.name} ${app.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  const mutate = async () => {
    if (!operation || !destination.trim()) return;
    await request(
      operation.action,
      operation.action === "mkdir"
        ? { path: destination.trim() }
        : { source: operation.source, target: destination.trim() },
    );
    setNotice("Saved in the ARTsie workspace.");
    await loadFiles(folder);
  };
  const liveAvailable = appId === "photocraft" || appId === "filmcraft";
  return (
    <>
      <Button
        variant="ghost"
        size="compact"
        className="no-drag relative z-10"
        onClick={() => changeOpen(true)}
        aria-label="Open ARTsie creative workspace"
      >
        <PaletteIcon />
        ARTsie
      </Button>
      {open && (
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogPopup className="flex h-[min(88dvh,52rem)] w-[min(96vw,72rem)] max-w-none flex-col overflow-hidden bg-background p-0">
            <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
              <DialogTitle className="flex items-center gap-2 text-base">
                <PaletteIcon className="size-4 text-muted-foreground" />
                ARTsie
                <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-normal text-secondary-foreground">
                  Beta extension
                </span>
              </DialogTitle>
              <DialogDescription>
                Your creative apps, files, and agent tools. On your Beta host.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <nav
                aria-label="ARTsie sections"
                className="flex shrink-0 gap-1 border-b bg-sidebar p-2 md:w-44 md:flex-col md:border-r md:border-b-0 md:p-3"
              >
                {(
                  [
                    ["apps", "Apps", PaletteIcon],
                    ["files", "Files & folders", FolderOpenIcon],
                    ["tools", "Agent tools", SlidersHorizontalIcon],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={tab === id ? "secondary" : "ghost"}
                    className="justify-start"
                    disabled={busy}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => {
                      setTab(id);
                      if (id === "files") void act(() => loadFiles(folder));
                    }}
                  >
                    <Icon />
                    {label}
                  </Button>
                ))}
                <div className="mt-auto hidden space-y-2 border-t pt-4 text-xs text-muted-foreground md:block">
                  <p>{apps.length || "13"} creative apps</p>
                  <p>Inbox → Projects → Exports</p>
                  <p>Files and editors live on the connected Beta host.</p>
                </div>
              </nav>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
                  <h2 className="text-sm font-medium">
                    {tab === "apps"
                      ? "Creative toolkit"
                      : tab === "files"
                        ? "Workspace"
                        : "Agent connections"}
                  </h2>
                  <span role="status" className="ml-auto text-xs text-muted-foreground">
                    {busy ? "Working…" : connected ? "ARTsie connected" : "ARTsie offline"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label="Refresh ARTsie"
                    onClick={() => void act(refresh)}
                  >
                    <RefreshCwIcon />
                  </Button>
                </div>
                <div aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto p-5">
                  {error && (
                    <div
                      role="alert"
                      className="mb-4 space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"
                    >
                      <p>{error}</p>
                      {!connected && (
                        <p className="text-xs text-muted-foreground">
                          Open ARTsie.app on the machine hosting Beta, then refresh. Closing this
                          panel keeps editor sessions running.
                        </p>
                      )}
                    </div>
                  )}
                  {notice && (
                    <p role="status" className="mb-4 rounded-lg border bg-secondary/40 p-3 text-sm">
                      {notice}
                    </p>
                  )}
                  {tab === "apps" && (
                    <div className="space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">
                          Everything you need to make something.
                        </p>
                        <label className="relative">
                          <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                          <input
                            className={`${field} w-48 pl-9`}
                            aria-label="Find an ARTsie app"
                            placeholder="Find an app…"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-1" aria-label="App categories">
                        {categoryLabels.map(([id, label]) => (
                          <Button
                            key={id}
                            variant={group === id ? "secondary" : "ghost"}
                            size="sm"
                            aria-pressed={group === id}
                            onClick={() => setGroup(id)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {filtered.map((app) => (
                          <article
                            key={app.id}
                            className="flex flex-col rounded-xl border bg-card p-4"
                          >
                            <div className="mb-4 flex items-center justify-between">
                              <span className="flex size-10 items-center justify-center rounded-xl border bg-secondary text-sm font-semibold tracking-tight text-secondary-foreground">
                                {app.monogram}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {app.installed ? "Installed" : "Unavailable"}
                              </span>
                            </div>
                            <h3 className="text-sm font-medium">{app.name}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">{app.category}</p>
                            <div className="mt-5 flex items-center justify-between gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy || !app.cli}
                                onClick={() => {
                                  setAppId(app.id);
                                  setTools(null);
                                  setTab("tools");
                                }}
                              >
                                Tools
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy || !app.installed}
                                onClick={() =>
                                  void act(async () => {
                                    await request("launch", { app: app.id });
                                    setNotice(`${app.name} opened on the Beta host.`);
                                  })
                                }
                              >
                                Open
                                <ArrowUpRightIcon />
                              </Button>
                            </div>
                          </article>
                        ))}
                      </div>
                      {connected && !filtered.length && (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                          No apps match this search.
                        </p>
                      )}
                    </div>
                  )}
                  {tab === "files" && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !connected}
                          onClick={() =>
                            void act(async () => {
                              await request("import", { folder: false });
                              await loadFiles("Inbox");
                              setNotice("Copied to Inbox. The original stays where it was.");
                            })
                          }
                        >
                          Import file
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !connected}
                          onClick={() =>
                            void act(async () => {
                              await request("import", { folder: true });
                              await loadFiles("Inbox");
                              setNotice("Folder copied to Inbox.");
                            })
                          }
                        >
                          Import folder
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || !connected}
                          onClick={() => {
                            setOperation({ action: "mkdir" });
                            setDestination(`${folder === "." ? "" : `${folder}/`}New folder`);
                          }}
                        >
                          New folder
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || !connected}
                          onClick={() =>
                            void act(async () => {
                              await request("reveal", { path: folder });
                              setNotice("Folder opened in Finder on the Beta host.");
                            })
                          }
                        >
                          Finder
                          <ArrowUpRightIcon />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[".", "Inbox", "Projects", "Exports"].map((path) => (
                          <Button
                            key={path}
                            size="sm"
                            variant={folder === path ? "secondary" : "ghost"}
                            disabled={busy}
                            onClick={() => void act(() => loadFiles(path))}
                          >
                            {path === "." ? "Workspace" : path}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || folder === "."}
                          onClick={() =>
                            void act(() =>
                              loadFiles(
                                folder.includes("/")
                                  ? folder.slice(0, folder.lastIndexOf("/"))
                                  : ".",
                              ),
                            )
                          }
                        >
                          ↑ Up
                        </Button>
                        <span className="break-all">workspace/{folder === "." ? "" : folder}</span>
                      </div>
                      {operation && (
                        <form
                          className="flex flex-wrap gap-2 rounded-lg border p-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void act(mutate);
                          }}
                        >
                          <label className="min-w-48 flex-1 text-xs text-muted-foreground">
                            {operation.action === "mkdir"
                              ? "New folder path"
                              : `${operation.action === "copy" ? "Copy" : "Move / rename"} ${operation.source} to`}
                            <input
                              autoFocus
                              required
                              className={`${field} mt-1 w-full`}
                              value={destination}
                              onChange={(event) => setDestination(event.target.value)}
                            />
                          </label>
                          <Button className="self-end" size="sm" type="submit" disabled={busy}>
                            Save
                          </Button>
                          <Button
                            className="self-end"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setOperation(null)}
                          >
                            Cancel
                          </Button>
                        </form>
                      )}
                      <div className="divide-y rounded-xl border bg-card">
                        {files.map((file) => (
                          <div key={file.path} className="flex flex-wrap items-center gap-2 p-3">
                            {file.directory ? (
                              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <button
                              className="min-w-32 flex-1 break-all text-left text-sm hover:underline focus-visible:outline-ring"
                              disabled={busy}
                              onClick={() => {
                                if (file.directory) void act(() => loadFiles(file.path));
                                else setNotice("Choose an app from Open with to open this file.");
                              }}
                            >
                              {file.name}
                            </button>
                            {!file.directory && (
                              <select
                                aria-label={`Open ${file.name} with`}
                                className={`${field} max-w-40 text-xs`}
                                value=""
                                disabled={busy}
                                onChange={(event) => {
                                  const app = event.target.value;
                                  if (app)
                                    void act(async () => {
                                      await request("launch", { app, path: file.path });
                                      setNotice(`${file.name} opened on the Beta host.`);
                                    });
                                }}
                              >
                                <option value="">Open with…</option>
                                {apps
                                  .filter((app) => app.installed)
                                  .map((app) => (
                                    <option key={app.id} value={app.id}>
                                      {app.name}
                                    </option>
                                  ))}
                              </select>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setOperation({ action: "copy", source: file.path });
                                setDestination(`Exports/${file.name}`);
                              }}
                            >
                              Copy
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setOperation({ action: "rename", source: file.path });
                                setDestination(file.path);
                              }}
                            >
                              Move / rename
                            </Button>
                          </div>
                        ))}
                        {connected && !files.length && (
                          <p className="p-10 text-center text-sm text-muted-foreground">
                            This folder is empty. Import a file or create a folder.
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Imports make copies. Destinations stay within workspace and existing files
                        are preserved.
                      </p>
                    </div>
                  )}
                  {tab === "tools" && (
                    <div className="space-y-5">
                      <div className="rounded-xl border bg-card p-4">
                        <h3 className="text-sm font-medium">Real tools for your assistant</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Use ARTsie’s MCP connection in your provider client to edit images, video,
                          audio, and documents. Your provider supplies the model and its approvals.
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Opening this panel does not register MCP with a provider. The ready-to-use
                          connection is in ARTsie/config/mcp.json.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select
                          className={`${field} min-w-48 flex-1`}
                          aria-label="Creative app for agent tools"
                          disabled={busy}
                          value={appId}
                          onChange={(event) => {
                            setAppId(event.target.value);
                            setTools(null);
                          }}
                        >
                          {apps
                            .filter((app) => app.cli)
                            .map((app) => (
                              <option key={app.id} value={app.id}>
                                {app.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={busy || !connected}
                          onClick={() => void act(() => discover(false))}
                        >
                          Discover tools
                        </Button>
                        {liveAvailable && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !connected}
                            onClick={() => void act(() => discover(true))}
                          >
                            Open live window
                            <ArrowUpRightIcon />
                          </Button>
                        )}
                      </div>
                      {selectedApp && (
                        <p className="text-xs text-muted-foreground">
                          File access: {selectedApp.filesystem_scope}.{" "}
                          {liveAvailable
                            ? "Live agent windows supported."
                            : "Headless tools available."}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Headless documents and ordinary desktop documents are separate sessions.
                        Save copies in Exports to review. Live control is available for PhotoCraft
                        and FilmCraft; use mode=live for those windows.
                      </p>
                      <div className="rounded-xl border bg-card p-4">
                        <h3 className="text-sm font-medium">Start in your chat</h3>
                        <p className="mt-2 select-text text-sm text-muted-foreground">
                          Use ARTsie to discover {selectedApp?.name ?? "PhotoCraft"}’s tools. Open a
                          copy of my file, make the requested edits, and save a new result in
                          workspace/Exports. Preserve the original.
                        </p>
                      </div>
                      {tools && (
                        <div>
                          <p className="mb-3 text-xs text-muted-foreground">
                            {tools.tools.length} tools ·{" "}
                            {toolMode === "live" ? "Visible agent window" : "Headless session"}
                          </p>
                          <div className="divide-y rounded-xl border bg-card">
                            {tools.tools.map((tool) => (
                              <details key={tool.name} className="p-3">
                                <summary className="cursor-pointer text-sm font-medium">
                                  {tool.name}
                                </summary>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {tool.description}
                                </p>
                                <pre className="mt-3 overflow-x-auto rounded-lg bg-secondary/40 p-3 text-xs">
                                  {JSON.stringify(tool.inputSchema, null, 2)}
                                </pre>
                              </details>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}
