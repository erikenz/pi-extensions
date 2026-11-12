import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import {
  adjustScroll,
  buildRows,
  clampScroll,
  countModels,
  formatFooterHelp,
  formatModelRowText,
  getModelIndexInWindow,
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
  void it("places favorites above divider and includes all models under provider headers", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-5", "GPT-5", "openai");
    const m3 = createMockModel("gemini", "Gemini", "google");

    const favSet = new Set(["openai/gpt-5"]);
    const hiddenSet = new Set<string>();

    const rows = buildRows([m1, m2, m3], favSet, hiddenSet, false);

    // 1 fav + 1 divider + 1 header (anthropic) + 1 model + 1 header (google) + 1 model + 1 header (openai) + 1 model = 8
    assert.equal(rows.length, 8);
    assert.equal(rows[0].kind, "model");
    if (rows[0].kind === "model") {
      assert.equal(rows[0].model.id, "gpt-5");
    }

    assert.equal(rows[1].kind, "divider");

    assert.equal(rows[2].kind, "header");
    if (rows[2].kind === "header") {
      assert.equal(rows[2].provider, "anthropic");
    }
    assert.equal(rows[3].kind, "model");

    assert.equal(rows[4].kind, "header");
    if (rows[4].kind === "header") {
      assert.equal(rows[4].provider, "google");
    }
    assert.equal(rows[5].kind, "model");

    assert.equal(rows[6].kind, "header");
    if (rows[6].kind === "header") {
      assert.equal(rows[6].provider, "openai");
    }
    assert.equal(rows[7].kind, "model");
    if (rows[7].kind === "model") {
      assert.equal(rows[7].model.id, "gpt-5");
    }
  });

  void it("handles hidden models properly when collapsed vs revealed", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-5", "GPT-5", "openai");

    const favSet = new Set<string>();
    const hiddenSet = new Set(["openai/gpt-5"]);

    // Collapsed: 1 provider header + 1 model = 2
    const rowsCollapsed = buildRows([m1, m2], favSet, hiddenSet, false);
    assert.equal(rowsCollapsed.length, 2);
    assert.equal(rowsCollapsed[0].kind, "header");
    if (rowsCollapsed[1].kind === "model") {
      assert.equal(rowsCollapsed[1].model.id, "sonnet");
    }

    // Revealed: 1 provider header + 1 model + 1 hidden header + 1 hidden model = 4
    const rowsRevealed = buildRows([m1, m2], favSet, hiddenSet, true);
    assert.equal(rowsRevealed.length, 4);
    assert.equal(rowsRevealed[0].kind, "header");
    assert.equal(rowsRevealed[2].kind, "header");
    if (rowsRevealed[2].kind === "header") {
      assert.equal(rowsRevealed[2].label, "─ Hidden (v to collapse) ─");
    }
  });

  void it("filters out blocked models completely", () => {
    const m1 = createMockModel("sonnet", "Sonnet", "anthropic");
    const m2 = createMockModel("gpt-4", "GPT-4", "openai");
    const m3 = createMockModel("llama3", "Llama 3", "ollama");

    const favSet = new Set(["openai/gpt-4"]);
    const hiddenSet = new Set<string>();

    // Block openai/* and llama3 -> only anthropic remains (1 header + 1 model = 2)
    const rows = buildRows([m1, m2, m3], favSet, hiddenSet, true, [
      "openai/*",
      "llama3",
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "header");
    if (rows[1].kind === "model") {
      assert.equal(rows[1].model.id, "sonnet");
    }
  });

  void it("groups antigravity-acp models into sub-groups with quotas", () => {
    const flash = createMockModel(
      "gemini-3.8-flash",
      "Gemini 3.8 Flash",
      "antigravity-acp"
    );
    const pro = createMockModel(
      "gemini-3.1-pro",
      "Gemini 3.1 Pro",
      "antigravity-acp"
    );
    const argon = createMockModel(
      "gemini-4-argon",
      "Gemini 4 Argon",
      "antigravity-acp"
    );
    const ds = createMockModel(
      "deepseek-v4.1-flash",
      "DeepSeek V4.1 Flash",
      "opencode-go"
    );

    const mockSnapshot = {
      at: Date.now(),
      groups: [
        {
          buckets: [{ remainingFraction: 0.5, window: "5h" }],
          displayName: "GEMINI MODELS",
        },
        {
          buckets: [{ remainingFraction: 0.05, window: "weekly" }],
          displayName: "GEMINI 4 ARGON",
        },
        {
          buckets: [{ remainingFraction: 0.9, window: "monthly" }],
          displayName: "opencode-go",
        },
      ],
    };

    const favSet = new Set(["antigravity-acp/gemini-3.8-flash"]);
    const hiddenSet = new Set<string>();

    const rows = buildRows(
      [flash, pro, argon, ds],
      favSet,
      hiddenSet,
      false,
      [],
      new Set<string>(),
      mockSnapshot
    );

    // Structure expected:
    // 0: favorite model (Gemini 3.8 Flash)
    // 1: divider
    // 2: header: antigravity-acp (provider header)
    // 3: header: Gemini Models (subgroup header with quota)
    // 4: model: Gemini 3.1 Pro
    // 5: model: Gemini 3.8 Flash
    // 6: header: Gemini 4 Argon (subgroup header with quota)
    // 7: model: Gemini 4 Argon
    // 8: header: opencode-go (provider header with quota)
    // 9: model: DeepSeek V4.1 Flash

    assert.equal(rows[0].kind, "model");
    assert.equal(rows[1].kind, "divider");

    assert.equal(rows[2].kind, "header");
    if (rows[2].kind === "header") {
      assert.equal(rows[2].provider, "antigravity-acp");
      assert.equal(rows[2].subgroup, undefined);
    }

    assert.equal(rows[3].kind, "header");
    if (rows[3].kind === "header") {
      assert.equal(rows[3].subgroup, "Gemini Models");
      assert.ok(rows[3].quotaBadge);
      assert.equal(rows[3].quotaBadge.text, "[5h: 50%]");
    }

    assert.equal(rows[4].kind, "model");
    if (rows[4].kind === "model") {
      assert.equal(rows[4].model.id, "gemini-3.1-pro");
    }

    assert.equal(rows[5].kind, "model");
    if (rows[5].kind === "model") {
      assert.equal(rows[5].model.id, "gemini-3.8-flash");
    }

    assert.equal(rows[6].kind, "header");
    if (rows[6].kind === "header") {
      assert.equal(rows[6].subgroup, "Gemini 4 Argon");
      assert.ok(rows[6].quotaBadge);
      assert.equal(rows[6].quotaBadge.text, "[W: 5%]");
    }

    assert.equal(rows[7].kind, "model");
    if (rows[7].kind === "model") {
      assert.equal(rows[7].model.id, "gemini-4-argon");
    }

    assert.equal(rows[8].kind, "header");
    if (rows[8].kind === "header") {
      assert.equal(rows[8].provider, "opencode-go");
      assert.ok(rows[8].quotaBadge);
      assert.equal(rows[8].quotaBadge.text, "[M: 90%]");
    }

    assert.equal(rows[9].kind, "model");
    if (rows[9].kind === "model") {
      assert.equal(rows[9].model.id, "deepseek-v4.1-flash");
    }
  });
});

