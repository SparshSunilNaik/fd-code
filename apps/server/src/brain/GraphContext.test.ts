// @effect-diagnostics nodeBuiltinImport:off -- Isolated executable fixtures verify the native process boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@fdcode/shared/HostProcess";
import * as GraphContext from "./GraphContext.ts";

it.effect(
  "uses a local graph without shell expansion and distinguishes failure from no matches",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = yield* Effect.acquireRelease(
          Effect.sync(() =>
            NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "alpha-graphify-test-")),
          ),
          (home) => Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
        );
        const bin = NodePath.join(home, ".graphify-venv", "bin");
        NodeFS.mkdirSync(bin, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(bin, "graphify"),
          `#!/usr/bin/env node
const q = process.argv[3];
process.stdout.write(q);
process.exit(q === "ambiguous" ? 3 : q === "no-match" ? 4 : q === "error" ? 7 : 0);
`,
          { mode: 0o700 },
        );
        const graph = NodePath.join(home, "session.json");
        NodeFS.writeFileSync(graph, "{}");
        yield* Effect.gen(function* () {
          const service = yield* GraphContext.GraphContext;
          const query = `sunflower $(touch ${NodePath.join(home, "must-not-exist")})`;
          const ready = yield* service.query(query, graph);
          expect(ready).toEqual({ status: "ready", source: graph, text: query });
          expect(NodeFS.existsSync(NodePath.join(home, "must-not-exist"))).toBe(false);
          expect((yield* service.query("ambiguous", graph)).status).toBe("ambiguous");
          expect((yield* service.query("no-match", graph)).status).toBe("no-match");
          expect((yield* service.query("error", graph)).status).toBe("error");
          expect(
            (yield* service.query("sunflower", NodePath.join(home, "absent.json"))).status,
          ).toBe("unavailable");
        }).pipe(
          Effect.provide(
            GraphContext.layer.pipe(Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home))),
          ),
        );
      }),
    ),
);
