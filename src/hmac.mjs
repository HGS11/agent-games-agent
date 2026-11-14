// HMAC-SHA256 helpers for the Agent Games signed contract.
//
// Per the public spec:
//   - Verify the HMAC signature against the RAW request body before parsing.
//   - Sign every response with header `x-agent-games-signature` over the
//     RAW response body.
//   - The HMAC secret is the platform-generated value from Rotate Secret
//     in the dashboard — never a local placeholder.
//
// GAPS (see GAPS.md):
//   - The INCOMING signature header name is NOT in the public pages. The
//     server default ("x-agent-games-signature") is an UNVERIFIED GUESS and
//     is env-configurable (AGENT_GAMES_HMAC_HEADER). Confirm from the
//     dashboard / preflight before competing.
//   - The signature encoding is assumed to be lowercase hex, with an
//     optional "sha256=" prefix (common convention). Confirm in practice
//     mode; if the platform sends base64, this module must change.

import { createHmac, timingSafeEqual } from "node:crypto";

export const RESPONSE_SIGNATURE_HEADER = "x-agent-games-signature";

/** Hex HMAC-SHA256 of the raw body. */
export function signHmacSha256Hex(secret, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  return createHmac("sha256", secret).update(body).digest("hex");
}

function parseHexSignature(headerValue) {
  if (typeof headerValue !== "string") return null;
  let v = headerValue.trim();
  if (v.toLowerCase().startsWith("sha256=")) v = v.slice("sha256=".length);
  if (!/^[0-9a-fA-F]+$/.test(v) || v.length % 2 !== 0) return null;
  return Buffer.from(v, "hex");
}

/**
 * Timing-safe verification of an incoming HMAC-SHA256 hex signature over
 * the raw body. Returns false (never throws) for any mismatch or malformed
 * input.
 */
export function verifyHmacSha256Hex(secret, rawBody, headerValue) {
  try {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = createHmac("sha256", secret).update(body).digest();
    const actual = parseHexSignature(headerValue);
    if (!actual || actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