void describe("formatModelRowText", () => {
  void it("formats favorite above divider with star and provider badge", () => {
    const m = createMockModel("gpt-5", "GPT-5", "openai");
    const text = formatModelRowText({
      isAboveDivider: true,
      isCurrent: false,
      isDef: false,
      isFav: true,
      isHidden: false,
      m,
      quotaBadge: "",
    });
    assert.equal(text, "★ GPT-5 (openai)");
  });

  void it("formats favorite in provider group with star and without redundant provider badge", () => {
    const m = createMockModel("gpt-5", "GPT-5", "openai");
    const text = formatModelRowText({
      isAboveDivider: false,
      isCurrent: false,
      isDef: false,
      isFav: true,
      isHidden: false,
      m,
      quotaBadge: "",
    });
    assert.equal(text, "★ GPT-5");
  });

  void it("formats non-favorite in provider group with padded spacing for column alignment", () => {
    const m = createMockModel("sonnet", "Sonnet", "anthropic");
    const text = formatModelRowText({
      isAboveDivider: false,
      isCurrent: false,
      isDef: false,
      isFav: false,
      isHidden: false,
      m,
      quotaBadge: "",
    });
    assert.equal(text, "  Sonnet");
  });

  void it("formats reasoning and default tags correctly with aligned padding", () => {
    const m = createMockModel("sonnet", "Sonnet", "anthropic", true);
    const text = formatModelRowText({
      isAboveDivider: false,
      isCurrent: true,
      isDef: true,
      isFav: false,
      isHidden: false,
      m,
      quotaBadge: " [100% left]",
    });
    assert.equal(text, "  Sonnet [100% left] ● [default] [reasoning]");
  });
});

