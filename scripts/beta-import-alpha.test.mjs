import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeSqlite from "node:sqlite";
import * as NodeNet from "node:net";
import * as NodeEvents from "node:events";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const importer = NodeURL.fileURLToPath(new URL("./beta-import-alpha.mjs", import.meta.url));
const runImport = (source, target) => execute(process.execPath, [importer, source, target]);

async function fixture(t) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3b-"));
  const alpha = NodePath.join(root, "alpha");
  const beta = NodePath.join(root, "beta");
  const userdata = NodePath.join(alpha, "userdata");
  await NodeFSP.mkdir(NodePath.join(userdata, "attachments"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(userdata, "attachments", "message.txt"),
    "historical attachment",
  );
  await NodeFSP.writeFile(NodePath.join(userdata, "settings.json"), '{"editor":"code"}');
  const db = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "state.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE projection_projects(id TEXT); INSERT INTO projection_projects VALUES ('p1');
    CREATE TABLE projection_threads(id TEXT, pending_approval_count INTEGER, pending_user_input_count INTEGER);
    INSERT INTO projection_threads VALUES ('t1', 2, 3);
    CREATE TABLE projection_thread_messages(id TEXT, body TEXT);
    INSERT INTO projection_thread_messages VALUES ('m1','old'),('m2','committed in WAL');
    CREATE TABLE projection_turns(id TEXT, state TEXT, completed_at TEXT);
    INSERT INTO projection_turns VALUES ('turn1','running',NULL),('turn2','completed','original time');
    CREATE TABLE historical_events(body TEXT); INSERT INTO historical_events VALUES ('original provider session');`);
  for (const table of [
    "provider_session_runtime",
    "projection_thread_sessions",
    "projection_pending_approvals",
    "auth_pairing_links",
    "auth_sessions",
  ]) {
    db.exec(
      `CREATE TABLE ${table}(value TEXT); INSERT INTO ${table} VALUES ('original live value');`,
    );
  }
  t.after(async () => {
    db.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  });
  return { root, alpha, beta, userdata, db };
}

async function assertNoPartialDestination(beta) {
  await NodeAssert.rejects(NodeFSP.access(NodePath.join(beta, "userdata")), { code: "ENOENT" });
  NodeAssert.deepEqual(await NodeFSP.readdir(beta), []);
}

NodeTest.test(
  "live WAL import preserves history and source state while detaching only the copy",
  async (t) => {
    const { alpha, beta, userdata, db } = await fixture(t);
    await NodeFSP.access(NodePath.join(userdata, "state.sqlite-wal"));
    const sourceBefore = db.prepare("SELECT * FROM projection_threads").all();
    const result = JSON.parse((await runImport(alpha, beta)).stdout);
    NodeAssert.deepEqual([result.projects, result.threads, result.messages], [1, 1, 2]);
    const copy = new NodeSqlite.DatabaseSync(NodePath.join(beta, "userdata", "state.sqlite"), {
      readOnly: true,
    });
    try {
      NodeAssert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      NodeAssert.equal(
        copy.prepare("SELECT body FROM projection_thread_messages WHERE id='m2'").get().body,
        "committed in WAL",
      );
      NodeAssert.deepEqual(
        { ...copy.prepare("SELECT * FROM projection_threads").get() },
        { id: "t1", pending_approval_count: 0, pending_user_input_count: 0 },
      );
      NodeAssert.equal(
        copy.prepare("SELECT state FROM projection_turns WHERE id='turn1'").get().state,
        "interrupted",
      );
      NodeAssert.equal(
        copy.prepare("SELECT completed_at FROM projection_turns WHERE id='turn2'").get()
          .completed_at,
        "original time",
      );
      NodeAssert.equal(
        copy.prepare("SELECT body FROM historical_events").get().body,
        "original provider session",
      );
      for (const table of [
        "provider_session_runtime",
        "projection_thread_sessions",
        "projection_pending_approvals",
        "auth_pairing_links",
        "auth_sessions",
      ]) {
        NodeAssert.equal(copy.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
        NodeAssert.equal(
          db.prepare(`SELECT value FROM ${table}`).get().value,
          "original live value",
        );
      }
    } finally {
      copy.close();
    }
    NodeAssert.deepEqual(db.prepare("SELECT * FROM projection_threads").all(), sourceBefore);
    NodeAssert.equal(
      db.prepare("SELECT state FROM projection_turns WHERE id='turn1'").get().state,
      "running",
    );
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(beta, "userdata", "attachments", "message.txt"), "utf8"),
      "historical attachment",
    );
    NodeAssert.deepEqual(
      JSON.parse(await NodeFSP.readFile(NodePath.join(beta, "userdata", "settings.json"), "utf8")),
      {
        editor: "code",
      },
    );
    await NodeAssert.rejects(runImport(alpha, beta), /already has userdata/);
    const unchangedCopy = new NodeSqlite.DatabaseSync(
      NodePath.join(beta, "userdata", "state.sqlite"),
      {
        readOnly: true,
      },
    );
    try {
      NodeAssert.equal(
        unchangedCopy.prepare("SELECT count(*) AS count FROM projection_thread_messages").get()
          .count,
        2,
      );
    } finally {
      unchangedCopy.close();
    }
  },
);

NodeTest.test("refuses identical and symlink-aliased homes without touching Alpha", async (t) => {
  const { root, alpha, db } = await fixture(t);
  await NodeAssert.rejects(runImport(alpha, alpha), /homes must differ/);
  const alias = NodePath.join(root, "alias");
  await NodeFSP.symlink(alpha, alias);
  await NodeAssert.rejects(runImport(alpha, alias), /homes must differ/);
  NodeAssert.equal(
    db.prepare("SELECT value FROM auth_sessions").get().value,
    "original live value",
  );
  NodeAssert.deepEqual((await NodeFSP.readdir(alpha)).sort(), ["userdata"]);
});

NodeTest.test("refuses preexisting userdata even without a database", async (t) => {
  const { alpha, beta } = await fixture(t);
  await NodeFSP.mkdir(NodePath.join(beta, "userdata"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(beta, "userdata", "keep.txt"), "preserve");
  await NodeAssert.rejects(runImport(alpha, beta), /already has userdata/);
  NodeAssert.equal(
    await NodeFSP.readFile(NodePath.join(beta, "userdata", "keep.txt"), "utf8"),
    "preserve",
  );
});

for (const failure of ["settings", "attachments"]) {
  NodeTest.test(`${failure} failure leaves no partial Beta userdata or staging`, async (t) => {
    const { alpha, beta, userdata, db } = await fixture(t);
    if (failure === "settings") {
      await NodeFSP.writeFile(NodePath.join(userdata, "settings.json"), "invalid json");
    } else {
      const socket = NodeNet.createServer();
      socket.listen(NodePath.join(userdata, "attachments", "s"));
      await NodeEvents.once(socket, "listening");
      t.after(() => new Promise((resolve) => socket.close(resolve)));
    }
    await NodeAssert.rejects(runImport(alpha, beta));
    await assertNoPartialDestination(beta);
    NodeAssert.equal(
      db.prepare("SELECT value FROM auth_sessions").get().value,
      "original live value",
    );
    NodeAssert.equal(
      db.prepare("SELECT state FROM projection_turns WHERE id='turn1'").get().state,
      "running",
    );
  });
}
