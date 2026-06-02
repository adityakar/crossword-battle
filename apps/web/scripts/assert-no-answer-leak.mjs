// assert-no-answer-leak.mjs — permanent anti-cheat guard.
//
// The whole game is server-authoritative: the client ships with NO answers. If a
// preset's answer letters ever leaked into the built client JS, a player could
// read the solution out of the bundle. This script FAILS the build (exit 1) if
// any preset answer word appears as a whole word in apps/web/dist/assets/*.js.
//
// Run AFTER a build:  pnpm --filter @cwb/web build && pnpm --filter @cwb/web assert:no-leak
//
// Importing presets.ts directly: presets.ts is dependency-free data (no
// `@cwb/engine` import), so Node 24's type-stripping resolves the relative .ts
// import fine. The path is relative to THIS module's URL (cwd-independent).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PRESET_DEFS } from '../../worker/src/presets.ts';

const here = dirname(fileURLToPath(import.meta.url));
const distAssets = join(here, '..', 'dist', 'assets');

// All preset answer words (the only secrets that must never reach the client).
const ANSWERS = [...new Set(PRESET_DEFS.flatMap((d) => d.words.map(([w]) => w.toUpperCase())))];

// Known-INCIDENTAL whole-word collisions that are NOT answer-data leaks. Each is
// a legitimate piece of the bundle that happens to spell a preset answer. Kept
// tiny and documented so the guard stays strict: every OTHER answer (and any
// future leak of a full puzzle's other words) still trips it. If you add a
// preset whose answer is a real word baked into UI copy or a dependency, add it
// here WITH a reason — never to silence a genuine leak.
const EXPECTED = {
  BYTE: 'qrcode lib QR "Byte" mode constant (Nn.BYTE / r.BYTE={id:"Byte"})',
  SCAN: 'UI copy: "SCAN TO JOIN" / "SCAN WITH YOUR PHONE"',
};

if (!existsSync(distAssets)) {
  console.error(
    `assert-no-leak: ${distAssets} not found. Build first:\n  pnpm --filter @cwb/web build`,
  );
  process.exit(1);
}

const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error(`assert-no-leak: no .js files in ${distAssets}. Build first.`);
  process.exit(1);
}

const offenders = [];
for (const file of jsFiles) {
  const text = readFileSync(join(distAssets, file), 'utf8');
  for (const answer of ANSWERS) {
    if (EXPECTED[answer]) continue; // documented incidental collision
    // Whole-word, case-sensitive. \b around an all-caps token catches the answer
    // as a discrete word (e.g. "MODEL") but not as a substring of camelCase/IDs.
    const re = new RegExp(`\\b${answer}\\b`);
    if (re.test(text)) offenders.push({ file, answer });
  }
}

if (offenders.length > 0) {
  console.error('assert-no-leak: ANSWER LEAK DETECTED in client bundle:');
  for (const { file, answer } of offenders) {
    console.error(`  - "${answer}" found in assets/${file}`);
  }
  console.error(
    '\nThe client must stay answer-free (server-authoritative model). ' +
      'Do NOT bundle preset answers into the web app.',
  );
  process.exit(1);
}

console.log(
  `assert-no-leak: OK — none of ${ANSWERS.length} preset answers leaked into ` +
    `${jsFiles.length} bundle file(s) ` +
    `(${Object.keys(EXPECTED).length} documented incidental collisions allowed).`,
);
process.exit(0);
