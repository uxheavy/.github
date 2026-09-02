/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../check.mjs";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), "uxheavy-copyright-"));
  mkdirSync(join(root, ".github"));
  writeFileSync(
    join(root, ".github/uxheavy-copyright.json"),
    JSON.stringify({ license: "MIT", owner: "2026-present Ngo Quoc Huy" })
  );
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Policy Test");
  git(root, "config", "user.email", "policy@example.invalid");
  writeFileSync(join(root, "existing.py"), "print('before')\n");
  writeFileSync(
    join(root, "inherited.ts"),
    "/**\n * Copyright (c) Upstream Authors\n * SPDX-License-Identifier: MIT\n */\nexport const before = true;\n"
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  return root;
}

test("marks added and previously unmarked modified source", () => {
  const root = repository();
  writeFileSync(join(root, "new.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "existing.py"), "print('after')\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "change");

  assert.throws(() => run({ base: "HEAD^", cwd: root, mode: "check" }), /missing contribution header/);
  const result = run({ base: "HEAD^", cwd: root, mode: "write" });
  assert.equal(result.changed, 2);
  assert.match(readFileSync(join(root, "new.ts"), "utf8"), /Copyright \(c\) 2026-present Ngo Quoc Huy/);
  assert.doesNotThrow(() => run({ base: "HEAD^", cwd: root, mode: "check" }));
});

test("rejects removal of inherited legal notices", () => {
  const root = repository();
  writeFileSync(join(root, "inherited.ts"), "export const after = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "remove notice");

  assert.throws(() => run({ base: "HEAD^", cwd: root, mode: "check" }), /removed an inherited legal notice/);
});
