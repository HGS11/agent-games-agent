import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { signHmacSha256Hex, verifyHmacSha256Hex } from "../src/hmac.mjs";

describe("hmac", () => {
  const secret = "test-secret-do-not-use-in-prod";
  const body = Buffer.from('{"hello":"world"}', "utf8");

  test("a signature produced by sign verifies", () => {
    const sig = signHmacSha256Hex(secret, body);
    assert.equal(verifyHmacSha256Hex(secret, body, sig), true);
  });

  test("tampered body fails", () => {
    const sig = signHmacSha256Hex(secret, body);
    assert.equal(verifyHmacSha256Hex(secret, Buffer.from('{"hello":"mars"}'), sig), false);
  });

  test("wrong secret fails", () => {
    const sig = signHmacSha256Hex(secret, body);
    assert.equal(verifyHmacSha256Hex("other-secret", body, sig), false);
  });

  test("sha256= prefix is accepted", () => {
    const sig = signHmacSha256Hex(secret, body);
    assert.equal(verifyHmacSha256Hex(secret, body, `sha256=${sig}`), true);
  });

  test("uppercase hex is accepted", () => {
    const sig = signHmacSha256Hex(secret, body).toUpperCase();
    assert.equal(verifyHmacSha256Hex(secret, body, sig), true);
  });

  test("missing / malformed signatures fail without throwing", () => {
    for (const bad of [undefined, null, "", "not-hex!!", "abcd", 12345]) {
      assert.equal(verifyHmacSha256Hex(secret, body, bad), false);
    }
  });

  test("signature is deterministic hex (64 chars)", () => {
    const sig = signHmacSha256Hex(secret, body);
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(sig, signHmacSha256Hex(secret, body));
  });
});
