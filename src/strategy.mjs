// Steal the VFY — STRATEGY MODULE (kept separate from the turn handler).
//
// *** NEEDS HAY'S REVIEW BEFORE ANY STRATEGY COMMITMENT ***
// The strategy commitment is FROZEN per match (spec: "commitment frozen
// mid-match"; redeployment only between rounds). A committed strategy
// cannot be changed mid-match, and the per-turn policy proof must match
// the committed strategy (a circuitVersion mismatch rejects the turn).
// Do NOT present this default as optimal. It is a simple, explicit,
// deterministic placeholder policy written so its reasoning can be read,
// argued with, and replaced.
//
// The spec's own warning (from /build): "for Steal the VFY the prompt
// deliberately leaves your strategy as your own TODO — don't let the
// model fill it in. A vibecoded harness is fine; a vibecoded strategy
// isn't a strategy." This module is that TODO, filled with the simplest
// defensible policy — Hay decides the real one.
//
// Determinism requirement: the policy MUST be a pure function of the
// normalized game state. The same state must always yield the same action,
// because the policy proof ties each action to the committed strategy.
//
// Normalized state (built by the turn handler from the turn envelope;
// the envelope field mapping is a dashboard-only gap, GAPS.md #G4):
//   {
//     turn: number,            // 1-based turn within the match
//     turnsTotal: number,      // 20 per spec
//     myBalance: number|null,  // null when unknown -> fail closed to HOLD
//     oppBalance: number|null,
//     oppLastAction: 'EXTRACT'|'FORTIFY'|'HOLD'|null, // inferred by handler
//   }
//
// Rationale for each branch is written inline. Amounts: EXTRACT is
// "bounded" per the spec but the cap is NOT in the public pages —
// EXTRACT_AMOUNT_PLACEHOLDER is a placeholder that MUST be replaced with
// the real cap/rules from the dashboard or practice mode before competing
// (GAPS.md #G5).

export const STRATEGY_REVIEW_REQUIRED = true;
export const STRATEGY_NAME = "haygs-default-v0-UNREVIEWED";
export const STRATEGY_VERSION = "0";

// PLACEHOLDER — the real EXTRACT bound/cap is unknown (GAPS.md #G5).
// Do not compete with this value unreviewed.
export const EXTRACT_AMOUNT_PLACEHOLDER = 10;

const HOLD = { action: "HOLD", amount: null };
const FORTIFY = { action: "FORTIFY", amount: null };
const extract = (amount) => ({ action: "EXTRACT", amount });

/**
 * Choose an action for one turn. Pure and deterministic.
 * @param {object} state - normalized game state (see header).
 * @returns {{action:'HOLD'|'FORTIFY'|'EXTRACT', amount:number|null}}
 */
export function chooseAction(state) {
  // Fail closed on any malformed/unknown state: HOLD costs nothing and
  // moves nothing, while a wrong EXTRACT/FORTIFY spends or exposes.
  if (
    !state ||
    typeof state !== "object" ||
    !Number.isInteger(state.turn) ||
    state.turn < 1 ||
    !Number.isInteger(state.turnsTotal) ||
    state.turnsTotal < 1 ||
    state.turn > state.turnsTotal ||
    typeof state.myBalance !== "number" ||
    typeof state.oppBalance !== "number" ||
    !Number.isFinite(state.myBalance) ||
    !Number.isFinite(state.oppBalance)
  ) {
    return { ...HOLD };
  }

  const turnsLeft = state.turnsTotal - state.turn;

  // Turn 1: no signal exists (simultaneous submission — nothing has been
  // observed yet). HOLD conserves; FORTIFY would pay a cost blind and
  // EXTRACT would strike blind.
  if (state.turn === 1) {
    return { ...HOLD };
  }

  // Opponent extracted last turn: defend. FORTIFY has a small fixed cost
  // and reduces/blocks extraction; eating a second extraction unprotected
  // is the worst outcome.
  if (state.oppLastAction === "EXTRACT") {
    return { ...FORTIFY };
  }

  // Behind with few turns left: must attack — HOLD cannot close a gap and
  // FORTIFY only spends. EXTRACT is free.
  if (state.myBalance < state.oppBalance && turnsLeft <= 4) {
    return extract(EXTRACT_AMOUNT_PLACEHOLDER);
  }

  // Ahead late: protect the lead. Extraction gains little when the
  // opponent is already behind, and FORTIFY costs; HOLD preserves.
  if (state.myBalance > state.oppBalance && turnsLeft <= 2) {
    return { ...HOLD };
  }

  // Default: apply pressure. EXTRACT is free and takes from the
  // opponent's exposed balance; doing nothing every turn concedes the
  // initiative to any opponent that extracts.
  return extract(EXTRACT_AMOUNT_PLACEHOLDER);
}
