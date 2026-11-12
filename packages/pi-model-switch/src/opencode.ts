import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { modelKey } from "./config.ts";
import type { ModelLike, QuotaBucket, QuotaGroup } from "./types.ts";

export interface OpenCodeAuthKey {
  key: string;
  provider: string;
}

export interface OpenCodeCacheData {
  timestamp: number;
  disabled: string[];
}

export interface OpenCodeSyncResult {
  disabled: Set<string>;
  changed: boolean;
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

let memoryDisabledCache: Set<string> | undefined;
let lastSyncTimestamp = 0;

// 1 hour cache TTL
export const OPENCODE_CACHE_TTL_MS = 3_600_000;

export const cacheFilePath = (agentDir?: string): string =>
  path.join(agentDir ?? getAgentDir(), "opencode-disabled-models.json");

export const clearCachedDisabledModels = (): void => {
  memoryDisabledCache = undefined;
  lastSyncTimestamp = 0;
};

export const setCachedDisabledModels = (disabled: Iterable<string>): void => {
  memoryDisabledCache = new Set(disabled);
  lastSyncTimestamp = Date.now();
};

export interface OpenCodeAuthMap {
  opencode?: string;
  "opencode-go"?: string;
}

export const getOpenCodeApiKeys = (agentDir?: string): OpenCodeAuthMap => {
  const result: OpenCodeAuthMap = {};

  const envOpencode = process.env.OPENCODE_API_KEY;
  if (envOpencode !== undefined && envOpencode.trim().length > 0) {
    result.opencode = envOpencode.trim();
  }
  const envOpencodeGo = process.env.OPENCODE_GO_API_KEY;
  if (envOpencodeGo !== undefined && envOpencodeGo.trim().length > 0) {
    result["opencode-go"] = envOpencodeGo.trim();
  }

  const authPath = path.join(agentDir ?? getAgentDir(), "auth.json");
  if (existsSync(authPath)) {
    try {
      const raw = readFileSync(authPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        if (
          result.opencode === undefined &&
          isRecord(parsed.opencode) &&
          typeof parsed.opencode.key === "string" &&
          parsed.opencode.key.trim().length > 0
        ) {
          result.opencode = parsed.opencode.key.trim();
        }
        if (
          result["opencode-go"] === undefined &&
          isRecord(parsed["opencode-go"]) &&
          typeof parsed["opencode-go"].key === "string" &&
          parsed["opencode-go"].key.trim().length > 0
        ) {
          result["opencode-go"] = parsed["opencode-go"].key.trim();
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return result;
};

export const getOpenCodeApiKey = (
  agentDir?: string
): OpenCodeAuthKey | undefined => {
  const keys = getOpenCodeApiKeys(agentDir);
  if (keys.opencode !== undefined) {
    return { key: keys.opencode, provider: "opencode" };
  }
  if (keys["opencode-go"] !== undefined) {
    return { key: keys["opencode-go"], provider: "opencode-go" };
  }
  return undefined;
};

export const getCachedDisabledModels = (agentDir?: string): Set<string> => {
  if (memoryDisabledCache !== undefined) {
    return memoryDisabledCache;
  }

  const filePath = cacheFilePath(agentDir);
  if (!existsSync(filePath)) {
    memoryDisabledCache = new Set<string>();
    return memoryDisabledCache;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && Array.isArray(parsed.disabled)) {
      const disabledList: string[] = [];
      for (const item of parsed.disabled) {
        if (typeof item === "string") {
          disabledList.push(item);
        }
      }
      memoryDisabledCache = new Set<string>(disabledList);
      lastSyncTimestamp =
        typeof parsed.timestamp === "number" ? parsed.timestamp : 0;
      return memoryDisabledCache;
    }
  } catch {
    // If parse fails, fall through
  }

  memoryDisabledCache = new Set<string>();
  return memoryDisabledCache;
};

export const saveCachedDisabledModels = (
  disabled: Set<string>,
  agentDir?: string
): void => {
  try {
    const filePath = cacheFilePath(agentDir);
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: OpenCodeCacheData = {
      disabled: [...disabled].toSorted(),
      timestamp: Date.now(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    memoryDisabledCache = disabled;
    lastSyncTimestamp = data.timestamp;
  } catch {
    // Best effort: do not crash on disk write failures
  }
};

export const parseDisabledModelsFromConfig = (
  data: unknown,
  targetProvider?: string
): Set<string> => {
  const result = new Set<string>();
  if (!isRecord(data) || !isRecord(data.providers)) {
    return result;
  }

  let entries: [string, unknown][] = [];
  if (targetProvider === undefined) {
    entries = Object.entries(data.providers);
  } else if (isRecord(data.providers[targetProvider])) {
    entries = [[targetProvider, data.providers[targetProvider]]];
  }

  for (const [providerName, providerConfig] of entries) {
    if (!isRecord(providerConfig) || !isRecord(providerConfig.models)) {
      continue;
    }
    for (const [modelId, modelCfg] of Object.entries(providerConfig.models)) {
      if (isRecord(modelCfg) && modelCfg.disabled === true) {
        result.add(`${providerName}/${modelId}`);
      }
    }
  }

  return result;
};

export const syncOpenCodeDisabledModels = async (
  agentDir?: string,
  force = false
): Promise<OpenCodeSyncResult> => {
  const cached = getCachedDisabledModels(agentDir);

  if (
    !force &&
    lastSyncTimestamp > 0 &&
    Date.now() - lastSyncTimestamp < OPENCODE_CACHE_TTL_MS
  ) {
    return { changed: false, disabled: cached };
  }

  const authMap = getOpenCodeApiKeys(agentDir);
  const providersToSync: {
    provider: "opencode" | "opencode-go";
    key: string;
  }[] = [];

  if (authMap.opencode !== undefined) {
    providersToSync.push({ key: authMap.opencode, provider: "opencode" });
  }
  if (authMap["opencode-go"] !== undefined) {
    providersToSync.push({
      key: authMap["opencode-go"],
      provider: "opencode-go",
    });
  }

  if (providersToSync.length === 0) {
    return { changed: false, disabled: cached };
  }

  try {
    const freshlyDisabled = new Set<string>();

    await Promise.all(
      providersToSync.map(async ({ key, provider }) => {
        try {
          const response = await fetch(
            "https://opencode.ai/console/api/v2/config",
            {
              headers: {
                Authorization: `Bearer ${key}`,
                "User-Agent": "pi",
              },
              signal: AbortSignal.timeout(4000),
            }
          );

          if (!response.ok) {
            return;
          }

          const json: unknown = await response.json();
          const providerDisabled = parseDisabledModelsFromConfig(
            json,
            provider
          );
          for (const item of providerDisabled) {
            freshlyDisabled.add(item);
          }
        } catch {
          // Ignore single provider network error
        }
      })
    );

    // If fetch failed completely (e.g. offline) and produced 0 results, preserve cache
    if (freshlyDisabled.size === 0 && cached.size > 0) {
      return { changed: false, disabled: cached };
    }

    // Check if the set changed
    let changed = freshlyDisabled.size !== cached.size;
    if (!changed) {
      for (const item of freshlyDisabled) {
        if (!cached.has(item)) {
          changed = true;
          break;
        }
      }
    }

    saveCachedDisabledModels(freshlyDisabled, agentDir);
    return { changed, disabled: freshlyDisabled };
  } catch {
    return { changed: false, disabled: cached };
  }
};

export const isOpenCodeDisabled = (
  model: ModelLike,
  disabledSet: Set<string>
): boolean => {
  if (disabledSet.size === 0) {
    return false;
  }
  const key = modelKey(model);
  if (disabledSet.has(key)) {
    return true;
  }
  const full = `${model.provider}/${model.id}`;
  if (disabledSet.has(full)) {
    return true;
  }
  return false;
};

export interface OpenCodeGoUsageWindow {
  status: string;
  percent: number;
  resetsAt?: string;
}

export interface OpenCodeGoUsageResponse {
  usage?: {
    rolling?: OpenCodeGoUsageWindow;
    weekly?: OpenCodeGoUsageWindow;
    monthly?: OpenCodeGoUsageWindow;
  };
}

export const parseOpenCodeGoUsage = (data: unknown): QuotaGroup | undefined => {
  if (!isRecord(data) || !isRecord(data.usage)) {
    return undefined;
  }
  const { usage } = data;
  const buckets: QuotaBucket[] = [];

  if (isRecord(usage.rolling) && typeof usage.rolling.percent === "number") {
    const remainingFraction = Math.max(
      0,
      Math.min(1, (100 - usage.rolling.percent) / 100)
    );
    buckets.push({
      remainingFraction,
      resetTime:
        typeof usage.rolling.resetsAt === "string"
          ? usage.rolling.resetsAt
          : undefined,
      window: "5h",
    });
  }

  if (isRecord(usage.weekly) && typeof usage.weekly.percent === "number") {
    const remainingFraction = Math.max(
      0,
      Math.min(1, (100 - usage.weekly.percent) / 100)
    );
    buckets.push({
      remainingFraction,
      resetTime:
        typeof usage.weekly.resetsAt === "string"
          ? usage.weekly.resetsAt
          : undefined,
      window: "weekly",
    });
  }

  if (isRecord(usage.monthly) && typeof usage.monthly.percent === "number") {
    const remainingFraction = Math.max(
      0,
      Math.min(1, (100 - usage.monthly.percent) / 100)
    );
    buckets.push({
      remainingFraction,
      resetTime:
        typeof usage.monthly.resetsAt === "string"
          ? usage.monthly.resetsAt
          : undefined,
      window: "monthly",
    });
  }

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    buckets,
    displayName: "opencode-go",
  };
};

export const fetchOpenCodeGoUsage = async (
  agentDir?: string
): Promise<QuotaGroup | undefined> => {
  const keys = getOpenCodeApiKeys(agentDir);
  const key = keys["opencode-go"] ?? keys.opencode;
  if (key === undefined || key.trim().length === 0) {
    return undefined;
  }

  try {
    const res = await fetch("https://opencode.ai/zen/go/v1/usage", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key.trim()}`,
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return undefined;
    }
    const json: unknown = await res.json();
    return parseOpenCodeGoUsage(json);
  } catch {
    return undefined;
  }
};
