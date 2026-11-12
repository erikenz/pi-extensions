import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { fetchOpenCodeGoUsage } from "./opencode.ts";
import type {
  ModelLike,
  QuotaBadgeResult,
  QuotaBucket,
  QuotaGroup,
  QuotaSnapshot,
} from "./types.ts";

interface AntigravityRuntime {
  quotaCache?: QuotaSnapshot;
  quota: (apiKey?: string) => Promise<QuotaSnapshot>;
}

interface AntigravitySharedSlot {
  runtime?: AntigravityRuntime;
}

let memoryQuotaCache: QuotaSnapshot | undefined;

const isAntigravitySharedSlot = (
  value: unknown
): value is AntigravitySharedSlot =>
  typeof value === "object" && value !== null && "runtime" in value;

const getSharedRuntime = (): AntigravityRuntime | undefined => {
  const SHARED_KEY = Symbol.for("pi-antigravity-acp:runtime");
  const slots: Record<string | symbol, unknown> = globalThis;
  const candidate = slots[SHARED_KEY];
  if (isAntigravitySharedSlot(candidate)) {
    return candidate.runtime;
  }
  return undefined;
};

export const setCachedQuota = (snapshot: QuotaSnapshot): void => {
  memoryQuotaCache = snapshot;
};

export const clearCachedQuota = (): void => {
  memoryQuotaCache = undefined;
};

export const getCachedQuota = (): QuotaSnapshot | undefined => {
  if (
    memoryQuotaCache !== undefined &&
    Date.now() - memoryQuotaCache.at < 60_000
  ) {
    return memoryQuotaCache;
  }
  const runtime = getSharedRuntime();
  if (runtime?.quotaCache !== undefined) {
    memoryQuotaCache = runtime.quotaCache;
    return memoryQuotaCache;
  }
  return memoryQuotaCache;
};

const requestQuotaViaEvent = async (
  pi: ExtensionAPI
): Promise<QuotaSnapshot | undefined> =>
  // oxlint-disable-next-line promise/avoid-new
  // eslint-disable-next-line promise/avoid-new
  await new Promise<QuotaSnapshot | undefined>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(undefined);
    }, 1500);

    pi.events.emit("antigravity-acp:quota:request", {
      reply: (res: { ok: boolean; quota?: QuotaSnapshot }) => {
        clearTimeout(timeout);
        if (res?.ok && res.quota?.groups !== undefined) {
          setCachedQuota(res.quota);
          resolve(res.quota);
        } else {
          resolve(undefined);
        }
      },
    });
  });

export const fetchQuota = async (
  pi?: ExtensionAPI,
  agentDir?: string
): Promise<QuotaSnapshot | undefined> => {
  const runtime = getSharedRuntime();
  let agySnapshot: QuotaSnapshot | undefined;

  if (runtime !== undefined) {
    try {
      const snapshot = await runtime.quota(undefined);
      if (snapshot.groups.length > 0) {
        agySnapshot = snapshot;
      }
    } catch {
      // Fall through to event request
    }
  }

  if (agySnapshot === undefined && pi !== undefined) {
    try {
      const result = await requestQuotaViaEvent(pi);
      if (result !== undefined) {
        agySnapshot = result;
      }
    } catch {
      // Ignore event failure
    }
  }

  let goGroup: QuotaGroup | undefined;
  try {
    goGroup = await fetchOpenCodeGoUsage(agentDir);
  } catch {
    // Ignore OpenCode network failure
  }

  const groups: QuotaGroup[] = [];
  if (agySnapshot !== undefined) {
    groups.push(...agySnapshot.groups);
  } else if (memoryQuotaCache !== undefined) {
    groups.push(
      ...memoryQuotaCache.groups.filter((g) => g.displayName !== "opencode-go")
    );
  }

  if (goGroup !== undefined) {
    groups.push(goGroup);
  } else if (memoryQuotaCache !== undefined) {
    const cachedGo = memoryQuotaCache.groups.find(
      (g) => g.displayName === "opencode-go"
    );
    if (cachedGo !== undefined) {
      groups.push(cachedGo);
    }
  }

  if (groups.length > 0) {
    const combined: QuotaSnapshot = {
      at: Date.now(),
      groups,
    };
    setCachedQuota(combined);
    return combined;
  }

  return getCachedQuota();
};

