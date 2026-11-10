import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";

import {
  DEFAULT_MODAL_KEYS,
  isModelBlocked,
  loadConfig,
  modelKey,
  resolveModalKeys,
  saveConfig,
} from "./config.ts";
import { isThinkingLevel, LEVEL_DESCRIPTIONS } from "./types.ts";
import type {
  PickerAction,
  ResolvedModalKeys,
  Row,
  ThinkingAction,
  WindowSliceResult,
} from "./types.ts";

export const VISIBLE_ROWS = 10;

const isKeyId = (value: string): value is KeyId => value.trim().length > 0;

export const sortModels = (models: Model<Api>[]): Model<Api>[] =>
  models.toSorted((a, b) => {
    const byProvider = a.provider.localeCompare(b.provider);
    if (byProvider !== 0) {
      return byProvider;
    }
    return a.name.localeCompare(b.name);
  });

export const buildRows = (
  models: Model<Api>[],
  favSet: Set<string>,
  hiddenSet: Set<string>,
  showHidden: boolean,
  blockedList: string[] = []
): Row[] => {
  const visibleModels = models.filter((m) => !isModelBlocked(m, blockedList));
  const isFav = (m: Model<Api>): boolean => favSet.has(modelKey(m));
  const isHid = (m: Model<Api>): boolean => hiddenSet.has(modelKey(m));
  const rows: Row[] = [];

  const favs = visibleModels.filter((m) => isFav(m) && !isHid(m));
  for (const m of favs) {
    rows.push({ kind: "model", model: m });
  }

  if (favs.length > 0) {
    rows.push({ kind: "divider" });
  }

  for (const candidate of visibleModels.filter((m) => !isFav(m) && !isHid(m))) {
    rows.push({ kind: "model", model: candidate });
  }

  const hidden = visibleModels.filter(isHid);
  if (showHidden && hidden.length > 0) {
    rows.push({ kind: "header", label: "─ Hidden (v to collapse) ─" });
    for (const m of hidden) {
      rows.push({ kind: "model", model: m });
    }
  }

  return rows;
};

export const windowSlice = (
  rows: Row[],
  winStart: number,
  winEnd: number,
  scroll: number,
  visibleLimit: number = VISIBLE_ROWS
): WindowSliceResult => {
  let start = winStart;
  let skipped = 0;
  while (start < winEnd && skipped < scroll) {
    if (rows[start].kind === "model") {
      skipped += 1;
    }
    start += 1;
  }

  let end = start;
  let counted = 0;
  while (end < winEnd && counted < visibleLimit) {
    if (rows[end].kind === "model") {
      counted += 1;
    }
    end += 1;
  }

  let moreBelow = false;
  for (let i = end; i < winEnd; i += 1) {
    if (rows[i].kind === "model") {
      moreBelow = true;
      break;
    }
  }

  return { end, moreAbove: scroll > 0, moreBelow, start };
};

export const clampScroll = (
  rows: Row[],
  winStart: number,
  winEnd: number,
  scroll: number,
  visibleLimit: number = VISIBLE_ROWS
): number => {
  let total = 0;
  for (let i = winStart; i < winEnd; i += 1) {
    if (rows[i].kind === "model") {
      total += 1;
    }
  }
  return Math.max(0, Math.min(scroll, Math.max(0, total - visibleLimit)));
};

export const firstSelectable = (rows: Row[]): number => {
  const i = rows.findIndex((r) => r.kind === "model");
  return i === -1 ? 0 : i;
};

export const lastSelectable = (rows: Row[]): number => {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].kind === "model") {
      return i;
    }
  }
  return 0;
};

export const nearestSelectable = (rows: Row[], target: number): number => {
  if (rows.length === 0) {
    return 0;
  }
  const clamp = Math.max(0, Math.min(target, rows.length - 1));
  for (let d = 0; d < rows.length; d += 1) {
    const down = clamp + d;
    if (down < rows.length && rows[down].kind === "model") {
      return down;
    }
    const up = clamp - d;
    if (up >= 0 && rows[up].kind === "model") {
      return up;
    }
  }
  return firstSelectable(rows);
};

