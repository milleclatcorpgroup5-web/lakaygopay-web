import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const functionsRoot = path.join(root, "functions");
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

const files = await walk(functionsRoot);
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;

      const target = path.resolve(path.dirname(file), specifier);
      const candidates = path.extname(target)
        ? [target]
        : [target, ...[".js", ".mjs", ".cjs", ".ts"].map(ext => target + ext),
          path.join(target, "index.js")];

      let found = false;
      for (const candidate of candidates) {
        if (await exists(candidate)) { found = true; break; }
      }
      if (!found) {
        failures.push(`${path.relative(root, file)} imports missing "${specifier}"`);
      }
    }
  }
}

if (failures.length) {
  console.error("Cloudflare Pages Functions import check failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log(`Pages Functions import check passed (${files.length} source files scanned).`);
