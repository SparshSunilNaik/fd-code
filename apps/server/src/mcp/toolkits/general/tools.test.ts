import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import { GeneralChatToolkit } from "./tools.ts";

const decodeRoute = Schema.decodeUnknownSync(
  GeneralChatToolkit.tools.beta_route_request.parametersSchema,
);

it("exposes General chat parameters as MCP object schemas and accepts the empty request", () => {
  const decode = Schema.decodeUnknownSync(McpSchema.ToolJsonSchema);
  for (const tool of Object.values(GeneralChatToolkit.tools)) {
    expect(() => decode(Tool.getJsonSchema(tool))).not.toThrow();
  }
  expect(decodeRoute({})).toEqual({});
  expect(() => decodeRoute([])).toThrow();
});
