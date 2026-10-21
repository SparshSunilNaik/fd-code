import * as fs from "node:fs";
import * as path from "node:path";

// ASAR extraction preserves bytes but loses executable modes on extensionless helpers.
export function restoreUnpackedModes(sourceAsar, extracted, unpackedFiles) {
  for (const relative of unpackedFiles) {
    const source = path.join(sourceAsar + ".unpacked", relative);
    const destination = path.join(extracted, relative);
    const mode = fs.statSync(source).mode & 0o777;
    const isPtyHelper =
      relative.startsWith("node_modules/node-pty/") && path.basename(relative) === "spawn-helper";
    fs.chmodSync(destination, isPtyHelper ? mode | 0o111 : mode);
  }
}
