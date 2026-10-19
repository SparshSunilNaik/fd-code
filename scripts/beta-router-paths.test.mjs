import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const compilerPath = resolve(
  dirname(requireWeb.resolve("@tanstack/router-plugin")),
  "../esm/core/code-splitter/compilers.js",
);
const { compileCodeSplitReferenceRoute } = await import(pathToFileURL(compilerPath));

for (const filename of [
  "/tmp/Heem's Brain/T3 Beta/routes/page.tsx",
  '/tmp/a"b/routes/page.tsx',
  "/tmp/brain-λ/routes/page.tsx",
]) {
  test(`route code splitting preserves ${JSON.stringify(filename)}`, () => {
    const result = compileCodeSplitReferenceRoute({
      code: "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/hello')({component:()=> <div>Hello</div>,loader:()=>42});",
      filename,
      targetFramework: "react",
      codeSplitGroupings: [["component"], ["loader"]],
      addHmr: false,
    });
    for (const kind of ["component", "loader"]) {
      assert.ok(result.code.includes(`import(${JSON.stringify(`${filename}?tsr-split=${kind}`)})`));
    }
  });
}
