import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isModelBlocked, loadConfig, modelKey, saveConfig } from "./config.ts";
import { LEVEL_DESCRIPTIONS } from "./picker.ts";

export function getNextFavoriteKey(
  favorites: string[],
  currentKey: string | undefined,
  direction: 1 | -1,
): string | null {
  if (!favorites || favorites.length === 0) return null;

  const currentIndex = currentKey ? favorites.indexOf(currentKey) : -1;
  let nextIndex: number;

  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : favorites.length - 1;
  } else {
    nextIndex = (currentIndex + direction + favorites.length) % favorites.length;
  }

  return favorites[nextIndex];
}

export function getNextThinkingLevel(
  levels: string[],
  currentLevel: string | undefined,
  direction: 1 | -1,
): string | null {
  if (!levels || levels.length === 0) return null;

  const currentIndex = currentLevel ? levels.indexOf(currentLevel) : -1;
  let nextIndex: number;

  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : levels.length - 1;
  } else {
    nextIndex = (currentIndex + direction + levels.length) % levels.length;
  }

  return levels[nextIndex];
}

export async function cycleFavorites(
  direction: 1 | -1,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<boolean> {
  const config = loadConfig();
  const blockedList = config.blocked ?? [];

  // Filter out any favorites that match the blocklist
  const activeFavorites = config.favorites.filter((fav) => {
    const [provider, ...rest] = fav.split("/");
    const id = rest.join("/");
    return !isModelBlocked({ provider, id }, blockedList);
  });

  if (activeFavorites.length === 0) {
    ctx.ui.notify(
      config.favorites.length > 0
        ? "All configured favorite models are currently blocked."
        : "No favorite models configured. Press Alt+M and press 'f' on models to add favorites.",
      "warning",
    );
    return false;
  }

  const currentKey = ctx.model ? modelKey(ctx.model) : undefined;
  const nextKey = getNextFavoriteKey(activeFavorites, currentKey, direction);

  if (!nextKey) return false;

  const [provider, ...rest] = nextKey.split("/");
  const modelId = rest.join("/");

  const targetModel = ctx.modelRegistry.find(provider, modelId);
  if (!targetModel) {
    ctx.ui.notify(`Model "${nextKey}" not found or provider not configured.`, "error");
    return false;
  }

  if (isModelBlocked(targetModel, blockedList)) {
    ctx.ui.notify(`Cannot switch to "${nextKey}": model is blocked.`, "warning");
    return false;
  }

  const success = await pi.setModel(targetModel);
  if (success) {
    let thinkingSuffix = "";
    const savedThinking = config.modelThinking?.[nextKey];
    if (savedThinking && typeof (pi as any).setThinkingLevel === "function") {
      (pi as any).setThinkingLevel(savedThinking);
      thinkingSuffix = ` [thinking: ${savedThinking}]`;
    }
    ctx.ui.notify(`★ ${targetModel.name || targetModel.id} (${targetModel.provider})${thinkingSuffix}`, "info");
    return true;
  } else {
    ctx.ui.notify(
      `Could not switch to ${targetModel.name || targetModel.id} (provider credentials missing)`,
      "error",
    );
    return false;
  }
}

export async function cycleThinkingLevel(
  direction: 1 | -1,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (!ctx.model) {
    ctx.ui.notify("No active model to change thinking level for.", "warning");
    return false;
  }

  const levels = getSupportedThinkingLevels(ctx.model);
  if (levels.length <= 1 && levels[0] === "off") {
    ctx.ui.notify(`${ctx.model.name} does not support thinking / reasoning`, "warning");
    return false;
  }

  const currentLevel =
    typeof (pi as any).getThinkingLevel === "function"
      ? ((pi as any).getThinkingLevel() as string | undefined)
      : undefined;

  const nextLevel = getNextThinkingLevel(levels, currentLevel, direction);
  if (!nextLevel) return false;

  if (typeof (pi as any).setThinkingLevel === "function") {
    (pi as any).setThinkingLevel(nextLevel);
  }

  const config = loadConfig();
  const key = modelKey(ctx.model);
  config.modelThinking = { ...(config.modelThinking ?? {}), [key]: nextLevel };
  saveConfig(config);

  const desc = LEVEL_DESCRIPTIONS[nextLevel] ?? nextLevel;
  ctx.ui.notify(`🧠 Thinking: ${nextLevel} (${desc})`, "info");
  return true;
}


