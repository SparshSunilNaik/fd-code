import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";

import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";

import { hydratePosixHome, resolveBaseDir } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it.effect("defaults server state to Beta and preserves explicit home overrides", () =>
  Effect.gen(function* () {
    assert.equal(yield* resolveBaseDir(undefined), `${NodeOS.homedir()}/.t3-beta`);
    assert.equal(yield* resolveBaseDir("  "), `${NodeOS.homedir()}/.t3-beta`);
    assert.equal(yield* resolveBaseDir(" /tmp/custom-beta "), "/tmp/custom-beta");
    assert.equal(yield* resolveBaseDir("~/custom-beta"), `${NodeOS.homedir()}/custom-beta`);
  }).pipe(Effect.provide(NodePath.layer)),
);
