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
import {
  getCachedDisabledModels,
  isOpenCodeDisabled,
  syncOpenCodeDisabledModels,
} from "./opencode.ts";
import {
  fetchQuota,
  formatModelQuotaBadge,
  formatProviderQuotaBadge,
  formatQuotaGroupBadge,
  getAntigravitySubgroup,
  getCachedQuota,
} from "./quota.ts";
import { isThinkingLevel, LEVEL_DESCRIPTIONS } from "./types.ts";
import type {
  FilterAction,
  PickerAction,
  QuotaBadgeResult,
  QuotaGroup,
  QuotaSnapshot,
  ResolvedModalKeys,
  Row,
  ThinkingAction,
  WindowSliceResult,
} from "./types.ts";

type UiTheme = Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>[1];

export const VISIBLE_ROWS = 20;

export const getVisibleLimit = (): number => {
  const terminalRows = process.stdout.rows;
  if (typeof terminalRows === "number" && terminalRows > 0) {
    // Reserve lines for header (1), favorites (~4), divider (1), navigation hints (2), padding (2)
    return Math.max(15, Math.min(35, terminalRows - 10));
  }
  return VISIBLE_ROWS;
};

const isKeyId = (value: string): value is KeyId => value.trim().length > 0;

export const sortModels = (models: Model<Api>[]): Model<Api>[] =>
  models.toSorted((a, b) => {
    const byProvider = a.provider.localeCompare(b.provider);
    if (byProvider !== 0) {
      return byProvider;
    }
    return a.name.localeCompare(b.name);
  });

const SUBGROUP_ORDER = [
  "Gemini Models",
  "Claude & GPT Models",
  "Gemini 4 Argon",
];

const compareSubgroups = (a: string, b: string): number => {
  const idxA = SUBGROUP_ORDER.indexOf(a);
  const idxB = SUBGROUP_ORDER.indexOf(b);
  if (idxA !== -1 && idxB !== -1) {
    return idxA - idxB;
  }
  if (idxA === -1 && idxB !== -1) {
    return 1;
  }
  if (idxA !== -1 && idxB === -1) {
    return -1;
  }
  return a.localeCompare(b);
};

export const buildAntigravityRows = (
  provider: string,
  models: Model<Api>[],
  quotaSnapshot?: QuotaSnapshot
): Row[] => {
  const rows: Row[] = [
    {
      kind: "header",
      label: `── ${provider} `,
      provider,
    },
  ];

  const subgroupMap = new Map<
    string,
    { group?: QuotaGroup; models: Model<Api>[] }
  >();
  for (const m of models) {
    const sub = getAntigravitySubgroup(m, quotaSnapshot);
    const entry = subgroupMap.get(sub.name);
    if (entry === undefined) {
      subgroupMap.set(sub.name, {
        group: sub.group,
        models: [m],
      });
    } else {
      entry.models.push(m);
      if (entry.group === undefined && sub.group !== undefined) {
        entry.group = sub.group;
      }
    }
  }

  const sortedSubgroups = [...subgroupMap.keys()].toSorted(compareSubgroups);
  for (const sgName of sortedSubgroups) {
    const entry = subgroupMap.get(sgName);
    if (entry === undefined) {
      continue;
    }
    const quotaBadge =
      entry.group === undefined
        ? undefined
        : formatQuotaGroupBadge(entry.group);
    rows.push({
      kind: "header",
      label: `  ── ${sgName} `,
      provider,
      quotaBadge,
      subgroup: sgName,
    });
    for (const m of entry.models) {
      rows.push({ kind: "model", model: m });
    }
  }

  return rows;
};

