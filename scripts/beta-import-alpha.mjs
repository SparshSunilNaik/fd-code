// One-way local import. Online backup reads Alpha through SQLite; only the new
// Beta copy is sanitized. Refuse to replace an existing Beta database.
import * as NodeSqlite from "node:sqlite";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const alphaHome = NodePath.resolve(process.argv[2] ?? NodePath.join(NodeOS.homedir(), ".t3"));
const betaHome = NodePath.resolve(process.argv[3] ?? NodePath.join(NodeOS.homedir(), ".t3-beta"));
const exists = async (path) =>
  NodeFSP.lstat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
// Resolve aliases even when the destination does not exist yet. Never import
// into Alpha itself (including through symlinks) or anywhere beneath it.
const canonicalDestination = async (path) => {
  try {
    return await NodeFSP.realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return NodePath.join(
      await canonicalDestination(NodePath.dirname(path)),
      NodePath.basename(path),
    );
  }
};
const sourceHome = await NodeFSP.realpath(alphaHome);
const destinationHome = await canonicalDestination(betaHome);
if (sourceHome === destinationHome || destinationHome.startsWith(sourceHome + NodePath.sep)) {
  throw new Error("Alpha and Beta homes must differ and Beta must be outside Alpha.");
}
const sourcePath = NodePath.join(sourceHome, "userdata", "state.sqlite");
const targetDir = NodePath.join(betaHome, "userdata");
const targetPath = NodePath.join(targetDir, "state.sqlite");
const refuseExistingDestination = async () => {
  if (await exists(targetDir))
    throw new Error("Beta already has userdata; import refuses to overwrite it.");
};
await refuseExistingDestination();
await NodeFSP.mkdir(betaHome, { recursive: true, mode: 0o700 });
const lockPath = NodePath.join(betaHome, ".alpha-import.lock");
await NodeFSP.writeFile(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
let staging;
try {
  await refuseExistingDestination();
  staging = await NodeFSP.mkdtemp(NodePath.join(betaHome, ".alpha-import-"));
  const stagedPath = NodePath.join(staging, "state.sqlite");
  const source = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
  try {
    await NodeSqlite.backup(source, stagedPath);
  } finally {
    source.close();
  }
  await NodeFSP.chmod(stagedPath, 0o600);
  const copy = new NodeSqlite.DatabaseSync(stagedPath);
  let summary;
  try {
    const tables = new Set(
      copy
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    const count = (table) => copy.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
    summary = {
      importedAt: new Date().toISOString(),
      sourcePath,
      projects: count("projection_projects"),
      threads: count("projection_threads"),
      messages: count("projection_thread_messages"),
      note: "Provider continuations, active turns, pending approvals, pairing links and client auth sessions were detached in this copy. Historical events remain evidence of the original sessions.",
    };
    copy.exec("PRAGMA secure_delete=ON; BEGIN IMMEDIATE");
    for (const table of [
      "provider_session_runtime",
      "projection_thread_sessions",
      "projection_pending_approvals",
      "auth_pairing_links",
      "auth_sessions",
    ]) {
      if (tables.has(table)) copy.exec(`DELETE FROM ${table}`);
    }
    copy.exec("UPDATE projection_threads SET pending_approval_count=0,pending_user_input_count=0");
    copy
      .prepare(
        "UPDATE projection_turns SET state='interrupted', completed_at=? WHERE state='running'",
      )
      .run(summary.importedAt);
    copy.exec("COMMIT; VACUUM");
    const check = copy.prepare("PRAGMA integrity_check").get();
    if (check.integrity_check !== "ok")
      throw new Error("The imported database failed its integrity check.");
    if (count("projection_thread_messages") !== summary.messages)
      throw new Error("Message count changed during import.");
  } finally {
    copy.close();
  }
  const alphaAttachments = NodePath.join(sourceHome, "userdata", "attachments");
  if (await exists(alphaAttachments))
    await NodeFSP.cp(alphaAttachments, NodePath.join(staging, "attachments"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  const settingsPath = NodePath.join(sourceHome, "userdata", "settings.json");
  if (await exists(settingsPath)) {
    const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8"));
    await NodeFSP.writeFile(
      NodePath.join(staging, "settings.json"),
      JSON.stringify(settings, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  }
  await NodeFSP.writeFile(
    NodePath.join(staging, "alpha-import.json"),
    JSON.stringify(summary, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  await refuseExistingDestination();
  await NodeFSP.rename(staging, targetDir);
  staging = undefined;
  console.log(JSON.stringify({ ...summary, destination: targetPath, integrity: "ok" }, null, 2));
} finally {
  if (staging) await NodeFSP.rm(staging, { recursive: true, force: true });
  await NodeFSP.rm(lockPath, { force: true });
}
