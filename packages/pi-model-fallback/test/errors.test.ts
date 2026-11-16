import assert from "node:assert/strict";
import { test } from "node:test";

import { isQuotaFailure, isQuotaOrRateLimitError } from "../src/errors.ts";

const QUOTA_MESSAGES = [
  "429 Too Many Requests",
  "HTTP 429",
  "rate limit exceeded",
  "rate_limit_exceeded",
  "RateLimitError: try again later",
  "You have exceeded your quota",
  "insufficient_quota",
  "insufficient balance",
  "Your credit balance is too low",
  "credits exhausted",
  "out of credits",
  "usage limit reached for this week",
  "weekly limit reached",
  "monthly limit reached",
  "resource_exhausted",
  "The model is overloaded",
  "server at capacity",
  "402 Payment Required",
  "payment required",
  "billing hard limit reached",
  "529 overloaded",
];

const OTHER_MESSAGES = [
  "context length exceeded",
  "maximum context window reached",
  "invalid api key",
  "model not found",
  "tool call failed",
  "aborted by user",
  "",
  "   ",
];

void test("recognizes quota and rate-limit messages", () => {
  for (const message of QUOTA_MESSAGES) {
    assert.equal(isQuotaOrRateLimitError(message), true, message);
  }
});

void test("ignores unrelated errors and empty messages", () => {
  for (const message of OTHER_MESSAGES) {
    assert.equal(isQuotaOrRateLimitError(message), false, message);
  }
});

void test("handles undefined and null", () => {
  assert.equal(isQuotaOrRateLimitError(undefined), false);
  assert.equal(isQuotaOrRateLimitError(null), false);
  assert.equal(isQuotaOrRateLimitError({}), false);
  assert.equal(isQuotaOrRateLimitError({ errorMessage: "" }), false);
});

void test("checks both errorMessage and stopReason", () => {
  assert.equal(
    isQuotaOrRateLimitError({
      errorMessage: "Provider rejected the request",
      stopReason: "rate limit exceeded",
    }),
    true
  );
  assert.equal(isQuotaOrRateLimitError({ stopReason: "429" }), true);
});

void test("isQuotaFailure reads request.failed-shaped values", () => {
  assert.equal(
    isQuotaFailure({ message: { errorMessage: "insufficient_quota" } }),
    true
  );
  assert.equal(isQuotaFailure({ message: { errorMessage: "bad key" } }), false);
  assert.equal(isQuotaFailure(undefined), false);
});
