import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { isModelBlocked, loadConfig, modelKey, saveConfig } from "./config.ts";
import { isThinkingLevel, LEVEL_DESCRIPTIONS } from "./types.ts";

export const getNextFavoriteKey = (
  favorites: string[],
  currentKey: string | undefined,
  direction: 1 | -1
): string | null => {
  if (favorites.length === 0) {
    return null;
  }

  const currentIndex =
    currentKey === undefined ? -1 : favorites.indexOf(currentKey);
  let nextIndex: number;

  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : favorites.length - 1;
  } else {
    nextIndex =
      (currentIndex + direction + favorites.length) % favorites.length;
  }

  return favorites[nextIndex] ?? null;
};

export const getNextThinkingLevel = (
  levels: string[],
  currentLevel: string | undefined,
  direction: 1 | -1
): string | null => {
  if (levels.length === 0) {
    return null;
  }

  const currentIndex =
    currentLevel === undefined ? -1 : levels.indexOf(currentLevel);
  let nextIndex: number;

  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : levels.length - 1;
  } else {
    nextIndex = (currentIndex + direction + levels.length) % levels.length;
  }

  return levels[nextIndex] ?? null;
};

export const cycleFavorites = async (
  direction: 1 | -1,
  pi: ExtensionAPI,
  ctx: ExtensionContext
): Promise<boolean> => {
  const config = loadConfig();
  const blockedList = config.blocked;

  // Filter out any favorites that match the blocklist
  const activeFavorites = config.favorites.filter((fav) => {
    const [provider, ...rest] = fav.split("/");
    const id = rest.join("/");
    return !isModelBlocked({ id, provider }, blockedList);
  });

  if (activeFavorites.length === 0) {
    ctx.ui.notify(
      config.favorites.length > 0
        ? "All configured favorite models are currently blocked."
        : "No favorite models configured. Press Alt+M and press 'f' on models to add favorites.",
      "warning"
    );
    return false;
  }

  const currentKey = ctx.model === undefined ? undefined : modelKey(ctx.model);
  const nextKey = getNextFavoriteKey(activeFavorites, currentKey, direction);

  if (nextKey === null) {
    return false;
  }

  const [provider, ...rest] = nextKey.split("/");
  const modelId = rest.join("/");

  const targetModel = ctx.modelRegistry
    .getAll()
    .find((m) => m.provider === provider && m.id === modelId);

  if (targetModel === undefined) {
    ctx.ui.notify(
      `Model "${nextKey}" not found or provider not configured.`,
      "error"
    );
    return false;
  }

  if (isModelBlocked(targetModel, blockedList)) {
    ctx.ui.notify(
      `Cannot switch to "${nextKey}": model is blocked.`,
      "warning"
    );
    return false;
  }

  const success = await pi.setModel(targetModel);
  if (success) {
    let thinkingSuffix = "";
    const savedThinking = config.modelThinking?.[nextKey];
    if (savedThinking !== undefined && isThinkingLevel(savedThinking)) {
      pi.setThinkingLevel(savedThinking);
      thinkingSuffix = ` [thinking: ${savedThinking}]`;
    }
    const displayName =
      targetModel.name.length > 0 ? targetModel.name : targetModel.id;
    ctx.ui.notify(
      `★ ${displayName} (${targetModel.provider})${thinkingSuffix}`,
      "info"
    );
    return true;
  }
  const failedName =
    targetModel.name.length > 0 ? targetModel.name : targetModel.id;
  ctx.ui.notify(
    `Could not switch to ${failedName} (provider credentials missing)`,
    "error"
  );
  return false;
};

export const cycleThinkingLevel = (
  direction: 1 | -1,
  pi: ExtensionAPI,
  ctx: ExtensionContext
): boolean => {
  if (ctx.model === undefined) {
    ctx.ui.notify("No active model to change thinking level for.", "warning");
    return false;
  }

  const levels = getSupportedThinkingLevels(ctx.model);
  if (levels.length <= 1 && levels[0] === "off") {
    ctx.ui.notify(
      `${ctx.model.name} does not support thinking / reasoning`,
      "warning"
    );
    return false;
  }

  const currentLevel = pi.getThinkingLevel();
  const nextLevel = getNextThinkingLevel(levels, currentLevel, direction);
  if (nextLevel === null) {
    return false;
  }

  if (isThinkingLevel(nextLevel)) {
    pi.setThinkingLevel(nextLevel);
  }

  const config = loadConfig();
  const key = modelKey(ctx.model);
  config.modelThinking = { ...config.modelThinking, [key]: nextLevel };
  saveConfig(config);

  const desc = LEVEL_DESCRIPTIONS[nextLevel] ?? nextLevel;
  ctx.ui.notify(`🧠 Thinking: ${nextLevel} (${desc})`, "info");
  return true;
};