export const buildRows = (
  models: Model<Api>[],
  favSet: Set<string>,
  hiddenSet: Set<string>,
  showHidden: boolean,
  blockedList: string[] = [],
  disabledSet: Set<string> = new Set<string>(),
  quotaSnapshot?: QuotaSnapshot
): Row[] => {
  const visibleModels = models.filter(
    (m) =>
      !isModelBlocked(m, blockedList) && !isOpenCodeDisabled(m, disabledSet)
  );
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

  const providerModels = sortModels(visibleModels.filter((m) => !isHid(m)));
  const byProvider = new Map<string, Model<Api>[]>();
  for (const candidate of providerModels) {
    const list = byProvider.get(candidate.provider);
    if (list === undefined) {
      byProvider.set(candidate.provider, [candidate]);
    } else {
      list.push(candidate);
    }
  }

  for (const [provider, pModels] of byProvider) {
    if (provider === "antigravity-acp" || provider.includes("antigravity")) {
      rows.push(...buildAntigravityRows(provider, pModels, quotaSnapshot));
    } else {
      const quotaBadge = formatProviderQuotaBadge(provider, quotaSnapshot);
      rows.push({
        kind: "header",
        label: `── ${provider} `,
        provider,
        quotaBadge,
      });
      for (const candidate of pModels) {
        rows.push({ kind: "model", model: candidate });
      }
    }
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

export const countModels = (
  rows: Row[],
  winStart: number,
  winEnd: number
): number => {
  let count = 0;
  for (let i = winStart; i < winEnd; i += 1) {
    if (rows[i].kind === "model") {
      count += 1;
    }
  }
  return count;
};

export const getModelIndexInWindow = (
  rows: Row[],
  winStart: number,
  winEnd: number,
  cursor: number
): number => {
  let modelIndex = 0;
  for (let i = winStart; i < winEnd && i < cursor; i += 1) {
    if (rows[i].kind === "model") {
      modelIndex += 1;
    }
  }
  return modelIndex;
};

export const adjustScroll = (
  currentScroll: number,
  modelIndex: number,
  totalModels: number,
  visibleLimit: number = VISIBLE_ROWS
): number => {
  const maxScroll = Math.max(0, totalModels - visibleLimit);
  let scroll = Math.max(0, Math.min(currentScroll, maxScroll));
  if (modelIndex < scroll) {
    scroll = modelIndex;
  } else if (modelIndex >= scroll + visibleLimit) {
    scroll = modelIndex - visibleLimit + 1;
  }
  return Math.max(0, Math.min(scroll, maxScroll));
};

export const clampScroll = (
  rows: Row[],
  winStart: number,
  winEnd: number,
  scroll: number,
  visibleLimit: number = VISIBLE_ROWS
): number => {
  const total = countModels(rows, winStart, winEnd);
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
  if (data === "r" || data === "R") {
    return { type: "refresh_quota" };
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

export const formatFooterHelp = (
  modalKeys: ResolvedModalKeys,
  width: number
): string => {
  const nav = formatNavHint(modalKeys);
  const selKey = formatFirstKey(modalKeys.select, "enter");
  const thinkKey = formatFirstKey(modalKeys.thinking, "t");
  const defKey = formatFirstKey(modalKeys.default, "d");
  const favKey = formatFirstKey(modalKeys.favorite, "f");
  const hideKey = formatFirstKey(modalKeys.hide, "h");
  const blockKey = formatFirstKey(modalKeys.block, "b");
  const hidKey = formatFirstKey(modalKeys.toggleHidden, "v");
  const filtKey = formatFirstKey(modalKeys.filter, "/");
  const cancel = formatCancelHint(modalKeys.cancel);

  if (width >= 120) {
    return `${nav} nav • ${selKey} select • ${thinkKey} thinking • ${defKey} default • ${favKey} fav • ${hideKey} hide • ${blockKey} block • ${hidKey} hidden • ${filtKey} filter • r refresh • ${cancel} cancel`;
  }
  if (width >= 90) {
    return `${nav} • ${selKey} sel • ${thinkKey} think • ${defKey} def • ${favKey} fav • ${hideKey} hide • ${blockKey} blk • ${hidKey} hid • ${filtKey} filt • r sync • ${cancel} back`;
  }
  return `${nav} • ${selKey} • ${thinkKey} think • ${favKey} fav • ${defKey} def • ${hideKey} hide • ${hidKey} hid • ${filtKey} filt • r • ${cancel}`;
};

export interface FormatModelRowParams {
  m: Model<Api>;
  isAboveDivider: boolean;
  isFav: boolean;
  isHidden: boolean;
  isCurrent: boolean;
  isDef: boolean;
  thinkingLevel?: string;
  quotaBadge: string;
}

export const formatModelRowText = (params: FormatModelRowParams): string => {
  const {
    isAboveDivider,
    isCurrent,
    isDef,
    isFav,
    isHidden,
    m,
    quotaBadge,
    thinkingLevel,
  } = params;
  const showProvider = isAboveDivider || isHidden;
  const providerPart = showProvider ? ` (${m.provider})` : "";
  let star = "";
  if (isFav) {
    star = "★ ";
  } else if (!isAboveDivider) {
    star = "  ";
  }
  let thinkingBadge = "";
  if (thinkingLevel !== undefined && thinkingLevel.length > 0) {
    thinkingBadge = ` [thinking: ${thinkingLevel}]`;
  } else if (m.reasoning) {
    thinkingBadge = " [reasoning]";
  }
  const tags =
    (isCurrent ? " ●" : "") + (isDef ? " [default]" : "") + thinkingBadge;
  return `${star}${m.name}${providerPart}${quotaBadge}${tags}`;
};

export interface HeaderRenderOptions {
  label: string;
  provider?: string;
  subgroup?: string;
  quotaBadge?: QuotaBadgeResult;
}

export const formatHeaderLine = (
  label: string,
  provider: string | undefined,
  width: number,
  badgeText?: string,
  subgroup?: string,
  isSticky = false
): string => {
  if (provider === undefined && subgroup === undefined) {
    return label;
  }
  const badgePart =
    badgeText === undefined || badgeText.length === 0 ? " " : ` ${badgeText} `;
  let prefix = `── ${provider}${badgePart}`;
  if (subgroup !== undefined) {
    prefix = isSticky
      ? `── ${provider} › ${subgroup}${badgePart}`
      : `  ── ${subgroup}${badgePart}`;
  }
  const fill = "─".repeat(Math.max(0, width - prefix.length));
  return `${prefix}${fill}`;
};

const resolveHeaderBadge = (
  header: HeaderRenderOptions,
  quotaSnapshot?: QuotaSnapshot
): QuotaBadgeResult | undefined => {
  if (header.quotaBadge !== undefined) {
    return header.quotaBadge;
  }
  if (header.subgroup !== undefined) {
    return undefined;
  }
  if (header.provider !== undefined) {
    return formatProviderQuotaBadge(header.provider, quotaSnapshot);
  }
  return undefined;
};

export const renderHeaderRow = (
  theme: UiTheme,
  headerOrLabel: string | HeaderRenderOptions,
  providerOrWidth?: string | number,
  widthOrQuota?: number | QuotaSnapshot,
  quotaSnapshotOrSticky?: QuotaSnapshot | boolean,
  isStickyParam = false
): string => {
  let header: HeaderRenderOptions;
  let width = 80;
  let quotaSnapshot: QuotaSnapshot | undefined;
  let isSticky = isStickyParam;

  if (typeof headerOrLabel === "object") {
    header = headerOrLabel;
    if (typeof providerOrWidth === "number") {
      width = providerOrWidth;
    }
    if (typeof widthOrQuota === "object") {
      quotaSnapshot = widthOrQuota;
    }
    if (typeof quotaSnapshotOrSticky === "boolean") {
      isSticky = quotaSnapshotOrSticky;
    }
  } else {
    header = {
      label: headerOrLabel,
      provider:
        typeof providerOrWidth === "string" ? providerOrWidth : undefined,
    };
    if (typeof widthOrQuota === "number") {
      width = widthOrQuota;
    }
    if (typeof quotaSnapshotOrSticky === "object") {
      quotaSnapshot = quotaSnapshotOrSticky;
    }
  }

  const { provider, subgroup } = header;
  const badge = resolveHeaderBadge(header, quotaSnapshot);

  if (provider === undefined && subgroup === undefined) {
    return theme.fg("dim", header.label);
  }

  let prefix = `── ${provider} `;
  if (subgroup !== undefined) {
    prefix = isSticky ? `── ${provider} › ${subgroup} ` : `  ── ${subgroup} `;
  }

  if (badge === undefined) {
    const fill = "─".repeat(Math.max(0, width - prefix.length));
    return theme.fg("dim", `${prefix}${fill}`);
  }

  const fill = "─".repeat(
    Math.max(0, width - prefix.length - badge.text.length - 1)
  );
  return (
    theme.fg("dim", prefix) +
    theme.fg(badge.severity, badge.text) +
    theme.fg("dim", ` ${fill}`)
  );
};

export const findStickyHeader = (
  rows: Row[],
  start: number,
  winStart: number
): (Row & { kind: "header" }) | undefined => {
  if (start <= winStart || rows[start]?.kind !== "model") {
    return undefined;
  }
  for (let i = start - 1; i >= winStart; i -= 1) {
    const candidate = rows[i];
    if (candidate.kind === "header") {
      return candidate;
    }
  }
  return undefined;
};

export const isFilterAction = (act: PickerAction): act is FilterAction =>
  act.type === "filter_cancel" ||
  act.type === "filter_apply" ||
  act.type === "filter_backspace" ||
  act.type === "filter_char" ||
  act.type === "start_filter";

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
    let quotaSnapshot: QuotaSnapshot | undefined = getCachedQuota();
    const syncOpenCodeEnabled = config.syncOpenCode ?? true;
    let disabledSet = syncOpenCodeEnabled
      ? getCachedDisabledModels(agentDir)
      : new Set<string>();

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
        blockedList,
        disabledSet,
        quotaSnapshot
      );
    let rows = computeRows();
    let cursor = firstSelectable(rows);
    let favScroll = 0;
    let modelScroll = 0;

    const focusedModel = (): Model<Api> | undefined => {
      const r = rows[cursor];
      return r?.kind === "model" ? r.model : undefined;
    };

    const updateScroll = (): void => {
      const limit = getVisibleLimit();
      const dividerIdx = rows.findIndex((r) => r.kind === "divider");
      if (dividerIdx === -1) {
        const total = countModels(rows, 0, rows.length);
        const idx = getModelIndexInWindow(rows, 0, rows.length, cursor);
        modelScroll = adjustScroll(modelScroll, idx, total, limit);
      } else if (cursor < dividerIdx) {
        const total = countModels(rows, 0, dividerIdx);
        const idx = getModelIndexInWindow(rows, 0, dividerIdx, cursor);
        favScroll = adjustScroll(favScroll, idx, total, limit);
      } else {
        const total = countModels(rows, dividerIdx + 1, rows.length);
        const idx = getModelIndexInWindow(
          rows,
          dividerIdx + 1,
          rows.length,
          cursor
        );
        modelScroll = adjustScroll(modelScroll, idx, total, limit);
      }
    };

    const rebuild = (): void => {
      const target = focusedModel();
      const dividerIdx = rows.findIndex((r) => r.kind === "divider");
      const wasInFavorites = dividerIdx !== -1 && cursor < dividerIdx;

      rows = computeRows();
      const newDividerIdx = rows.findIndex((r) => r.kind === "divider");

      if (target === undefined) {
        cursor = nearestSelectable(rows, cursor);
      } else {
        const targetKey = modelKey(target);
        if (wasInFavorites) {
          const favEnd = newDividerIdx === -1 ? 0 : newDividerIdx;
          const favIdx = rows.findIndex(
            (r, idx) =>
              idx < favEnd &&
              r.kind === "model" &&
              modelKey(r.model) === targetKey
          );
          cursor = favIdx === -1 ? nearestSelectable(rows, cursor) : favIdx;
        } else {
          const searchStart = newDividerIdx === -1 ? 0 : newDividerIdx + 1;
          const providerIdx = rows.findIndex(
            (r, idx) =>
              idx >= searchStart &&
              r.kind === "model" &&
              modelKey(r.model) === targetKey
          );
          cursor =
            providerIdx === -1 ? nearestSelectable(rows, cursor) : providerIdx;
        }
      }

      updateScroll();
      cached = undefined;
    };

    void fetchQuota(pi, agentDir).then((fresh) => {
      if (fresh !== undefined) {
        quotaSnapshot = fresh;
        rebuild();
        version += 1;
        cached = undefined;
        tui.requestRender();
      }
      return null;
    });

    if (syncOpenCodeEnabled) {
      void syncOpenCodeDisabledModels(agentDir).then((res) => {
        if (res.changed) {
          disabledSet = res.disabled;
          rebuild();
          version += 1;
          cached = undefined;
          tui.requestRender();
        }
        return null;
      });
    }

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
        scroll: number,
        limit: number = getVisibleLimit()
      ): void => {
        const slice = windowSlice(rows, winStart, winEnd, scroll, limit);

        const sticky = findStickyHeader(rows, slice.start, winStart);
        if (sticky !== undefined) {
          lines.push(
            renderHeaderRow(theme, sticky, width, quotaSnapshot, true)
          );
        }

        if (slice.moreAbove) {
          const label = scroll === 1 ? "1 more above" : `${scroll} more above`;
          lines.push(theme.fg("dim", `  ▲ (${label})`));
        }

        for (let i = slice.start; i < slice.end; i += 1) {
          const row = rows[i];
          if (row.kind === "header") {
            lines.push(
              renderHeaderRow(theme, row, width, quotaSnapshot, false)
            );
          } else if (row.kind === "model") {
            hasSelectable = true;
            const m = row.model;
            const key = modelKey(m);
            const isCurrent = key === currentKey;
            const isFav = favSet.has(key);
            const isDef = isDefault(m);
            const isHidden = hiddenSet.has(key);
            const isAboveDivider = dividerIdx !== -1 && i < dividerIdx;
            const level =
              modelThinking[key] ??
              (isCurrent ? currentThinkingLevel : undefined);

            const quota = isAboveDivider
              ? formatModelQuotaBadge(m, quotaSnapshot)
              : undefined;
            let quotaBadge = "";
            if (quota !== undefined) {
              quotaBadge =
                i === cursor
                  ? ` ${quota.text}`
                  : ` ${theme.fg(quota.severity, quota.text)}`;
            }

            const text = formatModelRowText({
              isAboveDivider,
              isCurrent,
              isDef,
              isFav,
              isHidden,
              m,
              quotaBadge,
              thinkingLevel: level,
            });

            if (i === cursor) {
              lines.push(
                theme.bg("selectedBg", theme.fg("accent", `▸ ${text}`))
              );
            } else if (isHidden) {
              lines.push(theme.fg("dim", `  ${text}`));
            } else {
              lines.push(`  ${text}`);
            }
          }
        }
        if (slice.moreBelow) {
          const total = countModels(rows, winStart, winEnd);
          const modelsInSlice = countModels(rows, slice.start, slice.end);
          const countBelow = Math.max(0, total - scroll - modelsInSlice);
          const label =
            countBelow === 1 ? "1 more below" : `${countBelow} more below`;
          lines.push(theme.fg("dim", `  ▼ (${label})`));
        }
      };

      const limit = getVisibleLimit();
      if (dividerIdx === -1) {
        renderWindow(0, rows.length, modelScroll, limit);
      } else {
        renderWindow(0, dividerIdx, favScroll, limit);
        lines.push(theme.fg("border", "─".repeat(Math.max(1, width))));
        renderWindow(dividerIdx + 1, rows.length, modelScroll, limit);
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
        lines.push(theme.fg("dim", formatFooterHelp(modalKeys, width)));
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

    const handleFilterInput = (action: FilterAction): void => {
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
        default: {
          break;
        }
      }
    };

    const handlePickerInput = (data: string): void => {
      const action = resolvePickerAction(data, filtering, modalKeys);
      if (isFilterAction(action)) {
        handleFilterInput(action);
        return;
      }
      switch (action.type) {
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
        case "refresh_quota": {
          void fetchQuota(pi, agentDir).then((fresh) => {
            if (fresh !== undefined) {
              quotaSnapshot = fresh;
              rebuild();
              version += 1;
              cached = undefined;
              tui.requestRender();
            }
            return null;
          });
          if (syncOpenCodeEnabled) {
            void syncOpenCodeDisabledModels(agentDir, true).then((res) => {
              if (res.changed) {
                disabledSet = res.disabled;
                rebuild();
                version += 1;
                cached = undefined;
                tui.requestRender();
              }
              return null;
            });
          }
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
