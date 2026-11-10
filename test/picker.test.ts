import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import {
  buildRows,
  clampScroll,
  lastSelectable,
  resolvePickerAction,
  resolveThinkingAction,
  sortModels,
  windowSlice,
} from "../src/picker.ts";
import type { Row } from "../src/types.ts";

const createMockModel = (
  id: string,
  name: string,
  provider: string,
  reasoning = false
): Model<Api> => ({
  api: "openai-completions",
  baseUrl: "https://example.com",
  contextWindow: 128_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  maxTokens: 4096,
  name,
  provider,
  reasoning,
});

void describe("sortModels", () => {
  void it("sorts models primarily by provider and secondarily by name", () => {
    const models: Model<Api>[] = [
      createMockModel("gpt-4", "gpt-4", "openai"),
      createMockModel("claude-sonnet", "claude-sonnet", "anthropic"),
      createMockModel("claude-haiku", "claude-haiku", "anthropic"),
    ];
    const sorted = sortModels(models);
    assert.deepEqual(
      sorted.map((m) => `${m.provider}/${m.name}`),
      ["anthropic/claude-haiku", "anthropic/claude-sonnet", "openai/gpt-4"]
    );
  });
});

void describe("buildRows", () => {
  void it("places favorites above divider and remaining below", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-5", "GPT-5", "openai");
    const m3 = createMockModel("gemini", "Gemini", "google");

    const favSet = new Set(["openai/gpt-5"]);
    const hiddenSet = new Set<string>();

    const rows = buildRows([m1, m2, m3], favSet, hiddenSet, false);

    // 1 fav + 1 divider + 2 others
    assert.equal(rows.length, 4);
    assert.equal(rows[0].kind, "model");
    if (rows[0].kind === "model") {
      assert.equal(rows[0].model.id, "gpt-5");
    }

    assert.equal(rows[1].kind, "divider");

    assert.equal(rows[2].kind, "model");
    assert.equal(rows[3].kind, "model");
  });

  void it("handles hidden models properly when collapsed vs revealed", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-5", "GPT-5", "openai");

    const favSet = new Set<string>();
    const hiddenSet = new Set(["openai/gpt-5"]);

    // Collapsed
    const rowsCollapsed = buildRows([m1, m2], favSet, hiddenSet, false);
    assert.equal(rowsCollapsed.length, 1);
    if (rowsCollapsed[0].kind === "model") {
      assert.equal(rowsCollapsed[0].model.id, "sonnet");
    }

    // Revealed
    const rowsRevealed = buildRows([m1, m2], favSet, hiddenSet, true);
    // 1 normal + 1 header + 1 hidden
    assert.equal(rowsRevealed.length, 3);
    assert.equal(rowsRevealed[1].kind, "header");
  });

  void it("filters out blocked models completely", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-4", "GPT-4", "openai");
    const m3 = createMockModel("llama3", "Llama 3", "ollama");

    const favSet = new Set(["openai/gpt-4"]);
    const hiddenSet = new Set<string>();

    // Block openai/* and llama3
    const rows = buildRows([m1, m2, m3], favSet, hiddenSet, true, [
      "openai/*",
      "llama3",
    ]);
    assert.equal(rows.length, 1);
    if (rows[0].kind === "model") {
      assert.equal(rows[0].model.id, "sonnet");
    }
  });
});

void describe("windowSlice and clampScroll", () => {
  void it("computes slice with moreBelow indicator", () => {
    const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({
      kind: "model",
      model: createMockModel(`m${i}`, `Model ${i}`, "test"),
    }));

    const slice = windowSlice(rows, 0, rows.length, 0, 10);
    assert.equal(slice.start, 0);
    assert.equal(slice.end, 10);
    assert.equal(slice.moreAbove, false);
    assert.equal(slice.moreBelow, true);
  });

  void it("clamps scroll accurately", () => {
    const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({
      kind: "model",
      model: createMockModel(`m${i}`, `Model ${i}`, "test"),
    }));

    assert.equal(clampScroll(rows, 0, rows.length, 20, 10), 5);
    assert.equal(clampScroll(rows, 0, rows.length, -5, 10), 0);
    assert.equal(clampScroll(rows, 0, rows.length, 3, 10), 3);
  });
});