export const formatResetDuration = (
  resetTimeIso: string,
  now: number = Date.now()
): string | undefined => {
  const resetAt = new Date(resetTimeIso).getTime();
  if (Number.isNaN(resetAt)) {
    return undefined;
  }
  const diffMs = resetAt - now;
  if (diffMs <= 0) {
    return undefined;
  }
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) {
      return `${days}d ${remHours}h`;
    }
    return `${days}d`;
  }
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
};

const matchArgonGroup = (
  modelId: string,
  modelName: string,
  groups: QuotaGroup[]
): QuotaGroup | undefined => {
  const isArgon = modelId.includes("argon") || modelName.includes("argon");
  if (!isArgon) {
    return undefined;
  }
  return groups.find((g) => g.displayName.toLowerCase().includes("argon"));
};

const matchClaudeGptGroup = (
  modelId: string,
  modelName: string,
  groups: QuotaGroup[]
): QuotaGroup | undefined => {
  const isClaudeOrGpt =
    modelId.includes("claude") ||
    modelName.includes("claude") ||
    modelId.includes("gpt") ||
    modelName.includes("gpt") ||
    modelId.includes("opus") ||
    modelName.includes("opus") ||
    modelId.includes("sonnet") ||
    modelName.includes("sonnet");
  if (!isClaudeOrGpt) {
    return undefined;
  }
  return groups.find((g) => {
    const name = g.displayName.toLowerCase();
    return name.includes("claude") || name.includes("gpt");
  });
};

const matchGeminiGroup = (
  modelId: string,
  modelName: string,
  groups: QuotaGroup[]
): QuotaGroup | undefined => {
  const isGemini =
    modelId.includes("gemini") ||
    modelName.includes("gemini") ||
    modelId.includes("flash") ||
    modelName.includes("flash") ||
    modelId.includes("pro") ||
    modelName.includes("pro");
  if (!isGemini) {
    return undefined;
  }
  return groups.find((g) => {
    const name = g.displayName.toLowerCase();
    return name.includes("gemini") && !name.includes("argon");
  });
};

const matchWordIntersection = (
  modelId: string,
  modelName: string,
  groups: QuotaGroup[]
): QuotaGroup | undefined => {
  for (const group of groups) {
    const groupWords = group.displayName.toLowerCase().split(/[\s_-]+/u);
    for (const word of groupWords) {
      if (
        word.length >= 4 &&
        (modelId.includes(word) || modelName.includes(word))
      ) {
        return group;
      }
    }
  }
  return undefined;
};

export const findQuotaForModel = (
  model: ModelLike | Model<Api>,
  snapshot?: QuotaSnapshot
): QuotaGroup | undefined => {
  if (snapshot === undefined || snapshot.groups.length === 0) {
    return undefined;
  }

  if (model.provider === "opencode-go") {
    return snapshot.groups.find((g) => g.displayName === "opencode-go");
  }

  if (
    model.provider !== "antigravity-acp" &&
    !model.provider.includes("antigravity")
  ) {
    return undefined;
  }

  const modelId = model.id.toLowerCase();
  const modelName = (model.name ?? "").toLowerCase();

  return (
    matchArgonGroup(modelId, modelName, snapshot.groups) ??
    matchClaudeGptGroup(modelId, modelName, snapshot.groups) ??
    matchGeminiGroup(modelId, modelName, snapshot.groups) ??
    matchWordIntersection(modelId, modelName, snapshot.groups)
  );
};

const formatFraction = (frac: number): string => {
  if (frac <= 0) {
    return "0%";
  }
  const pct = Math.round(frac * 100);
  if (pct === 0 && frac > 0) {
    return "<1%";
  }
  return `${pct}%`;
};

const formatBucketPart = (
  prefix: string,
  bucket: QuotaBucket,
  now: number,
  includeReset: boolean
): string => {
  const { resetTime } = bucket;
  const hasReset =
    includeReset && resetTime !== undefined && resetTime.length > 0;
  const resetStr = hasReset ? formatResetDuration(resetTime, now) : undefined;
  const resetPart =
    resetStr !== undefined && resetStr.length > 0
      ? ` (resets in ${resetStr})`
      : "";
  return `${prefix}: ${formatFraction(bucket.remainingFraction)}${resetPart}`;
};

