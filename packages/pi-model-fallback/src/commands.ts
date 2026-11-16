import { FALLBACK_PROVIDER, loadConfig } from "./config.ts";
import {
  formatDuration,
  pruneExpiredCooldowns,
  routerStore,
} from "./cooldown.ts";
import type { RouterStore } from "./cooldown.ts";
import type { FallbackConfig } from "./types.ts";

const chainId = (id: string): string => `${FALLBACK_PROVIDER}/${id}`;

/** Render the status of every configured fallback chain. */
export const describeStatus = (
  config: FallbackConfig,
  store: RouterStore = routerStore,
  now: number = Date.now()
): string => {
  if (config.fallbacks.length === 0) {
    return "No fallback chains configured. Add `fallbacks` entries to ~/.config/pi/agent/model-fallback.json.";
  }

  const lines = [`Model fallback chains (${config.fallbacks.length}):`];
  for (const entry of config.fallbacks) {
    const id = chainId(entry.id);
    const state = store.get(id);
    const cooldowns = pruneExpiredCooldowns(state?.cooldowns, now);
    lines.push(`• ${entry.id} — ${entry.name} [${id}]`);
    for (const [index, key] of entry.chain.entries()) {
      const active = index === state?.activeCandidateIndex ? "*" : " ";
      const expiresAt = cooldowns[key];
      const status =
        expiresAt !== undefined && expiresAt > now
          ? `cooling down (${formatDuration(expiresAt - now)} left)`
          : "ready";
      lines.push(`  ${active}${index + 1}. ${key} — ${status}`);
    }
  }
  return lines.join("\n");
};

export interface FallbackCommandContext {
  ui: {
    notify: (message: string, type?: "info" | "warning" | "error") => void;
  };
}

// Pi's command contract is async, but every step here is synchronous UI work.
// oxlint-disable-next-line require-await
// eslint-disable-next-line require-await
export const handleFallbackCommand = async (
  raw: string,
  ctx: FallbackCommandContext,
  store: RouterStore = routerStore,
  config: FallbackConfig = loadConfig()
): Promise<void> => {
  const [subcommand = "", ...rest] = raw.trim().split(/\s+/u);

  if (subcommand === "reset" || subcommand === "clear") {
    const [target] = rest;
    if (target === undefined || target.length === 0) {
      store.clear();
      for (const entry of config.fallbacks) {
        store.set(chainId(entry.id), {
          activeCandidateIndex: 0,
          cooldowns: {},
        });
      }
      ctx.ui.notify("Cleared all fallback cooldowns.", "info");
      return;
    }
    const entry = config.fallbacks.find(
      (candidate) => candidate.id === target || chainId(candidate.id) === target
    );
    if (entry === undefined) {
      ctx.ui.notify(`Unknown fallback chain "${target}".`, "warning");
      return;
    }
    store.set(chainId(entry.id), { activeCandidateIndex: 0, cooldowns: {} });
    ctx.ui.notify(`Cleared cooldowns for ${chainId(entry.id)}.`, "info");
    return;
  }

  if (subcommand === "" || subcommand === "status") {
    ctx.ui.notify(describeStatus(config, store), "info");
    return;
  }

  ctx.ui.notify("Usage: /fallback [status | reset [chain-id]]", "warning");
};
