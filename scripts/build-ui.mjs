#!/usr/bin/env node
/**
 * Bundles the static cockpit UI into a generated TypeScript module so the
 * extension has no runtime file-system or asset-path dependencies.
 *
 * Usage: node scripts/build-ui.mjs [--watch]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, watch } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = resolve(root, "ui");
const outFile = resolve(root, "src", "assets.ts");

const FILES = [
  ["index.html", "text/html; charset=utf-8", "index.html"],
  ["app.css", "text/css; charset=utf-8", "app.css"],
  ["app.js", "text/javascript; charset=utf-8", "app.js"],
  ["favicon.svg", "image/svg+xml", "favicon.svg"],
];

async function build() {
  const entries = [];
  const hash = createHash("sha256");
  for (const [file, type, key] of FILES) {
    const body = await readFile(resolve(uiDir, file), "utf8");
    hash.update(file).update(body);
    entries.push({ key, type, body, file });
  }
  const version = hash.digest("hex").slice(0, 10);

  const lines = [
    "/* GENERATED FILE — do not edit. Run `node scripts/build-ui.mjs`. */",
    "",
    "export interface UiAsset {",
    "  type: string;",
    "  body: string;",
    "}",
    "",
    `export const UI_VERSION = ${JSON.stringify(version)};`,
    "",
    "export const UI_ASSETS: Record<string, UiAsset> = {",
  ];

  for (const entry of entries) {
    lines.push(`  ${JSON.stringify(entry.key)}: {`);
    lines.push(`    type: ${JSON.stringify(entry.type)},`);
    lines.push(`    body: ${JSON.stringify(entry.body)},`);
    lines.push("  },");
  }
  lines.push("};", "");

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, lines.join("\n"), "utf8");

  let total = 0;
  for (const entry of entries) total += Buffer.byteLength(entry.body);
  console.log(
    `[pi-webman] built ${entries.length} assets (${(total / 1024).toFixed(1)} KiB) → src/assets.ts · v${version}`,
  );
}

await build();

if (process.argv.includes("--watch")) {
  console.log("[pi-webman] watching ui/ …");
  let timer;
  watch(uiDir, { recursive: true }).then(async (watcher) => {
    for await (const event of watcher) {
      if (!event.filename) continue;
      clearTimeout(timer);
      timer = setTimeout(() => {
        build().catch((error) => console.error("[pi-webman] build failed:", error));
      }, 60);
    }
  });
}