export const formatQuotaGroupBadge = (
  group: QuotaGroup,
  now: number = Date.now()
): QuotaBadgeResult | undefined => {
  if (group.buckets.length === 0) {
    return undefined;
  }

  const b5 = group.buckets.find(
    (b) => b.window === "5h" || /5h|five/iu.test(b.window)
  );
  const bW = group.buckets.find(
    (b) => b.window === "weekly" || /weekly|week/iu.test(b.window)
  );
  const bM = group.buckets.find(
    (b) => b.window === "monthly" || /monthly|month/iu.test(b.window)
  );

  const parts: string[] = [];
  const fractions: number[] = [];

  if (b5 !== undefined) {
    fractions.push(b5.remainingFraction);
    parts.push(formatBucketPart("5h", b5, now, true));
  }

  if (bW !== undefined) {
    fractions.push(bW.remainingFraction);
    const showWeeklyReset =
      b5 === undefined ||
      b5.resetTime === undefined ||
      bW.remainingFraction <= 0.15;
    parts.push(formatBucketPart("W", bW, now, showWeeklyReset));
  }

  if (bM !== undefined) {
    fractions.push(bM.remainingFraction);
    const showMonthlyReset =
      (b5 === undefined && bW === undefined) || bM.remainingFraction <= 0.15;
    parts.push(formatBucketPart("M", bM, now, showMonthlyReset));
  }

  if (parts.length === 0) {
    for (const b of group.buckets) {
      fractions.push(b.remainingFraction);
      parts.push(formatBucketPart(b.window, b, now, true));
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  const text = `[${parts.join(" · ")}]`;
  const minFraction = Math.min(...fractions);
  let severity: "success" | "warning" | "error" = "success";
  if (minFraction <= 0.15) {
    severity = "error";
  } else if (minFraction <= 0.5) {
    severity = "warning";
  }

  return { severity, text };
};

export const formatModelQuotaBadge = (
  model: ModelLike | Model<Api>,
  snapshot?: QuotaSnapshot,
  now: number = Date.now()
): QuotaBadgeResult | undefined => {
  const group = findQuotaForModel(model, snapshot);
  if (group === undefined) {
    return undefined;
  }
  return formatQuotaGroupBadge(group, now);
};

export const formatProviderQuotaBadge = (
  provider: string,
  snapshot?: QuotaSnapshot,
  now: number = Date.now()
): QuotaBadgeResult | undefined => {
  if (snapshot === undefined || snapshot.groups.length === 0) {
    return undefined;
  }
  const group = snapshot.groups.find(
    (g) => g.displayName.toLowerCase() === provider.toLowerCase()
  );
  if (group === undefined) {
    return undefined;
  }
  return formatQuotaGroupBadge(group, now);
};

export interface AntigravitySubgroupInfo {
  name: string;
  group?: QuotaGroup;
}

export const formatSubgroupName = (name: string): string => {
  const trimmed = name.trim();
  if (/^gemini\s+models$/iu.test(trimmed)) {
    return "Gemini Models";
  }
  if (/^gemini\s+4\s+argon$/iu.test(trimmed)) {
    return "Gemini 4 Argon";
  }
  if (/^claude\s+and\s+gpt\s+models$/iu.test(trimmed)) {
    return "Claude & GPT Models";
  }
  return trimmed
    .toLowerCase()
    .split(/\s+/u)
    .map((w) => (w === "and" ? "&" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
};

export const getAntigravitySubgroup = (
  model: ModelLike | Model<Api>,
  snapshot?: QuotaSnapshot
): AntigravitySubgroupInfo => {
  const group = findQuotaForModel(model, snapshot);
  if (group !== undefined) {
    return { group, name: formatSubgroupName(group.displayName) };
  }
  const id = model.id.toLowerCase();
  const name = (model.name ?? "").toLowerCase();
  if (id.includes("argon") || name.includes("argon")) {
    return { name: "Gemini 4 Argon" };
  }
  if (
    id.includes("claude") ||
    name.includes("claude") ||
    id.includes("gpt") ||
    name.includes("gpt") ||
    id.includes("opus") ||
    name.includes("opus") ||
    id.includes("sonnet") ||
    name.includes("sonnet")
  ) {
    return { name: "Claude & GPT Models" };
  }
  if (
    id.includes("gemini") ||
    name.includes("gemini") ||
    id.includes("flash") ||
    name.includes("flash") ||
    id.includes("pro") ||
    name.includes("pro")
  ) {
    return { name: "Gemini Models" };
  }
  return { name: "Other Models" };
};
