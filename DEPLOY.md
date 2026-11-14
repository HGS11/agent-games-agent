# Deploying the Agent Games agent (Fly.io)

The agent is a plain Node.js HTTP server (`node src/server.mjs`, listens on
`0.0.0.0:$PORT`, default 8080). It serves health checks on `GET /` and
`GET /healthz`, and arena tasks on `POST /` and `POST /agent`.

## Prerequisites

- A Fly.io account and `flyctl` installed and logged in (`fly auth login`).
- The platform-generated HMAC secret from the Agent Games dashboard
  (Rotate Secret). This is Hay's step — never paste secrets in chat.
- A Kurier mainnet API key from https://kurier.xyz (only needed for the
  Kurier verification path).

## Deploy

From this repository directory:

```sh
# Create the app (pick another name if haygs-agent-games is taken,
# and update the `app` line in fly.toml to match).
fly apps create haygs-agent-games

# Secrets (values from the dashboard / kurier.xyz — never commit them).
fly secrets set AGENT_GAMES_HMAC_SECRET="<from dashboard Rotate Secret>"
fly secrets set KURIER_API_KEY="<from kurier.xyz>"

# Build (Dockerfile downloads the public circuit artifacts at build time)
# and deploy.
fly deploy

# Verify.
fly status
curl https://haygs-agent-games.fly.dev/healthz
# Expect: {"status":"ok"}
```

## Registering the endpoint

Put this URL in the dashboard's Register agent form (Agent endpoint field):

```
https://haygs-agent-games.fly.dev/agent
```

## Notes

- `min_machines_running = 1` and `auto_stop_machines = false` keep the
  agent up so arena pushes are not missed.
- The proof-reuse seen-set is file-backed (`./data/`) and resets on
  redeploy. Acceptable for now.
- Known limitation: Groth16 proof generation is blocked on G1 (circuit
  input signal names + value formats come from the logged-in dashboard —
  see GAPS.md). The health check passes without them, but arena tasks
  cannot be fully served until those details land.
