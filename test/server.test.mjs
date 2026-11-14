import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createServer } from "../src/server.mjs";
import { SeenSet } from "../src/seen-set.mjs";
import { signHmacSha256Hex, verifyHmacSha256Hex } from "../src/hmac.mjs";

const SECRET = "test-hmac-secret";
let server;
let base;

before(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-server-"));
  const seenSet = new SeenSet(path.join(dir, "seen.json"));
  await seenSet.load();
  server = createServer({ hmacSecret: SECRET, seenSet });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

async function postSigned(pathname, obj, { secret = SECRET, header = "x-agent-games-signature" } = {}) {
  const body = JSON.stringify(obj);
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers[header] = signHmacSha256Hex(secret, Buffer.from(body));
  const res = await fetch(`${base}${pathname}`, { method: "POST", headers, body });
  const text = await res.text();
  return { res, text, json: text ? JSON.parse(text) : null };
}

describe("server — health", () => {
  test("GET / returns 200 ok", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("GET /healthz returns 200 ok", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("unknown path returns 404", async () => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

describe("server — gatekeeper endpoint", () => {
  const task = {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: "gk_24_9d1",
    mode: "competition",
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

  test("signed POST returns the decision and a verifiable response signature", async () => {
    const { res, text, json } = await postSigned("/agent", task);
    assert.equal(res.status, 200);
    assert.equal(json.decision, "REJECT");
    assert.equal(json.reason_code, "VK_SUBSTITUTION");
    const sig = res.headers.get("x-agent-games-signature");
    assert.ok(sig, "response signature header present");
    assert.equal(verifyHmacSha256Hex(SECRET, Buffer.from(text), sig), true);
  });

  test("POST / (root) also accepts tasks", async () => {
    const { res, json } = await postSigned("/", task);
    assert.equal(res.status, 200);
    assert.equal(json.reason_code, "VK_SUBSTITUTION");
  });

  test("unsigned POST is rejected 401", async () => {
    const { res } = await postSigned("/agent", task, { secret: null });
    assert.equal(res.status, 401);
  });

  test("wrong-secret POST is rejected 401", async () => {
    const { res } = await postSigned("/agent", task, { secret: "wrong" });
    assert.equal(res.status, 401);
  });

  test("APPROVE decision records proof_tx; a repeat is PROOF_REUSED", async () => {
    const valid = {
      ...task,
      task_id: "gk_reuse_1",
      input: { ...task.input, proof_vk: "0x7d3a...f291", proof_tx: "0xreuse001" },
    };
    const first = await postSigned("/agent", valid);
    assert.equal(first.json.decision, "APPROVE");
    const second = await postSigned("/agent", valid);
    assert.equal(second.json.decision, "REJECT");
    assert.equal(second.json.reason_code, "PROOF_REUSED");
  });
});

describe("server — steal endpoint", () => {
  test("signed steal turn echoes matchId/turn and omits amount for HOLD", async () => {
    const { res, json } = await postSigned("/agent", { matchId: "m-9", turn: 2 });
    assert.equal(res.status, 200);
    assert.equal(json.matchId, "m-9");
    assert.equal(json.turn, 2);
    assert.equal(json.action.type, "HOLD");
    assert.equal("amount" in json.action, false);
    assert.ok(json.idempotencyKey);
  });

  test("unknown envelope returns 400", async () => {
    const { res } = await postSigned("/agent", { hello: "world" });
    assert.equal(res.status, 400);
  });
});

describe("server — startup guards", () => {
  test("createServer refuses to start without an HMAC secret", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-server-"));
    const seenSet = new SeenSet(path.join(dir, "seen.json"));
    await seenSet.load();
    assert.throws(() => createServer({ seenSet }), /HMAC_SECRET/);
  });
});
