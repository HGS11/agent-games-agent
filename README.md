# agent-games-haygs

zkVerify Agent Games agent for **Haygs**, tracks **Proof Gatekeeper** +
**Steal the VFY**. Scaffold state: decision logic, HMAC contract, health
endpoints, seen-set persistence, Steal turn handling, strategy module,
Kurier client, and a full test suite are implemented and passing. **Proof
generation is BLOCKED** on unknown circuit input signal names — see
`GAPS.md` #G1. No repo, deploy, registration, or dashboard access has
been done from this scaffold.

Spec source: `~/workspace/zkverify/agent-spec.md` (public pages read
14 Nov 2026). Circuit artifacts + manifest: `../circuits/`.

## Status

| Piece | State |
|---|---|
| Gatekeeper 7-check decision module | Done, tested (incl. spec sample → REJECT/VK_SUBSTITUTION) |
| HMAC verify (raw body) + response signing | Done, tested (incoming header name = unverified guess, G2) |
| Health endpoints `GET /`, `GET /healthz` | Done, tested (which path is checked: G3) |
| Proof-reuse seen-set (file-backed, atomic) | Done, tested |
| Steal turn handler (echo, amount omission, idempotency) | Done, tested (schema assumptions: G4) |
| Strategy module | Placeholder policy, **needs Hay's review** (G5, G9) |
| Kurier submit + poll-to-Finalized client | Done, tested against a mock server (needs Hay's API key, G10) |
| Groth16 proof generation / local verification | **BLOCKED** — input signal names unknown (G1) |
| On-chain proof confirmation (zkVerifyJS) | Not implemented (G8) |

## Quickstart

```sh
cd ~/workspace/zkverify/agent
npm install          # snarkjs is the only dependency
npm test             # 70 tests, all must pass
AGENT_GAMES_HMAC_SECRET='<from dashboard Rotate Secret>' \
SEEN_SET_PATH='./data/seen-proof-tx.json' \
PORT=8080 npm start
```

The server refuses to start without `AGENT_GAMES_HMAC_SECRET`. There is
no insecure/dev bypass.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `AGENT_GAMES_HMAC_SECRET` | Yes | Platform-generated HMAC secret (dashboard → Rotate Secret). Never a placeholder. |
| `AGENT_GAMES_HMAC_HEADER` | No | Incoming signature header name. Default `x-agent-games-signature` (UNVERIFIED GUESS, G2). |
| `PORT` | No | Default `8080`. |
| `SEEN_SET_PATH` | No | Seen proof_tx store. Default `./data/seen-proof-tx.json`. |
| `KURIER_API_KEY` | Only for Kurier path | Hay's key from https://kurier.xyz signup. Never stored in this repo. |
| `KURIER_BASE_URL` | No | Default `https://api.kurier.xyz/api/v1` (mainnet). |

## File map

```
src/
  server.mjs      stdlib HTTP server: health, signed POST routing, fail-closed
  gatekeeper.mjs  7-check decision module (pure, tested)
  seen-set.mjs    file-backed JSON seen-set, atomic writes
  hmac.mjs        HMAC-SHA256 verify/sign helpers
  steal.mjs       Steal turn handler + per-match tracker
  strategy.mjs    strategy policy (SEPARATE module; UNREVIEWED placeholder)
  prover.mjs      snarkjs wrapper + explicit BLOCKED guards (G1)
  kurier.mjs      Kurier REST client (register-vk, submit-proof, job-status)
test/             node:test suites, one per module + HTTP smoke tests
```

## Assumptions (labelled — verify in practice mode)

- Gatekeeper check precedence when several traps coincide: VK → REUSED →
  EXPIRED → THRESHOLD → RECIPIENT → AMOUNT (spec defines none; tasks are
  believed to carry one trap each).
- VK/address equality is case-insensitive after trim; boundary values are
  inclusive (`>=` minimum, `<=` cap, `current_block == expiry_block` ok).
- `INVALID_TASK` reason code is invented for fail-closed malformed-input
  REJECTs (G7).
- `proof_tx` is recorded as seen only on APPROVE ("already accepted").
- Steal response shape assumes `action: { type, amount? }` and top-level
  `idempotencyKey` (deterministic per match+turn: `haygs:<matchId>:<turn>`).
- Opponent's previous action is inferred from balance deltas (G4).
- HMAC signatures are lowercase hex, optional `sha256=` prefix (G2).
- Kurier submissions use the published vkHashes directly (no re-register),
  per the spec's "copy it when submitting proofs via Kurier".

## Gaps before competing

See `GAPS.md` — 14 numbered items (G1–G14), each with where it must come
from (dashboard page / practice mode). G1 (circuit input names) blocks
all proof generation; G10 (secrets) is Hay's step.

## Deployment

Not done. The agent needs a public HTTPS endpoint answering within 60s
(Gatekeeper) / the turn window (Steal). Hosting is undecided — no
deploy, repo, or registration was performed by this scaffold.
