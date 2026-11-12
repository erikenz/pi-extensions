import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearCachedQuota,
  findQuotaForModel,
  formatModelQuotaBadge,
  formatProviderQuotaBadge,
  formatResetDuration,
  formatSubgroupName,
  getAntigravitySubgroup,
  getCachedQuota,
  setCachedQuota,
} from "../src/quota.ts";
import type { QuotaSnapshot } from "../src/types.ts";

const mockSnapshot: QuotaSnapshot = {
  at: Date.now(),
  groups: [
    {
      buckets: [
        {
          remainingFraction: 0.6068,
          resetTime: "2026-11-14T02:34:00.000Z",
          window: "weekly",
        },
        {
          remainingFraction: 0.8641,
          resetTime: "2026-11-11T21:47:00.000Z",
          window: "5h",
        },
      ],
      displayName: "GEMINI MODELS",
    },
    {
      buckets: [
        {
          remainingFraction: 1,
          window: "weekly",
        },
        {
          remainingFraction: 1,
          window: "5h",
        },
      ],
      displayName: "CLAUDE AND GPT MODELS",
    },
    {
      buckets: [
        {
          remainingFraction: 0.0096,
          resetTime: "2026-11-13T22:34:00.000Z",
          window: "weekly",
        },
      ],
      displayName: "GEMINI 4 ARGON",
    },
    {
      buckets: [
        {
          remainingFraction: 1,
          resetTime: "2026-11-12T01:19:00.000Z",
          window: "5h",
        },
        {
          remainingFraction: 0.33,
          resetTime: "2026-11-16T00:00:00.000Z",
          window: "weekly",
        },
        {
          remainingFraction: 0.03,
          resetTime: "2026-11-18T21:37:00.000Z",
          window: "monthly",
        },
      ],
      displayName: "opencode-go",
    },
  ],
};

void describe("formatResetDuration", () => {
  const baseTime = new Date("2026-11-11T20:19:00.000Z").getTime();

  void it("formats hours and minutes accurately", () => {
    // 1h 28m ahead
    const target = new Date("2026-11-11T21:47:00.000Z").toISOString();
    assert.equal(formatResetDuration(target, baseTime), "1h 28m");
  });

  void it("formats large hour counts into days and hours", () => {
    // 54h 15m ahead -> 2d 6h
    const target = new Date("2026-11-14T02:34:00.000Z").toISOString();
    assert.equal(formatResetDuration(target, baseTime), "2d 6h");

    // Exact days (e.g. 48h -> 2d)
    const exactDays = new Date("2026-11-13T20:19:00.000Z").toISOString();
    assert.equal(formatResetDuration(exactDays, baseTime), "2d");
  });

  void it("formats sub-hour durations in minutes", () => {
    // 45 minutes ahead
    const target = new Date("2026-11-11T21:04:00.000Z").toISOString();
    assert.equal(formatResetDuration(target, baseTime), "45m");
  });

  void it("returns undefined for past or invalid timestamps", () => {
    const past = new Date("2026-11-11T19:00:00.000Z").toISOString();
    assert.equal(formatResetDuration(past, baseTime), undefined);
    assert.equal(formatResetDuration("not-a-date", baseTime), undefined);
  });
});

void describe("findQuotaForModel", () => {
  void it("matches Gemini models to GEMINI MODELS group", () => {
    const flash = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      provider: "antigravity-acp",
    };
    const group = findQuotaForModel(flash, mockSnapshot);
    assert.ok(group);
    assert.equal(group.displayName, "GEMINI MODELS");

    const pro = {
      id: "gemini-3.1-pro",
      name: "Gemini 3.1 Pro",
      provider: "antigravity-acp",
    };
    const proGroup = findQuotaForModel(pro, mockSnapshot);
    assert.ok(proGroup);
    assert.equal(proGroup.displayName, "GEMINI MODELS");
  });

  void it("matches Argon to dedicated GEMINI 4 ARGON group", () => {
    const argon = {
      id: "gemini-4-argon",
      name: "Gemini 4 Argon",
      provider: "antigravity-acp",
    };
    const group = findQuotaForModel(argon, mockSnapshot);
    assert.ok(group);
    assert.equal(group.displayName, "GEMINI 4 ARGON");
  });

  void it("matches Claude and GPT models to CLAUDE AND GPT MODELS group", () => {
    const sonnet = {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "antigravity-acp",
    };
    const group = findQuotaForModel(sonnet, mockSnapshot);
    assert.ok(group);
    assert.equal(group.displayName, "CLAUDE AND GPT MODELS");

    const gpt = {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "antigravity-acp",
    };
    const gptGroup = findQuotaForModel(gpt, mockSnapshot);
    assert.ok(gptGroup);
    assert.equal(gptGroup.displayName, "CLAUDE AND GPT MODELS");
  });

  void it("matches opencode-go models to opencode-go group", () => {
    const deepseek = {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      provider: "opencode-go",
    };
    const group = findQuotaForModel(deepseek, mockSnapshot);
    assert.ok(group);
    assert.equal(group.displayName, "opencode-go");
  });

  void it("returns undefined for other providers", () => {
    const external = {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "anthropic",
    };
    assert.equal(findQuotaForModel(external, mockSnapshot), undefined);
  });
});

