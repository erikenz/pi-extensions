import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cycleFavorites, cycleThinkingLevel } from "../src/cycling.ts";
import { openModelPickerModal } from "../src/picker.ts";

export default function modelSwitchExtension(pi: ExtensionAPI): void {
  // Command: /model-switch [cycle [next|prev] | thinking [next|prev]]
  pi.registerCommand("model-switch", {
    description: "Open the favorite model picker modal, cycle favorites, or cycle thinking level",
    handler: async (args, ctx) => {
      const trimmed = (args || "").trim().toLowerCase();
      if (trimmed === "cycle" || trimmed === "next" || trimmed === "cycle next") {
        await cycleFavorites(1, pi, ctx);
      } else if (trimmed === "prev" || trimmed === "previous" || trimmed === "cycle prev") {
        await cycleFavorites(-1, pi, ctx);
      } else if (trimmed === "thinking" || trimmed === "thinking next" || trimmed === "t") {
        await cycleThinkingLevel(1, pi, ctx);
      } else if (trimmed === "thinking prev" || trimmed === "t prev") {
        await cycleThinkingLevel(-1, pi, ctx);
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

  // Keyboard shortcut: Alt+M to open modal
  pi.registerShortcut("alt+m", {
    description: "Open favorite models picker modal",
    handler: async (ctx) => {
      await openModelPickerModal(pi, ctx);
    },
  });

  // Keyboard shortcut: Ctrl+Alt+P to cycle forward
  pi.registerShortcut("ctrl+alt+p", {
    description: "Cycle forward through favorite models",
    handler: async (ctx) => {
      await cycleFavorites(1, pi, ctx);
    },
  });

  // Keyboard shortcut: Ctrl+Alt+Shift+P to cycle backward
  pi.registerShortcut("ctrl+alt+shift+p", {
    description: "Cycle backward through favorite models",
    handler: async (ctx) => {
      await cycleFavorites(-1, pi, ctx);
    },
  });

  // Keyboard shortcut: Alt+T to cycle thinking level forward
  pi.registerShortcut("alt+t", {
    description: "Cycle thinking / effort level forward for current model",
    handler: async (ctx) => {
      await cycleThinkingLevel(1, pi, ctx);
    },
  });

  // Keyboard shortcut: Alt+Shift+T to cycle thinking level backward
  pi.registerShortcut("alt+shift+t", {
    description: "Cycle thinking / effort level backward for current model",
    handler: async (ctx) => {
      await cycleThinkingLevel(-1, pi, ctx);
    },
  });
}

