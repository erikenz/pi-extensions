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

test("normalizeKeyList handles fallbacks, strings, arrays, and disabled states", async () => {
  const { normalizeKeyList } = await import("../src/config.ts");
  const fallback = ["default1", "default2"];

  // Undefined uses fallback
  assert.deepEqual(normalizeKeyList(undefined, fallback), ["default1", "default2"]);

  // Null, false, empty string disable keybinding
  assert.deepEqual(normalizeKeyList(null, fallback), []);
  assert.deepEqual(normalizeKeyList(false, fallback), []);
  assert.deepEqual(normalizeKeyList("", fallback), []);

  // Single string
  assert.deepEqual(normalizeKeyList("alt+m", fallback), ["alt+m"]);

  // Array of strings
  assert.deepEqual(normalizeKeyList(["alt+m", "ctrl+shift+m"], fallback), [
    "alt+m",
    "ctrl+shift+m",
  ]);
});

test("resolveShortcuts applies defaults and respects overrides / disabling", async () => {
  const { resolveShortcuts, DEFAULT_SHORTCUTS } = await import("../src/config.ts");

  // Empty config -> default shortcuts
  const resolvedDefault = resolveShortcuts(undefined);
  assert.deepEqual(resolvedDefault, DEFAULT_SHORTCUTS);

  // Partial override
  const custom = resolveShortcuts({
    open: "ctrl+l",
    cycleNext: null, // explicitly disabled
    cyclePrev: ["ctrl+alt+k", "ctrl+alt+shift+p"],
  });

  assert.deepEqual(custom.open, ["ctrl+l"]);
  assert.deepEqual(custom.cycleNext, []);
  assert.deepEqual(custom.cyclePrev, ["ctrl+alt+k", "ctrl+alt+shift+p"]);
  assert.deepEqual(custom.thinkingNext, DEFAULT_SHORTCUTS.thinkingNext);
  assert.deepEqual(custom.thinkingPrev, DEFAULT_SHORTCUTS.thinkingPrev);
});

test("resolveModalKeys applies defaults and respects overrides", async () => {
  const { resolveModalKeys, DEFAULT_MODAL_KEYS } = await import("../src/config.ts");

  // Empty config -> default modal keys
  const resolvedDefault = resolveModalKeys(undefined);
  assert.deepEqual(resolvedDefault, DEFAULT_MODAL_KEYS);

  // Custom modal keys
  const custom = resolveModalKeys({
    up: ["u", "up"],
    down: ["e", "down"],
    select: ["space"],
    cancel: "x",
  });

  assert.deepEqual(custom.up, ["u", "U", "up"]);
  assert.deepEqual(custom.down, ["e", "E", "down"]);
  assert.deepEqual(custom.select, ["space"]);
  assert.deepEqual(custom.cancel, ["x", "X"]);
  assert.deepEqual(custom.thinking, DEFAULT_MODAL_KEYS.thinking);
});
