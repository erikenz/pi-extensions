import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMemoryRouterStore,
  formatDuration,
  isCoolingDown,
  markCooldown,
  pruneExpiredCooldowns,
} from "../src/cooldown.ts";

void test("markCooldown sets an expiry relative to now", () => {
  assert.deepEqual(markCooldown({}, "a/one", 1000, 5000), {
    "a/one": 6000,
  });
});

void test("markCooldown preserves other live cooldowns and drops expired ones", () => {
  assert.deepEqual(
    markCooldown({ "a/one": 9000, "b/two": 500 }, "c/three", 1000, 2000),
    { "a/one": 9000, "c/three": 3000 }
  );
});

void test("isCoolingDown is exclusive at the expiry boundary", () => {
  assert.equal(isCoolingDown({ "a/one": 5000 }, "a/one", 4999), true);
  assert.equal(isCoolingDown({ "a/one": 5000 }, "a/one", 5000), false);
  assert.equal(isCoolingDown({ "a/one": 5000 }, "a/one", 5001), false);
  assert.equal(isCoolingDown({}, "a/one", 0), false);
  assert.equal(isCoolingDown(undefined, "a/one", 0), false);
});

void test("pruneExpiredCooldowns keeps only future expiries", () => {
  assert.deepEqual(
    pruneExpiredCooldowns(
      { "a/one": 1000, "b/two": 2000, "c/three": 3000 },
      2000
    ),
    { "c/three": 3000 }
  );
  assert.deepEqual(pruneExpiredCooldowns(undefined, 0), {});
});

void test("formatDuration renders minutes and seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(1500), "2s");
  assert.equal(formatDuration(65_000), "1m 5s");
  assert.equal(formatDuration(3_600_000), "60m 0s");
});

void test("memory store round-trips and clones state", () => {
  const store = createMemoryRouterStore();
  const state = {
    activeCandidateIndex: 1,
    cooldowns: { "a/one": 5000 },
  };
  store.set("fallback/test", state);

  const read = store.get("fallback/test");
  assert.deepEqual(read, state);
  assert.notEqual(read, state);
  assert.notEqual(read?.cooldowns, state.cooldowns);

  if (read !== undefined) {
    read.cooldowns["a/one"] = 1;
    read.activeCandidateIndex = 9;
  }
  assert.deepEqual(store.get("fallback/test"), state);

  assert.deepEqual(store.entries(), [["fallback/test", state]]);
});

void test("memory store clears one chain or everything", () => {
  const store = createMemoryRouterStore();
  store.set("fallback/one", { activeCandidateIndex: 0, cooldowns: {} });
  store.set("fallback/two", { activeCandidateIndex: 0, cooldowns: {} });

  store.clear("fallback/one");
  assert.equal(store.get("fallback/one"), undefined);
  assert.notEqual(store.get("fallback/two"), undefined);

  store.clear();
  assert.deepEqual(store.entries(), []);
});
