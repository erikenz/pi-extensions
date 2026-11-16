import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  configPath,
  DEFAULT_COOLDOWN_MS,
  loadConfig,
  modelKey,
  parseConfig,
  parseModelKey,
} from "../src/config.ts";

const withTempFile = (
  contents: string,
  run: (filePath: string) => void
): void => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-model-fallback-"));
  const filePath = path.join(directory, "model-fallback.json");
  try {
    writeFileSync(filePath, contents, "utf-8");
    run(filePath);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

void test("configPath points at model-fallback.json in the agent directory", () => {
  assert.match(configPath(), /model-fallback\.json$/u);
});

void test("parseModelKey splits at the first slash", () => {
  assert.deepEqual(parseModelKey("opencode-go/claude-haiku-5-5"), {
    id: "claude-haiku-5-5",
    provider: "opencode-go",
  });
  assert.deepEqual(parseModelKey(" opencode / deepseek-v4.1-flash "), {
    id: "deepseek-v4.1-flash",
    provider: "opencode",
  });
  assert.deepEqual(parseModelKey("openai/gpt-5/suffix"), {
    id: "gpt-5/suffix",
    provider: "openai",
  });
});

void test("parseModelKey rejects malformed keys", () => {
  for (const key of ["", "no-slash", "/id", "provider/", " / "]) {
    assert.equal(parseModelKey(key), undefined, key);
  }
});

void test("modelKey joins provider and id", () => {
  assert.equal(
    modelKey({ id: "claude-haiku-5-5", provider: "opencode-go" }),
    "opencode-go/claude-haiku-5-5"
  );
});

void test("parseConfig returns defaults for missing or invalid input", () => {
  for (const raw of [undefined, null, [], "text", 42]) {
    assert.deepEqual(parseConfig(raw), {
      cooldownMs: DEFAULT_COOLDOWN_MS,
      fallbacks: [],
    });
  }
});

void test("parseConfig reads the documented schema", () => {
  const config = parseConfig({
    $schema: "./schema.json",
    cooldownMs: 1000,
    fallbacks: {
      "claude-workhorse": {
        chain: ["opencode-go/claude-sonnet-5-5"],
        name: "Claude Smart Fallback",
      },
      "deepseek-flash": {
        chain: [
          "opencode/deepseek-v4.1-flash",
          "opencode-go/deepseek-v4.1-flash",
        ],
        cooldownMs: 2000,
        name: "DeepSeek Flash (Auto Fallback)",
      },
    },
  });

  assert.equal(config.cooldownMs, 1000);
  assert.deepEqual(config.fallbacks, [
    {
      chain: ["opencode-go/claude-sonnet-5-5"],
      cooldownMs: 1000,
      id: "claude-workhorse",
      name: "Claude Smart Fallback",
    },
    {
      chain: [
        "opencode/deepseek-v4.1-flash",
        "opencode-go/deepseek-v4.1-flash",
      ],
      cooldownMs: 2000,
      id: "deepseek-flash",
      name: "DeepSeek Flash (Auto Fallback)",
    },
  ]);
});

void test("parseConfig fills in default names and cooldowns", () => {
  const config = parseConfig({
    fallbacks: {
      "no-name": { chain: ["a/one"] },
    },
  });

  assert.equal(config.fallbacks[0]?.name, "no-name (Auto Fallback)");
  assert.equal(config.fallbacks[0]?.cooldownMs, DEFAULT_COOLDOWN_MS);
});

void test("parseConfig trims, dedupes, and rejects invalid chain entries", () => {
  const config = parseConfig({
    fallbacks: {
      "mixed-chain": {
        chain: [
          " a/one ",
          "a/one",
          "not-a-model",
          "",
          "   ",
          42,
          null,
          "b/two",
        ],
      },
    },
  });

  assert.deepEqual(config.fallbacks[0]?.chain, ["a/one", "b/two"]);
});

void test("parseConfig skips fallbacks with unusable chains or values", () => {
  const config = parseConfig({
    fallbacks: {
      "empty-chain": { chain: [] },
      "invalid-only": { chain: ["not-a-model"] },
      "missing-chain": { name: "No chain" },
      "no-usable-chain": { chain: "a/one" },
      "not-a-record": "nope",
    },
  });

  assert.deepEqual(config.fallbacks, []);
});

void test("parseConfig ignores non-positive cooldowns", () => {
  const config = parseConfig({
    cooldownMs: -1,
    fallbacks: {
      test: { chain: ["a/one"], cooldownMs: 0 },
    },
  });

  assert.equal(config.cooldownMs, DEFAULT_COOLDOWN_MS);
  assert.equal(config.fallbacks[0]?.cooldownMs, DEFAULT_COOLDOWN_MS);
});

void test("loadConfig returns defaults when the file is missing", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-model-fallback-"));
  try {
    assert.deepEqual(loadConfig(path.join(directory, "missing.json")), {
      cooldownMs: DEFAULT_COOLDOWN_MS,
      fallbacks: [],
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("loadConfig returns defaults for an empty file", () => {
  withTempFile("   \n", (filePath) => {
    assert.deepEqual(loadConfig(filePath), {
      cooldownMs: DEFAULT_COOLDOWN_MS,
      fallbacks: [],
    });
  });
});

void test("loadConfig returns defaults for invalid JSON or non-object JSON", () => {
  withTempFile("{ not json", (filePath) => {
    assert.deepEqual(loadConfig(filePath).fallbacks, []);
  });
  withTempFile("[]", (filePath) => {
    assert.deepEqual(loadConfig(filePath).fallbacks, []);
  });
});

void test("loadConfig reads a valid file", () => {
  withTempFile(
    JSON.stringify({
      cooldownMs: 5000,
      fallbacks: {
        chain: { chain: ["opencode-go/deepseek-v4.1-flash"] },
      },
    }),
    (filePath) => {
      const config = loadConfig(filePath);
      assert.equal(config.cooldownMs, 5000);
      assert.equal(config.fallbacks.length, 1);
      assert.deepEqual(config.fallbacks[0]?.chain, [
        "opencode-go/deepseek-v4.1-flash",
      ]);
    }
  );
});
