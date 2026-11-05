import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelSwitchConfig } from "./types.ts";

export const modelKey = (m: Model<Api>): string => `${m.provider}/${m.id}`;

export function configPath(): string {
  return join(getAgentDir(), "model-switch.json");
}

export function loadConfig(): ModelSwitchConfig {
  const filePath = configPath();

  if (!existsSync(filePath)) {
    return { favorites: [], hidden: [] };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ModelSwitchConfig>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      modelThinking:
        typeof parsed.modelThinking === "object" && parsed.modelThinking !== null
          ? (parsed.modelThinking as Record<string, string>)
          : {},
    };
  } catch {
    return { favorites: [], hidden: [], modelThinking: {} };
  }
}

export function saveConfig(config: ModelSwitchConfig): void {
  try {
    const content = JSON.stringify(config, null, 2);
    writeFileSync(configPath(), content, "utf-8");
  } catch {
    // Best-effort: failures must not crash caller
  }
}
