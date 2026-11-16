import assert from "node:assert/strict";
import test from "node:test";

import { describeStatus, handleFallbackCommand } from "../src/commands.ts";
import type { FallbackCommandContext } from "../src/commands.ts";
import { createMemoryRouterStore } from "../src/cooldown.ts";
import type { FallbackConfig } from "../src/types.ts";

const sampleConfig: FallbackConfig = {
  cooldownMs: 60_000,
  fallbacks: [
    {
      chain: ["provider-a/model-1", "provider-b/model-2"],
      cooldownMs: 60_000,
      id: "test-chain",
      name: "Test Chain",
    },
  ],
};

void test("describeStatus formats active model and cooldown status", () => {
  const store = createMemoryRouterStore();
  const now = 1_000_000;
  store.set("fallback/test-chain", {
    activeCandidateIndex: 1,
    cooldowns: {
      "provider-a/model-1": now + 30_000,
    },
  });

  const output = describeStatus(sampleConfig, store, now);
  assert.match(output, /Model fallback chains \(1\):/u);
  assert.match(output, /provider-a\/model-1 — cooling down \(30s left\)/u);
  assert.match(output, /\*2\. provider-b\/model-2 — ready/u);
});

void test("handleFallbackCommand clears cooldowns on reset", async () => {
  const store = createMemoryRouterStore();
  store.set("fallback/test-chain", {
    activeCandidateIndex: 1,
    cooldowns: { "provider-a/model-1": 9_999_999 },
  });

  const notifications: { message: string; type?: string }[] = [];
  const mockCtx: FallbackCommandContext = {
    ui: {
      notify: (message, type) => {
        notifications.push({ message, type });
      },
    },
  };

  // Reset target chain
  await handleFallbackCommand("reset test-chain", mockCtx, store, sampleConfig);
  const updated = store.get("fallback/test-chain");
  assert.equal(updated?.activeCandidateIndex, 0);
  assert.deepEqual(updated?.cooldowns, {});
  assert.equal(notifications[0]?.type, "info");
});
