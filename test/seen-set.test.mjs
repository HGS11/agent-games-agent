import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { SeenSet } from "../src/seen-set.mjs";

describe("seen-set", () => {
  test("starts empty when the file does not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
    const set = new SeenSet(path.join(dir, "seen.json"));
    await set.load();
    assert.equal(set.size, 0);
    assert.equal(set.has("0xabc"), false);
  });

  test("addAndSave persists and survives reload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
    const file = path.join(dir, "nested", "seen.json");
    const set = new SeenSet(file);
    await set.load();
    await set.addAndSave("0xaaa");
    await set.addAndSave("0xbbb");
    const raw = await readFile(file, "utf8");
    assert.deepEqual(JSON.parse(raw), ["0xaaa", "0xbbb"]);

    const reloaded = new SeenSet(file);
    await reloaded.load();
    assert.equal(reloaded.size, 2);
    assert.equal(reloaded.has("0xaaa"), true);
    assert.equal(reloaded.has("0xccc"), false);
  });

  test("corrupt file fails closed (throws on load)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
    const file = path.join(dir, "seen.json");
    await writeFile(file, "{not json", "utf8");
    const set = new SeenSet(file);
    await assert.rejects(() => set.load(), /not valid JSON/);
  });

  test("non-array JSON fails closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seen-"));
    const file = path.join(dir, "seen.json");
    await writeFile(file, '{"a":1}', "utf8");
    const set = new SeenSet(file);
    await assert.rejects(() => set.load(), /array of strings/);
  });
});
