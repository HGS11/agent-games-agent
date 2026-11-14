// Kurier REST client (zkVerify verification path, recommended in the spec).
//
// Shapes below follow the public Kurier tutorial
// (https://docs.zkverify.io/overview/getting-started/kurier, read 14 Nov 2026):
//   POST {base}/register-vk/{API_KEY}
//     { proofType: "groth16",
//       proofOptions: { library: "snarkjs", curve: "bn128" },
//       vk: <verification-key JSON> }
//     -> response contains vkHash or meta.vkHash
//   POST {base}/submit-proof/{API_KEY}
//     { proofType: "groth16", vkRegistered: true,
//       proofOptions: { library: "snarkjs", curve: "bn128" },
//       proofData: { proof, publicSignals, vk: <vkHash> } }
//     -> { jobId, optimisticVerify: "success" }
//   GET  {base}/job-status/{API_KEY}/{jobId}
//     -> { status: Queued|Valid|Submitted|IncludedInBlock|Finalized|Failed, ... }
//
// Notes:
//   - The Agent Games circuits' vkHashes are ALREADY registered on zkVerify
//     mainnet (spec: "copy it when submitting proofs via Kurier"), so the
//     normal path uses the published vkHash directly in submit-proof and
//     skips register-vk. registerVk() is kept for completeness.
//   - Mainnet base: https://api.kurier.xyz/api/v1
//     Testnet base: https://api-testnet.kurier.xyz/api/v1
//   - The API key is HAY'S STEP: sign up at kurier.xyz (mainnet) or
//     testnet.kurier.xyz (testnet). It is read ONLY from the KURIER_API_KEY
//     environment variable, never stored in this repo, never logged.
//     Kurier's own API design puts the key in the URL path; URLs are
//     therefore never logged by this module.
//   - No aggregation (no chainId): Agent Games needs verify-only + Finalized.

export const KURIER_MAINNET = "https://api.kurier.xyz/api/v1";
export const KURIER_TESTNET = "https://api-testnet.kurier.xyz/api/v1";

const PROOF_OPTIONS = Object.freeze({ library: "snarkjs", curve: "bn128" });

export const MISSING_API_KEY_MESSAGE =
  "KURIER_API_KEY is not set. Kurier mainnet API key is Hay's step: sign up " +
  "at https://kurier.xyz (mainnet) and set KURIER_API_KEY in the deployment " +
  "environment. Never invent, request, or store a key in this repo.";

async function parseJsonResponse(res, label) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Kurier ${label}: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Kurier ${label}: HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

export class KurierClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey - from env only; never hardcode.
   * @param {string} [opts.baseUrl] - default mainnet.
   * @param {function} [opts.fetchImpl] - injectable for tests.
   */
  constructor({ apiKey, baseUrl = KURIER_MAINNET, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new Error(MISSING_API_KEY_MESSAGE);
    }
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env = process.env) {
    return new KurierClient({
      apiKey: env.KURIER_API_KEY,
      baseUrl: env.KURIER_BASE_URL || KURIER_MAINNET,
    });
  }

  /** Register a verification key once. Returns the vkHash string. */
  async registerVk(vk) {
    const res = await this.fetchImpl(`${this.baseUrl}/register-vk/${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofType: "groth16", proofOptions: PROOF_OPTIONS, vk }),
    });
    const data = await parseJsonResponse(res, "register-vk");
    const vkHash = data.vkHash || (data.meta && data.meta.vkHash);
    if (!vkHash) {
      throw new Error(`Kurier register-vk: no vkHash in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return vkHash;
  }

  /** Submit a proof for verification. Returns { jobId, optimisticVerify, ...raw }. */
  async submitProof({ proof, publicSignals, vkHash }) {
    if (!proof || !publicSignals || !vkHash) {
      throw new Error("submitProof requires proof, publicSignals and vkHash");
    }
    const res = await this.fetchImpl(`${this.baseUrl}/submit-proof/${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: PROOF_OPTIONS,
        proofData: { proof, publicSignals, vk: vkHash },
      }),
    });
    const data = await parseJsonResponse(res, "submit-proof");
    if (!data.jobId) {
      throw new Error(`Kurier submit-proof: no jobId in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  }

  /** Fetch one job-status snapshot. */
  async jobStatus(jobId) {
    const res = await this.fetchImpl(`${this.baseUrl}/job-status/${this.apiKey}/${jobId}`);
    return parseJsonResponse(res, "job-status");
  }

  /**
   * Poll job-status until Finalized.
   * @returns the final status object.
   * @throws on Failed status or timeout.
   */
  async pollUntilFinalized(jobId, { intervalMs = 5000, timeoutMs = 300000, onStatus = null } = {}) {
    const started = Date.now();
    for (;;) {
      const status = await this.jobStatus(jobId);
      if (typeof onStatus === "function") onStatus(status);
      if (status.status === "Finalized") return status;
      if (status.status === "Failed") {
        throw new Error(`Kurier job ${jobId} failed: ${JSON.stringify(status).slice(0, 300)}`);
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Kurier job ${jobId} did not finalize within ${timeoutMs}ms (last: ${status.status})`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
