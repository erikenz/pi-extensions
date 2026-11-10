import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  KeyBindingSetting,
  ModalKeyConfig,
  ModelSwitchConfig,
  ResolvedModalKeys,
  ResolvedShortcuts,
  ShortcutConfig,
} from "./types.ts";

export const modelKey = (m: Model<Api>): string => `${m.provider}/${m.id}`;

export const DEFAULT_SHORTCUTS: ResolvedShortcuts = {
  open: ["alt+m"],
  cycleNext: ["ctrl+alt+p"],
  cyclePrev: ["ctrl+alt+shift+p"],
  thinkingNext: ["alt+t"],
  thinkingPrev: ["alt+shift+t"],
};

export const DEFAULT_MODAL_KEYS: ResolvedModalKeys = {
  up: ["k", "K", "up"],
  down: ["j", "J", "down"],
  first: ["g", "home"],
  last: ["G", "end", "shift+g"],
  select: ["enter"],
  cancel: ["q", "Q", "escape", "esc"],
  thinking: ["t", "T", "e", "E"],
  favorite: ["f", "F"],
  default: ["d", "D"],
  hide: ["h", "H"],
  toggleHidden: ["v", "V"],
  filter: ["/"],
  block: ["b", "B"],
};

export function normalizeKeyList(
  setting: KeyBindingSetting | undefined,
  fallback: string[],
): string[] {
  if (setting === undefined) {
    return [...fallback];
  }
  if (setting === null || setting === false || setting === "") {
    return [];
  }
  const rawList = Array.isArray(setting) ? setting : [setting];
  const result: string[] = [];
  for (const item of rawList) {
    const trimmed = String(item).trim();
    if (!trimmed) continue;
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
    if (trimmed.length === 1 && /[a-zA-Z]/.test(trimmed) && trimmed !== "g" && trimmed !== "G") {
      const alt = trimmed === trimmed.toLowerCase() ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (!result.includes(alt)) {
        result.push(alt);
      }
    }
  }
  return result;
}

export function resolveShortcuts(custom?: ShortcutConfig): ResolvedShortcuts {
  return {
    open: normalizeKeyList(custom?.open, DEFAULT_SHORTCUTS.open),
    cycleNext: normalizeKeyList(custom?.cycleNext, DEFAULT_SHORTCUTS.cycleNext),
    cyclePrev: normalizeKeyList(custom?.cyclePrev, DEFAULT_SHORTCUTS.cyclePrev),
    thinkingNext: normalizeKeyList(custom?.thinkingNext, DEFAULT_SHORTCUTS.thinkingNext),
    thinkingPrev: normalizeKeyList(custom?.thinkingPrev, DEFAULT_SHORTCUTS.thinkingPrev),
  };
}

export function resolveModalKeys(custom?: ModalKeyConfig): ResolvedModalKeys {
  return {
    up: normalizeKeyList(custom?.up, DEFAULT_MODAL_KEYS.up),
    down: normalizeKeyList(custom?.down, DEFAULT_MODAL_KEYS.down),
    first: normalizeKeyList(custom?.first, DEFAULT_MODAL_KEYS.first),
    last: normalizeKeyList(custom?.last, DEFAULT_MODAL_KEYS.last),
    select: normalizeKeyList(custom?.select, DEFAULT_MODAL_KEYS.select),
    cancel: normalizeKeyList(custom?.cancel, DEFAULT_MODAL_KEYS.cancel),
    thinking: normalizeKeyList(custom?.thinking, DEFAULT_MODAL_KEYS.thinking),
    favorite: normalizeKeyList(custom?.favorite, DEFAULT_MODAL_KEYS.favorite),
    default: normalizeKeyList(custom?.default, DEFAULT_MODAL_KEYS.default),
    hide: normalizeKeyList(custom?.hide, DEFAULT_MODAL_KEYS.hide),
    toggleHidden: normalizeKeyList(custom?.toggleHidden, DEFAULT_MODAL_KEYS.toggleHidden),
    filter: normalizeKeyList(custom?.filter, DEFAULT_MODAL_KEYS.filter),
    block: normalizeKeyList(custom?.block, DEFAULT_MODAL_KEYS.block),
  };
}

export function configPath(): string {
  return join(getAgentDir(), "model-switch.json");
}

