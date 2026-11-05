import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNextFavoriteKey, getNextThinkingLevel } from "../src/cycling.ts";

describe("getNextFavoriteKey", () => {
  const favorites = [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-5",
    "google/gemini-2.5-pro",
  ];

  it("returns null when favorites list is empty", () => {
    assert.equal(getNextFavoriteKey([], "openai/gpt-5", 1), null);
  });

  it("returns first favorite when current model is not in favorites (forward)", () => {
    assert.equal(getNextFavoriteKey(favorites, "meta/llama-3", 1), "anthropic/claude-sonnet-4-5");
    assert.equal(getNextFavoriteKey(favorites, undefined, 1), "anthropic/claude-sonnet-4-5");
  });

  it("returns last favorite when current model is not in favorites (backward)", () => {
    assert.equal(getNextFavoriteKey(favorites, "meta/llama-3", -1), "google/gemini-2.5-pro");
    assert.equal(getNextFavoriteKey(favorites, undefined, -1), "google/gemini-2.5-pro");
  });

  it("cycles to next favorite forward", () => {
    assert.equal(getNextFavoriteKey(favorites, "anthropic/claude-sonnet-4-5", 1), "openai/gpt-5");
    assert.equal(getNextFavoriteKey(favorites, "openai/gpt-5", 1), "google/gemini-2.5-pro");
  });

  it("wraps around to first favorite when cycling past the end", () => {
    assert.equal(getNextFavoriteKey(favorites, "google/gemini-2.5-pro", 1), "anthropic/claude-sonnet-4-5");
  });

  it("cycles to previous favorite backward", () => {
    assert.equal(getNextFavoriteKey(favorites, "google/gemini-2.5-pro", -1), "openai/gpt-5");
    assert.equal(getNextFavoriteKey(favorites, "openai/gpt-5", -1), "anthropic/claude-sonnet-4-5");
  });

  it("wraps around to last favorite when cycling backward from the start", () => {
    assert.equal(getNextFavoriteKey(favorites, "anthropic/claude-sonnet-4-5", -1), "google/gemini-2.5-pro");
  });
});

describe("getNextThinkingLevel", () => {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];

  it("returns null when levels list is empty", () => {
    assert.equal(getNextThinkingLevel([], "medium", 1), null);
  });

  it("defaults to first level forward when current level is unknown", () => {
    assert.equal(getNextThinkingLevel(levels, undefined, 1), "off");
    assert.equal(getNextThinkingLevel(levels, "invalid", 1), "off");
  });

  it("defaults to last level backward when current level is unknown", () => {
    assert.equal(getNextThinkingLevel(levels, undefined, -1), "xhigh");
    assert.equal(getNextThinkingLevel(levels, "invalid", -1), "xhigh");
  });

  it("cycles forward through thinking levels", () => {
    assert.equal(getNextThinkingLevel(levels, "off", 1), "minimal");
    assert.equal(getNextThinkingLevel(levels, "minimal", 1), "low");
    assert.equal(getNextThinkingLevel(levels, "high", 1), "xhigh");
  });

  it("wraps around forward from max level to first level", () => {
    assert.equal(getNextThinkingLevel(levels, "xhigh", 1), "off");
  });

  it("cycles backward through thinking levels", () => {
    assert.equal(getNextThinkingLevel(levels, "xhigh", -1), "high");
    assert.equal(getNextThinkingLevel(levels, "medium", -1), "low");
  });

  it("wraps around backward from first level to max level", () => {
    assert.equal(getNextThinkingLevel(levels, "off", -1), "xhigh");
  });
});

