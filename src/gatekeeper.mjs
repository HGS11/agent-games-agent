// Proof Gatekeeper decision module.
//
// Implements the 7 checks from the public spec
// (~/workspace/zkverify/agent-spec.md) exactly as documented:
//   VALID_CONDITION (~50%) -> APPROVE
//   VK_SUBSTITUTION, THRESHOLD_MISMATCH, PROOF_REUSED, EXPIRED_CONDITION,
//   RECIPIENT_MISMATCH, AMOUNT_OVERFLOW -> REJECT with that reason_code.
//
// Fail closed: any missing/malformed field or uncertainty => REJECT.
//
// ASSUMPTIONS (labelled; see GAPS.md):
//   A1. Check precedence when several traps coincide is NOT specified.
//       Order used here: VK -> REUSED -> EXPIRED -> THRESHOLD -> RECIPIENT
//       -> AMOUNT. Tasks are believed to carry exactly one trap each, so
//       precedence should not matter; verify in practice mode.
//   A2. VK / address equality is case-insensitive hex equality after trim.
//   A3. Boundary values are inclusive: public_balance == minimum approves,
//       amount == max_transfer approves, current_block == expiry_block
//       approves (expiry means current_block > expiry_block).
//   A4. reason_code "INVALID_TASK" is NOT a spec code. It is used only for
//       malformed envelopes (fail-closed REJECT). The platform's handling
//       of unknown reason codes is a dashboard-only gap (GAPS.md #G7).
//   A5. The proof_tx is recorded as seen ONLY when the decision is APPROVE
//       (the spec's PROOF_REUSED wording: "already accepted in a previous
//       task"). Rejected proofs are not consumed.
//   A6. On-chain confirmation of the proof via zkVerifyJS (build checklist
//       item 02) is NOT implemented: the envelope fields are taken as the
//       platform's statement. Whether independent on-chain lookup is
//       required is a dashboard-only gap (GAPS.md #G8).

export const REASON = Object.freeze({
  VALID: "VALID_CONDITION",
  VK_SUBSTITUTION: "VK_SUBSTITUTION",
  THRESHOLD_MISMATCH: "THRESHOLD_MISMATCH",
  PROOF_REUSED: "PROOF_REUSED",
  EXPIRED_CONDITION: "EXPIRED_CONDITION",
  RECIPIENT_MISMATCH: "RECIPIENT_MISMATCH",
  AMOUNT_OVERFLOW: "AMOUNT_OVERFLOW",
  INVALID_TASK: "INVALID_TASK", // non-spec, see A4
});

const REQUIRED_FIELDS = [
  "registered_vk",
  "proof_vk",
  "minimum",
  "public_balance",
  "expiry_block",
  "current_block",
  "recipient",
  "condition_recipient",
  "amount",
  "max_transfer",
  "proof_tx",
];

function asBigInt(value, field) {
  // Accept decimal integer strings (spec sample) or safe integers.
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`field ${field} is not a decimal integer: ${JSON.stringify(value)}`);
}

function asBlock(value, field) {
  const n = asBigInt(value, field);
  if (n < 0n) throw new Error(`field ${field} is negative`);
  return n;
}

function asNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`field ${field} is not a non-empty string`);
  }
  return value.trim();
}

function sameHex(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Decide a Proof Gatekeeper task.
 * @param {object} task - parsed task envelope; task.input holds the fields.
 * @param {{has(ref:string):boolean}} seenSet - proof_tx reuse store.
 * @returns {{response:{decision:string,reason_code:string,proof_tx:string|null},
 *            consumeProof:boolean, detail:object}}
 *   consumeProof=true only for APPROVE: caller must then persist proof_tx.
 */
export function decideGatekeeper(task, seenSet) {
  const echoProofTx =
    task && typeof task === "object" && task.input && typeof task.input.proof_tx === "string"
      ? task.input.proof_tx
      : null;

  const invalid = (error) => ({
    response: { decision: "REJECT", reason_code: REASON.INVALID_TASK, proof_tx: echoProofTx },
    consumeProof: false,
    detail: { error: String(error && error.message ? error.message : error) },
  });

  try {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error("task envelope is not an object");
    }
    const input = task.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("task.input is missing or not an object");
    }
    for (const f of REQUIRED_FIELDS) {
      if (!(f in input) || input[f] === undefined || input[f] === null) {
        throw new Error(`missing required field: ${f}`);
      }
    }

    const registeredVk = asNonEmptyString(input.registered_vk, "registered_vk");
    const proofVk = asNonEmptyString(input.proof_vk, "proof_vk");
    const minimum = asBigInt(input.minimum, "minimum");
    const publicBalance = asBigInt(input.public_balance, "public_balance");
    const expiryBlock = asBlock(input.expiry_block, "expiry_block");
    const currentBlock = asBlock(input.current_block, "current_block");
    const recipient = asNonEmptyString(input.recipient, "recipient");
    const conditionRecipient = asNonEmptyString(input.condition_recipient, "condition_recipient");
    const amount = asBigInt(input.amount, "amount");
    const maxTransfer = asBigInt(input.max_transfer, "max_transfer");
    const proofTx = asNonEmptyString(input.proof_tx, "proof_tx");

    const reject = (reason_code, failedCheck) => ({
      response: { decision: "REJECT", reason_code, proof_tx: proofTx },
      consumeProof: false,
      detail: { failedCheck },
    });

    // 1. Verification key must match the registered condition VK.
    if (!sameHex(proofVk, registeredVk)) {
      return reject(REASON.VK_SUBSTITUTION, "proof_vk != registered_vk");
    }
    // 2. Proof reference must not have been accepted in a previous task.
    if (seenSet.has(proofTx)) {
      return reject(REASON.PROOF_REUSED, "proof_tx already seen");
    }
    // 3. Condition must not be expired.
    if (currentBlock > expiryBlock) {
      return reject(REASON.EXPIRED_CONDITION, "current_block > expiry_block");
    }
    // 4. Public balance must meet the minimum threshold.
    if (publicBalance < minimum) {
      return reject(REASON.THRESHOLD_MISMATCH, "public_balance < minimum");
    }
    // 5. Recipient committed in the proof must match the payment condition.
    if (!sameHex(recipient, conditionRecipient)) {
      return reject(REASON.RECIPIENT_MISMATCH, "recipient != condition_recipient");
    }
    // 6. Amount must not exceed the single-transfer cap.
    if (amount > maxTransfer) {
      return reject(REASON.AMOUNT_OVERFLOW, "amount > max_transfer");
    }

    return {
      response: { decision: "APPROVE", reason_code: REASON.VALID, proof_tx: proofTx },
      consumeProof: true,
      detail: { failedCheck: null },
    };
  } catch (error) {
    return invalid(error);
  }
}
