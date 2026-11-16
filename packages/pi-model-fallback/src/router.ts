import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type {
  Api,
  Model,
  ModelInputModality,
  ModelThinkingLevel,
} from "@earendil-works/pi-ai";

import { modelKey, parseModelKey } from "./config.ts";
import {
  isCoolingDown,
  markCooldown,
  pruneExpiredCooldowns,
  routerStore,
} from "./cooldown.ts";
import type { RouterStore } from "./cooldown.ts";
import { isQuotaFailure } from "./errors.ts";
import type {
  RouterContext,
  RouterRequest,
  RouterRoute,
  RouterState,
} from "./types.ts";

export const DEFAULT_THINKING_LEVELS: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface VirtualModelCapabilities {
  contextWindow?: number;
  input?: ModelInputModality[];
  maxTokens?: number;
  thinkingLevels: readonly ModelThinkingLevel[];
}

/** Mirror the primary physical model's limits and thinking levels. */
export const capabilitiesFromModel = (
  model: Model<Api> | undefined
): VirtualModelCapabilities => {
  if (model === undefined) {
    return { thinkingLevels: DEFAULT_THINKING_LEVELS };
  }
  const supported = getSupportedThinkingLevels(model);
  return {
    contextWindow: model.contextWindow,
    input: [...model.input],
    maxTokens: model.maxTokens,
    thinkingLevels: supported.length > 0 ? supported : DEFAULT_THINKING_LEVELS,
  };
};

export interface RouterOptions {
  chain: readonly string[];
  chainId: string;
  cooldownMs: number;
  now?: () => number;
  store?: RouterStore;
  warn?: (message: string) => void;
}

interface Candidate {
  index: number;
  key: string;
  model: Model<Api>;
}

const resolveCandidates = (
  options: RouterOptions,
  ctx: RouterContext,
  warned: Set<string>
): Candidate[] => {
  const candidates: Candidate[] = [];
  for (const [index, key] of options.chain.entries()) {
    const parsed = parseModelKey(key);
    if (parsed === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        options.warn?.(
          `Skipping invalid model key "${key}" in chain "${options.chainId}".`
        );
      }
      continue;
    }
    // oxlint-disable-next-line no-array-method-this-argument
    // eslint-disable-next-line no-array-method-this-argument
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id);
    if (model === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        options.warn?.(
          `Skipping missing model "${key}" in chain "${options.chainId}".`
        );
      }
      continue;
    }
    candidates.push({ index, key, model });
  }
  return candidates;
};

const firstHealthy = (
  candidates: readonly Candidate[],
  cooldowns: Record<string, number>,
  now: number
): Candidate | undefined =>
  candidates.find((candidate) => !isCoolingDown(cooldowns, candidate.key, now));

const earliestExpiry = (
  candidates: readonly Candidate[],
  cooldowns: Record<string, number>
): Candidate | undefined => {
  let result: Candidate | undefined;
  for (const candidate of candidates) {
    if (result === undefined) {
      result = candidate;
      continue;
    }
    const expiry = cooldowns[candidate.key] ?? 0;
    const resultExpiry = cooldowns[result.key] ?? 0;
    if (expiry < resultExpiry) {
      result = candidate;
    }
  }
  return result;
};

/** The next candidate after the failed one, preferring a healthy one. */
const nextAfterFailure = (
  candidates: readonly Candidate[],
  failedKey: string,
  cooldowns: Record<string, number>,
  now: number
): Candidate | undefined => {
  const failedIndex = candidates.findIndex(
    (candidate) => candidate.key === failedKey
  );
  const start = failedIndex === -1 ? -1 : failedIndex;
  for (let offset = 1; offset <= candidates.length; offset += 1) {
    const candidate =
      candidates[(start + offset + candidates.length) % candidates.length];
    if (
      candidate !== undefined &&
      candidate.key !== failedKey &&
      !isCoolingDown(cooldowns, candidate.key, now)
    ) {
      return candidate;
    }
  }
  const others = candidates.filter((candidate) => candidate.key !== failedKey);
  return earliestExpiry(others, cooldowns) ?? candidates[0];
};

const buildState = (
  request: RouterRequest,
  options: RouterOptions,
  store: RouterStore,
  now: number
): RouterState => {
  const memory = store.get(options.chainId);
  return {
    activeCandidateIndex:
      request.state?.activeCandidateIndex ?? memory?.activeCandidateIndex ?? 0,
    // The in-memory store is the live overlay: it is updated on every route and
    // makes `/fallback reset` effective. Session state is the persisted baseline
    // after a restart or when a branch predates the current process.
    cooldowns: pruneExpiredCooldowns(
      memory === undefined ? request.state?.cooldowns : memory.cooldowns,
      now
    ),
  };
};

const finish = (
  chosen: Candidate,
  thinkingLevel: ModelThinkingLevel,
  state: RouterState,
  store: RouterStore,
  options: RouterOptions,
  now: number
): RouterRoute => {
  const nextState: RouterState = {
    activeCandidateIndex: chosen.index,
    cooldowns: pruneExpiredCooldowns(state.cooldowns, now),
  };
  store.set(options.chainId, nextState);
  return { model: chosen.model, state: nextState, thinkingLevel };
};

/**
 * Build a router for one fallback chain. The returned function is Pi's `route`
 * implementation: it picks a physical model and thinking level per request.
 */
export const createRouter = (
  options: RouterOptions
): ((request: RouterRequest, ctx: RouterContext) => RouterRoute) => {
  const store = options.store ?? routerStore;
  const warned = new Set<string>();

  return (request, ctx) => {
    const now = options.now?.() ?? Date.now();
    const candidates = resolveCandidates(options, ctx, warned);
    if (candidates.length === 0) {
      throw new Error(
        `No available models in fallback chain "${options.chainId}". Check model-fallback.json and provider credentials.`
      );
    }

    const state = buildState(request, options, store, now);

    if (request.reason === "continuation" && request.previous !== undefined) {
      const previousKey = modelKey(request.previous.model);
      const sticky = candidates.find(
        (candidate) => candidate.key === previousKey
      );
      const chosen = sticky ?? {
        index: state.activeCandidateIndex,
        key: previousKey,
        model: request.previous.model,
      };
      return finish(
        chosen,
        request.previous.thinkingLevel ?? request.thinkingLevel,
        state,
        store,
        options,
        now
      );
    }

    if (request.reason === "retry" && request.failed !== undefined) {
      const failedKey = modelKey(request.failed.model);
      const thinkingLevel =
        request.failed.thinkingLevel ?? request.thinkingLevel;

      if (isQuotaFailure(request.failed)) {
        state.cooldowns = markCooldown(
          state.cooldowns,
          failedKey,
          now,
          options.cooldownMs
        );
        const chosen = nextAfterFailure(
          candidates,
          failedKey,
          state.cooldowns,
          now
        );
        return finish(
          chosen ?? candidates[0],
          thinkingLevel,
          state,
          store,
          options,
          now
        );
      }

      const failedCandidate = candidates.find(
        (candidate) => candidate.key === failedKey
      );
      const chosen = failedCandidate ?? {
        index: state.activeCandidateIndex,
        key: failedKey,
        model: request.failed.model,
      };
      return finish(chosen, thinkingLevel, state, store, options, now);
    }

    const chosen =
      firstHealthy(candidates, state.cooldowns, now) ??
      earliestExpiry(candidates, state.cooldowns) ??
      candidates[0];
    return finish(chosen, request.thinkingLevel, state, store, options, now);
  };
};
