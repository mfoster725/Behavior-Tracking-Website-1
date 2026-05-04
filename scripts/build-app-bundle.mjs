/**
 * Concatenates the three legacy global scripts in load order, validates syntax
 * with esbuild, and writes static/app.bundle.js (single <script> in index.html).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PARTS = [
  'static/js/app-config.js',
  'static/app.js',
  'static/js/app-marketplace-tab.js',
];

function main() {
  const chunks = [];
  for (const rel of PARTS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.error('Missing source file:', abs);
      process.exit(1);
    }
    chunks.push(fs.readFileSync(abs, 'utf8'));
  }
  const combined = chunks.join('\n');

  try {
    esbuild.transformSync(combined, { loader: 'js', logLevel: 'silent' });
  } catch (e) {
    console.error('Bundle failed esbuild parse (syntax error in combined sources):');
    console.error(e.message);
    process.exit(1);
  }

  const banner =
    `/* Built from ${PARTS.join(' + ')} — edit those files, then run: npm run build:app */\n`;
  const outPath = path.join(root, 'static', 'app.bundle.js');
  fs.writeFileSync(outPath, banner + combined, 'utf8');
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log('OK', outPath, `(${kb} KB)`);
}

main();
