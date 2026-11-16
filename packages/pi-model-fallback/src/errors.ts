import type { FailureMessage } from "./types.ts";

/**
 * Indicators of quota depletion, rate limiting, or provider overload. They are checked
 * against both `errorMessage` and `stopReason`.
 */
const QUOTA_PATTERNS: readonly RegExp[] = [
  /\b429\b/u,
  /\b402\b/u,
  /\b529\b/u,
  /rate[\s_-]*limit/iu,
  /\btoo many requests\b/iu,
  /\bquota\b/iu,
  /\binsufficient[\s_-]*(?:quota|balance|credits?|funds?)\b/iu,
  /\b(?:credits?|balance|funds?)\s+(?:exhausted|depleted|exceeded|insufficient|empty|too low)\b/iu,
  /\bcredit balance\b/iu,
  /\bout of (?:credits?|quota|balance|funds?)\b/iu,
  /\b(?:usage|weekly|monthly|daily|hourly)\s+limit\b/iu,
  /\b(?:resource|quota)[\s_-]*exhausted\b/iu,
  /\boverloaded\b/iu,
  /\b(?:service|server)\s+(?:is\s+)?(?:at|over)\s+capacity\b/iu,
  /\bbilling\b/iu,
  /\bpayment required\b/iu,
];

export const isQuotaOrRateLimitError = (
  failure: FailureMessage | string | undefined | null
): boolean => {
  if (failure === undefined || failure === null) {
    return false;
  }
  const text =
    typeof failure === "string"
      ? failure
      : [failure.errorMessage, failure.stopReason]
          .filter((part): part is string => typeof part === "string")
          .join(" ");
  if (text.trim().length === 0) {
    return false;
  }
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text));
};

/** Whether a `request.failed` object reports a quota/rate-limit failure. */
export const isQuotaFailure = (
  failed: { message: FailureMessage } | undefined
): boolean => isQuotaOrRateLimitError(failed?.message);