void describe("formatModelQuotaBadge", () => {
  const baseTime = new Date("2026-11-11T20:19:00.000Z").getTime();

  void it("formats Gemini Flash with both 5h and weekly limits", () => {
    const flash = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      provider: "antigravity-acp",
    };
    const badge = formatModelQuotaBadge(flash, mockSnapshot, baseTime);
    assert.ok(badge);
    assert.equal(badge.text, "[5h: 86% (resets in 1h 28m) · W: 61%]");
    assert.equal(badge.severity, "success");
  });

  void it("formats Claude with 100% quota available", () => {
    const claude = {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "antigravity-acp",
    };
    const badge = formatModelQuotaBadge(claude, mockSnapshot, baseTime);
    assert.ok(badge);
    assert.equal(badge.text, "[5h: 100% · W: 100%]");
    assert.equal(badge.severity, "success");
  });

  void it("formats Argon with low weekly quota and error severity", () => {
    const argon = {
      id: "gemini-4-argon",
      name: "Gemini 4 Argon",
      provider: "antigravity-acp",
    };
    const badge = formatModelQuotaBadge(argon, mockSnapshot, baseTime);
    assert.ok(badge);
    assert.equal(badge.text, "[W: 1% (resets in 2d 2h)]");
    assert.equal(badge.severity, "error");
  });

  void it("marks warning severity when remaining is between 15% and 50%", () => {
    const warningSnapshot: QuotaSnapshot = {
      at: baseTime,
      groups: [
        {
          buckets: [
            {
              remainingFraction: 0.35,
              resetTime: "2026-11-11T21:47:00.000Z",
              window: "5h",
            },
            {
              remainingFraction: 0.8,
              window: "weekly",
            },
          ],
          displayName: "GEMINI MODELS",
        },
      ],
    };
    const flash = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      provider: "antigravity-acp",
    };
    const badge = formatModelQuotaBadge(flash, warningSnapshot, baseTime);
    assert.ok(badge);
    assert.equal(badge.severity, "warning");
  });

  void it("formats opencode-go model with 5h, weekly, and monthly limits", () => {
    const deepseek = {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      provider: "opencode-go",
    };
    const badge = formatModelQuotaBadge(deepseek, mockSnapshot, baseTime);
    assert.ok(badge);
    assert.equal(
      badge.text,
      "[5h: 100% (resets in 5h) · W: 33% · M: 3% (resets in 7d 1h)]"
    );
    assert.equal(badge.severity, "error");
  });
});

void describe("formatProviderQuotaBadge", () => {
  const baseTime = new Date("2026-11-11T20:19:00.000Z").getTime();

  void it("formats opencode-go provider quota accurately", () => {
    const badge = formatProviderQuotaBadge(
      "opencode-go",
      mockSnapshot,
      baseTime
    );
    assert.ok(badge);
    assert.equal(
      badge.text,
      "[5h: 100% (resets in 5h) · W: 33% · M: 3% (resets in 7d 1h)]"
    );
    assert.equal(badge.severity, "error");
  });

  void it("returns undefined for providers without a dedicated quota group", () => {
    assert.equal(
      formatProviderQuotaBadge("opencode", mockSnapshot, baseTime),
      undefined
    );
    assert.equal(
      formatProviderQuotaBadge("unknown", mockSnapshot, baseTime),
      undefined
    );
  });
});

void describe("quota cache management", () => {
  void it("caches snapshot in memory and retrieves it", () => {
    clearCachedQuota();
    assert.equal(getCachedQuota(), undefined);

    setCachedQuota(mockSnapshot);
    assert.deepEqual(getCachedQuota(), mockSnapshot);

    clearCachedQuota();
    assert.equal(getCachedQuota(), undefined);
  });
});

void describe("formatSubgroupName", () => {
  void it("formats Antigravity quota group display names into clean title-cased labels", () => {
    assert.equal(formatSubgroupName("GEMINI MODELS"), "Gemini Models");
    assert.equal(
      formatSubgroupName("CLAUDE AND GPT MODELS"),
      "Claude & GPT Models"
    );
    assert.equal(formatSubgroupName("GEMINI 4 ARGON"), "Gemini 4 Argon");
    assert.equal(formatSubgroupName("OTHER MODELS"), "Other Models");
  });
});

void describe("getAntigravitySubgroup", () => {
  void it("maps models to their respective subgroups using snapshot or name heuristics", () => {
    const flash = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      provider: "antigravity-acp",
    };
    const subFlash = getAntigravitySubgroup(flash, mockSnapshot);
    assert.equal(subFlash.name, "Gemini Models");
    assert.ok(subFlash.group);

    const argon = {
      id: "gemini-4-argon",
      name: "Gemini 4 Argon",
      provider: "antigravity-acp",
    };
    const subArgon = getAntigravitySubgroup(argon, mockSnapshot);
    assert.equal(subArgon.name, "Gemini 4 Argon");
    assert.ok(subArgon.group);

    const claude = {
      id: "claude-sonnet-4.5",
      name: "Claude Sonnet 4.5",
      provider: "antigravity-acp",
    };
    const subClaude = getAntigravitySubgroup(claude, mockSnapshot);
    assert.equal(subClaude.name, "Claude & GPT Models");
    assert.ok(subClaude.group);

    // Without snapshot
    const fallbackFlash = getAntigravitySubgroup(flash);
    assert.equal(fallbackFlash.name, "Gemini Models");
    assert.equal(fallbackFlash.group, undefined);
  });
});
