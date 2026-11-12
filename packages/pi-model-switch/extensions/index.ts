import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

import {
  addBlockedPattern,
  isModelBlocked,
  loadConfig,
  removeBlockedPattern,
  resolveShortcuts,
} from "../src/config.ts";
import { cycleFavorites, cycleThinkingLevel } from "../src/cycling.ts";
import {
  getCachedDisabledModels,
  isOpenCodeDisabled,
  syncOpenCodeDisabledModels,
} from "../src/opencode.ts";
import { openModelPickerModal } from "../src/picker.ts";
import type { ModelLike } from "../src/types.ts";

const isKeyId = (value: string): value is KeyId => value.trim().length > 0;

const registerSafeShortcut = (
  pi: ExtensionAPI,
  shortcut: string,
  description: string,
  handler: (ctx: ExtensionContext) => Promise<void> | void
): void => {
  try {
    if (isKeyId(shortcut)) {
      pi.registerShortcut(shortcut, {
        description,
        handler,
      });
    }
  } catch {
    // Ignore shortcut conflict or invalid shortcut string
  }
};

const handleBlockCommand = async (
  pattern: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<void> => {
  if (pattern.length === 0) {
    ctx.ui.notify(
      "Usage: /model-switch block <provider/model or glob pattern>",
      "warning"
    );
    return;
  }
  const added = addBlockedPattern(pattern);
  if (added) {
    ctx.ui.notify(`Blocked "${pattern}".`, "info");
    if (ctx.model !== undefined && isModelBlocked(ctx.model, [pattern])) {
      const available = ctx.modelRegistry.getAvailable();
      const configNow = loadConfig();
      const fallback = available.find(
        (m) => !isModelBlocked(m, configNow.blocked)
      );
      if (fallback !== undefined) {
        await pi.setModel(fallback);
        const name = fallback.name.length > 0 ? fallback.name : fallback.id;
        ctx.ui.notify(
          `Active model matched blocklist; switched to ${name}.`,
          "info"
        );
      }
    }
  } else {
    ctx.ui.notify(`"${pattern}" is already in the blocklist.`, "info");
  }
};

const handleUnblockCommand = (
  pattern: string,
  ctx: ExtensionCommandContext
): void => {
  if (pattern.length === 0) {
    ctx.ui.notify("Usage: /model-switch unblock <pattern>", "warning");
    return;
  }
  const removed = removeBlockedPattern(pattern);
  if (removed) {
    ctx.ui.notify(`Unblocked "${pattern}".`, "info");
  } else {
    ctx.ui.notify(`"${pattern}" was not found in blocklist.`, "warning");
  }
};

const handleListBlockedCommand = (ctx: ExtensionCommandContext): void => {
  const currentConfig = loadConfig();
  const list = currentConfig.blocked;
  if (list.length === 0) {
    ctx.ui.notify("No models currently blocked.", "info");
  } else {
    ctx.ui.notify(
      `Blocked models/patterns (${list.length}):\n• ${list.join("\n• ")}`,
      "info"
    );
  }
};

const handleCommandDispatch = async (
  raw: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<void> => {
  const lower = raw.toLowerCase();
  if (lower === "cycle" || lower === "next" || lower === "cycle next") {
    await cycleFavorites(1, pi, ctx);
  } else if (
    lower === "prev" ||
    lower === "previous" ||
    lower === "cycle prev"
  ) {
    await cycleFavorites(-1, pi, ctx);
  } else if (
    lower === "thinking" ||
    lower === "thinking next" ||
    lower === "t"
  ) {
    cycleThinkingLevel(1, pi, ctx);
  } else if (lower === "thinking prev" || lower === "t prev") {
    cycleThinkingLevel(-1, pi, ctx);
  } else if (lower.startsWith("block ")) {
    await handleBlockCommand(raw.slice(6).trim(), pi, ctx);
  } else if (lower.startsWith("unblock ")) {
    handleUnblockCommand(raw.slice(8).trim(), ctx);
  } else if (lower === "blocked" || lower === "list-blocked") {
    handleListBlockedCommand(ctx);
  } else if (
    lower === "sync" ||
    lower === "sync-models" ||
    lower === "refresh-models"
  ) {
    ctx.ui.notify("Syncing OpenCode console configuration...", "info");
    const res = await syncOpenCodeDisabledModels(getAgentDir(), true);
    ctx.ui.notify(
      `OpenCode sync complete: ${res.disabled.size} disabled models filtered.`,
      "info"
    );
  } else {
    await openModelPickerModal(pi, ctx);
  }
};

const isModelUnavailable = (
  model: ModelLike,
  blockedList: string[],
  disabledSet: Set<string>
): boolean =>
  isModelBlocked(model, blockedList) || isOpenCodeDisabled(model, disabledSet);

const modelSwitchExtension = (pi: ExtensionAPI): void => {
  // Command: /model-switch [cycle [next|prev] | thinking [next|prev] | block <id> | unblock <id> | blocked]
  pi.registerCommand("model-switch", {
    description:
      "Open the favorite model picker modal, cycle favorites, manage blocklist, or cycle thinking level",
    handler: async (args, ctx) => {
      const raw = args === undefined ? "" : args.trim();
      await handleCommandDispatch(raw, pi, ctx);
    },
  });

  // Alias: /m
  try {
    pi.registerCommand("m", {
      description: "Open model favorites picker",
      handler: async (_args, ctx) => {
        await openModelPickerModal(pi, ctx);
      },
    });
  } catch {
    // If /m is already registered by another extension, /model-switch remains available
  }

  const config = loadConfig();
  const shortcuts = resolveShortcuts(config.shortcuts);

  for (const sc of shortcuts.open) {
    registerSafeShortcut(
      pi,
      sc,
      "Open favorite models picker modal",
      async (ctx) => {
        await openModelPickerModal(pi, ctx);
      }
    );
  }

  for (const sc of shortcuts.cycleNext) {
    registerSafeShortcut(
      pi,
      sc,
      "Cycle forward through favorite models",
      async (ctx) => {
        await cycleFavorites(1, pi, ctx);
      }
    );
  }

  for (const sc of shortcuts.cyclePrev) {
    registerSafeShortcut(
      pi,
      sc,
      "Cycle backward through favorite models",
      async (ctx) => {
        await cycleFavorites(-1, pi, ctx);
      }
    );
  }

  for (const sc of shortcuts.thinkingNext) {
    registerSafeShortcut(
      pi,
      sc,
      "Cycle thinking / effort level forward for current model",
      (ctx) => {
        cycleThinkingLevel(1, pi, ctx);
      }
    );
  }

  for (const sc of shortcuts.thinkingPrev) {
    registerSafeShortcut(
      pi,
      sc,
      "Cycle thinking / effort level backward for current model",
      (ctx) => {
        cycleThinkingLevel(-1, pi, ctx);
      }
    );
  }

  // Global blocklist & disabled models enforcement across Pi
  let isEnforcing = false;

  pi.on("model_select", async (event, ctx) => {
    if (isEnforcing) {
      return;
    }
    const currentConfig = loadConfig();
    const blockedList = currentConfig.blocked;
    const disabledSet =
      currentConfig.syncOpenCode === false
        ? new Set<string>()
        : getCachedDisabledModels(getAgentDir());

    if (isModelUnavailable(event.model, blockedList, disabledSet)) {
      isEnforcing = true;
      try {
        const modelName =
          event.model.name.length > 0 ? event.model.name : event.model.id;
        const reason = isModelBlocked(event.model, blockedList)
          ? "disabled by blocklist"
          : "disabled in OpenCode console";
        ctx.ui.notify(
          `Model ${modelName} (${event.model.provider}) is ${reason}.`,
          "error"
        );
        const prev = event.previousModel;
        const canUsePrev =
          prev !== undefined &&
          !isModelUnavailable(prev, blockedList, disabledSet);
        if (canUsePrev) {
          await pi.setModel(prev);
        } else {
          const available = ctx.modelRegistry.getAvailable();
          const fallback = available.find(
            (m) => !isModelUnavailable(m, blockedList, disabledSet)
          );
          if (fallback !== undefined) {
            await pi.setModel(fallback);
          }
        }
      } finally {
        isEnforcing = false;
      }
    }
  });

  const checkAndFallbackModel = async (
    ctx: ExtensionContext,
    reason: "Startup model" | "Blocked model"
  ): Promise<void> => {
    const currentConfig = loadConfig();
    const blockedList = currentConfig.blocked;
    const disabledSet =
      currentConfig.syncOpenCode === false
        ? new Set<string>()
        : getCachedDisabledModels(getAgentDir());

    if (ctx.model === undefined) {
      return;
    }

    if (isModelUnavailable(ctx.model, blockedList, disabledSet)) {
      const available = ctx.modelRegistry.getAvailable();
      const fallback = available.find(
        (m) => !isModelUnavailable(m, blockedList, disabledSet)
      );
      if (fallback !== undefined) {
        await pi.setModel(fallback);
        const currentName =
          ctx.model.name.length > 0 ? ctx.model.name : ctx.model.id;
        const fallbackName =
          fallback.name.length > 0 ? fallback.name : fallback.id;
        const statusDetail = isModelBlocked(ctx.model, blockedList)
          ? "blocklisted"
          : "disabled in OpenCode";
        ctx.ui.notify(
          `${reason} ${currentName} is unavailable (${statusDetail}). Switched to ${fallbackName}.`,
          "warning"
        );
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const currentConfig = loadConfig();
    if (currentConfig.syncOpenCode === false) {
      // Sync disabled by user setting
    } else {
      void syncOpenCodeDisabledModels(getAgentDir());
    }
    await checkAndFallbackModel(ctx, "Startup model");
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await checkAndFallbackModel(ctx, "Blocked model");
  });
};

export default modelSwitchExtension;
