#!/usr/bin/env node
// Reuse a matching installed runtime; write a separate locally signed Beta artifact.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { restoreUnpackedModes } from "./lib/beta-native-modes.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    "source-app": { type: "string", default: "/Applications/T3 Code (Alpha).app" },
    "output-root": {
      type: "string",
      default: "/Applications",
    },
    "replace-owned": { type: "boolean", default: false },
  },
});
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("This packaging route requires macOS arm64.");
const sourceApp = fs.realpathSync(values["source-app"]);
const outputDir = path.resolve(values["output-root"]);
const targetApp = path.join(outputDir, "Beta.app");
const replacing = fs.existsSync(targetApp);
if (replacing && !values["replace-owned"])
  throw new Error(
    `Refusing to overwrite ${targetApp}. Stop Beta and pass --replace-owned, or choose a new --output-root.`,
  );
if (outputDir === sourceApp || outputDir.startsWith(sourceApp + path.sep))
  throw new Error("Output cannot be inside the source app.");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.error}`);
  return result.stdout;
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (filename) => sha(fs.readFileSync(filename));
const readPlist = (filename) =>
  JSON.parse(
    run("/usr/bin/python3", [
      "-c",
      "import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))",
      filename,
    ]),
  );
const writePlist = (filename, value) =>
  run(
    "/usr/bin/python3",
    [
      "-c",
      "import plistlib,json,sys; plistlib.dump(json.load(sys.stdin),open(sys.argv[1],'wb'),fmt=plistlib.FMT_XML)",
      filename,
    ],
    { input: JSON.stringify(value) },
  );
if (replacing) {
  const prior = JSON.parse(
    fs.readFileSync(path.join(outputDir, "Beta.build-provenance.json"), "utf8"),
  );
  const info = readPlist(path.join(targetApp, "Contents/Info.plist"));
  if (
    prior.format !== "t3-beta-local-build/v1" ||
    prior.output.appId !== "com.faheem.t3beta" ||
    info.CFBundleIdentifier !== "com.faheem.t3beta" ||
    fileHash(path.join(targetApp, "Contents/Resources/app.asar")) !== prior.output.asarSha256
  ) {
    throw new Error(
      "Existing output is not an intact artifact owned by this packager; refusing to replace it.",
    );
  }
  const running = run("/bin/ps", ["-axo", "command="])
    .split("\n")
    .some(
      (line) =>
        line.includes(path.join(targetApp, "Contents/MacOS/Beta")) ||
        line.includes(path.join(targetApp, "Contents/Frameworks/Beta Helper")),
    );
  if (running)
    throw new Error(
      "Beta is still running from this output. Close its app and backend before repackaging.",
    );
}
const sourceAsar = path.join(sourceApp, "Contents/Resources/app.asar");
const sourcePackage = JSON.parse(asar.extractFile(sourceAsar, "package.json").toString());
const sourceInfo = readPlist(path.join(sourceApp, "Contents/Info.plist"));
const sourceHeader = asar.getRawHeader(sourceAsar);
const commit = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).trim();
const runtimeCommit = sourcePackage.t3codeCommitHash;
if (typeof runtimeCommit !== "string" || !/^[a-f0-9]{7,40}$/.test(runtimeCommit))
  throw new Error("Installed runtime has no valid source commit.");
// Local Beta commits extend the installed baseline. Native packages and the
// Electron version are independently checked below before reusing that runtime.
run("git", ["merge-base", "--is-ancestor", runtimeCommit, commit], { cwd: repoRoot });
if (
  sourceInfo.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash !== sha(sourceHeader.headerString)
)
  throw new Error("Original ASAR header integrity does not match its bundle metadata.");
const electronVersion = readPlist(
  path.join(sourceApp, "Contents/Frameworks/Electron Framework.framework/Resources/Info.plist"),
).CFBundleVersion;
const desktopManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "apps/desktop/package.json"), "utf8"),
);
if (electronVersion !== desktopManifest.dependencies.electron)
  throw new Error("Installed and pinned Electron versions differ.");
for (const relative of [
  "apps/server/dist/bin.mjs",
  "apps/web/dist/index.html",
  "apps/desktop/dist-electron/main.cjs",
  "apps/desktop/dist-electron/preload.cjs",
]) {
  if (!fs.statSync(path.join(repoRoot, relative)).isFile())
    throw new Error(`Missing built artifact ${relative}`);
}
const unpackedRoots = [];
const unpackedFiles = [];
const originalFiles = [];
function walkHeader(node, prefix = "") {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (value.files) {
      if (value.unpacked && !node.unpacked) unpackedRoots.push(relative);
      walkHeader(value, relative);
    } else if (!value.link) {
      originalFiles.push(relative);
      if (value.unpacked) unpackedFiles.push(relative);
    }
  }
}
walkHeader(sourceHeader.header);
const externalHashes = Object.fromEntries(
  originalFiles
    .filter((file) => file.startsWith("node_modules/"))
    .map((file) => [file, sha(asar.extractFile(sourceAsar, file))]),
);
const nativeResourceHashes = Object.fromEntries(
  unpackedFiles.map((file) => [
    file,
    externalHashes[file] ?? sha(asar.extractFile(sourceAsar, file)),
  ]),
);
const sourceAsarSha256 = fileHash(sourceAsar);
const trackedDiffSha256 = sha(run("git", ["diff", "HEAD", "--binary"], { cwd: repoRoot }));
const version = `${sourcePackage.version.replace(/-.*/, "")}-beta.2`;
fs.mkdirSync(outputDir, { recursive: true });
const stage = fs.mkdtempSync(path.join(outputDir, ".beta-package-stage-"));
const copiedApp = path.join(stage, "Beta.app");
const extracted = path.join(stage, "payload");
console.log("Copying the matching installed runtime into a new staging directory...");
run("/usr/bin/ditto", [sourceApp, copiedApp]);
asar.extractAll(sourceAsar, extracted);
restoreUnpackedModes(sourceAsar, extracted, unpackedFiles);
const buildInputs = {};
function walkFiles(root, prefix = "") {
  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, relative);
    else if (entry.isFile()) buildInputs[relative] = fileHash(absolute);
  }
}
for (const relative of ["apps/server/dist", "apps/desktop/dist-electron"]) {
  const destination = path.join(extracted, relative);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, relative), destination, {
    recursive: true,
    preserveTimestamps: true,
    // Finder conflict copies are not build outputs. Leave them in the checkout;
    // copying their cloud placeholders can block packaging indefinitely.
    filter: (source) => {
      if (relative !== "apps/desktop/dist-electron") return true;
      const name = path.basename(source);
      if (name.endsWith(".map")) return false;
      const canonical = name.replace(/ \d+(?=\.cjs$)/, "");
      return canonical === name || !fs.existsSync(path.join(path.dirname(source), canonical));
    },
  });
  if (relative === "apps/server/dist") {
    // A frontend-only rebuild does not refresh the server bundle's client copy.
    // Assemble the shipped tree from the current web output at this owning boundary.
    fs.rmSync(path.join(destination, "client"), { recursive: true, force: true });
    fs.cpSync(path.join(repoRoot, "apps/web/dist"), path.join(destination, "client"), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  const previous = Object.keys(buildInputs);
  walkFiles(destination, relative);
  if (Object.keys(buildInputs).length === previous.length)
    throw new Error(`Empty built tree ${relative}`);
}
const betaPackage = {
  ...sourcePackage,
  name: "t3-beta",
  productName: "Beta",
  version,
  buildVersion: version,
  description: "Beta local IDE build",
  t3codeCommitHash: commit,
  t3betaBuild: {
    baseCommit: commit,
    trackedDiffSha256,
    packagedAt: new Date().toISOString(),
    runtimeSourceVersion: sourcePackage.version,
  },
};
fs.writeFileSync(path.join(extracted, "package.json"), JSON.stringify(betaPackage, null, 2) + "\n");
console.log("Packing new desktop, server and client artifacts while retaining native packages...");
const newAsar = path.join(stage, "app.asar");
await asar.createPackageWithOptions(extracted, newAsar, {
  unpackDir: `{${unpackedRoots.join(",")}}`,
});
const newHeader = asar.getRawHeader(newAsar);
for (const [relative, expected] of Object.entries(externalHashes)) {
  if (sha(asar.extractFile(newAsar, relative)) !== expected)
    throw new Error(`External package changed: ${relative}`);
}
const newUnpacked = [];
function collectUnpacked(node, prefix = "") {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (value.files) collectUnpacked(value, relative);
    else if (value.unpacked) newUnpacked.push(relative);
  }
}
collectUnpacked(newHeader.header);
if (JSON.stringify(newUnpacked.sort()) !== JSON.stringify(unpackedFiles.sort()))
  throw new Error("The native unpacked file set changed.");
for (const [relative, expected] of Object.entries(buildInputs)) {
  if (sha(asar.extractFile(newAsar, relative)) !== expected)
    throw new Error(`Built artifact changed during packaging: ${relative}`);
}
const resources = path.join(copiedApp, "Contents/Resources");
fs.rmSync(path.join(resources, "app.asar.unpacked"), { recursive: true, force: true });
fs.renameSync(newAsar, path.join(resources, "app.asar"));
fs.renameSync(newAsar + ".unpacked", path.join(resources, "app.asar.unpacked"));
const appInfoPath = path.join(copiedApp, "Contents/Info.plist");
const appInfo = readPlist(appInfoPath);
const oldExecutable = appInfo.CFBundleExecutable;
fs.renameSync(
  path.join(copiedApp, "Contents/MacOS", oldExecutable),
  path.join(copiedApp, "Contents/MacOS/Beta"),
);
Object.assign(appInfo, {
  CFBundleName: "Beta",
  CFBundleDisplayName: "Beta",
  CFBundleExecutable: "Beta",
  CFBundleIdentifier: "com.faheem.t3beta",
  CFBundleShortVersionString: sourcePackage.version.replace(/-.*/, ""),
  CFBundleVersion: "42.2",
  CFBundleURLTypes: [
    {
      CFBundleTypeRole: "Editor",
      CFBundleURLName: "Beta",
      CFBundleURLSchemes: ["t3beta", "t3beta-dev"],
    },
  ],
  ElectronAsarIntegrity: {
    "Resources/app.asar": { algorithm: "SHA256", hash: sha(newHeader.headerString) },
  },
});
delete appInfo.ElectronTeamID;
writePlist(appInfoPath, appInfo);
const entitlements = {
  "com.apple.security.cs.allow-jit": true,
  "com.apple.security.cs.allow-unsigned-executable-memory": true,
  "com.apple.security.cs.disable-library-validation": true,
};
const entitlementsPath = path.join(stage, "beta-entitlements.plist");
writePlist(entitlementsPath, entitlements);
const helperApps = [];
const frameworks = path.join(copiedApp, "Contents/Frameworks");
for (const entry of fs.readdirSync(frameworks).filter((name) => name.endsWith(".app"))) {
  const helper = path.join(frameworks, entry);
  const infoPath = path.join(helper, "Contents/Info.plist");
  const info = readPlist(infoPath);
  const suffix = info.CFBundleExecutable.slice(oldExecutable.length);
  if (!suffix.startsWith(" Helper")) throw new Error(`Unexpected helper name ${entry}`);
  const name = `Beta${suffix}`;
  fs.renameSync(
    path.join(helper, "Contents/MacOS", info.CFBundleExecutable),
    path.join(helper, "Contents/MacOS", name),
  );
  Object.assign(info, {
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleExecutable: name,
    CFBundleIdentifier: `com.faheem.t3beta.helper${suffix.includes("(") ? "." + suffix.match(/\(([^)]+)\)/)[1].toLowerCase() : ""}`,
  });
  delete info.ElectronTeamID;
  writePlist(infoPath, info);
  const renamed = path.join(frameworks, `${name}.app`);
  fs.renameSync(helper, renamed);
  helperApps.push(renamed);
}
// Finder metadata invalidates a local signature. Remove only these two attributes on the NEW copy.
for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
  const result = spawnSync("/usr/bin/xattr", ["-dr", attribute, copiedApp], { encoding: "utf8" });
  if (result.status !== 0 && !/No such xattr/.test(result.stderr))
    throw new Error(`Failed to clear copied ${attribute}: ${result.stderr}`);
}
console.log(
  "Signing renamed helpers and the new app identity; original frameworks remain unchanged...",
);
for (const helper of helperApps)
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    entitlementsPath,
    helper,
  ]);
run("/usr/bin/codesign", [
  "--force",
  "--sign",
  "-",
  "--options",
  "runtime",
  "--entitlements",
  entitlementsPath,
  copiedApp,
]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", copiedApp]);
for (const [relative, expected] of Object.entries(nativeResourceHashes)) {
  if (fileHash(path.join(resources, "app.asar.unpacked", relative)) !== expected)
    throw new Error(`Native resource changed: ${relative}`);
}
if (fileHash(sourceAsar) !== sourceAsarSha256)
  throw new Error("Original ASAR changed unexpectedly.");
const resourceMonitor = "Contents/Resources/resource-monitor/t3-resource-monitor";
if (
  fileHash(path.join(sourceApp, resourceMonitor)) !==
  fileHash(path.join(copiedApp, resourceMonitor))
)
  throw new Error("Resource monitor bytes changed.");
const provenance = {
  format: "t3-beta-local-build/v1",
  builtAt: new Date().toISOString(),
  version,
  source: {
    commit,
    workingTreeDirty: run("git", ["status", "--porcelain"], { cwd: repoRoot }).trim().length > 0,
    trackedDiffSha256,
  },
  runtime: {
    sourceAppName: path.basename(sourceApp),
    sourceVersion: sourcePackage.version,
    electronVersion,
    originalAsarSha256: sourceAsarSha256,
    originalAsarHeaderSha256: sha(sourceHeader.headerString),
    retainedExternalFiles: Object.keys(externalHashes).length,
    retainedUnpackedFiles: unpackedFiles.length,
    unpackedRoots,
    nativeResourceHashes,
    resourceMonitorSha256: fileHash(path.join(copiedApp, resourceMonitor)),
  },
  output: {
    appName: "Beta.app",
    appId: appInfo.CFBundleIdentifier,
    asarSha256: fileHash(path.join(resources, "app.asar")),
    asarHeaderSha256: sha(newHeader.headerString),
    localAdHocSignatureVerified: true,
  },
  buildInputs,
  packagingScriptSha256: fileHash(fileURLToPath(import.meta.url)),
  signingNote:
    "Local ad-hoc signature. Original vendor team, application-identity and associated-domain entitlements are not claimed. Original frameworks and native runtime package bytes retained; changed main/helpers signed locally.",
};
if (replacing) {
  const backup = fs.mkdtempSync(path.join(outputDir, ".Beta-build-backup-"));
  for (const entry of ["Beta.app", "Beta.build-provenance.json", "Beta.README.txt"]) {
    const previous = path.join(outputDir, entry);
    if (fs.existsSync(previous)) fs.renameSync(previous, path.join(backup, entry));
  }
  console.log(`Previous owned Beta artifact preserved at ${backup}`);
}
fs.renameSync(copiedApp, targetApp);
// Desktop FileProvider can attach FinderInfo when a bundle is moved. Verify the final location,
// so a successful staging signature can never be reported as a verified deliverable by mistake.
for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
  const result = spawnSync("/usr/bin/xattr", ["-dr", attribute, targetApp], { encoding: "utf8" });
  if (result.status !== 0 && !/No such xattr/.test(result.stderr))
    throw new Error(`Failed to clear final ${attribute}: ${result.stderr}`);
}
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", targetApp]);
provenance.output.bundleIdentityFiles = Object.fromEntries(
  [
    "Contents/Info.plist",
    "Contents/MacOS/Beta",
    ...helperApps.flatMap((helper) => {
      const relative = path.relative(copiedApp, helper);
      const name = path.basename(helper, ".app");
      return [
        path.join(relative, "Contents/Info.plist"),
        path.join(relative, "Contents/MacOS", name),
      ];
    }),
  ].map((relative) => [relative, fileHash(path.join(targetApp, relative))]),
);
fs.writeFileSync(
  path.join(outputDir, "Beta.build-provenance.json"),
  JSON.stringify(provenance, null, 2) + "\n",
  { flag: "wx" },
);
fs.writeFileSync(
  path.join(outputDir, "Beta.README.txt"),
  `Beta ${version}\n\nOpen Beta.app to run the separate local IDE.\nState: ~/.t3-beta (separate from Alpha).\nThis app is locally ad-hoc signed, not an upstream notarized release.\nNative runtime packages and licenses are retained from matching Alpha commit ${commit}.\nSee Beta.build-provenance.json for artifact hashes and verification.\n`,
  { flag: "wx" },
);
fs.rmSync(stage, { recursive: true });
console.log(
  JSON.stringify({
    app: targetApp,
    provenance: path.join(outputDir, "Beta.build-provenance.json"),
    verified: true,
    nativeFilesRetained: unpackedFiles.length,
  }),
);
