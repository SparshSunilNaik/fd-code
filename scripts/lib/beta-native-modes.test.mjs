import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { restoreUnpackedModes } from "./beta-native-modes.mjs";

const asar = createRequire(import.meta.url)("@electron/asar");

test("extracted PTY helpers can execute and ordinary native files retain their modes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beta-native-modes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceAsar = path.join(root, "app.asar");
  const extracted = path.join(root, "payload");
  const files = [
    "node_modules/node-pty/build/Release/spawn-helper",
    "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "node_modules/node-pty/build/Release/pty.node",
    "node_modules/other/tool",
  ];
  for (const relative of files) {
    for (const base of [sourceAsar + ".unpacked", extracted]) {
      const file = path.join(base, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "#!/bin/sh\nprintf PACKAGED_HELPER_OK\n");
      fs.chmodSync(file, 0o644);
    }
  }
  fs.chmodSync(path.join(sourceAsar + ".unpacked", files[3]), 0o750);
  assert.equal(spawnSync(path.join(extracted, files[0])).error?.code, "EACCES");
  restoreUnpackedModes(sourceAsar, extracted, files);
  for (const helper of files.slice(0, 2)) {
    const result = spawnSync(path.join(extracted, helper), [], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "PACKAGED_HELPER_OK");
  }
  assert.equal(fs.statSync(path.join(extracted, files[2])).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(extracted, files[3])).mode & 0o777, 0o750);
  const archive = path.join(root, "repacked.asar");
  await asar.createPackageWithOptions(extracted, archive, { unpackDir: "node_modules" });
  for (const helper of files.slice(0, 2)) {
    const result = spawnSync(path.join(archive + ".unpacked", helper), [], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "PACKAGED_HELPER_OK");
  }
});