export const matchesAnyKey = (data: string, bindings: string[]): boolean => {
  for (const b of bindings) {
    if (data === b) {
      return true;
    }
    if (b.length > 1 && data.toLowerCase() === b.toLowerCase()) {
      return true;
    }
    try {
      if (isKeyId(b) && matchesKey(data, b)) {
        return true;
      }
    } catch {
      // ignore unrecognized key string
    }
  }
  return false;
};

const resolveFilterAction = (data: string): PickerAction => {
  if (matchesKey(data, Key.escape)) {
    return { type: "filter_cancel" };
  }
  if (matchesKey(data, Key.enter)) {
    return { type: "filter_apply" };
  }
  if (matchesKey(data, Key.backspace)) {
    return { type: "filter_backspace" };
  }
  if (data.length === 1 && data >= " ") {
    return { char: data, type: "filter_char" };
  }
  return { type: "ignore" };
};

const resolveNavAction = (
  data: string,
  modalKeys: ResolvedModalKeys
): PickerAction => {
  if (matchesAnyKey(data, modalKeys.up)) {
    return { delta: -1, type: "move" };
  }
  if (matchesAnyKey(data, modalKeys.down)) {
    return { delta: 1, type: "move" };
  }
  if (matchesAnyKey(data, modalKeys.first)) {
    return { type: "jump_first" };
  }
  if (matchesAnyKey(data, modalKeys.last)) {
    return { type: "jump_last" };
  }
  if (matchesAnyKey(data, modalKeys.thinking)) {
    return { type: "open_thinking" };
  }
  if (matchesAnyKey(data, modalKeys.favorite)) {
    return { type: "toggle_fav" };
  }
  if (matchesAnyKey(data, modalKeys.default)) {
    return { type: "toggle_default" };
  }
  if (matchesAnyKey(data, modalKeys.hide)) {
    return { type: "toggle_hide" };
  }
  if (matchesAnyKey(data, modalKeys.toggleHidden)) {
    return { type: "toggle_show_hidden" };
  }
  if (matchesAnyKey(data, modalKeys.block)) {
    return { type: "toggle_block" };
  }
  if (matchesAnyKey(data, modalKeys.filter)) {
    return { type: "start_filter" };
  }
  if (matchesAnyKey(data, modalKeys.select)) {
    return { type: "select" };
  }
  if (matchesAnyKey(data, modalKeys.cancel)) {
    return { type: "cancel" };
  }
  return { type: "ignore" };
};

export const resolvePickerAction = (
  data: string,
  filtering: boolean,
  modalKeys: ResolvedModalKeys = DEFAULT_MODAL_KEYS
): PickerAction =>
  filtering ? resolveFilterAction(data) : resolveNavAction(data, modalKeys);

export const resolveThinkingAction = (
  data: string,
  modalKeys: ResolvedModalKeys = DEFAULT_MODAL_KEYS
): ThinkingAction => {
  if (matchesAnyKey(data, modalKeys.up)) {
    return { delta: -1, type: "move" };
  }
  if (matchesAnyKey(data, modalKeys.down)) {
    return { delta: 1, type: "move" };
  }
  if (matchesAnyKey(data, modalKeys.first)) {
    return { type: "jump_first" };
  }
  if (matchesAnyKey(data, modalKeys.last)) {
    return { type: "jump_last" };
  }
  if (matchesAnyKey(data, modalKeys.select)) {
    return { type: "select" };
  }
  if (matchesAnyKey(data, modalKeys.cancel)) {
    return { type: "cancel" };
  }
  return { type: "ignore" };
};

const formatFirstKey = (keys: string[], fallback: string): string => {
  const [first] = keys;
  return first ?? fallback;
};

const formatNavHint = (keys: ResolvedModalKeys): string => {
  const [up] = keys.up;
  const [down] = keys.down;
  if (up === "k" && down === "j") {
    return "↑↓/jk";
  }
  return `${up ?? "↑"}${down ?? "↓"}`;
};

