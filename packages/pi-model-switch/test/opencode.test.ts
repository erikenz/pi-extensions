import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import {
  clearCachedDisabledModels,
  getCachedDisabledModels,
  getOpenCodeApiKey,
  getOpenCodeApiKeys,
  isOpenCodeDisabled,
  parseDisabledModelsFromConfig,
  parseOpenCodeGoUsage,
  saveCachedDisabledModels,
} from "../src/opencode.ts";
import { buildRows } from "../src/picker.ts";

const createMockModel = (
  id: string,
  name: string,
  provider: string
): Model<Api> => ({
  api: "openai-completions",
  baseUrl: "https://example.com",
  contextWindow: 128_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  maxTokens: 4096,
  name,
  provider,
  reasoning: false,
});

void describe("parseDisabledModelsFromConfig", () => {
  void test("extracts models with disabled: true per provider", () => {
    const mockConfig = {
      providers: {
        opencode: {
          models: {
            "claude-fable-5": { disabled: true },
            "claude-haiku-4-5": { disabled: false },
            "gpt-5": { disabled: true },
          },
        },
        "opencode-go": {
          models: {
            "beam-free": { disabled: true },
            "kimi-k3": {},
          },
        },
      },
    };

    const disabled = parseDisabledModelsFromConfig(mockConfig);
    assert.equal(disabled.size, 3);
    assert.equal(disabled.has("opencode/claude-fable-5"), true);
    assert.equal(disabled.has("opencode/gpt-5"), true);
    assert.equal(disabled.has("opencode-go/beam-free"), true);
    assert.equal(disabled.has("opencode/claude-haiku-4-5"), false);
    assert.equal(disabled.has("opencode-go/kimi-k3"), false);
  });

  void test("extracts models scoped to a specific targetProvider", () => {
    const mockConfig = {
      providers: {
        opencode: {
          models: {
            m1: { disabled: true },
          },
        },
        "opencode-go": {
          models: {
            m2: { disabled: true },
          },
        },
      },
    };

    const disabledGo = parseDisabledModelsFromConfig(mockConfig, "opencode-go");
    assert.equal(disabledGo.size, 1);
    assert.equal(disabledGo.has("opencode-go/m2"), true);
    assert.equal(disabledGo.has("opencode/m1"), false);
  });

  void test("handles empty or missing providers gracefully", () => {
    assert.equal(parseDisabledModelsFromConfig({}).size, 0);
  });
});

void describe("isOpenCodeDisabled", () => {
  const disabledSet = new Set(["opencode/gpt-5", "opencode-go/beam-free"]);

  void test("matches exact provider/id key", () => {
    assert.equal(
      isOpenCodeDisabled(
        { id: "gpt-5", name: "GPT-5", provider: "opencode" },
        disabledSet
      ),
      true
    );
    assert.equal(
      isOpenCodeDisabled(
        { id: "gpt-5", name: "GPT-5", provider: "openai" },
        disabledSet
      ),
      false
    );
  });

  void test("returns false for enabled models", () => {
    assert.equal(
      isOpenCodeDisabled(
        { id: "big-pickle", name: "Big Pickle", provider: "opencode" },
        disabledSet
      ),
      false
    );
  });
});

void describe("cache management and getOpenCodeApiKey", () => {
  void test("reads api key from mock auth.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-agent-"));
    try {
      const auth = {
        opencode: { key: "test-opencode-key", type: "api_key" },
      };
      fs.writeFileSync(
        path.join(tmpDir, "auth.json"),
        JSON.stringify(auth),
        "utf-8"
      );

      const found = getOpenCodeApiKey(tmpDir);
      assert.deepEqual(found, {
        key: "test-opencode-key",
        provider: "opencode",
      });

      const keys = getOpenCodeApiKeys(tmpDir);
      assert.deepEqual(keys, {
        opencode: "test-opencode-key",
      });
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  void test("reads both opencode and opencode-go keys from mock auth.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-agent-"));
    try {
      const auth = {
        opencode: { key: "zen-key", type: "api_key" },
        "opencode-go": { key: "go-key", type: "api_key" },
      };
      fs.writeFileSync(
        path.join(tmpDir, "auth.json"),
        JSON.stringify(auth),
        "utf-8"
      );

      const keys = getOpenCodeApiKeys(tmpDir);
      assert.deepEqual(keys, {
        opencode: "zen-key",
        "opencode-go": "go-key",
      });
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  void test("saves and retrieves disabled models from disk cache", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-agent-"));
    try {
      clearCachedDisabledModels();
      const set = new Set(["opencode/m1", "opencode-go/m2"]);
      saveCachedDisabledModels(set, tmpDir);

      clearCachedDisabledModels();
      const loaded = getCachedDisabledModels(tmpDir);
      assert.equal(loaded.size, 2);
      assert.equal(loaded.has("opencode/m1"), true);
      assert.equal(loaded.has("opencode-go/m2"), true);
    } finally {
      clearCachedDisabledModels();
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });
});

void describe("buildRows with disabledSet", () => {
  const models: Model<Api>[] = [
    createMockModel("flash", "Gemini Flash", "antigravity-acp"),
    createMockModel("big-pickle", "Big Pickle", "opencode"),
    createMockModel("disabled-model", "Disabled Model", "opencode"),
  ];

  void test("excludes models in disabledSet from rows", () => {
    const disabledSet = new Set(["opencode/disabled-model"]);
    const rows = buildRows(
      models,
      new Set(),
      new Set(),
      false,
      [],
      disabledSet
    );

    const modelRows = rows.filter((r) => r.kind === "model");
    assert.equal(modelRows.length, 2);
    assert.equal(
      modelRows.some(
        (r) => r.kind === "model" && r.model.id === "disabled-model"
      ),
      false
    );
    assert.equal(
      modelRows.some((r) => r.kind === "model" && r.model.id === "big-pickle"),
      true
    );
  });
});

void describe("parseOpenCodeGoUsage", () => {
  void test("parses rolling, weekly, and monthly usage percent into remaining fractions", () => {
    const data = {
      usage: {
        monthly: {
          percent: 97,
          resetsAt: "2026-11-18T21:37:49.000Z",
          status: "ok",
        },
        rolling: {
          percent: 0,
          resetsAt: "2026-11-12T20:40:17.788Z",
          status: "ok",
        },
        weekly: {
          percent: 67,
          resetsAt: "2026-11-16T00:00:00.000Z",
          status: "ok",
        },
      },
    };

    const group = parseOpenCodeGoUsage(data);
    assert.ok(group);
    assert.equal(group.displayName, "opencode-go");
    assert.equal(group.buckets.length, 3);

    const b5 = group.buckets.find((b) => b.window === "5h");
    assert.ok(b5);
    assert.equal(b5.remainingFraction, 1);
    assert.equal(b5.resetTime, "2026-11-12T20:40:17.788Z");

    const bW = group.buckets.find((b) => b.window === "weekly");
    assert.ok(bW);
    assert.equal(Math.round(bW.remainingFraction * 100), 33);
    assert.equal(bW.resetTime, "2026-11-16T00:00:00.000Z");

    const bM = group.buckets.find((b) => b.window === "monthly");
    assert.ok(bM);
    assert.equal(Math.round(bM.remainingFraction * 100), 3);
    assert.equal(bM.resetTime, "2026-11-18T21:37:49.000Z");
  });

  void test("returns undefined for invalid or missing data", () => {
    assert.equal(parseOpenCodeGoUsage(null), undefined);
    assert.equal(parseOpenCodeGoUsage({}), undefined);
    assert.equal(parseOpenCodeGoUsage({ usage: {} }), undefined);
  });
});
