import assert from "node:assert/strict";
import { describe, it } from "node:test";
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


describe("sortModels", () => {
  it("sorts models primarily by provider and secondarily by name", () => {
    const models: any[] = [
      { provider: "openai", name: "gpt-4" },
      { provider: "anthropic", name: "claude-sonnet" },
      { provider: "anthropic", name: "claude-haiku" },
    ];
    const sorted = sortModels(models);
    assert.deepEqual(
      sorted.map((m) => `${m.provider}/${m.name}`),
      ["anthropic/claude-haiku", "anthropic/claude-sonnet", "openai/gpt-4"],
    );
  });
});

describe("buildRows", () => {
  it("places favorites above divider and remaining below", () => {
    const m1: any = { provider: "anthropic", id: "sonnet", name: "Sonnet" };
    const m2: any = { provider: "openai", id: "gpt-5", name: "GPT-5" };
    const m3: any = { provider: "google", id: "gemini", name: "Gemini" };

    const favSet = new Set(["openai/gpt-5"]);
    const hiddenSet = new Set<string>();

    const rows = buildRows([m1, m2, m3], favSet, hiddenSet, false);

    assert.equal(rows.length, 4); // 1 fav + 1 divider + 2 others
    assert.equal(rows[0].kind, "model");
    if (rows[0].kind === "model") assert.equal(rows[0].model.id, "gpt-5");

    assert.equal(rows[1].kind, "divider");

    assert.equal(rows[2].kind, "model");
    assert.equal(rows[3].kind, "model");
  });

  it("handles hidden models properly when collapsed vs revealed", () => {
    const m1: any = { provider: "anthropic", id: "sonnet", name: "Sonnet" };
    const m2: any = { provider: "openai", id: "gpt-5", name: "GPT-5" };

    const favSet = new Set<string>();
    const hiddenSet = new Set(["openai/gpt-5"]);

    // Collapsed
    const rowsCollapsed = buildRows([m1, m2], favSet, hiddenSet, false);
    assert.equal(rowsCollapsed.length, 1);
    if (rowsCollapsed[0].kind === "model") assert.equal(rowsCollapsed[0].model.id, "sonnet");

    // Revealed
    const rowsRevealed = buildRows([m1, m2], favSet, hiddenSet, true);
    assert.equal(rowsRevealed.length, 3); // 1 normal + 1 header + 1 hidden
    assert.equal(rowsRevealed[1].kind, "header");
  });
});

describe("windowSlice and clampScroll", () => {
  it("computes slice with moreBelow indicator", () => {
    const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({
      kind: "model",
      model: { provider: "test", id: `m${i}`, name: `Model ${i}` } as any,
    }));

    const slice = windowSlice(rows, 0, rows.length, 0, 10);
    assert.equal(slice.start, 0);
    assert.equal(slice.end, 10);
    assert.equal(slice.moreAbove, false);
    assert.equal(slice.moreBelow, true);
  });

  it("clamps scroll accurately", () => {
    const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({
      kind: "model",
      model: { provider: "test", id: `m${i}`, name: `Model ${i}` } as any,
    }));

    assert.equal(clampScroll(rows, 0, rows.length, 20, 10), 5);
    assert.equal(clampScroll(rows, 0, rows.length, -5, 10), 0);
    assert.equal(clampScroll(rows, 0, rows.length, 3, 10), 3);
  });
});

describe("lastSelectable", () => {
  it("finds the last model row index", () => {
    const rows: Row[] = [
      { kind: "model", model: { provider: "a", id: "1", name: "1" } as any },
      { kind: "divider" },
      { kind: "model", model: { provider: "b", id: "2", name: "2" } as any },
      { kind: "header", label: "Hidden" },
    ];
    assert.equal(lastSelectable(rows), 2);
  });
});

