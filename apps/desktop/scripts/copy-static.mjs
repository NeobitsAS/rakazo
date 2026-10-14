import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits the TypeScript sources; the preload bridges and the static assets
// of the setup window and the shell's overlays have to be copied into dist alongside them.
const STATIC_FILES = [
  "preload.cjs",
  "setup-preload.cjs",
  "setup.html",
  "setup.css",
  "setup.js",
  "pill-preload.cjs",
  "pill.html",
  "pill.css",
  "pill.js",
  "settings-button-preload.cjs",
  "settings-button.html",
  "settings-button.css",
  "settings-button-page.js",
];
const TOKENS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui-tokens/src/tokens.css",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await mkdir(dist, { recursive: true });
await Promise.all([
  ...STATIC_FILES.map((file) => copyFile(path.join(root, "src", file), path.join(dist, file))),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
]);
