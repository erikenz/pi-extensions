import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  addBlockedPattern,
  isModelBlocked,
  loadConfig,
  removeBlockedPattern,
  resolveShortcuts,
} from "../src/config.ts";
import { cycleFavorites, cycleThinkingLevel } from "../src/cycling.ts";
import { openModelPickerModal } from "../src/picker.ts";

export default function modelSwitchExtension(pi: ExtensionAPI): void {
  // Command: /model-switch [cycle [next|prev] | thinking [next|prev] | block <id> | unblock <id> | blocked]
  pi.registerCommand("model-switch", {
    description: "Open the favorite model picker modal, cycle favorites, manage blocklist, or cycle thinking level",
    handler: async (args, ctx) => {
      const raw = (args || "").trim();
      const lower = raw.toLowerCase();
      if (lower === "cycle" || lower === "next" || lower === "cycle next") {
        await cycleFavorites(1, pi, ctx);
      } else if (lower === "prev" || lower === "previous" || lower === "cycle prev") {
        await cycleFavorites(-1, pi, ctx);
      } else if (lower === "thinking" || lower === "thinking next" || lower === "t") {
        await cycleThinkingLevel(1, pi, ctx);
      } else if (lower === "thinking prev" || lower === "t prev") {
        await cycleThinkingLevel(-1, pi, ctx);
      } else if (lower.startsWith("block ")) {
        const pattern = raw.slice(6).trim();
        if (!pattern) {
          ctx.ui.notify("Usage: /model-switch block <provider/model or glob pattern>", "warning");
          return;
        }
        const added = addBlockedPattern(pattern);
        if (added) {
          ctx.ui.notify(`Blocked "${pattern}".`, "info");
          if (ctx.model && isModelBlocked(ctx.model, [pattern])) {
            const available = ctx.modelRegistry.getAvailable();
            const configNow = loadConfig();
            const fallback = available.find((m) => !isModelBlocked(m, configNow.blocked ?? []));
            if (fallback) {
              await pi.setModel(fallback);
              ctx.ui.notify(
                `Active model matched blocklist; switched to ${fallback.name || fallback.id}.`,
                "info",
              );
            }
          }
        } else {
          ctx.ui.notify(`"${pattern}" is already in the blocklist.`, "info");
        }
      } else if (lower.startsWith("unblock ")) {
        const pattern = raw.slice(8).trim();
        if (!pattern) {
          ctx.ui.notify("Usage: /model-switch unblock <pattern>", "warning");
          return;
        }
        const removed = removeBlockedPattern(pattern);
        if (removed) {
          ctx.ui.notify(`Unblocked "${pattern}".`, "info");
        } else {
          ctx.ui.notify(`"${pattern}" was not found in blocklist.`, "warning");
        }
      } else if (lower === "blocked" || lower === "list-blocked") {
        const currentConfig = loadConfig();
        const list = currentConfig.blocked ?? [];
        if (list.length === 0) {
          ctx.ui.notify("No models currently blocked.", "info");
        } else {
          ctx.ui.notify(`Blocked models/patterns (${list.length}):\n• ${list.join("\n• ")}`, "info");
        }
      } else {
        await openModelPickerModal(pi, ctx);
      }
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

  // Keyboard shortcut: Open modal
  for (const sc of shortcuts.open) {
    try {
      pi.registerShortcut(sc as any, {
        description: "Open favorite models picker modal",
        handler: async (ctx) => {
          await openModelPickerModal(pi, ctx);
        },
      });
    } catch {}
  }

  // Keyboard shortcut: Cycle forward through favorites
  for (const sc of shortcuts.cycleNext) {
    try {
      pi.registerShortcut(sc as any, {
        description: "Cycle forward through favorite models",
        handler: async (ctx) => {
          await cycleFavorites(1, pi, ctx);
        },
      });
    } catch {}
  }

  // Keyboard shortcut: Cycle backward through favorites
  for (const sc of shortcuts.cyclePrev) {
    try {
      pi.registerShortcut(sc as any, {
        description: "Cycle backward through favorite models",
        handler: async (ctx) => {
          await cycleFavorites(-1, pi, ctx);
        },
      });
    } catch {}
  }

  // Keyboard shortcut: Cycle thinking level forward
  for (const sc of shortcuts.thinkingNext) {
    try {
      pi.registerShortcut(sc as any, {
        description: "Cycle thinking / effort level forward for current model",
        handler: async (ctx) => {
          await cycleThinkingLevel(1, pi, ctx);
        },
      });
    } catch {}
  }

  // Keyboard shortcut: Cycle thinking level backward
  for (const sc of shortcuts.thinkingPrev) {
    try {
      pi.registerShortcut(sc as any, {
        description: "Cycle thinking / effort level backward for current model",
        handler: async (ctx) => {
          await cycleThinkingLevel(-1, pi, ctx);
        },
      });
    } catch {}
  }

  // Global blocklist enforcement across Pi
  let isEnforcing = false;

  pi.on("model_select", async (event, ctx) => {
    if (isEnforcing) return;
    const currentConfig = loadConfig();
    const blockedList = currentConfig.blocked ?? [];
    if (blockedList.length === 0) return;

    if (isModelBlocked(event.model, blockedList)) {
      isEnforcing = true;
      try {
        ctx.ui.notify(
          `Model ${event.model.name || event.model.id} (${event.model.provider}) is disabled by blocklist.`,
          "error",
        );
        if (event.previousModel && !isModelBlocked(event.previousModel, blockedList)) {
          await pi.setModel(event.previousModel);
        } else {
          const available = ctx.modelRegistry.getAvailable();
          const fallback = available.find((m) => !isModelBlocked(m, blockedList));
          if (fallback) {
            await pi.setModel(fallback);
          }
        }
      } finally {
        isEnforcing = false;
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const currentConfig = loadConfig();
    const blockedList = currentConfig.blocked ?? [];
    if (blockedList.length === 0 || !ctx.model) return;

    if (isModelBlocked(ctx.model, blockedList)) {
      const available = ctx.modelRegistry.getAvailable();
      const fallback = available.find((m) => !isModelBlocked(m, blockedList));
      if (fallback) {
        await pi.setModel(fallback);
        ctx.ui.notify(
          `Startup model ${ctx.model.name || ctx.model.id} is blocked by blocklist. Switched to ${fallback.name || fallback.id}.`,
          "warning",
        );
      }
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const currentConfig = loadConfig();
    const blockedList = currentConfig.blocked ?? [];
    if (blockedList.length === 0 || !ctx.model) return;

    if (isModelBlocked(ctx.model, blockedList)) {
      const available = ctx.modelRegistry.getAvailable();
      const fallback = available.find((m) => !isModelBlocked(m, blockedList));
      if (fallback) {
        await pi.setModel(fallback);
        ctx.ui.notify(
          `Blocked model ${ctx.model.name || ctx.model.id} prevented from running turn. Switched to ${fallback.name || fallback.id}.`,
          "warning",
        );
      }
    }
  });
}