void describe("formatFooterHelp", () => {
  const defaultKeys = {
    block: ["b"],
    cancel: ["escape", "q"],
    default: ["d"],
    down: ["j", "down"],
    favorite: ["f"],
    filter: ["/"],
    first: ["g"],
    hide: ["h"],
    last: ["G"],
    select: ["return"],
    thinking: ["t"],
    toggleHidden: ["v"],
    up: ["k", "up"],
  };

  void it("renders full descriptive help on wide terminals (>= 120 cols)", () => {
    const help = formatFooterHelp(defaultKeys, 125);
    assert.ok(
      help.includes(
        "nav • return select • t thinking • d default • f fav • h hide • b block • v hidden • / filter • r refresh • q/esc cancel"
      )
    );
  });

  void it("renders compact help on medium terminals (90-119 cols)", () => {
    const help = formatFooterHelp(defaultKeys, 100);
    assert.ok(
      help.includes(
        "• return sel • t think • d def • f fav • h hide • b blk • v hid • / filt • r sync • q/esc back"
      )
    );
    assert.ok(help.length <= 100);
  });

  void it("renders condensed essentials on standard/narrow terminals (< 90 cols)", () => {
    const help = formatFooterHelp(defaultKeys, 80);
    assert.ok(help.length <= 80);
    assert.ok(
      help.includes(
        "• return • t think • f fav • d def • h hide • v hid • / filt • r • q/esc"
      )
    );
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

  void it("calculates model index and counts accurately across headers and dividers", () => {
    const rows: Row[] = [
      { kind: "model", model: createMockModel("0", "0", "a") },
      { kind: "model", model: createMockModel("1", "1", "a") },
      { kind: "divider" },
      { kind: "header", label: "── b ──" },
      { kind: "model", model: createMockModel("2", "2", "b") },
      { kind: "model", model: createMockModel("3", "3", "b") },
    ];

    assert.equal(countModels(rows, 0, 2), 2);
    assert.equal(countModels(rows, 3, rows.length), 2);
    assert.equal(getModelIndexInWindow(rows, 3, rows.length, 4), 0);
    assert.equal(getModelIndexInWindow(rows, 3, rows.length, 5), 1);
  });

  void it("adjusts scroll dynamically to keep cursor inside visible limit", () => {
    // 25 models, limit 10
    // At model index 0: scroll stays 0
    assert.equal(adjustScroll(0, 0, 25, 10), 0);
    // At model index 5: scroll stays 0
    assert.equal(adjustScroll(0, 5, 25, 10), 0);
    // At model index 9: scroll stays 0
    assert.equal(adjustScroll(0, 9, 25, 10), 0);
    // At model index 10: scroll increases to 1
    assert.equal(adjustScroll(0, 10, 25, 10), 1);
    // Moving up to model index 0 when scroll was 5: scroll snaps to 0
    assert.equal(adjustScroll(5, 0, 25, 10), 0);
    // Moving to bottom index 24: scroll clamps to maxScroll 15
    assert.equal(adjustScroll(0, 24, 25, 10), 15);
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
