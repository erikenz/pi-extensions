import assert from "node:assert/strict";
import { test } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import { createMemoryRouterStore } from "../src/cooldown.ts";
import type { RouterStore } from "../src/cooldown.ts";
import {
  capabilitiesFromModel,
  createRouter,
  DEFAULT_THINKING_LEVELS,
} from "../src/router.ts";
import type { RouterContext, RouterRequest } from "../src/types.ts";

const makeModel = (
  provider: string,
  id: string,
  overrides: Partial<Model<Api>> = {}
): Model<Api> => ({
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  contextWindow: 100_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text", "image"],
  maxTokens: 8192,
  name: id,
  provider,
  reasoning: true,
  ...overrides,
});

const makeRegistry = (models: readonly Model<Api>[]): RouterContext => {
  const byKey = new Map(
    models.map((model) => [`${model.provider}/${model.id}`, model])
  );
  return {
    modelRegistry: {
      find: (provider, modelId) => byKey.get(`${provider}/${modelId}`),
    },
  };
};

const makeRequest = (
  overrides: Partial<RouterRequest> = {}
): RouterRequest => ({
  reason: "user",
  thinkingLevel: "medium",
  ...overrides,
});

const free = makeModel("opencode", "deepseek-v4.1-flash");
const paid = makeModel("opencode-go", "deepseek-v4.1-flash");
const backup = makeModel("opencode-go", "claude-haiku-5-5");
const chain = [
  "opencode/deepseek-v4.1-flash",
  "opencode-go/deepseek-v4.1-flash",
  "opencode-go/claude-haiku-5-5",
];

interface Harness {
  ctx: RouterContext;
  route: ReturnType<typeof createRouter>;
  store: RouterStore;
  warnings: string[];
  setNow: (value: number) => void;
}

const makeHarness = (
  models: readonly Model<Api>[] = [free, paid, backup],
  cooldownMs = 30 * 60 * 1000
): Harness => {
  const store = createMemoryRouterStore();
  const warnings: string[] = [];
  let now = 1000;
  const route = createRouter({
    chain,
    chainId: "fallback/test",
    cooldownMs,
    now: () => now,
    store,
    warn: (message) => {
      warnings.push(message);
    },
  });
  return {
    ctx: makeRegistry(models),
    route,
    setNow: (value) => {
      now = value;
    },
    store,
    warnings,
  };
};

void test("routes to the highest-priority healthy model on a user turn", () => {
  const harness = makeHarness();
  const result = harness.route(
    makeRequest({ thinkingLevel: "high" }),
    harness.ctx
  );

  assert.equal(result.model, free);
  assert.equal(result.thinkingLevel, "high");
  assert.deepEqual(result.state, {
    activeCandidateIndex: 0,
    cooldowns: {},
  });
});

void test("skips missing models with a warning", () => {
  const harness = makeHarness([paid, backup]);
  const first = harness.route(makeRequest(), harness.ctx);
  assert.equal(first.model, paid);
  assert.equal(first.state?.activeCandidateIndex, 1);
  assert.equal(harness.warnings.length, 1);
  assert.match(harness.warnings[0] ?? "", /missing model/u);

  const second = harness.route(makeRequest(), harness.ctx);
  assert.equal(second.model, paid);
  assert.equal(harness.warnings.length, 1, "warning is deduplicated");
});

void test("throws when no chain model is available", () => {
  const harness = makeHarness([]);
  assert.throws(
    () => harness.route(makeRequest(), harness.ctx),
    /No available models in fallback chain/u
  );
  assert.equal(harness.warnings.length, chain.length);
});

void test("fails over to the next model on a 429 retry", () => {
  const harness = makeHarness();
  harness.route(makeRequest(), harness.ctx);

  const result = harness.route(
    makeRequest({
      failed: {
        message: { errorMessage: "429 Too Many Requests" },
        model: free,
        thinkingLevel: "high",
      },
      reason: "retry",
      thinkingLevel: "high",
    }),
    harness.ctx
  );

  assert.equal(result.model, paid);
  assert.equal(result.thinkingLevel, "high");
  assert.equal(result.state?.activeCandidateIndex, 1);
  assert.deepEqual(result.state?.cooldowns, {
    "opencode/deepseek-v4.1-flash": 1000 + 30 * 60 * 1000,
  });
});

void test("fails over on quota and overload indicators", () => {
  for (const message of [
    "insufficient_quota",
    "credits exhausted",
    "The model is overloaded",
    "rate limit exceeded",
  ]) {
    const harness = makeHarness();
    const result = harness.route(
      makeRequest({
        failed: { message: { errorMessage: message }, model: free },
        reason: "retry",
      }),
      harness.ctx
    );
    assert.equal(result.model, paid, message);
  }
});

void test("does not cool down or switch for a non-quota retry", () => {
  const harness = makeHarness();
  const result = harness.route(
    makeRequest({
      failed: {
        message: { errorMessage: "invalid api key" },
        model: free,
        thinkingLevel: "low",
      },
      reason: "retry",
    }),
    harness.ctx
  );

  assert.equal(result.model, free);
  assert.equal(result.thinkingLevel, "low");
  assert.deepEqual(result.state?.cooldowns, {});
});