export function matchesBlockPattern(
  pattern: string,
  model: { provider: string; id: string },
): boolean {
  const p = pattern.trim();
  if (!p) return false;

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
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const regex = new RegExp(`^${escaped}$`, "i");

    if (p.includes("/")) {
      return regex.test(key);
    }
    return regex.test(key) || regex.test(id);
  }

  return pLower === key;
}

export function isModelBlocked(
  model: { provider: string; id: string },
  blocklist?: string[],
): boolean {
  if (!blocklist || !Array.isArray(blocklist) || blocklist.length === 0) {
    return false;
  }
  return blocklist.some((pattern) => matchesBlockPattern(pattern, model));
}

export function addBlockedPattern(pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  const config = loadConfig();
  const blocked = config.blocked ?? [];
  if (blocked.includes(p)) return false;
  blocked.push(p);
  // Also remove exact or matching model keys from favorites
  const favorites = config.favorites.filter((fav) => {
    if (fav === p) return false;
    const [provider, ...rest] = fav.split("/");
    return !matchesBlockPattern(p, { provider, id: rest.join("/") });
  });
  saveConfig({ ...config, favorites, blocked });
  return true;
}

export function removeBlockedPattern(pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  const config = loadConfig();
  const blocked = config.blocked ?? [];
  const idx = blocked.indexOf(p);
  if (idx === -1) return false;
  blocked.splice(idx, 1);
  saveConfig({ ...config, blocked });
  return true;
}

export function loadConfig(): ModelSwitchConfig {
  const filePath = configPath();

  if (!existsSync(filePath)) {
    return { favorites: [], hidden: [], blocked: [] };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ModelSwitchConfig & { blocklist?: string[]; models?: Record<string, { disabled?: boolean }> }>;
    const blocked: string[] = Array.isArray(parsed.blocked)
      ? [...parsed.blocked]
      : Array.isArray(parsed.blocklist)
        ? [...parsed.blocklist]
        : [];

    if (typeof parsed.models === "object" && parsed.models !== null) {
      for (const [key, val] of Object.entries(parsed.models)) {
        if (typeof val === "object" && val !== null && val.disabled === true) {
          if (!blocked.includes(key)) {
            blocked.push(key);
          }
        }
      }
    }
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      blocked,
      modelThinking:
        typeof parsed.modelThinking === "object" && parsed.modelThinking !== null
          ? (parsed.modelThinking as Record<string, string>)
          : {},
      shortcuts:
        typeof parsed.shortcuts === "object" && parsed.shortcuts !== null
          ? (parsed.shortcuts as ShortcutConfig)
          : undefined,
      modalKeys:
        typeof parsed.modalKeys === "object" && parsed.modalKeys !== null
          ? (parsed.modalKeys as ModalKeyConfig)
          : undefined,
    };
  } catch {
    return { favorites: [], hidden: [], blocked: [], modelThinking: {} };
  }
}

export function saveConfig(
  newConfig: Partial<ModelSwitchConfig & { models?: Record<string, { disabled?: boolean }> }> & {
    favorites: string[];
    hidden: string[];
    blocked?: string[];
  },
): void {
  try {
    let existing: Partial<
      ModelSwitchConfig & { blocklist?: string[]; models?: Record<string, { disabled?: boolean }> }
    > = {};
    const filePath = configPath();
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ModelSwitchConfig & { blocklist?: string[] }>;
      } catch {
        existing = {};
      }
    }
    const merged: ModelSwitchConfig & { models?: Record<string, { disabled?: boolean }> } = {
      favorites: newConfig.favorites,
      hidden: newConfig.hidden,
      blocked: newConfig.blocked ?? existing.blocked ?? existing.blocklist ?? [],
      modelThinking: newConfig.modelThinking ?? existing.modelThinking ?? {},
      shortcuts: newConfig.shortcuts ?? existing.shortcuts,
      modalKeys: newConfig.modalKeys ?? existing.modalKeys,
    };
    if ((newConfig as any).models ?? existing.models) {
      merged.models = (newConfig as any).models ?? existing.models;
    }
    const content = JSON.stringify(merged, null, 2);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  } catch {
    // Best-effort: failures must not crash caller
  }
}
