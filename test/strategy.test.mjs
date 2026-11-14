import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EXTRACT_AMOUNT_PLACEHOLDER,
  STRATEGY_NAME,
  STRATEGY_REVIEW_REQUIRED,
  chooseAction,
} from "../src/strategy.mjs";

describe("strategy — review gate", () => {
  test("strategy is explicitly flagged as needing Hay's review", () => {
    assert.equal(STRATEGY_REVIEW_REQUIRED, true);
    assert.match(STRATEGY_NAME, /UNREVIEWED/);
  });
});

describe("strategy — branches", () => {
  const base = { turn: 5, turnsTotal: 20, myBalance: 100, oppBalance: 100, oppLastAction: null };

  test("turn 1 holds (no signal yet)", () => {
    assert.deepEqual(chooseAction({ ...base, turn: 1 }), { action: "HOLD", amount: null });
  });

  test("opponent extracted last turn -> fortify", () => {
    assert.deepEqual(chooseAction({ ...base, oppLastAction: "EXTRACT" }), {
      action: "FORTIFY",
      amount: null,
    });
  });

  test("behind with few turns left -> extract", () => {
    const out = chooseAction({ ...base, turn: 18, myBalance: 80, oppBalance: 100 });
    assert.equal(out.action, "EXTRACT");
    assert.equal(out.amount, EXTRACT_AMOUNT_PLACEHOLDER);
  });

  test("ahead with few turns left -> hold", () => {
    assert.deepEqual(
      chooseAction({ ...base, turn: 19, myBalance: 120, oppBalance: 100 }),
      { action: "HOLD", amount: null }
    );
  });

  test("default mid-game -> extract pressure", () => {
    const out = chooseAction(base);
    assert.equal(out.action, "EXTRACT");
    assert.equal(out.amount, EXTRACT_AMOUNT_PLACEHOLDER);
  });

  test("deterministic: same state, same action", () => {
    const s = { ...base, turn: 7, myBalance: 90, oppBalance: 110, oppLastAction: "HOLD" };
    assert.deepEqual(chooseAction(s), chooseAction(s));
  });

  test("unknown / malformed state fails closed to HOLD", () => {
    for (const bad of [
      null,
      undefined,
      {},
      { ...base, myBalance: null },
      { ...base, oppBalance: "100" },
      { ...base, turn: 0 },
      { ...base, turn: 21 },
      { ...base, turn: 2.5 },
    ]) {
      assert.deepEqual(chooseAction(bad), { action: "HOLD", amount: null });
    }
  });
});
