// Groth16 proof generation / verification wrapper (snarkjs).
//
// *** PROOF GENERATION IS BLOCKED ***
// The circuit input signal names are NOT recoverable from the downloaded
// artifacts: Circom 2.2.3 witness-calculator wasm files resolve inputs by
// HASH (getInputSignalMapPosition / setInputSignal), and neither the wasm
// (strings dump + name section) nor the .zkey contains signal names.
//   - gatekeeper.wasm: 13 input signals, 647 witness size (probed live);
//     verification key: groth16/bn128, 13 public signals (all inputs public)
//   - vfy-policy.wasm: 17 input signals, 1909 witness size (probed live);
//     verification key: groth16/bn128, 9 public signals (8 private inputs)
// The input names + value formats must come from the dashboard, practice
// mode, or the event's circuit sources (GAPS.md #G1). Do NOT invent them:
// a proof built on guessed inputs will not verify against the platform's
// registered key.
//
// What this module DOES provide (usable once #G1 is resolved):
//   - generateProof({ wasmPath, zkeyPath, input }) — thin snarkjs wrapper;
//     `input` must be keyed by the circuit's real signal names.
//   - verifyProofLocal({ vk, proof, publicSignals }) — snarkjs verify.
//   - proveGatekeeper()/provePolicy() — explicit guards that throw a
//     descriptive error naming the gap instead of silently producing
//     nothing. Wire real input builders here once #G1 is resolved.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const snarkjs = require("snarkjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CIRCUITS_DIR = path.resolve(HERE, "..", "..", "circuits");

// vkHash values registered on zkVerify mainnet (from /api/circuit-info,
// recorded in ~/workspace/zkverify/agent-spec.md). Copy when submitting
// proofs via Kurier — no re-registration needed per the spec.
export const VK_HASHES = Object.freeze({
  gatekeeper: "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
  vfyPolicy: "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047",
});

export const CIRCUIT_FILES = Object.freeze({
  gatekeeper: {
    wasm: path.join(CIRCUITS_DIR, "gatekeeper.wasm"),
    zkey: path.join(CIRCUITS_DIR, "gatekeeper_final.zkey"),
    vk: path.join(CIRCUITS_DIR, "gatekeeper_vk.json"),
    vkHash: VK_HASHES.gatekeeper,
    inputSignalCount: 13,
  },
  vfyPolicy: {
    wasm: path.join(CIRCUITS_DIR, "vfy-policy.wasm"),
    zkey: path.join(CIRCUITS_DIR, "vfy-policy_final.zkey"),
    vk: path.join(CIRCUITS_DIR, "vfy-policy_vk.json"),
    vkHash: VK_HASHES.vfyPolicy,
    inputSignalCount: 17,
  },
});

export const PROOF_INPUTS_GAP =
  "BLOCKED (GAPS.md #G1): circuit input signal names are not in the " +
  "downloaded artifacts (Circom 2.2.3 wasm resolves inputs by hash; no " +
  "names in wasm strings, name section, or zkey). Input names + value " +
  "formats must come from the dashboard, practice mode, or circuit sources. " +
  "Do not guess them.";

/** Thin wrapper over snarkjs groth16.fullProve. Caller supplies `input` keyed by real signal names. */
export async function generateProof({ wasmPath, zkeyPath, input }) {
  if (!wasmPath || !zkeyPath || !input || typeof input !== "object") {
    throw new Error("generateProof requires wasmPath, zkeyPath and an input object");
  }
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  return { proof, publicSignals };
}

/** Local verification against a verification-key object (snarkjs JSON format). */
export async function verifyProofLocal({ vk, proof, publicSignals }) {
  if (!vk || !proof || !publicSignals) {
    throw new Error("verifyProofLocal requires vk, proof and publicSignals");
  }
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

/** Gatekeeper proof builder — BLOCKED until #G1 is resolved. */
export async function proveGatekeeper(/* task, decision */) {
  throw new Error(PROOF_INPUTS_GAP);
}

/** Steal policy-proof builder — BLOCKED until #G1 is resolved. */
export async function provePolicy(/* action, state */) {
  throw new Error(PROOF_INPUTS_GAP);
}
