#!/usr/bin/env node
/**
 * Batch-resolves every `values*.json` file sitting next to an
 * `annotation.json` in a folder, writing one resolved output per input
 * into `<folder>/resolved/`.
 *
 * Usage:
 *   npm run resolve                 # defaults to samples/w2
 *   npm run resolve -- samples/w2   # explicit folder
 *
 * Add a new taxpayer scenario by dropping a `values-whatever.json` file
 * next to `annotation.json` and re-running — no other wiring needed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FormTemplate } from "./types.js";
import { resolveForm } from "./resolver.js";

const folder = process.argv[2] ?? "samples/w2";

const annotationPath = join(folder, "annotation.json");
if (!existsSync(annotationPath)) {
  console.error(`No annotation.json found in ${folder}`);
  process.exit(1);
}
const template: FormTemplate = JSON.parse(readFileSync(annotationPath, "utf8"));

const valuesFiles = readdirSync(folder)
  .filter((f) => /^values.*\.json$/.test(f))
  .sort();

if (valuesFiles.length === 0) {
  console.error(`No values*.json files found in ${folder}`);
  process.exit(1);
}

const outDir = join(folder, "resolved");
mkdirSync(outDir, { recursive: true });

for (const file of valuesFiles) {
  const values = JSON.parse(readFileSync(join(folder, file), "utf8"));
  const resolved = resolveForm(template, values);
  const outName = "resolved" + basename(file, ".json").replace(/^values/, "") + ".json";
  writeFileSync(join(outDir, outName), JSON.stringify(resolved, null, 2) + "\n");
  console.log(`${file} -> resolved/${outName} (${resolved.length} fields)`);
}
