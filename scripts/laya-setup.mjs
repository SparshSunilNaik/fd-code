#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeProcess from "node:process";
const { values } = NodeUtil.parseArgs({
  options: {
    python: { type: "string", default: "python3.11" },
    "home-dir": { type: "string", default: NodePath.join(NodeOS.homedir(), ".fd-code") },
  },
});
const directory = NodePath.resolve(values["home-dir"], "laya");
NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
const run = (command, args, options = {}) => {
  const result = NodeChildProcess.spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} exited with ${result.status}`);
};
const venv = NodePath.join(directory, "venv");
const python = NodePath.join(
  venv,
  NodeProcess.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!NodeFS.existsSync(python)) run(values.python, ["-m", "venv", venv]);
// Installs only this feature's isolated runtime. Never upgrades the system Python or other tooling.
run(python, ["-m", "pip", "install", "laya[serve]==0.4.11"]);
const tokenPath = NodePath.join(directory, "token");
if (!NodeFS.existsSync(tokenPath))
  NodeFS.writeFileSync(tokenPath, NodeCrypto.randomBytes(32).toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
run(python, [
  "-I",
  "-c",
  `import os, sys
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HOME"] = sys.argv[1]
import json, torch, laya
from laya import Router
torch.set_num_threads(2)
r = Router(device="cpu", max_loaded=1).predict("Find current weather on the web", {"route": {"type": "choice", "instructions": "Which destination fits?", "criteria": {"general": "general conversation", "web": "current information from websites"}}}, model="multilingual", max_len=2048)
print(json.dumps({"laya_version": laya.__version__, "smoke_result": r}, ensure_ascii=False))`,
  NodePath.join(directory, "cache"),
]);
console.log(
  "Local Laya is ready. FD CODE starts its authenticated, loopback-only service when General chat is opened in the updated app.",
);
