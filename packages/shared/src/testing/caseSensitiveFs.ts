// @effect-diagnostics nodeBuiltinImport:off - one synchronous probe at module load, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * macOS and Windows temp directories fold case, so `App.png` and `app.png` are
 * one file there. Tests that need both spellings side by side should
 * `skipIf(!caseSensitiveTempDir)` rather than assert on a collapsed directory.
 */
export const caseSensitiveTempDir: boolean = (() => {
  let directory: string | undefined;
  try {
    directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-case-probe-"));
    NodeFS.writeFileSync(NodePath.join(directory, "Probe"), "");
    return !NodeFS.existsSync(NodePath.join(directory, "probe"));
  } catch {
    return false;
  } finally {
    try {
      if (directory !== undefined) NodeFS.rmSync(directory, { recursive: true, force: true });
    } catch {}
  }
})();