void describe("lastSelectable", () => {
  void it("finds the last model row index", () => {
    const rows: Row[] = [
      { kind: "model", model: createMockModel("1", "1", "a") },
      { kind: "divider" },
      { kind: "model", model: createMockModel("2", "2", "b") },
      { kind: "header", label: "Hidden" },
    ];
    assert.equal(lastSelectable(rows), 2);
  });
});

void describe("resolvePickerAction", () => {
  void it("supports vim j/k and arrow navigation when not filtering", () => {
    assert.deepEqual(resolvePickerAction("j", false), {
      delta: 1,
      type: "move",
    });
    assert.deepEqual(resolvePickerAction("J", false), {
      delta: 1,
      type: "move",
    });
    // down arrow
    assert.deepEqual(resolvePickerAction("\u001B[B", false), {
      delta: 1,
      type: "move",
    });

    assert.deepEqual(resolvePickerAction("k", false), {
      delta: -1,
      type: "move",
    });
    assert.deepEqual(resolvePickerAction("K", false), {
      delta: -1,
      type: "move",
    });
    // up arrow
    assert.deepEqual(resolvePickerAction("\u001B[A", false), {
      delta: -1,
      type: "move",
    });
  });

  void it("supports vim g/G for jump to first and last", () => {
    assert.deepEqual(resolvePickerAction("g", false), { type: "jump_first" });
    assert.deepEqual(resolvePickerAction("G", false), { type: "jump_last" });
  });

  void it("supports model action hotkeys and vim quit", () => {
    assert.deepEqual(resolvePickerAction("t", false), {
      type: "open_thinking",
    });
    assert.deepEqual(resolvePickerAction("T", false), {
      type: "open_thinking",
    });
    assert.deepEqual(resolvePickerAction("e", false), {
      type: "open_thinking",
    });

    assert.deepEqual(resolvePickerAction("f", false), { type: "toggle_fav" });
    assert.deepEqual(resolvePickerAction("d", false), {
      type: "toggle_default",
    });
    assert.deepEqual(resolvePickerAction("D", false), {
      type: "toggle_default",
    });
    assert.deepEqual(resolvePickerAction("h", false), { type: "toggle_hide" });
    assert.deepEqual(resolvePickerAction("v", false), {
      type: "toggle_show_hidden",
    });
    assert.deepEqual(resolvePickerAction("b", false), { type: "toggle_block" });
    assert.deepEqual(resolvePickerAction("B", false), { type: "toggle_block" });
    assert.deepEqual(resolvePickerAction("/", false), { type: "start_filter" });
    assert.deepEqual(resolvePickerAction("\r", false), { type: "select" });
    assert.deepEqual(resolvePickerAction("q", false), { type: "cancel" });
    assert.deepEqual(resolvePickerAction("\u001B", false), { type: "cancel" });
  });

  void it("handles filtering mode correctly without triggering vim navigation", () => {
    // In filter mode, 'j' and 'k' should be typed as characters, not navigation
    assert.deepEqual(resolvePickerAction("j", true), {
      char: "j",
      type: "filter_char",
    });
    assert.deepEqual(resolvePickerAction("k", true), {
      char: "k",
      type: "filter_char",
    });
    assert.deepEqual(resolvePickerAction("\u001B", true), {
      type: "filter_cancel",
    });
    assert.deepEqual(resolvePickerAction("\r", true), { type: "filter_apply" });
    assert.deepEqual(resolvePickerAction("\u007F", true), {
      type: "filter_backspace",
    });
  });
});