describe("resolvePickerAction", () => {
  it("supports vim j/k and arrow navigation when not filtering", () => {
    assert.deepEqual(resolvePickerAction("j", false), { type: "move", delta: 1 });
    assert.deepEqual(resolvePickerAction("J", false), { type: "move", delta: 1 });
    assert.deepEqual(resolvePickerAction("\u001b[B", false), { type: "move", delta: 1 }); // down arrow

    assert.deepEqual(resolvePickerAction("k", false), { type: "move", delta: -1 });
    assert.deepEqual(resolvePickerAction("K", false), { type: "move", delta: -1 });
    assert.deepEqual(resolvePickerAction("\u001b[A", false), { type: "move", delta: -1 }); // up arrow
  });

  it("supports vim g/G for jump to first and last", () => {
    assert.deepEqual(resolvePickerAction("g", false), { type: "jump_first" });
    assert.deepEqual(resolvePickerAction("G", false), { type: "jump_last" });
  });

  it("supports model action hotkeys and vim quit", () => {
    assert.deepEqual(resolvePickerAction("t", false), { type: "open_thinking" });
    assert.deepEqual(resolvePickerAction("T", false), { type: "open_thinking" });
    assert.deepEqual(resolvePickerAction("e", false), { type: "open_thinking" });

    assert.deepEqual(resolvePickerAction("f", false), { type: "toggle_fav" });
    assert.deepEqual(resolvePickerAction("d", false), { type: "toggle_default" });
    assert.deepEqual(resolvePickerAction("D", false), { type: "toggle_default" });
    assert.deepEqual(resolvePickerAction("h", false), { type: "toggle_hide" });
    assert.deepEqual(resolvePickerAction("v", false), { type: "toggle_show_hidden" });
    assert.deepEqual(resolvePickerAction("/", false), { type: "start_filter" });
    assert.deepEqual(resolvePickerAction("\r", false), { type: "select" });
    assert.deepEqual(resolvePickerAction("q", false), { type: "cancel" });
    assert.deepEqual(resolvePickerAction("\u001b", false), { type: "cancel" });
  });

  it("handles filtering mode correctly without triggering vim navigation", () => {
    // In filter mode, 'j' and 'k' should be typed as characters, not navigation
    assert.deepEqual(resolvePickerAction("j", true), { type: "filter_char", char: "j" });
    assert.deepEqual(resolvePickerAction("k", true), { type: "filter_char", char: "k" });
    assert.deepEqual(resolvePickerAction("\u001b", true), { type: "filter_cancel" });
    assert.deepEqual(resolvePickerAction("\r", true), { type: "filter_apply" });
    assert.deepEqual(resolvePickerAction("\x7f", true), { type: "filter_backspace" });
  });
});

describe("resolveThinkingAction", () => {
  it("supports vim j/k and arrow navigation for thinking levels", () => {
    assert.deepEqual(resolveThinkingAction("j"), { type: "move", delta: 1 });
    assert.deepEqual(resolveThinkingAction("J"), { type: "move", delta: 1 });
    assert.deepEqual(resolveThinkingAction("\u001b[B"), { type: "move", delta: 1 });

    assert.deepEqual(resolveThinkingAction("k"), { type: "move", delta: -1 });
    assert.deepEqual(resolveThinkingAction("K"), { type: "move", delta: -1 });
    assert.deepEqual(resolveThinkingAction("\u001b[A"), { type: "move", delta: -1 });
  });

  it("supports vim g/G for jumping in thinking levels", () => {
    assert.deepEqual(resolveThinkingAction("g"), { type: "jump_first" });
    assert.deepEqual(resolveThinkingAction("G"), { type: "jump_last" });
  });

  it("supports select and cancel in thinking mode", () => {
    assert.deepEqual(resolveThinkingAction("\r"), { type: "select" });
    assert.deepEqual(resolveThinkingAction("q"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("Q"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("\u001b"), { type: "cancel" });
    assert.deepEqual(resolveThinkingAction("x"), { type: "ignore" });
  });

  it("respects custom modalKeys for thinking mode", () => {
    const customModalKeys = {
      up: ["u"],
      down: ["e"],
      first: ["a"],
      last: ["z"],
      select: ["space"],
      cancel: ["x"],
      thinking: ["t"],
      favorite: ["f"],
      default: ["d"],
      hide: ["h"],
      toggleHidden: ["v"],
      filter: ["/"],
    };

    assert.deepEqual(resolveThinkingAction("e", customModalKeys), { type: "move", delta: 1 });
    assert.deepEqual(resolveThinkingAction("u", customModalKeys), { type: "move", delta: -1 });
    assert.deepEqual(resolveThinkingAction("a", customModalKeys), { type: "jump_first" });
    assert.deepEqual(resolveThinkingAction("z", customModalKeys), { type: "jump_last" });
    assert.deepEqual(resolveThinkingAction("x", customModalKeys), { type: "cancel" });
  });
});

describe("custom modalKeys in resolvePickerAction", () => {
  it("uses custom navigation and action keys when provided", () => {
    const customKeys = {
      up: ["w"],
      down: ["s"],
      first: ["home"],
      last: ["end"],
      select: ["enter"],
      cancel: ["x"],
      thinking: ["m"],
      favorite: ["p"],
      default: ["*"],
      hide: ["-"],
      toggleHidden: ["="],
      filter: ["?"],
    };

    assert.deepEqual(resolvePickerAction("w", false, customKeys), { type: "move", delta: -1 });
    assert.deepEqual(resolvePickerAction("s", false, customKeys), { type: "move", delta: 1 });
    assert.deepEqual(resolvePickerAction("m", false, customKeys), { type: "open_thinking" });
    assert.deepEqual(resolvePickerAction("p", false, customKeys), { type: "toggle_fav" });
    assert.deepEqual(resolvePickerAction("*", false, customKeys), { type: "toggle_default" });
    assert.deepEqual(resolvePickerAction("-", false, customKeys), { type: "toggle_hide" });
    assert.deepEqual(resolvePickerAction("=", false, customKeys), { type: "toggle_show_hidden" });
    assert.deepEqual(resolvePickerAction("?", false, customKeys), { type: "start_filter" });
    assert.deepEqual(resolvePickerAction("x", false, customKeys), { type: "cancel" });
  });
});

