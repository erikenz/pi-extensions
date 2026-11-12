import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  KeyBindingSetting,
  ModalKeyConfig,
  ModelLike,
  ModelSwitchConfig,
  ResolvedModalKeys,
  ResolvedShortcuts,
  ShortcutConfig,
} from "./types.ts";

export const modelKey = (m: ModelLike): string => `${m.provider}/${m.id}`;

export const DEFAULT_SHORTCUTS: ResolvedShortcuts = {
  cycleNext: ["ctrl+alt+p"],
  cyclePrev: ["ctrl+alt+shift+p"],
  open: ["alt+m"],
  thinkingNext: ["alt+t"],
  thinkingPrev: ["alt+shift+t"],
};

export const DEFAULT_MODAL_KEYS: ResolvedModalKeys = {
  block: ["b", "B"],
  cancel: ["q", "Q", "escape", "esc"],
  default: ["d", "D"],
  down: ["j", "J", "down"],
  favorite: ["f", "F"],
  filter: ["/"],
  first: ["g", "home"],
  hide: ["h", "H"],
  last: ["G", "end", "shift+g"],
  select: ["enter"],
  thinking: ["t", "T", "e", "E"],
  toggleHidden: ["v", "V"],
  up: ["k", "K", "up"],
};

export const normalizeKeyList = (
  setting: KeyBindingSetting | undefined,
  fallback: string[]
): string[] => {
  if (setting === undefined) {
    return [...fallback];
  }
  if (setting === null || setting === false || setting === "") {
    return [];
  }
  const rawList = Array.isArray(setting) ? setting : [setting];
  const result: string[] = [];
  for (const item of rawList) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
    if (
      trimmed.length === 1 &&
      /[a-zA-Z]/u.test(trimmed) &&
      trimmed !== "g" &&
      trimmed !== "G"
    ) {
      const alt =
        trimmed === trimmed.toLowerCase()
          ? trimmed.toUpperCase()
          : trimmed.toLowerCase();
      if (!result.includes(alt)) {
        result.push(alt);
      }
    }
  }
  return result;
};

export const resolveShortcuts = (
  custom?: ShortcutConfig
): ResolvedShortcuts => ({
  cycleNext: normalizeKeyList(custom?.cycleNext, DEFAULT_SHORTCUTS.cycleNext),
  cyclePrev: normalizeKeyList(custom?.cyclePrev, DEFAULT_SHORTCUTS.cyclePrev),
  open: normalizeKeyList(custom?.open, DEFAULT_SHORTCUTS.open),
  thinkingNext: normalizeKeyList(
    custom?.thinkingNext,
    DEFAULT_SHORTCUTS.thinkingNext
  ),
  thinkingPrev: normalizeKeyList(
    custom?.thinkingPrev,
    DEFAULT_SHORTCUTS.thinkingPrev
  ),
});

export const resolveModalKeys = (
  custom?: ModalKeyConfig
): ResolvedModalKeys => ({
  block: normalizeKeyList(custom?.block, DEFAULT_MODAL_KEYS.block),
  cancel: normalizeKeyList(custom?.cancel, DEFAULT_MODAL_KEYS.cancel),
  default: normalizeKeyList(custom?.default, DEFAULT_MODAL_KEYS.default),
  down: normalizeKeyList(custom?.down, DEFAULT_MODAL_KEYS.down),
  favorite: normalizeKeyList(custom?.favorite, DEFAULT_MODAL_KEYS.favorite),
  filter: normalizeKeyList(custom?.filter, DEFAULT_MODAL_KEYS.filter),
  first: normalizeKeyList(custom?.first, DEFAULT_MODAL_KEYS.first),
  hide: normalizeKeyList(custom?.hide, DEFAULT_MODAL_KEYS.hide),
  last: normalizeKeyList(custom?.last, DEFAULT_MODAL_KEYS.last),
  select: normalizeKeyList(custom?.select, DEFAULT_MODAL_KEYS.select),
  thinking: normalizeKeyList(custom?.thinking, DEFAULT_MODAL_KEYS.thinking),
  toggleHidden: normalizeKeyList(
    custom?.toggleHidden,
    DEFAULT_MODAL_KEYS.toggleHidden
  ),
  up: normalizeKeyList(custom?.up, DEFAULT_MODAL_KEYS.up),
});

export const configPath = (): string =>
  path.join(getAgentDir(), "model-switch.json");

export const matchesBlockPattern = (
  pattern: string,
  model: ModelLike
): boolean => {
  const p = pattern.trim();
  if (p.length === 0) {
    return false;
  }

  const key = `${model.provider}/${model.id}`.toLowerCase();
  const id = model.id.toLowerCase();
  const pLower = p.toLowerCase();

  // Fast path for exact matches
  if (pLower === key || (!pLower.includes("/") && pLower === id)) {
    return true;
  }

  // If pattern contains glob wildcards (* or ?)
  if (p.includes("*") || p.includes("?")) {
    const escaped = pLower
      .replaceAll(/[.+^${}()|[\]\\]/gu, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".");
    const regex = new RegExp(`^${escaped}$`, "iu");

    if (p.includes("/")) {
      return regex.test(key);
    }
    return regex.test(key) || regex.test(id);
  }

  return pLower === key;
};

