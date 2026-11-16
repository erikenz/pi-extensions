import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { FallbackConfig, FallbackEntry } from "./types.ts";

export const FALLBACK_PROVIDER = "fallback";

export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

const DEFAULT_NAME_SUFFIX = "(Auto Fallback)";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const configPath = (): string =>
  path.join(getAgentDir(), "model-fallback.json");

/** Split a `provider/model` key at the first slash. */
export const parseModelKey = (
  key: string
): { provider: string; id: string } | undefined => {
  const trimmed = key.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return undefined;
  }
  const provider = trimmed.slice(0, slash).trim();
  const id = trimmed.slice(slash + 1).trim();
  if (provider.length === 0 || id.length === 0) {
    return undefined;
  }
  return { id, provider };
};

export const modelKey = (model: { provider: string; id: string }): string =>
  `${model.provider}/${model.id}`;

const parseChain = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const chain: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const key = item.trim();
    if (
      key.length === 0 ||
      chain.includes(key) ||
      parseModelKey(key) === undefined
    ) {
      continue;
    }
    chain.push(key);
  }
  return chain;
};

/** Parse and validate a raw configuration value. Never throws. */
export const parseConfig = (raw: unknown): FallbackConfig => {
  const globalCooldown = isRecord(raw)
    ? (toPositiveNumber(raw.cooldownMs) ?? DEFAULT_COOLDOWN_MS)
    : DEFAULT_COOLDOWN_MS;
  const fallbacks: FallbackEntry[] = [];

  if (!isRecord(raw) || !isRecord(raw.fallbacks)) {
    return { cooldownMs: globalCooldown, fallbacks };
  }

  for (const [rawId, value] of Object.entries(raw.fallbacks)) {
    const id = rawId.trim();
    if (id.length === 0 || !isRecord(value)) {
      continue;
    }
    const chain = parseChain(value.chain);
    if (chain.length === 0) {
      continue;
    }
    const rawName = typeof value.name === "string" ? value.name.trim() : "";
    const name = rawName.length > 0 ? rawName : `${id} ${DEFAULT_NAME_SUFFIX}`;
    fallbacks.push({
      chain,
      cooldownMs: toPositiveNumber(value.cooldownMs) ?? globalCooldown,
      id,
      name,
    });
  }

  return { cooldownMs: globalCooldown, fallbacks };
};

/** Load the config, returning defaults for a missing, empty, or invalid file. */
export const loadConfig = (filePath: string = configPath()): FallbackConfig => {
  if (!existsSync(filePath)) {
    return parseConfig(undefined);
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    if (raw.trim().length === 0) {
      return parseConfig(undefined);
    }
    return parseConfig(JSON.parse(raw));
  } catch {
    return parseConfig(undefined);
  }
};