const formatCancelHint = (keys: string[]): string => {
  if (keys.includes("q") && (keys.includes("escape") || keys.includes("esc"))) {
    return "q/esc";
  }
  const [first] = keys;
  return first ?? "esc";
};

export const openModelPickerModal = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext
): Promise<void> => {
  const config = loadConfig();
  const modalKeys = resolveModalKeys(config.modalKeys);
  const favSet = new Set(config.favorites);
  const hiddenSet = new Set(config.hidden);
  const blockedList = [...config.blocked];
  const modelThinking: Record<string, string> = { ...config.modelThinking };
  const models = sortModels(ctx.modelRegistry.getAvailable());
  const currentKey = ctx.model === undefined ? undefined : modelKey(ctx.model);
  const currentThinkingLevel = pi.getThinkingLevel();
  let showHidden = false;

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(process.cwd(), agentDir);
  let defaultProvider = settingsManager.getDefaultProvider();
  let defaultModelId = settingsManager.getDefaultModel();
  const isDefault = (m: Model<Api>): boolean =>
    m.provider === defaultProvider && m.id === defaultModelId;

  const chosen = await ctx.ui.custom<{
    model: Model<Api>;
    thinkingLevel?: string;
  } | null>((tui, theme, _keybindings, done) => {
    let filter = "";
    let filtering = false;
    let mode: "models" | "thinking" = "models";
    let thinkingModel: Model<Api> | undefined;
    let thinkingLevels: string[] = [];
    let thinkingCursor = 0;

    const matches = (m: Model<Api>): boolean => {
      if (filter.length === 0) {
        return true;
      }
      const q = filter.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    };

    const computeRows = (): Row[] =>
      buildRows(
        models.filter(matches),
        favSet,
        hiddenSet,
        showHidden,
        blockedList
      );
    let rows = computeRows();
    let cursor = firstSelectable(rows);
    let favScroll = 0;
    let modelScroll = 0;
    let version = 0;
    let cached:
      | {
          version: number;
          width: number;
          favScroll: number;
          modelScroll: number;
          lines: string[];
        }
      | undefined;

    const focusedModel = (): Model<Api> | undefined => {
      const r = rows[cursor];
      return r?.kind === "model" ? r.model : undefined;
    };

    const rebuild = (): void => {
      rows = computeRows();
      cursor = nearestSelectable(rows, cursor);
      cached = undefined;
    };

    const toggleFavorite = (): void => {
      const m = focusedModel();
      if (m === undefined) {
        return;
      }
      const key = modelKey(m);
      if (favSet.has(key)) {
        favSet.delete(key);
      } else {
        favSet.add(key);
        hiddenSet.delete(key);
      }
      saveConfig({
        blocked: blockedList,
        favorites: [...favSet],
        hidden: [...hiddenSet],
        modelThinking,
      });
      rebuild();
      version += 1;
      tui.requestRender();
    };

    const toggleDefault = async (): Promise<void> => {
      const m = focusedModel();
      if (m === undefined) {
        return;
      }
      try {
        if (isDefault(m)) {
          ctx.ui.notify(`${m.name} is already your default model`, "info");
          return;
        }
        settingsManager.setDefaultModelAndProvider(m.provider, m.id);
        await settingsManager.flush();
        defaultProvider = m.provider;
        defaultModelId = m.id;
        ctx.ui.notify(
          `Set as default Pi model: ${m.name} (${m.provider})`,
          "info"
        );
        cached = undefined;
        version += 1;
        tui.requestRender();
      } catch (error) {
        ctx.ui.notify(
          `Failed to update default model: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    };

    const toggleHidden = (): void => {
      const m = focusedModel();
      if (m === undefined) {
        return;
      }
      const key = modelKey(m);
      if (hiddenSet.has(key)) {
        hiddenSet.delete(key);
      } else {
        hiddenSet.add(key);
        favSet.delete(key);
      }
      saveConfig({
        blocked: blockedList,
        favorites: [...favSet],
        hidden: [...hiddenSet],
        modelThinking,
      });
      rebuild();
      version += 1;
      tui.requestRender();
    };

    const toggleBlock = (): void => {
      const m = focusedModel();
      if (m === undefined) {
        return;
      }
      const key = modelKey(m);
      if (!blockedList.includes(key)) {
        blockedList.push(key);
        favSet.delete(key);
        hiddenSet.delete(key);
        saveConfig({
          blocked: blockedList,
          favorites: [...favSet],
          hidden: [...hiddenSet],
          modalKeys: config.modalKeys,
          modelThinking,
          shortcuts: config.shortcuts,
        });
        const name = m.name.length > 0 ? m.name : m.id;
        ctx.ui.notify(`Blocked ${name} (${m.provider})`, "info");
        rebuild();
        version += 1;
        tui.requestRender();
      }
    };

    const updateScroll = (): void => {
      const dividerIdx = rows.findIndex((r) => r.kind === "divider");
      if (dividerIdx === -1) {
        modelScroll = clampScroll(rows, 0, rows.length, cursor);
      } else if (cursor < dividerIdx) {
        favScroll = clampScroll(rows, 0, dividerIdx, cursor);
      } else {
        modelScroll = clampScroll(
          rows,
          dividerIdx + 1,
          rows.length,
          cursor - (dividerIdx + 1)
        );
      }
    };

    const moveCursor = (delta: number): void => {
      if (rows.length === 0) {
        return;
      }
      let next = cursor;
      for (const _row of rows) {
        next = (next + delta + rows.length) % rows.length;
        if (rows[next].kind === "model") {
          cursor = next;
          break;
        }
      }
      updateScroll();
      cached = undefined;
      version += 1;
      tui.requestRender();
    };

    const jumpToFirst = (): void => {
      cursor = firstSelectable(rows);
      updateScroll();
      cached = undefined;
      version += 1;
      tui.requestRender();
    };

    const jumpToLast = (): void => {
      cursor = lastSelectable(rows);
      updateScroll();
      cached = undefined;
      version += 1;
      tui.requestRender();
    };

    const openThinkingSelection = (): void => {
      const m = focusedModel();
      if (m === undefined) {
        return;
      }
      const levels = getSupportedThinkingLevels(m);
      if (levels.length <= 1 && levels[0] === "off") {
        ctx.ui.notify(
          `${m.name} does not support thinking / reasoning`,
          "warning"
        );
        return;
      }
      thinkingModel = m;
      thinkingLevels = levels;
      const key = modelKey(m);
      const activeOrSaved =
        modelThinking[key] ??
        (key === currentKey ? currentThinkingLevel : "medium");
      const idx = thinkingLevels.indexOf(activeOrSaved);
      thinkingCursor = idx === -1 ? 0 : idx;
      mode = "thinking";
      version += 1;
      cached = undefined;
      tui.requestRender();
    };

    const render = (width: number): string[] => {
      if (mode === "thinking" && thinkingModel !== undefined) {
        const header = theme.fg(
          "accent",
          `Select Thinking / Effort for ${thinkingModel.name} (${thinkingModel.provider})`
        );
        const lines: string[] = [header, ""];

        const key = modelKey(thinkingModel);
        const activeOrSaved =
          modelThinking[key] ??
          (key === currentKey ? currentThinkingLevel : undefined);

        for (let i = 0; i < thinkingLevels.length; i += 1) {
          const lvl = thinkingLevels[i];
          const desc = LEVEL_DESCRIPTIONS[lvl] ?? "";
          const isCurrent = lvl === activeOrSaved;
          const tag = isCurrent ? " ●" : "";
          const text = `${lvl.padEnd(8)} ${desc}${tag}`;
          if (i === thinkingCursor) {
            lines.push(theme.bg("selectedBg", theme.fg("accent", `▸ ${text}`)));
          } else {
            lines.push(`  ${text}`);
          }
        }

        lines.push(
          "",
          theme.fg(
            "dim",
            `${formatNavHint(modalKeys)} nav • ${formatFirstKey(modalKeys.select, "enter")} select & apply • ${formatCancelHint(modalKeys.cancel)} back`
          )
        );
        return lines.map((l) => truncateToWidth(l, Math.max(1, width)));
      }

      if (
        cached !== undefined &&
        cached.version === version &&
        cached.width === width
      ) {
        return cached.lines;
      }
      const header = theme.fg("accent", "Select Model");
      const lines: string[] = [header];

      const dividerIdx = rows.findIndex((r) => r.kind === "divider");
      let hasSelectable = false;

      const renderWindow = (
        winStart: number,
        winEnd: number,
        scroll: number
      ): void => {
        const slice = windowSlice(rows, winStart, winEnd, scroll);
        if (slice.moreAbove) {
          lines.push(theme.fg("dim", "  ▲"));
        }
        for (let i = slice.start; i < slice.end; i += 1) {
          const row = rows[i];
          if (row.kind === "header") {
            lines.push(theme.fg("dim", row.label));
          } else if (row.kind === "model") {
            hasSelectable = true;
            const m = row.model;
            const key = modelKey(m);
            const isCurrent = key === currentKey;
            const isFav = favSet.has(key);
            const isDef = isDefault(m);
            const star = isFav ? "★ " : "  ";
            const level =
              modelThinking[key] ??
              (isCurrent ? currentThinkingLevel : undefined);
            let thinkingBadge = "";
            if (level !== undefined && level.length > 0) {
              thinkingBadge = ` [thinking: ${level}]`;
            } else if (m.reasoning) {
              thinkingBadge = " [reasoning]";
            }
            const tags =
              (isCurrent ? " ●" : "") +
              (isDef ? " [default]" : "") +
              thinkingBadge;
            const text = `${star}${m.name} (${m.provider})${tags}`;
            if (i === cursor) {
              lines.push(
                theme.bg("selectedBg", theme.fg("accent", `▸ ${text}`))
              );
            } else if (hiddenSet.has(key)) {
              lines.push(theme.fg("dim", `  ${text}`));
            } else {
              lines.push(`  ${text}`);
            }
          }
        }
        if (slice.moreBelow) {
          lines.push(theme.fg("dim", "  ▼"));
        }
      };

      if (dividerIdx === -1) {
        renderWindow(0, rows.length, modelScroll);
      } else {
        renderWindow(0, dividerIdx, favScroll);
        lines.push(theme.fg("border", "─".repeat(Math.max(1, width))));
        renderWindow(dividerIdx + 1, rows.length, modelScroll);
      }

      if (!hasSelectable) {
        lines.push(theme.fg("dim", "  (no models match)"));
      }

      if (filtering) {
        lines.push(
          theme.fg("accent", `filter: "${filter}"`) +
            theme.fg("dim", " • enter apply • esc clear")
        );
      } else {
        lines.push(
          theme.fg(
            "dim",
            `${formatNavHint(modalKeys)} nav • ${formatFirstKey(modalKeys.select, "enter")} select • ${formatFirstKey(modalKeys.thinking, "t")} thinking • ${formatFirstKey(modalKeys.default, "d")} default • ${formatFirstKey(modalKeys.favorite, "f")} fav • ${formatFirstKey(modalKeys.hide, "h")} hide • ${formatFirstKey(modalKeys.block, "b")} block • ${formatFirstKey(modalKeys.toggleHidden, "v")} hidden • ${formatFirstKey(modalKeys.filter, "/")} filter • ${formatCancelHint(modalKeys.cancel)} cancel`
          )
        );
      }

      cached = {
        favScroll,
        lines: lines.map((l) => truncateToWidth(l, Math.max(1, width))),
        modelScroll,
        version,
        width,
      };
      return cached.lines;
    };

    const handleThinkingInput = (data: string): void => {
      const action = resolveThinkingAction(data, modalKeys);
      switch (action.type) {
        case "move": {
          if (thinkingLevels.length > 0) {
            thinkingCursor =
              (thinkingCursor + action.delta + thinkingLevels.length) %
              thinkingLevels.length;
            version += 1;
            cached = undefined;
            tui.requestRender();
          }
          break;
        }
        case "jump_first": {
          thinkingCursor = 0;
          version += 1;
          cached = undefined;
          tui.requestRender();
          break;
        }
        case "jump_last": {
          thinkingCursor = Math.max(0, thinkingLevels.length - 1);
          version += 1;
          cached = undefined;
          tui.requestRender();
          break;
        }
        case "select": {
          const chosenLevel = thinkingLevels[thinkingCursor];
          if (
            thinkingModel !== undefined &&
            chosenLevel !== undefined &&
            chosenLevel.length > 0
          ) {
            modelThinking[modelKey(thinkingModel)] = chosenLevel;
            saveConfig({
              blocked: blockedList,
              favorites: [...favSet],
              hidden: [...hiddenSet],
              modelThinking,
            });
            done({ model: thinkingModel, thinkingLevel: chosenLevel });
          }
          break;
        }
        case "cancel": {
          mode = "models";
          thinkingModel = undefined;
          version += 1;
          cached = undefined;
          tui.requestRender();
          break;
        }
        case "ignore": {
          break;
        }
        default: {
          break;
        }
      }
    };

    const handlePickerInput = (data: string): void => {
      const action = resolvePickerAction(data, filtering, modalKeys);
      switch (action.type) {
        case "filter_cancel": {
          filter = "";
          filtering = false;
          rebuild();
          version += 1;
          tui.requestRender();
          break;
        }
        case "filter_apply": {
          filtering = false;
          rebuild();
          version += 1;
          tui.requestRender();
          break;
        }
        case "filter_backspace": {
          filter = filter.slice(0, -1);
          rebuild();
          version += 1;
          tui.requestRender();
          break;
        }
        case "filter_char": {
          filter += action.char;
          rebuild();
          version += 1;
          tui.requestRender();
          break;
        }
        case "start_filter": {
          filtering = true;
          version += 1;
          tui.requestRender();
          break;
        }
        case "move": {
          moveCursor(action.delta);
          break;
        }
        case "jump_first": {
          jumpToFirst();
          break;
        }
        case "jump_last": {
          jumpToLast();
          break;
        }
        case "open_thinking": {
          openThinkingSelection();
          break;
        }
        case "toggle_fav": {
          toggleFavorite();
          break;
        }
        case "toggle_default": {
          void toggleDefault();
          break;
        }
        case "toggle_hide": {
          toggleHidden();
          break;
        }
        case "toggle_block": {
          toggleBlock();
          break;
        }
        case "toggle_show_hidden": {
          showHidden = !showHidden;
          rebuild();
          version += 1;
          tui.requestRender();
          break;
        }
        case "select": {
          const m = focusedModel();
          if (m !== undefined) {
            const key = modelKey(m);
            const savedLevel = modelThinking[key];
            done({ model: m, thinkingLevel: savedLevel });
          }
          break;
        }
        case "cancel": {
          done(null);
          break;
        }
        case "ignore": {
          break;
        }
        default: {
          break;
        }
      }
    };

    const handleInput = (data: string): void => {
      if (mode === "thinking") {
        handleThinkingInput(data);
      } else {
        handlePickerInput(data);
      }
    };

    return {
      handleInput,
      invalidate: () => {
        cached = undefined;
      },
      render,
    };
  });

  if (chosen !== null) {
    const success = await pi.setModel(chosen.model);
    if (success) {
      let thinkingSuffix = "";
      if (
        chosen.thinkingLevel !== undefined &&
        isThinkingLevel(chosen.thinkingLevel)
      ) {
        pi.setThinkingLevel(chosen.thinkingLevel);
        thinkingSuffix = ` [thinking: ${chosen.thinkingLevel}]`;
      }
      ctx.ui.notify(
        `Active model: ${chosen.model.name} (${chosen.model.provider})${thinkingSuffix}`,
        "info"
      );
    } else {
      ctx.ui.notify(
        `Could not set ${chosen.model.name} (provider missing credentials)`,
        "error"
      );
    }
  }
};
