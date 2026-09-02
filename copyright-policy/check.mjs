/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEADER_BYTES = 2048;
const DEFAULT_EXTENSIONS = [".cjs", ".js", ".jsx", ".mjs", ".py", ".ts", ".tsx"];

function git(root, args, encoding = "utf8") {
  return execFileSync("git", ["-C", root, ...args], { encoding });
}

export function readPolicy(root, configPath = ".github/uxheavy-copyright.json") {
  const policy = JSON.parse(readFileSync(resolve(root, configPath), "utf8"));
  if (typeof policy.owner !== "string" || policy.owner.length === 0) {
    throw new Error("copyright policy requires a non-empty owner");
  }
  if (typeof policy.license !== "string" || policy.license.length === 0) {
    throw new Error("copyright policy requires a non-empty SPDX license");
  }
  return {
    ...policy,
    extensions: policy.extensions ?? DEFAULT_EXTENSIONS,
    excludePathsContaining: policy.excludePathsContaining ?? ["/migrations/"],
    excludeSuffixes: policy.excludeSuffixes ?? [".config.ts", ".d.ts"],
  };
}

export function isEligible(path, policy) {
  const normalized = `/${path.replaceAll("\\\\", "/")}`;
  return (
    policy.extensions.includes(extname(path)) &&
    !policy.excludePathsContaining.some((part) => normalized.includes(part)) &&
    !policy.excludeSuffixes.some((suffix) => path.endsWith(suffix))
  );
}

export function legalNotices(source) {
  return source
    .slice(0, HEADER_BYTES)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.includes("Copyright") || line.includes("SPDX-License-Identifier:")
    );
}

export function hasContributionHeader(source, policy) {
  const header = source.slice(0, HEADER_BYTES);
  return (
    header.includes(`Copyright (c) ${policy.owner}`) &&
    header.includes(`SPDX-License-Identifier: ${policy.license}`)
  );
}

export function preservesNotices(before, after) {
  return legalNotices(before).every((notice) => after.includes(notice));
}

function headerFor(path, policy) {
  const owner = `Copyright (c) ${policy.owner}`;
  const spdx = `SPDX-License-Identifier: ${policy.license}`;
  if (extname(path) === ".py") return `# ${owner}\n# ${spdx}\n\n`;
  return `/**\n * ${owner}\n * ${spdx}\n */\n\n`;
}

export function addContributionHeader(source, path, policy) {
  if (hasContributionHeader(source, policy)) return source;
  const header = headerFor(path, policy);
  if (!source.startsWith("#!")) return header + source;
  const newline = source.indexOf("\n");
  if (newline === -1) return `${source}\n${header}`;
  return source.slice(0, newline + 1) + header + source.slice(newline + 1);
}

export function changedFiles(root, base) {
  const fields = git(
    root,
    ["diff", "--name-status", "--diff-filter=AMR", "-z", `${base}...HEAD`, "--"],
    "buffer"
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (status.startsWith("R")) {
      const beforePath = fields[index++];
      const path = fields[index++];
      changes.push({ beforePath, path, status: "R" });
    } else {
      const path = fields[index++];
      changes.push({ beforePath: path, path, status });
    }
  }
  return changes;
}

export function run({ base, configPath, mode, cwd = process.cwd() }) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const policy = readPolicy(root, configPath);
  const changes = changedFiles(root, base).filter(({ path }) => isEligible(path, policy));
  const invalid = [];
  let changed = 0;

  for (const change of changes) {
    const absolutePath = resolve(root, change.path);
    const source = readFileSync(absolutePath, "utf8");
    if (change.status === "A") {
      if (hasContributionHeader(source, policy)) continue;
      if (mode === "write") {
        writeFileSync(absolutePath, addContributionHeader(source, change.path, policy));
        changed += 1;
      } else invalid.push(`${change.path}: missing contribution header`);
      continue;
    }

    const before = git(root, ["show", `${base}:${change.beforePath}`]);
    const notices = legalNotices(before);
    if (notices.length > 0) {
      if (!preservesNotices(before, source)) {
        invalid.push(`${change.path}: removed an inherited legal notice`);
      }
      continue;
    }

    if (hasContributionHeader(source, policy)) continue;
    if (mode === "write") {
      writeFileSync(absolutePath, addContributionHeader(source, change.path, policy));
      changed += 1;
    } else invalid.push(`${change.path}: modified unmarked source needs a contribution header`);
  }

  if (invalid.length > 0) throw new Error(invalid.join("\n"));
  return { changed, checked: changes.length };
}

function parseArgs(args) {
  const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : undefined;
  const baseIndex = args.indexOf("--changed-from");
  const configIndex = args.indexOf("--config");
  const base = baseIndex === -1 ? undefined : args[baseIndex + 1];
  if (!mode || !base) {
    throw new Error("Usage: check.mjs --check|--write --changed-from <git-ref> [--config <path>]");
  }
  return { base, configPath: configIndex === -1 ? undefined : args[configIndex + 1], mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = run(parseArgs(process.argv.slice(2)));
    console.log(`Copyright policy: ${result.checked} checked, ${result.changed} changed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
