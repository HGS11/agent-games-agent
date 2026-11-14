import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideGatekeeper, REASON } from "../src/gatekeeper.mjs";

// Exact sample payload from the public spec (/events/proof-gatekeeper).
// registered_vk != proof_vk, so the expected answer is REJECT / VK_SUBSTITUTION.
const SAMPLE = {
  type: "agent-games.proof-gatekeeper.v1",
  task_id: "gk_24_9d1",
  mode: "competition",
  issued_at: "<issued-at>",
  deadline_at: "<deadline-at>",
  input: {
    registered_vk: "0x7d3a...f291",
    proof_vk: "0xa4c1...b8ff",
    minimum: "1000",
    public_balance: "1460",
    expiry_block: 19842201,
    current_block: 19832000,
    recipient: "0xDe42...9f01",
    condition_recipient: "0xDe42...9f01",
    amount: "500",
    max_transfer: "1000",
    proof_tx: "0xa4c1...8ff1",
  },
};

const emptySeen = { has: () => false };

function withInput(overrides) {
  return { ...SAMPLE, input: { ...SAMPLE.input, ...overrides } };
}

// A fully valid task: proof_vk matches registered_vk, everything else as sampled.
const VALID = withInput({ proof_vk: "0x7d3a...f291" });

describe("gatekeeper — spec sample", () => {
  test("sample payload yields REJECT / VK_SUBSTITUTION", () => {
    const { response, consumeProof } = decideGatekeeper(SAMPLE, emptySeen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.VK_SUBSTITUTION);
    assert.equal(response.proof_tx, "0xa4c1...8ff1");
    assert.equal(consumeProof, false);
  });
});

describe("gatekeeper — all 7 trap types", () => {
  test("VALID_CONDITION approves and consumes the proof", () => {
    const { response, consumeProof } = decideGatekeeper(VALID, emptySeen);
    assert.equal(response.decision, "APPROVE");
    assert.equal(response.reason_code, REASON.VALID);
    assert.equal(consumeProof, true);
  });

  test("VK_SUBSTITUTION", () => {
    const { response } = decideGatekeeper(withInput({ proof_vk: "0xdeadbeef" }), emptySeen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.VK_SUBSTITUTION);
  });

  test("THRESHOLD_MISMATCH (public_balance below minimum)", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", public_balance: "999" }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.THRESHOLD_MISMATCH);
  });

  test("PROOF_REUSED (proof_tx already seen)", () => {
    const seen = { has: (ref) => ref === "0xa4c1...8ff1" };
    const { response, consumeProof } = decideGatekeeper(VALID, seen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.PROOF_REUSED);
    assert.equal(consumeProof, false);
  });

  test("EXPIRED_CONDITION (current_block past expiry_block)", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", current_block: 19842202 }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.EXPIRED_CONDITION);
  });

  test("RECIPIENT_MISMATCH", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", recipient: "0xBeef...0001" }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.RECIPIENT_MISMATCH);
  });

  test("AMOUNT_OVERFLOW (amount above max_transfer)", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", amount: "1001" }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.AMOUNT_OVERFLOW);
  });
});

describe("gatekeeper — boundaries (inclusive, assumption A3)", () => {
  test("public_balance == minimum approves", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", public_balance: "1000" }),
      emptySeen
    );
    assert.equal(response.decision, "APPROVE");
  });

  test("amount == max_transfer approves", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", amount: "1000" }),
      emptySeen
    );
    assert.equal(response.decision, "APPROVE");
  });

  test("current_block == expiry_block approves (not yet expired)", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", current_block: 19842201 }),
      emptySeen
    );
    assert.equal(response.decision, "APPROVE");
  });

  test("VK / address comparison is case-insensitive (assumption A2)", () => {
    const { response } = decideGatekeeper(
      withInput({
        proof_vk: "0X7D3A...F291",
        recipient: "0xde42...9f01",
      }),
      emptySeen
    );
    assert.equal(response.decision, "APPROVE");
  });

  test("big values compare as BigInt, not float", () => {
    const { response } = decideGatekeeper(
      withInput({
        proof_vk: "0x7d3a...f291",
        minimum: "9007199254740993",
        public_balance: "9007199254740992",
      }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.THRESHOLD_MISMATCH);
  });
});

describe("gatekeeper — fail closed on malformed input", () => {
  test("missing field -> REJECT / INVALID_TASK", () => {
    const task = withInput({});
    delete task.input.amount;
    const { response, consumeProof } = decideGatekeeper(task, emptySeen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.INVALID_TASK);
    assert.equal(consumeProof, false);
  });

  test("non-integer amount -> REJECT / INVALID_TASK", () => {
    const { response } = decideGatekeeper(
      withInput({ proof_vk: "0x7d3a...f291", amount: "five hundred" }),
      emptySeen
    );
    assert.equal(response.reason_code, REASON.INVALID_TASK);
  });

  test("missing input object -> REJECT / INVALID_TASK", () => {
    const { response } = decideGatekeeper({ type: "x" }, emptySeen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.INVALID_TASK);
    assert.equal(response.proof_tx, null);
  });

  test("null task -> REJECT / INVALID_TASK", () => {
    const { response } = decideGatekeeper(null, emptySeen);
    assert.equal(response.decision, "REJECT");
    assert.equal(response.reason_code, REASON.INVALID_TASK);
  });
});
