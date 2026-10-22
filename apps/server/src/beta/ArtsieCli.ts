import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";

export class ArtsieCliError extends Schema.TaggedError<ArtsieCliError>()("ArtsieCliError", {
  reason: Schema.Literals(["invalid-command", "unavailable", "invalid-output", "outcome-unknown"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-command":
        return "Use an ARTsie app or workflow command; CLI installation, configuration and server commands are excluded.";
      case "unavailable":
        return "The local ARTsie CLI could not start. Run ARTsie's scripts/install_cli.py on this host.";
      case "invalid-output":
        return "The ARTsie CLI returned an invalid result. Inspect the editor before retrying.";
      case "outcome-unknown":
        return "The ARTsie CLI did not finish in time. Its action may have completed; inspect the editor or files before retrying.";
    }
  }
}

const COMMANDS = new Set([
  "status",
  "apps",
  "tools",
  "schema",
  "call",
  "search",
  "catalog",
  "files",
  "mkdir",
  "copy",
  "move",
  "import",
  "launch",
  "live",
  "photocraft",
  "vectorcraft",
  "filmcraft",
  "lightcraft",
  "pdfcraft",
  "effectcraft",
  "designcraft",
  "figcraft",
  "wordcraft",
  "soundcraft",
  "deckcraft",
  "cadcraft",
  "gridcraft",
]);
const CONFIG_FLAGS = new Set(["--mcp", "--update"]);

export class ArtsieCli extends Context.Service<
  ArtsieCli,
  {
    readonly run: (
      argv: ReadonlyArray<string>,
    ) => Effect.Effect<{ readonly exitCode: number; readonly result: unknown }, ArtsieCliError>;
  }
>()("t3/beta/ArtsieCli") {}

const decodeCliOutput = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  const command = yield* Config.String("FD_CODE_ARTSIE_CLI").pipe(
    Config.withDefault(path.join(NodeOS.homedir(), ".local/bin/artsie")),
  );
  const run = Effect.fn("artsie.cli.run")(function* (argv: ReadonlyArray<string>) {
    if (
      !COMMANDS.has(argv[0] ?? "") ||
      argv.some(
        (value) =>
          CONFIG_FLAGS.has(value.split("=")[0] ?? "") ||
          value.startsWith("--format") ||
          value === "--full-output",
      ) ||
      (argv[0] === "catalog" && argv[1] !== "refresh")
    ) {
      return yield* new ArtsieCliError({
        reason: "invalid-command",
        cause: new Error("Unsupported CLI command"),
      });
    }
    const output = yield* runner
      .run({
        command,
        args: [...argv, "--format", "json", "--full-output"],
        stdin: "",
        timeout: "170 seconds",
        maxOutputBytes: 8 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ArtsieCliError({
              reason: cause._tag === "ProcessSpawnError" ? "unavailable" : "outcome-unknown",
              cause,
            }),
        ),
      );
    const result = yield* decodeCliOutput(output.stdout).pipe(
      Effect.mapError((cause) => new ArtsieCliError({ reason: "invalid-output", cause })),
    );
    return { exitCode: Number(output.code ?? 1), result };
  });
  return ArtsieCli.of({ run });
});

export const layer = Layer.effect(ArtsieCli, make);
