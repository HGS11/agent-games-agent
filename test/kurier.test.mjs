import assert from "node:assert/strict";
import http from "node:http";
import { describe, test } from "node:test";
import { KurierClient, MISSING_API_KEY_MESSAGE } from "../src/kurier.mjs";

// Mock Kurier server: records requests, serves scripted job-status sequences.
function mockKurier({ registerResponse, submitResponse, statusSequence }) {
  const requests = [];
  let statusCalls = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    await new Promise((r) => req.on("end", r));
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/api/v1/register-vk/")) {
      res.end(JSON.stringify(registerResponse));
    } else if (req.url.startsWith("/api/v1/submit-proof/")) {
      res.end(JSON.stringify(submitResponse));
    } else if (req.url.startsWith("/api/v1/job-status/")) {
      const idx = Math.min(statusCalls++, statusSequence.length - 1);
      res.end(JSON.stringify(statusSequence[idx]));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "nope" }));
    }
  });
  return { server, requests };
}

async function withMock(config, fn) {
  const { server, requests } = mockKurier(config);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const client = new KurierClient({ apiKey: "test-key", baseUrl: `http://127.0.0.1:${port}/api/v1` });
    await fn(client, requests);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("kurier", () => {
  test("constructor requires an API key and names Hay's step", () => {
    assert.throws(() => new KurierClient({}), new RegExp("KURIER_API_KEY"));
    assert.match(MISSING_API_KEY_MESSAGE, /kurier\.xyz/);
  });

  test("registerVk posts the documented groth16 shape and returns vkHash", async () => {
    await withMock(
      { registerResponse: { vkHash: "0xabc" }, submitResponse: {}, statusSequence: [] },
      async (client, requests) => {
        const vkHash = await client.registerVk({ protocol: "groth16" });
        assert.equal(vkHash, "0xabc");
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, "POST");
        assert.equal(requests[0].url, "/api/v1/register-vk/test-key");
        assert.deepEqual(requests[0].body, {
          proofType: "groth16",
          proofOptions: { library: "snarkjs", curve: "bn128" },
          vk: { protocol: "groth16" },
        });
      }
    );
  });

  test("registerVk also reads meta.vkHash", async () => {
    await withMock(
      { registerResponse: { meta: { vkHash: "0xdef" } }, submitResponse: {}, statusSequence: [] },
      async (client) => {
        assert.equal(await client.registerVk({}), "0xdef");
      }
    );
  });

  test("submitProof posts proofData with the vkHash", async () => {
    await withMock(
      { registerResponse: {}, submitResponse: { jobId: "job-1", optimisticVerify: "success" }, statusSequence: [] },
      async (client, requests) => {
        const data = await client.submitProof({
          proof: { pi_a: ["1"] },
          publicSignals: ["2"],
          vkHash: "0xabc",
        });
        assert.equal(data.jobId, "job-1");
        assert.deepEqual(requests[0].body, {
          proofType: "groth16",
          vkRegistered: true,
          proofOptions: { library: "snarkjs", curve: "bn128" },
          proofData: { proof: { pi_a: ["1"] }, publicSignals: ["2"], vk: "0xabc" },
        });
      }
    );
  });

  test("pollUntilFinalized polls until Finalized", async () => {
    await withMock(
      {
        registerResponse: {},
        submitResponse: {},
        statusSequence: [
          { jobId: "job-1", status: "Submitted" },
          { jobId: "job-1", status: "IncludedInBlock" },
          { jobId: "job-1", status: "Finalized", txHash: "0x999" },
        ],
      },
      async (client, requests) => {
        const seen = [];
        const fin = await client.pollUntilFinalized("job-1", {
          intervalMs: 1,
          onStatus: (s) => seen.push(s.status),
        });
        assert.equal(fin.status, "Finalized");
        assert.equal(fin.txHash, "0x999");
        assert.deepEqual(seen, ["Submitted", "IncludedInBlock", "Finalized"]);
        assert.equal(requests.filter((r) => r.url.includes("job-status")).length, 3);
      }
    );
  });

  test("pollUntilFinalized throws on Failed", async () => {
    await withMock(
      { registerResponse: {}, submitResponse: {}, statusSequence: [{ jobId: "j", status: "Failed" }] },
      async (client) => {
        await assert.rejects(() => client.pollUntilFinalized("j", { intervalMs: 1 }), /failed/);
      }
    );
  });

  test("pollUntilFinalized throws on timeout", async () => {
    await withMock(
      { registerResponse: {}, submitResponse: {}, statusSequence: [{ jobId: "j", status: "Queued" }] },
      async (client) => {
        await assert.rejects(
          () => client.pollUntilFinalized("j", { intervalMs: 1, timeoutMs: 5 }),
          /did not finalize/
        );
      }
    );
  });
});
