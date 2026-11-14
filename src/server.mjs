// Agent Games agent server — Node stdlib HTTP only (+ snarkjs for proofs).
//
// Environment:
//   AGENT_GAMES_HMAC_SECRET  (required) platform-generated HMAC secret from
//                            the dashboard (Rotate Secret). Never a local
//                            placeholder. Server refuses to start without it.
//   AGENT_GAMES_HMAC_HEADER  incoming signature header name.
//                            DEFAULT: "x-agent-games-signature" — UNVERIFIED
//                            GUESS (the public pages name only the RESPONSE
//                            header). Confirm from dashboard/preflight.
//   PORT                     default 8080.
//   SEEN_SET_PATH            default ./data/seen-proof-tx.json (relative to
//                            the working directory).
//   KURIER_API_KEY           only needed for the Kurier path (Hay's step).
//
// Routes:
//   GET  / and GET /healthz  -> 200 {"status":"ok"} (which path the platform
//                            health-checks is UNKNOWN — both are served;
//                            see GAPS.md #G3).
//   POST / and POST /agent   -> signed task endpoint. HMAC is verified over
//                            the RAW body before parsing. Responses are
//                            signed with x-agent-games-signature over the
//                            raw response body.
//   Anything else           -> 404.
//
// Routing of POST bodies (assumption — envelope `type` for Gatekeeper is
// from the spec; Steal routing by matchId+turn shape, GAPS.md #G4):
//   body.type === "agent-games.proof-gatekeeper.v1" -> Gatekeeper decision.
//   body has string matchId + integer turn               -> Steal turn.
//   otherwise                                            -> 400.
//
// Proof behaviour (honest limitation): Groth16 proofs are NOT attached to
// responses — proof generation is blocked on unknown circuit input signal
// names (GAPS.md #G1). Gatekeeper answers therefore carry decision +
// reason_code + proof_tx only, and will miss the reliability bonus / incur
// the -2 missing-proof penalty on provable tasks until #G1 is resolved.
// Steal turns likewise carry no policy proof until #G1 is resolved.

import http from "node:http";

import { decideGatekeeper } from "./gatekeeper.mjs";
import { SeenSet } from "./seen-set.mjs";
import {
  RESPONSE_SIGNATURE_HEADER,
  signHmacSha256Hex,
  verifyHmacSha256Hex,
} from "./hmac.mjs";
import { MatchTracker, defaultGetState, handleStealTurn } from "./steal.mjs";
import { chooseAction } from "./strategy.mjs";

export const GATEKEEPER_TYPE = "agent-games.proof-gatekeeper.v1";
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, obj, { signWith = null } = {}) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const headers = { "content-type": "application/json", "content-length": body.length };
  if (signWith) {
    headers[RESPONSE_SIGNATURE_HEADER] = signHmacSha256Hex(signWith, body);
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Build the HTTP server. Does not listen; caller controls startup.
 * @param {object} config
 * @param {string} config.hmacSecret - required.
 * @param {string} [config.hmacHeader] - default x-agent-games-signature (UNVERIFIED GUESS).
 * @param {SeenSet} config.seenSet - loaded before serving.
 * @param {object} [config.steal] - { getState, choose, tracker, circuitVersion, prove }.
 */
export function createServer(config) {
  if (!config || !config.hmacSecret) {
    throw new Error(
      "AGENT_GAMES_HMAC_SECRET is required: the platform-generated HMAC secret " +
        "from the dashboard (Rotate Secret). Refusing to serve unsigned."
    );
  }
  if (!config.seenSet) throw new Error("createServer requires a loaded SeenSet");
  const hmacHeader = (config.hmacHeader || RESPONSE_SIGNATURE_HEADER).toLowerCase();
  const stealOpts = {
    tracker: new MatchTracker(),
    getState: defaultGetState,
    choose: chooseAction,
    ...(config.steal || {}),
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "GET" && (path === "/" || path === "/healthz")) {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && (path === "/" || path === "/agent")) {
        const rawBody = await readRawBody(req);
        const signature = req.headers[hmacHeader];
        if (!verifyHmacSha256Hex(config.hmacSecret, rawBody, signature)) {
          sendJson(res, 401, { error: "invalid signature" });
          return;
        }

        let body;
        try {
          body = JSON.parse(rawBody.toString("utf8"));
        } catch {
          sendJson(res, 400, { error: "invalid JSON" }, { signWith: config.hmacSecret });
          return;
        }

        if (body && body.type === GATEKEEPER_TYPE) {
          const { response, consumeProof, detail } = decideGatekeeper(body, config.seenSet);
          if (consumeProof) {
            try {
              await config.seenSet.addAndSave(response.proof_tx);
            } catch (error) {
              // Fail closed: an APPROVE we cannot record would let the
              // same proof be accepted again later. Downgrade to REJECT.
              console.error("seen-set persist failed; failing closed:", error.message);
              sendJson(
                res,
                200,
                { decision: "REJECT", reason_code: "INVALID_TASK", proof_tx: response.proof_tx },
                { signWith: config.hmacSecret }
              );
              return;
            }
          }
          void detail;
          sendJson(res, 200, response, { signWith: config.hmacSecret });
          return;
        }

        if (body && typeof body.matchId === "string" && Number.isInteger(body.turn)) {
          const response = await handleStealTurn(body, stealOpts);
          delete response._malformed;
          sendJson(res, 200, response, { signWith: config.hmacSecret });
          return;
        }

        sendJson(res, 400, { error: "unknown task envelope" }, { signWith: config.hmacSecret });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      console.error("request error:", error);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    }
  });

  return server;
}

/** Start the server from environment variables. Returns { server, port }. */
export async function startServer(env = process.env) {
  const hmacSecret = env.AGENT_GAMES_HMAC_SECRET;
  if (!hmacSecret) {
    throw new Error(
      "AGENT_GAMES_HMAC_SECRET is not set. Get the platform-generated secret " +
        "from the Agent Games dashboard (Rotate Secret) and set it in the " +
        "deployment environment. Never use a local placeholder."
    );
  }
  const seenSet = new SeenSet(env.SEEN_SET_PATH || "./data/seen-proof-tx.json");
  await seenSet.load();
  const server = createServer({
    hmacSecret,
    hmacHeader: env.AGENT_GAMES_HMAC_HEADER,
    seenSet,
  });
  const port = Number(env.PORT || 8080);
  await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
  console.log(`agent-games-haygs listening on 0.0.0.0:${port} (seen-set: ${seenSet.size} refs)`);
  return { server, port };
}

const invokedAsMain =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsMain) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
