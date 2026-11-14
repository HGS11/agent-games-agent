// File-backed proof-reuse seen-set.
//
// The Gatekeeper must reject a proof_tx that was already accepted in a
// previous task (PROOF_REUSED). The set survives restarts: it is stored as
// a JSON array of strings and written atomically (temp file + rename) so a
// crash mid-write cannot corrupt it.
//
// A corrupt or unreadable file is a hard error at load time (fail closed):
// silently starting with an empty set would let reused proofs through.

import { promises as fs } from "node:fs";
import path from "node:path";

export class SeenSet {
  /**
   * @param {string} filePath - where the JSON array is stored.
   */
  constructor(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("SeenSet requires a file path");
    }
    this.filePath = filePath;
    this.refs = new Set();
    this.loaded = false;
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.refs = new Set();
        this.loaded = true;
        return this;
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`seen-set file is not valid JSON: ${this.filePath}: ${error.message}`);
    }
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      throw new Error(`seen-set file must be a JSON array of strings: ${this.filePath}`);
    }
    this.refs = new Set(parsed);
    this.loaded = true;
    return this;
  }

  has(ref) {
    return this.refs.has(ref);
  }

  get size() {
    return this.refs.size;
  }

  add(ref) {
    this.refs.add(ref);
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify([...this.refs].sort(), null, 2) + "\n", "utf8");
    await fs.rename(tmp, this.filePath);
  }

  async addAndSave(ref) {
    this.add(ref);
    await this.save();
  }
}
