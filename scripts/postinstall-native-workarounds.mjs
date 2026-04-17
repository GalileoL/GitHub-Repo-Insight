import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const tailwindLightningCssEntry = path.join(
  repoRoot,
  'node_modules',
  '@tailwindcss',
  'node',
  'node_modules',
  'lightningcss',
  'node',
  'index.js',
);

const proxySource = `const { createRequire } = require('node:module');
const path = require('node:path');

const requireFromRoot = createRequire(path.resolve(__dirname, '../../../../../package.json'));
module.exports = requireFromRoot('lightningcss');
`;

const pnpmLightningCssProxySource = `const { createRequire } = require('node:module');
const path = require('node:path');

const requireFromRoot = createRequire(path.resolve(__dirname, '../../../../../package.json'));
module.exports = requireFromRoot('lightningcss');
`;

const rollupNativeProxySource = `const { createRequire } = require('node:module');
const path = require('node:path');
const requireFromRoot = createRequire(path.resolve(__dirname, '../../../../../../package.json'));
const wasmNative = requireFromRoot('rollup/dist/native.js');

exports.parse = wasmNative.parse;
exports.parseAsync = wasmNative.parseAsync;
exports.xxhashBase64Url = wasmNative.xxhashBase64Url;
exports.xxhashBase36 = wasmNative.xxhashBase36;
exports.xxhashBase16 = wasmNative.xxhashBase16;
`;

async function patchTailwindLightningCss() {
  try {
    await access(tailwindLightningCssEntry);
  } catch {
    return;
  }

  const current = await readFile(tailwindLightningCssEntry, 'utf8');
  if (current === proxySource) {
    return;
  }

  await writeFile(tailwindLightningCssEntry, proxySource, 'utf8');
  console.log('[postinstall] Patched @tailwindcss/node to use root lightningcss package');
}

async function patchPnPmNativeRollup() {
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');

  let entries;
  try {
    entries = await readdir(pnpmDir, { withFileTypes: true });
  } catch {
    return;
  }

  const nativeRollupDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('rollup@'))
    .map((entry) => path.join(pnpmDir, entry.name, 'node_modules', 'rollup', 'dist', 'native.js'));

  for (const target of nativeRollupDirs) {
    try {
      const current = await readFile(target, 'utf8');
      const shouldPatch = current.includes('requireWithFriendlyError')
        || current.includes("require('./wasm-node/bindings_wasm.js')")
        || current.includes("@rollup/wasm-node/dist/parseAst.js")
        || current.includes("rollup/dist/parseAst.js")
        || current.includes("rollup/dist/native.js");
      if (current === rollupNativeProxySource || !shouldPatch) {
        continue;
      }
      await writeFile(target, rollupNativeProxySource, 'utf8');
      console.log(`[postinstall] Patched Rollup native loader at ${path.relative(repoRoot, target)}`);
    } catch {
      // Ignore missing / non-readable entries so install remains robust across layouts.
    }
  }
}

async function patchPnPmNativeLightningCss() {
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');

  let entries;
  try {
    entries = await readdir(pnpmDir, { withFileTypes: true });
  } catch {
    return;
  }

  const nativeLightningCssEntries = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lightningcss@'))
    .map((entry) => path.join(pnpmDir, entry.name, 'node_modules', 'lightningcss', 'node', 'index.js'));

  for (const target of nativeLightningCssEntries) {
    try {
      const current = await readFile(target, 'utf8');
      const shouldPatch = current.includes('lightningcss-')
        || current.includes('../lightningcss.')
        || current.includes('detect-libc');
      if (current === pnpmLightningCssProxySource || !shouldPatch) {
        continue;
      }
      await writeFile(target, pnpmLightningCssProxySource, 'utf8');
      console.log(`[postinstall] Patched Lightning CSS native loader at ${path.relative(repoRoot, target)}`);
    } catch {
      // Ignore missing / non-readable entries so install remains robust across layouts.
    }
  }
}

await patchTailwindLightningCss();
await patchPnPmNativeRollup();
await patchPnPmNativeLightningCss();
