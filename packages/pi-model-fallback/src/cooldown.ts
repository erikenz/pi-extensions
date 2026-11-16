import type { RouterState } from "./types.ts";

export type Cooldowns = Record<string, number>;

/** Remove cooldowns whose expiry is at or before `now`. */
export const pruneExpiredCooldowns = (
  cooldowns: Cooldowns | undefined,
  now: number
): Cooldowns => {
  const result: Cooldowns = {};
  for (const [key, expiresAt] of Object.entries(cooldowns ?? {})) {
    if (Number.isFinite(expiresAt) && expiresAt > now) {
      result[key] = expiresAt;
    }
  }
  return result;
};

export const isCoolingDown = (
  cooldowns: Cooldowns | undefined,
  key: string,
  now: number
): boolean => {
  const expiresAt = cooldowns?.[key];
  return typeof expiresAt === "number" && expiresAt > now;
};

/** Return a new cooldowns record with `key` cooling down for `durationMs`. */
export const markCooldown = (
  cooldowns: Cooldowns | undefined,
  key: string,
  now: number,
  durationMs: number
): Cooldowns => ({
  ...pruneExpiredCooldowns(cooldowns, now),
  [key]: now + Math.max(0, durationMs),
});

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const cloneState = (state: RouterState): RouterState => ({
  activeCandidateIndex: state.activeCandidateIndex,
  cooldowns: { ...state.cooldowns },
});

/** Persistence surface for router state. Tests inject an isolated instance. */
export interface RouterStore {
  clear: (chainId?: string) => void;
  entries: () => [string, RouterState][];
  get: (chainId: string) => RouterState | undefined;
  set: (chainId: string, state: RouterState) => void;
}

export const createMemoryRouterStore = (): RouterStore => {
  const states = new Map<string, RouterState>();
  return {
    clear: (chainId) => {
      if (chainId === undefined) {
        states.clear();
        return;
      }
      states.delete(chainId);
    },
    entries: () =>
      [...states.entries()].map(([chainId, state]) => [
        chainId,
        cloneState(state),
      ]),
    get: (chainId) => {
      const state = states.get(chainId);
      return state === undefined ? undefined : cloneState(state);
    },
    set: (chainId, state) => {
      states.set(chainId, cloneState(state));
    },
  };
};

/** Process-wide store used by the extension and the status command. */
export const routerStore: RouterStore = createMemoryRouterStore();