void describe("resolveThinkingAction", () => {
  void it("supports vim j/k and arrow navigation for thinking levels", () => {
    assert.deepEqual(resolveThinkingAction("j"), { delta: 1, type: "move" });
    assert.deepEqual(resolveThinkingAction("J"), { delta: 1, type: "move" });
    assert.deepEqual(resolveThinkingAction("\u001B[B"), {
      delta: 1,
      type: "move",
    });

    assert.deepEqual(resolveThinkingAction("k"), { delta: -1, type: "move" });
    assert.deepEqual(resolveThinkingAction("K"), { delta: -1, type: "move" });
    assert.deepEqual(resolveThinkingAction("\u001B[A"), {
      delta: -1,
      type: "move",
    });
  });

  void it("supports vim g/G for jumping in thinking levels", () => {
    assert.deepEqual(resolveThinkingAction("g"), { type: "jump_first" });
    assert.deepEqual(resolveThinkingAction("G"), { type: "jump_last" });
  });

  void it("supports select and cancel in thinking mode", () => {
    assert.deepEqual(resolveThinkingAction("\r"), { type: "select" });
    assert.deepEqual(resolveThinkingAction("q"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("Q"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("\u001B"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("x"), { type: "ignore" });
  });

  void it("respects custom modalKeys for thinking mode", () => {
    const customModalKeys = {
      block: ["b"],
      cancel: ["x"],
      default: ["d"],
      down: ["e"],
      favorite: ["f"],
      filter: ["/"],
      first: ["a"],
      hide: ["h"],
      last: ["z"],
      select: ["space"],
      thinking: ["t"],
      toggleHidden: ["v"],
      up: ["u"],
    };

    assert.deepEqual(resolveThinkingAction("e", customModalKeys), {
      delta: 1,
      type: "move",
    });
    assert.deepEqual(resolveThinkingAction("u", customModalKeys), {
      delta: -1,
      type: "move",
    });
    assert.deepEqual(resolveThinkingAction("a", customModalKeys), {
      type: "jump_first",
    });
    assert.deepEqual(resolveThinkingAction("z", customModalKeys), {
      type: "jump_last",
    });
    assert.deepEqual(resolveThinkingAction("x", customModalKeys), {
      type: "cancel",
    });
  });
});

void describe("custom modalKeys in resolvePickerAction", () => {
  void it("uses custom navigation and action keys when provided", () => {
    const customKeys = {
      block: ["!"],
      cancel: ["x"],
      default: ["*"],
      down: ["s"],
      favorite: ["p"],
      filter: ["?"],
      first: ["home"],
      hide: ["-"],
      last: ["end"],
      select: ["enter"],
      thinking: ["m"],
      toggleHidden: ["="],
      up: ["w"],
    };

    assert.deepEqual(resolvePickerAction("w", false, customKeys), {
      delta: -1,
      type: "move",
    });
    assert.deepEqual(resolvePickerAction("s", false, customKeys), {
      delta: 1,
      type: "move",
    });
    assert.deepEqual(resolvePickerAction("m", false, customKeys), {
      type: "open_thinking",
    });
    assert.deepEqual(resolvePickerAction("p", false, customKeys), {
      type: "toggle_fav",
    });
    assert.deepEqual(resolvePickerAction("*", false, customKeys), {
      type: "toggle_default",
    });
    assert.deepEqual(resolvePickerAction("-", false, customKeys), {
      type: "toggle_hide",
    });
    assert.deepEqual(resolvePickerAction("=", false, customKeys), {
      type: "toggle_show_hidden",
    });
    assert.deepEqual(resolvePickerAction("!", false, customKeys), {
      type: "toggle_block",
    });
    assert.deepEqual(resolvePickerAction("?", false, customKeys), {
      type: "start_filter",
    });
    assert.deepEqual(resolvePickerAction("x", false, customKeys), {
      type: "cancel",
    });
  });
});
