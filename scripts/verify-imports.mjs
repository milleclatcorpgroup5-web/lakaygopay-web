#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const roots = ["functions", "public", "tests", "scripts"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = resolve(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (sourceExtensions.has(extname(path))) files.push(path);
  }
}

for (const root of roots) walk(root);

const importPattern = /(?:\bfrom\s*|\bimport\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
const missing = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const target = resolve(dirname(file), specifier);
    const candidates = extname(target)
      ? [target]
      : [target, target + ".js", target + ".mjs", target + ".cjs", target + ".json",
        resolve(target, "index.js"), resolve(target, "index.mjs")];
    if (!candidates.some((candidate) => {
      try { return statSync(candidate).isFile(); } catch { return false; }
    })) {
      missing.push(file.replace(process.cwd() + "/", "") + " -> " + specifier);
    }
  }
}

if (missing.length) {
  console.error("Broken relative imports:");
  for (const item of missing) console.error(" - " + item);
  process.exit(1);
}
console.log("PASS: " + files.length + " JavaScript files; all relative imports resolve.");
