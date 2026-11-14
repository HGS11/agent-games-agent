import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CIRCUIT_FILES,
  PROOF_INPUTS_GAP,
  VK_HASHES,
  generateProof,
  proveGatekeeper,
  provePolicy,
} from "../src/prover.mjs";

describe("prover — blocked guards (GAPS.md #G1)", () => {
  test("proveGatekeeper throws naming the missing input names", async () => {
    await assert.rejects(() => proveGatekeeper(), /GAPS\.md #G1/);
    assert.match(PROOF_INPUTS_GAP, /input signal names/);
  });

  test("provePolicy throws naming the missing input names", async () => {
    await assert.rejects(() => provePolicy(), /GAPS\.md #G1/);
  });

  test("generateProof validates its arguments", async () => {
    await assert.rejects(() => generateProof({}), /requires wasmPath/);
  });
});

describe("prover — artifact wiring", () => {
  test("downloaded wasm/zkey files exist at the wired paths", () => {
    for (const c of Object.values(CIRCUIT_FILES)) {
      assert.equal(existsSync(c.wasm), true, `missing ${c.wasm}`);
      assert.equal(existsSync(c.zkey), true, `missing ${c.zkey}`);
    }
  });

  test("vkHashes match the spec values from /api/circuit-info", () => {
    assert.equal(
      VK_HASHES.gatekeeper,
      "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0"
    );
    assert.equal(
      VK_HASHES.vfyPolicy,
      "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047"
    );
  });

  test("probed input signal counts are recorded", () => {
    assert.equal(CIRCUIT_FILES.gatekeeper.inputSignalCount, 13);
    assert.equal(CIRCUIT_FILES.vfyPolicy.inputSignalCount, 17);
  });
});
