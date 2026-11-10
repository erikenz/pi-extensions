import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import {
  addBlockedPattern,
  configPath,
  DEFAULT_MODAL_KEYS,
  DEFAULT_SHORTCUTS,
  isModelBlocked,
  loadConfig,
  matchesBlockPattern,
  modelKey,
  normalizeKeyList,
  removeBlockedPattern,
  resolveModalKeys,
  resolveShortcuts,
  saveConfig,
} from "../src/config.ts";

void test("modelKey formats provider and id correctly", () => {
  const mockModel = {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
  };
  assert.equal(modelKey(mockModel), "anthropic/claude-sonnet-4-5");
});

void test("configPath points to model-switch.json", () => {
  assert.match(configPath(), /model-switch\.json$/u);
});

void test("normalizeKeyList handles fallbacks, strings, arrays, and disabled states", () => {
  const fallback = ["default1", "default2"];

  // Undefined uses fallback
  assert.deepEqual(normalizeKeyList(undefined, fallback), [
    "default1",
    "default2",
  ]);

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

void test("resolveShortcuts applies defaults and respects overrides / disabling", () => {
  // Empty config -> default shortcuts
  const resolvedDefault = resolveShortcuts(undefined);
  assert.deepEqual(resolvedDefault, DEFAULT_SHORTCUTS);

  // Partial override
  // cycleNext explicitly disabled
  const custom = resolveShortcuts({
    cycleNext: null,
    cyclePrev: ["ctrl+alt+k", "ctrl+alt+shift+p"],
    open: "ctrl+l",
  });

  assert.deepEqual(custom.open, ["ctrl+l"]);
  assert.deepEqual(custom.cycleNext, []);
  assert.deepEqual(custom.cyclePrev, ["ctrl+alt+k", "ctrl+alt+shift+p"]);
  assert.deepEqual(custom.thinkingNext, DEFAULT_SHORTCUTS.thinkingNext);
  assert.deepEqual(custom.thinkingPrev, DEFAULT_SHORTCUTS.thinkingPrev);
});

void test("resolveModalKeys applies defaults and respects overrides", () => {
  // Empty config -> default modal keys
  const resolvedDefault = resolveModalKeys(undefined);
  assert.deepEqual(resolvedDefault, DEFAULT_MODAL_KEYS);

  // Custom modal keys
  const custom = resolveModalKeys({
    cancel: "x",
    down: ["e", "down"],
    select: ["space"],
    up: ["u", "up"],
  });

  assert.deepEqual(custom.up, ["u", "U", "up"]);
  assert.deepEqual(custom.down, ["e", "E", "down"]);
  assert.deepEqual(custom.select, ["space"]);
  assert.deepEqual(custom.cancel, ["x", "X"]);
  assert.deepEqual(custom.thinking, DEFAULT_MODAL_KEYS.thinking);
  assert.deepEqual(custom.block, DEFAULT_MODAL_KEYS.block);
});

void test("matchesBlockPattern supports exact keys, model ids, and wildcards", () => {
  const model = { id: "gpt-4o", provider: "openai" };

  // Exact provider/id
  assert.equal(matchesBlockPattern("openai/gpt-4o", model), true);
  assert.equal(matchesBlockPattern("OPENAI/GPT-4O", model), true);
  assert.equal(matchesBlockPattern("anthropic/claude", model), false);

  // Exact bare id
  assert.equal(matchesBlockPattern("gpt-4o", model), true);
  assert.equal(matchesBlockPattern("gpt-4", model), false);

  // Wildcards
  assert.equal(matchesBlockPattern("openai/*", model), true);
  assert.equal(matchesBlockPattern("ollama/*", model), false);
  assert.equal(matchesBlockPattern("*gpt*", model), true);
  assert.equal(matchesBlockPattern("*-4o", model), true);
  assert.equal(matchesBlockPattern("openai/?pt-4o", model), true);
  assert.equal(matchesBlockPattern("", model), false);
});

void test("isModelBlocked returns true if model matches any blocklist pattern", () => {
  const model = { id: "llama-3.1", provider: "ollama" };

  assert.equal(isModelBlocked(model, []), false);
  assert.equal(isModelBlocked(model, undefined), false);
  assert.equal(isModelBlocked(model, ["openai/*", "anthropic/*"]), false);
  assert.equal(isModelBlocked(model, ["openai/*", "ollama/*"]), true);
  assert.equal(isModelBlocked(model, ["*llama*"]), true);
});

void test("addBlockedPattern and removeBlockedPattern manage blocked list in config", () => {
  // Empty string handling
  assert.equal(addBlockedPattern(""), false);
  assert.equal(removeBlockedPattern(""), false);

  const p = configPath();
  const backup = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;

  try {
    const testPattern = "test-provider/test-block-pattern";

    // Ensure clean state
    removeBlockedPattern(testPattern);

    // Add pattern
    assert.equal(addBlockedPattern(testPattern), true);
    assert.equal(loadConfig().blocked.includes(testPattern), true);

    // Adding duplicate returns false
    assert.equal(addBlockedPattern(testPattern), false);

    // Remove pattern
    assert.equal(removeBlockedPattern(testPattern), true);
    assert.equal(loadConfig().blocked.includes(testPattern), false);

    // Removing non-existent returns false
    assert.equal(removeBlockedPattern(testPattern), false);
  } finally {
    if (backup !== null) {
      fs.writeFileSync(p, backup, "utf-8");
    } else if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
});

void test("loadConfig extracts disabled models from models dictionary format", () => {
  const p = configPath();
  const backup = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;

  try {
    const initial = loadConfig();

    // Save config with models object containing disabled: true
    saveConfig({
      ...initial,
      blocked: ["existing-blocked"],
      models: {
        "disabled-model-1": { disabled: true },
        "disabled-model-2": { disabled: true },
        "enabled-model": { disabled: false },
      },
    });

    const loaded = loadConfig();
    assert.equal(loaded.blocked.includes("existing-blocked"), true);
    assert.equal(loaded.blocked.includes("disabled-model-1"), true);
    assert.equal(loaded.blocked.includes("disabled-model-2"), true);
    assert.equal(loaded.blocked.includes("enabled-model"), false);
  } finally {
    if (backup !== null) {
      fs.writeFileSync(p, backup, "utf-8");
    } else if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
});
