// main.ts — GLASSHOUSE entry harness (Node 22, stdlib only).
// Copies game/ + screenshots/ into the output directory and writes
// dossier.json via the kit's buildDossier (vendor/makefun-threejs.ts,
// unchanged). Deterministic: same input writes the same bytes on every run
// — no timestamps, no randomness, sorted traversal, plain files only.
// The grader runs this without MAKEFUN_OUTPUT_DIR set (default /output);
// test it that way (uid 65534) before submitting.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-threejs.ts';

const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const ROOT = new URL('.', import.meta.url).pathname;

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const names = readdirSync(src).sort();
  for (const name of names) {
    const from = join(src, name);
    const to = join(dst, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyTree(from, to);
    } else if (st.isFile()) {
      cpSync(from, to);
    }
    // Symlinks and anything else are skipped: plain files only.
  }
}

function main(): void {
  const gameSrc = join(ROOT, 'game');
  const shotsSrc = join(ROOT, 'screenshots');
  if (!existsSync(gameSrc)) throw new Error('main.ts: game/ is missing');
  if (!existsSync(shotsSrc)) throw new Error('main.ts: screenshots/ is missing');

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  copyTree(gameSrc, join(OUT, 'game'));
  copyTree(shotsSrc, join(OUT, 'screenshots'));

  const dossier = buildDossier(OUT, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(OUT, 'dossier.json'), dossier);
}

main();