export const isModelBlocked = (
  model: ModelLike,
  blocklist?: string[]
): boolean => {
  if (
    blocklist === undefined ||
    !Array.isArray(blocklist) ||
    blocklist.length === 0
  ) {
    return false;
  }
  return blocklist.some((pattern) => matchesBlockPattern(pattern, model));
};

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

const toStringArray = (val: unknown): string[] => {
  if (!Array.isArray(val)) {
    return [];
  }
  const result: string[] = [];
  for (const item of val) {
    if (typeof item === "string") {
      result.push(item);
    }
  }
  return result;
};

const toStringRecord = (val: unknown): Record<string, string> => {
  if (!isRecord(val)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === "string") {
      result[k] = v;
    }
  }
  return result;
};

export const loadConfig = (): ModelSwitchConfig => {
  const filePath = configPath();

  if (!existsSync(filePath)) {
    return { blocked: [], favorites: [], hidden: [] };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { blocked: [], favorites: [], hidden: [] };
    }

    const blocked = toStringArray(parsed.blocked);
    if (blocked.length === 0 && Array.isArray(parsed.blocklist)) {
      blocked.push(...toStringArray(parsed.blocklist));
    }

    let models: Record<string, { disabled?: boolean }> | undefined;
    if (isRecord(parsed.models)) {
      models = {};
      for (const [key, val] of Object.entries(parsed.models)) {
        if (isRecord(val) && typeof val.disabled === "boolean") {
          models[key] = { disabled: val.disabled };
          if (val.disabled && !blocked.includes(key)) {
            blocked.push(key);
          }
        }
      }
    }

    const modalKeys = isRecord(parsed.modalKeys)
      ? (parsed.modalKeys as ModalKeyConfig)
      : undefined;
    const shortcuts = isRecord(parsed.shortcuts)
      ? (parsed.shortcuts as ShortcutConfig)
      : undefined;
    const syncOpenCode =
      typeof parsed.syncOpenCode === "boolean"
        ? parsed.syncOpenCode
        : undefined;

    return {
      blocked,
      favorites: toStringArray(parsed.favorites),
      hidden: toStringArray(parsed.hidden),
      modalKeys,
      modelThinking: toStringRecord(parsed.modelThinking),
      models,
      shortcuts,
      syncOpenCode,
    };
  } catch {
    return { blocked: [], favorites: [], hidden: [], modelThinking: {} };
  }
};

export const saveConfig = (
  newConfig: Partial<ModelSwitchConfig> & {
    favorites: string[];
    hidden: string[];
    blocked?: string[];
  }
): void => {
  try {
    const existing = loadConfig();
    const filePath = configPath();
    const merged: ModelSwitchConfig = {
      blocked: newConfig.blocked ?? existing.blocked,
      favorites: newConfig.favorites,
      hidden: newConfig.hidden,
      modalKeys: newConfig.modalKeys ?? existing.modalKeys,
      modelThinking: newConfig.modelThinking ?? existing.modelThinking ?? {},
      shortcuts: newConfig.shortcuts ?? existing.shortcuts,
      syncOpenCode: newConfig.syncOpenCode ?? existing.syncOpenCode,
    };
    if (newConfig.models !== undefined || existing.models !== undefined) {
      merged.models = newConfig.models ?? existing.models;
    }
    const content = JSON.stringify(merged, null, 2);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  } catch {
    // Best-effort: failures must not crash caller
  }
};

export const addBlockedPattern = (pattern: string): boolean => {
  const p = pattern.trim();
  if (p.length === 0) {
    return false;
  }
  const config = loadConfig();
  const blocked = config.blocked ?? [];
  if (blocked.includes(p)) {
    return false;
  }
  blocked.push(p);
  // Also remove exact or matching model keys from favorites
  const favorites = config.favorites.filter((fav) => {
    if (fav === p) {
      return false;
    }
    const [provider, ...rest] = fav.split("/");
    return !matchesBlockPattern(p, { id: rest.join("/"), provider });
  });
  saveConfig({ ...config, blocked, favorites });
  return true;
};

export const removeBlockedPattern = (pattern: string): boolean => {
  const p = pattern.trim();
  if (p.length === 0) {
    return false;
  }
  const config = loadConfig();
  const blocked = config.blocked ?? [];
  const idx = blocked.indexOf(p);
  if (idx === -1) {
    return false;
  }
  blocked.splice(idx, 1);
  saveConfig({ ...config, blocked });
  return true;
};
