/**
 * Error slug mappings defined in section 3 of specification:
 * 401 invalid_api_key: "API key is invalid."
 * 402 no_plan: "This account has no active calling plan."
 * 403 spam_blocked: "This number is marked as spam in the CRM."
 * 422 validation: show the API message.
 * 429 rate_limited: "Too many requests, wait a minute."
 * Anything else: show a generic message and keep raw slug in server log.
 */

const KNOWN_ERROR_MAPPINGS: Record<string, string> = {
  invalid_api_key: 'API key is invalid.',
  no_plan:
    'This account has no active calling plan, so bridge calls are not available. Ask the account owner to enable calling.',
  spam_blocked: 'This number is marked as spam in the CRM.',
  rate_limited: 'Too many requests, wait a minute.',
};

/**
 * Returns a friendly, user-safe error message based on Omixo API status and error slug.
 */
export function getFriendlyErrorMessage(
  status: number,
  slug?: string,
  rawMessage?: string
): string {
  // If slug matches known mapping, return friendly message
  if (slug && KNOWN_ERROR_MAPPINGS[slug]) {
    return KNOWN_ERROR_MAPPINGS[slug]!;
  }

  // 422 validation errors: show the API message
  if (status === 422 && rawMessage) {
    return rawMessage;
  }

  // HTTP status fallback mapping if slug was not explicitly matched
  if (status === 401) {
    return 'API key is invalid.';
  }
  if (status === 402) {
    return 'This account has no active calling plan.';
  }
  if (status === 403) {
    return 'This call is not permitted (number may be blocked or unapproved).';
  }
  if (status === 429) {
    return 'Too many requests, wait a minute.';
  }

  // Log unknown slug to server console for troubleshooting
  if (slug) {
    console.error(`[Omixo API] Unmapped error slug received: ${slug} (HTTP ${status}, message: ${rawMessage ?? 'none'})`);
  }

  return 'An unexpected error occurred while communicating with the calling service.';
}