void test("continuation stays on the previous model and thinking level", () => {
  const harness = makeHarness();
  const result = harness.route(
    makeRequest({
      previous: { model: backup, thinkingLevel: "xhigh" },
      reason: "continuation",
      thinkingLevel: "medium",
    }),
    harness.ctx
  );

  assert.equal(result.model, backup);
  assert.equal(result.thinkingLevel, "xhigh");
  assert.equal(result.state?.activeCandidateIndex, 2);
});

void test("continuation keeps a previous model that left the chain", () => {
  const harness = makeHarness();
  const outside = makeModel("other", "model");
  const result = harness.route(
    makeRequest({
      previous: { model: outside, thinkingLevel: "minimal" },
      reason: "continuation",
    }),
    harness.ctx
  );

  assert.equal(result.model, outside);
  assert.equal(result.thinkingLevel, "minimal");
});

void test("a cooled-down tier 0 is skipped on the next user turn", () => {
  const harness = makeHarness();
  const retry = harness.route(
    makeRequest({
      failed: { message: { errorMessage: "429" }, model: free },
      reason: "retry",
    }),
    harness.ctx
  );

  const next = harness.route(
    makeRequest({ reason: "user", state: retry.state }),
    harness.ctx
  );
  assert.equal(next.model, paid);
});

void test("in-memory cooldowns apply to requests without session state", () => {
  const harness = makeHarness();
  harness.route(
    makeRequest({
      failed: { message: { errorMessage: "quota exceeded" }, model: free },
      reason: "retry",
    }),
    harness.ctx
  );

  const next = harness.route(makeRequest({ reason: "direct" }), harness.ctx);
  assert.equal(next.model, paid);
});

void test("live memory state overrides stale session cooldowns after a reset", () => {
  const harness = makeHarness();
  harness.store.set("fallback/test", {
    activeCandidateIndex: 0,
    cooldowns: {},
  });

  const result = harness.route(
    makeRequest({
      state: {
        activeCandidateIndex: 0,
        cooldowns: { "opencode/deepseek-v4.1-flash": 999_999 },
      },
    }),
    harness.ctx
  );
  assert.equal(result.model, free);
});

void test("session cooldowns apply without an in-memory state", () => {
  const harness = makeHarness();
  const result = harness.route(
    makeRequest({
      state: {
        activeCandidateIndex: 0,
        cooldowns: { "opencode/deepseek-v4.1-flash": 5000 },
      },
    }),
    harness.ctx
  );
  assert.equal(result.model, paid);
});

void test("cooldowns expire and tier 0 becomes eligible again", () => {
  const harness = makeHarness([free, paid], 500);
  const retry = harness.route(
    makeRequest({
      failed: { message: { errorMessage: "429" }, model: free },
      reason: "retry",
    }),
    harness.ctx
  );
  assert.equal(retry.model, paid);

  harness.setNow(1500);
  const next = harness.route(
    makeRequest({ reason: "user", state: retry.state }),
    harness.ctx
  );
  assert.equal(next.model, free);
  assert.deepEqual(next.state?.cooldowns, {});
});

void test("when every model is cooling down, the earliest expiry wins", () => {
  const harness = makeHarness();
  harness.store.set("fallback/test", {
    activeCandidateIndex: 0,
    cooldowns: {
      "opencode-go/claude-haiku-5-5": 1500,
      "opencode-go/deepseek-v4.1-flash": 1800,
      "opencode/deepseek-v4.1-flash": 2000,
    },
  });

  const result = harness.route(makeRequest(), harness.ctx);
  assert.equal(result.model, backup);
  assert.equal(result.state?.activeCandidateIndex, 2);
});

void test("retry failover wraps to the next model after the last one", () => {
  const harness = makeHarness();
  const result = harness.route(
    makeRequest({
      failed: {
        message: { errorMessage: "429" },
        model: backup,
        thinkingLevel: "max",
      },
      reason: "retry",
      thinkingLevel: "max",
    }),
    harness.ctx
  );

  assert.equal(result.model, free);
  assert.equal(result.thinkingLevel, "max");
  assert.equal(result.state?.activeCandidateIndex, 0);
});

void test("returned state is JSON-serializable", () => {
  const harness = makeHarness();
  const result = harness.route(makeRequest(), harness.ctx);
  const state = structuredClone(result.state);
  assert.deepEqual(state, result.state);
});

void test("capabilities mirror the primary physical model", () => {
  const primary = makeModel("opencode", "primary", {
    contextWindow: 200_000,
    input: ["text"],
    maxTokens: 32_000,
    reasoning: true,
  });

  assert.deepEqual(capabilitiesFromModel(primary), {
    contextWindow: 200_000,
    input: ["text"],
    maxTokens: 32_000,
    thinkingLevels: ["off", "minimal", "low", "medium", "high"],
  });
});

void test("capabilities fall back to sensible defaults without a model", () => {
  assert.deepEqual(capabilitiesFromModel(undefined), {
    thinkingLevels: DEFAULT_THINKING_LEVELS,
  });
});

void test("a non-reasoning model only offers the off thinking level", () => {
  assert.deepEqual(
    capabilitiesFromModel(makeModel("p", "plain", { reasoning: false })),
    {
      contextWindow: 100_000,
      input: ["text", "image"],
      maxTokens: 8192,
      thinkingLevels: ["off"],
    }
  );
});
