#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeProcess from "node:process";
// Beta's beta_rag tool queries the brain graph with this fork's CLI at ~/.graphify-venv/bin/graphify.
const GRAPHIFY_FORK = "https://github.com/faheemdehalvi/graphify.git";
const GRAPHIFY_REF = "v0.9.92";
const { values } = NodeUtil.parseArgs({
  options: {
    python: { type: "string", default: "python3.11" },
    venv: { type: "string", default: NodePath.join(NodeOS.homedir(), ".graphify-venv") },
  },
});
const run = (command, args, options = {}) => {
  const result = NodeChildProcess.spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} exited with ${result.status}`);
};
const venv = NodePath.resolve(values.venv);
const bin = NodePath.join(venv, NodeProcess.platform === "win32" ? "Scripts" : "bin");
const python = NodePath.join(bin, NodeProcess.platform === "win32" ? "python.exe" : "python");
if (!NodeFS.existsSync(python)) run(values.python, ["-m", "venv", venv]);
// Installs only into this isolated environment. Never upgrades the system Python or other tooling.
const spec = `graphifyy @ git+${GRAPHIFY_FORK}@${GRAPHIFY_REF}`;
run(python, ["-m", "pip", "install", spec]);
// pip skips a same-version install from another source, so replace the package itself from the fork.
run(python, ["-m", "pip", "install", "--no-deps", "--force-reinstall", spec]);
run(NodePath.join(bin, "graphify"), ["--version"]);
console.log(
  `Graphify ${GRAPHIFY_REF} from ${GRAPHIFY_FORK} is ready. beta_rag uses it once the brain graph exists at ~/.faheems-brain/graph/brain-graph.json.`,
);
