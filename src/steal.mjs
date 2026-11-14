// Steal the VFY — turn handler.
//
// Per the public spec, a turn response must:
//   - echo matchId and turn exactly as received (a stale echo is an error),
//   - declare the action,
//   - attach the policy proof (circuitVersion + Groth16 proof +
//     public_signals); proofReference and publicInputsHash are optional
//     on-chain audit pointers,
//   - omit action.amount ENTIRELY for HOLD and FORTIFY (the schema rejects
//     the field even when it is 0),
//   - use a fresh idempotencyKey per turn (reuse across turns: only the
//     first submission per key is accepted).
//
// ASSUMPTIONS / GAPS (see GAPS.md):
//   A1. Response field names/casing beyond matchId/turn/circuitVersion/
//       public_signals are NOT in the public pages. This handler assumes
//       `action: { type, amount? }` and a top-level `idempotencyKey`.
//       Confirm the exact schema from the dashboard/practice mode (#G4).
//   A2. The turn envelope's game-state field names are unknown, so state
//       extraction is an injected plug point (`getState`). The DEFAULT
//       extractor returns null (unknown mapping) and the strategy then
//       fails closed to HOLD. The server is therefore safe but passive
//       for Steal until the mapping is configured from dashboard data.
//   A3. idempotencyKey is deterministic per (matchId, turn):
//       `haygs:<matchId>:<turn>`. Unique per turn (spec requirement) and
//       stable if the platform re-pushes the same turn (retry-safe).
//   A4. The opponent's previous action is INFERRED from balance deltas
//       tracked per match (myBalance fell => opponent EXTRACTed). If the
//       envelope carries the previous actions directly, use that instead.
//   A5. Policy proofs are NOT attached: proof generation is blocked on
//       unknown circuit input signal names (GAPS.md #G1). Turns submitted
//       without a valid proof lose the reliability bonus and a missing/
//       invalid proof costs -2/turn for Steal. The `prove` hook is where
//       proof generation plugs in once unblocked.

import { chooseAction } from "./strategy.mjs";

/** Per-match memory: last seen turn + balances, for delta inference. */
export class MatchTracker {
  constructor() {
    this.matches = new Map(); // matchId -> { turn, myBalance, oppBalance }
  }

  previous(matchId) {
    return this.matches.get(matchId) || null;
  }

  record(matchId, turn, state) {
    this.matches.set(matchId, {
      turn,
      myBalance: state.myBalance,
      oppBalance: state.oppBalance,
    });
  }
}

/** Default state extractor: unknown envelope mapping -> null (fail closed). */
export function defaultGetState(/* envelope */) {
  return null;
}

function inferOppLastAction(prev, state) {
  if (!prev || state.myBalance === null || prev.myBalance === null) return null;
  // My balance fell since last turn: the opponent extracted against me.
  // (FORTIFY costs fall on the fortifier; HOLD moves nothing.)
  if (state.myBalance < prev.myBalance) return "EXTRACT";
  return null;
}

/**
 * Handle one Steal turn envelope.
 * @param {object} envelope - parsed turn envelope from the platform.
 * @param {object} opts
 * @param {MatchTracker} [opts.tracker]
 * @param {(envelope:object)=>object|null} [opts.getState] - state extractor.
 * @param {(state:object)=>{action:string,amount:number|null}} [opts.choose]
 * @param {string|null} [opts.circuitVersion] - from the strategy commitment.
 * @param {(action:object,state:object)=>Promise<{proof:object,public_signals:string[]}|null>} [opts.prove]
 * @returns {Promise<object>} response object (proof attached only if prove succeeds).
 */
export async function handleStealTurn(envelope, opts = {}) {
  const tracker = opts.tracker || new MatchTracker();
  const getState = opts.getState || defaultGetState;
  const choose = opts.choose || chooseAction;

  const matchId =
    envelope && typeof envelope.matchId === "string" ? envelope.matchId : null;
  const turn =
    envelope && Number.isInteger(envelope.turn) ? envelope.turn : null;

  // Malformed envelope: fail closed. A response with a missing/mismatched
  // required field is treated by the platform as HOLD with no proof, so
  // answer HOLD explicitly rather than crashing or echoing garbage.
  const holdResponse = (mid, t) => ({
    matchId: mid,
    turn: t,
    action: { type: "HOLD" },
    idempotencyKey: `haygs:${mid}:${t}`,
  });
  if (matchId === null || turn === null) {
    return { ...holdResponse(matchId, turn), _malformed: true };
  }

  let state = null;
  try {
    state = getState(envelope);
  } catch {
    state = null;
  }

  let normalized;
  if (state && typeof state === "object") {
    const prev = tracker.previous(matchId);
    normalized = {
      turn,
      turnsTotal: Number.isInteger(state.turnsTotal) ? state.turnsTotal : 20,
      myBalance: typeof state.myBalance === "number" ? state.myBalance : null,
      oppBalance: typeof state.oppBalance === "number" ? state.oppBalance : null,
      oppLastAction: inferOppLastAction(prev, {
        myBalance: typeof state.myBalance === "number" ? state.myBalance : null,
      }),
    };
    tracker.record(matchId, turn, normalized);
  } else {
    // Unknown state mapping: strategy receives an invalid state and fails
    // closed to HOLD (see strategy.mjs).
    normalized = {
      turn,
      turnsTotal: 20,
      myBalance: null,
      oppBalance: null,
      oppLastAction: null,
    };
  }

  const decision = choose(normalized);

  const action =
    decision.action === "EXTRACT"
      ? { type: "EXTRACT", amount: decision.amount }
      : { type: decision.action }; // amount omitted ENTIRELY for HOLD/FORTIFY

  const response = {
    matchId,
    turn,
    action,
    idempotencyKey: `haygs:${matchId}:${turn}`,
  };

  // Policy proof: attached only when a prover is configured AND it
  // succeeds. A failed proof must never block the action response (a
  // timeout costs -1/turn; the turn still runs).
  if (typeof opts.prove === "function" && opts.circuitVersion) {
    try {
      const proofOut = await opts.prove({ action: decision, state: normalized, envelope });
      if (proofOut && proofOut.proof && proofOut.public_signals) {
        response.proof = {
          circuitVersion: opts.circuitVersion,
          proof: proofOut.proof,
          public_signals: proofOut.public_signals,
        };
      }
    } catch {
      // No proof attached; action response still goes out.
    }
  }

  return response;
}
