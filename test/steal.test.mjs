import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MatchTracker, handleStealTurn } from "../src/steal.mjs";

describe("steal — response shape", () => {
  test("echoes matchId and turn exactly", async () => {
    const res = await handleStealTurn({ matchId: "m-123", turn: 4 });
    assert.equal(res.matchId, "m-123");
    assert.equal(res.turn, 4);
  });

  test("default (unknown state mapping) fails closed to HOLD with no amount key", async () => {
    const res = await handleStealTurn({ matchId: "m-1", turn: 3 });
    assert.equal(res.action.type, "HOLD");
    assert.equal("amount" in res.action, false);
  });

  test("FORTIFY responses omit amount entirely (spec: schema rejects it even as 0)", async () => {
    const res = await handleStealTurn(
      { matchId: "m-2", turn: 5 },
      { choose: () => ({ action: "FORTIFY", amount: null }) }
    );
    assert.equal(res.action.type, "FORTIFY");
    assert.equal("amount" in res.action, false);
  });

  test("EXTRACT responses carry amount", async () => {
    const res = await handleStealTurn(
      { matchId: "m-3", turn: 5 },
      {
        choose: () => ({ action: "EXTRACT", amount: 10 }),
        getState: () => ({ myBalance: 100, oppBalance: 100 }),
      }
    );
    assert.equal(res.action.type, "EXTRACT");
    assert.equal(res.action.amount, 10);
  });

  test("idempotencyKey is unique per turn and stable on retry of the same turn", async () => {
    const a = await handleStealTurn({ matchId: "m-4", turn: 1 });
    const b = await handleStealTurn({ matchId: "m-4", turn: 1 });
    const c = await handleStealTurn({ matchId: "m-4", turn: 2 });
    assert.equal(a.idempotencyKey, b.idempotencyKey);
    assert.notEqual(a.idempotencyKey, c.idempotencyKey);
  });

  test("malformed envelope fails closed to HOLD", async () => {
    const res = await handleStealTurn({ turn: "not-a-number" });
    assert.equal(res.action.type, "HOLD");
    assert.equal(res._malformed, true);
    assert.equal("amount" in res.action, false);
  });
});

describe("steal — proof hook", () => {
  test("proof is attached when the prover succeeds", async () => {
    const fakeProof = { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"], protocol: "groth16" };
    const res = await handleStealTurn(
      { matchId: "m-5", turn: 2 },
      {
        circuitVersion: "v1-test",
        prove: async () => ({ proof: fakeProof, public_signals: ["7", "8"] }),
      }
    );
    assert.deepEqual(res.proof, {
      circuitVersion: "v1-test",
      proof: fakeProof,
      public_signals: ["7", "8"],
    });
  });

  test("a failing prover never blocks the action response", async () => {
    const res = await handleStealTurn(
      { matchId: "m-6", turn: 2 },
      {
        circuitVersion: "v1-test",
        prove: async () => {
          throw new Error("prover down");
        },
      }
    );
    assert.equal(res.action.type, "HOLD");
    assert.equal("proof" in res, false);
  });

  test("no proof without a circuitVersion (uncommitted strategy)", async () => {
    const res = await handleStealTurn(
      { matchId: "m-7", turn: 2 },
      { prove: async () => ({ proof: {}, public_signals: [] }) }
    );
    assert.equal("proof" in res, false);
  });
});

describe("steal — opponent inference via tracker", () => {
  test("a falling balance infers opponent EXTRACT -> strategy fortifies", async () => {
    const tracker = new MatchTracker();
    const choose = (state) =>
      state.oppLastAction === "EXTRACT"
        ? { action: "FORTIFY", amount: null }
        : { action: "HOLD", amount: null };
    await handleStealTurn(
      { matchId: "m-8", turn: 1 },
      { tracker, choose, getState: () => ({ myBalance: 100, oppBalance: 100 }) }
    );
    const res = await handleStealTurn(
      { matchId: "m-8", turn: 2 },
      { tracker, choose, getState: () => ({ myBalance: 90, oppBalance: 100 }) }
    );
    assert.equal(res.action.type, "FORTIFY");
  });
});
