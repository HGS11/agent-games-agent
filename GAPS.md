# Dashboard-only details still needed before this agent can compete

Everything below is NOT in the public pages and was NOT guessed. Each item
names exactly where it must come from. Until an item is resolved, the
scaffold either fails closed or carries the flagged default stated here.

## G1 — Circuit input signal names + value formats [BLOCKS ALL PROOFS]

- Gatekeeper circuit: 13 input signals (all public). VFY policy circuit:
  17 input signals (9 public, 8 private). Names and formats unknown.
- Recovery from the artifacts was attempted and is impossible (see
  `../circuits/MANIFEST.md`: Circom 2.2.3 wasm resolves inputs by hash).
- Where from: the logged-in dashboard (circuit docs/downloads), practice
  mode sample inputs, or the event's published circuit sources.
- Impact until resolved: no Groth16 proof can be generated or verified
  locally; Gatekeeper provable tasks incur the −2 missing-proof penalty
  and no reliability bonus; Steal turns carry no policy proof (−2/turn
  for invalid/missing proof, no reliability bonus).

## G2 — Incoming HMAC signature header name

- The public pages name only the RESPONSE header
  (`x-agent-games-signature`). The request header carrying the platform's
  signature is unknown. Server default is the same name — UNVERIFIED
  GUESS, overridable via `AGENT_GAMES_HMAC_HEADER`.
- Where from: dashboard agent settings / preflight documentation, or the
  headers of a practice task.
- Also confirm: signature encoding (assumed lowercase hex, optional
  `sha256=` prefix; base64 would need a code change in `src/hmac.mjs`).

## G3 — Health-check path and method

- The server answers `200 {"status":"ok"}` on both `GET /` and
  `GET /healthz`. Which path (if either) the platform checks, and whether
  it expects a specific body, is unknown.
- Where from: dashboard endpoint registration / preflight.

## G4 — Steal turn envelope + response schema (exact field names)

- Unknown: turn-envelope field names for game state (balances, frozen
  commitment hash, deadline, previous actions), the exact response
  schema (action object shape, `idempotencyKey` placement, proof object
  shape, `circuitVersion` format), and the state-field mapping the
  strategy needs. Current code assumes `action: { type, amount? }` and a
  top-level `idempotencyKey`, and fails closed to HOLD when no state
  extractor is configured.
- Where from: dashboard practice turn / preflight sample payloads.

## G5 — Steal game numeric rules

- Unknown: EXTRACT amount bound/cap, FORTIFY fixed cost, exposed-balance
  computation, and how balance deltas map to opponent actions.
- The strategy's `EXTRACT_AMOUNT_PLACEHOLDER = 10` is a placeholder that
  MUST be replaced before competing.
- Where from: dashboard rules detail / practice mode.

## G6 — `publicInputsHash` computation (Steal)

- Unknown: field order and hash function. The platform computes this hash
  independently and rejects proofs where it diverges. Currently omitted.
- Where from: dashboard / practice mode (must match the platform exactly).

## G7 — Gatekeeper reason code for malformed/uncertain tasks

- `INVALID_TASK` is an invented code used only for fail-closed REJECTs on
  malformed envelopes. Whether the platform accepts unknown reason codes,
  and what it expects for unparseable tasks, is unknown.
- Where from: practice mode.

## G8 — Independent on-chain proof confirmation (Gatekeeper)

- Build checklist item 02 says to call zkVerifyJS to confirm the proof is
  on-chain and its VK matches. The scaffold decides from envelope fields
  only. Whether independent lookup is required, and how to look a proof
  up by `proof_tx`, is unknown.
- Where from: dashboard / practice mode.

## G9 — Strategy-commitment format and submission

- Unknown: commitment payload format, where/how to submit it,
  `circuitVersion` values, and freeze/redeploy mechanics. No commitment
  may be submitted before Swiss Round 1 without this — and the strategy
  itself needs Hay's review first (see `src/strategy.mjs`).
- Where from: dashboard (agent registration / Steal setup).

## G10 — Secrets (Hay's steps — never invent, request, or store)

- Agent Games HMAC secret: dashboard → Rotate Secret. Shown once; the
  deployment needs it as `AGENT_GAMES_HMAC_SECRET`.
- Kurier mainnet API key: sign up at https://kurier.xyz; deployment needs
  it as `KURIER_API_KEY`. Needed only for the Kurier verification path.
- Where from: the dashboard and kurier.xyz respectively, entered by Hay
  into the deployment environment.

## G11 — Signed preflight + practice-task flow

- Unknown: preflight steps, what "signed" requires, and the completion
  criteria for the mandatory practice task / practice turn.
- Where from: the logged-in dashboard (entry requirements list preflight
  + practice as mandatory before competing).

## G12 — Endpoint URL handling

- Registration takes a full endpoint URL (example `my-agent.fly.dev/agent`).
  The server accepts POST on `/` and `/agent`. Confirm the platform POSTs
  to the registered URL verbatim and whether it appends any path.
- Where from: dashboard endpoint registration.

## G13 — Gatekeeper proof-attachment format

- For provable tasks the response must carry Groth16 proof evidence, but
  the field names/shape for attaching `proof` + `public_signals` to the
  decision response are not in the public pages.
- Where from: dashboard / practice mode (after G1 is resolved).

## G14 — Timestamp / nonce freshness rules

- The spec's security list requires valid task signature and timestamp,
  but the staleness window / replay rules are not stated. The scaffold
  does not enforce any freshness window.
- Where from: dashboard / preflight documentation.
