import assert from "node:assert/strict";
import { test } from "node:test";
import { modelKey } from "../src/config.ts";

test("modelKey formats provider and id correctly", () => {
  const mockModel: any = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" };
  assert.equal(modelKey(mockModel), "anthropic/claude-sonnet-4-5");
});

test("configPath points to model-switch.json", async () => {
  const { configPath } = await import("../src/config.ts");
  assert.match(configPath(), /model-switch\.json$/);
});
