#!/usr/bin/env node
/*
 * TizenTube for Windows
 * Copyright (C) 2026 Abdullah Shabib
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License, version 3 only, as published by
 * the Free Software Foundation. This program is distributed WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the License along with this program; if
 * not, see <https://www.gnu.org/licenses/>.
 *
 * Bundles TizenTube (GPL-3.0-only) by Reis Can. See NOTICE.md.
 */

/**
 * Verifies that the vendored TizenTube userscript still matches the SHA-256
 * pinned in src/main/config.js, and that every source file parses.
 *
 * The bundled script runs with full Node privileges, so a bundle that no longer
 * matches its pin means either the pin was not updated with `npm run pin-script`
 * or the file was replaced by something else. Either way the build should stop.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'src', 'main', 'config.js');
const BUNDLE_PATH = path.join(ROOT, 'src', 'scripts', 'tizentube-bundle.js');

const SOURCES = [
  'src/main/main.js',
  'src/main/config.js',
  'src/main/native-vibration.js',
  'src/preload/preload.js',
  'src/renderer/controller.js',
  'src/renderer/overlay.js',
  'scripts/pin-script.js',
  'scripts/verify-pin.js'
];

let failed = false;
function fail(msg) {
  console.error('  FAIL  ' + msg);
  failed = true;
}
function pass(msg) {
  console.log('  ok    ' + msg);
}

console.log('Verifying userscript pin');
const config = fs.readFileSync(CONFIG_PATH, 'utf8');
const versionMatch = config.match(/scriptVersion:\s*'([^']+)'/);
const shaMatch = config.match(/scriptSha256:\s*'([0-9a-f]{64})'/);

if (!versionMatch) fail('scriptVersion not found in src/main/config.js');
if (!shaMatch) fail('scriptSha256 not found (or not a 64-char hex digest) in src/main/config.js');

if (versionMatch && shaMatch) {
  const expected = shaMatch[1];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(BUNDLE_PATH)).digest('hex');
  if (actual === expected) {
    pass(`bundled userscript matches the pin for v${versionMatch[1]} (${expected.slice(0, 12)}...)`);
  } else {
    fail(`bundled userscript does NOT match the pin for v${versionMatch[1]}\n` +
         `          expected ${expected}\n` +
         `          actual   ${actual}\n` +
         `        Run \`npm run pin-script\` to re-pin, and review the change.`);
  }
}

console.log('Verifying sources parse');
for (const rel of SOURCES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`${rel} is missing`);
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    pass(rel);
  } catch (err) {
    fail(`${rel} does not parse\n${err.stderr ? err.stderr.toString().trim() : err.message}`);
  }
}

console.log('Verifying licence files are present');
for (const rel of ['LICENSE', 'NOTICE.md']) {
  if (fs.existsSync(path.join(ROOT, rel))) pass(rel);
  else fail(`${rel} is missing — required for GPL-3.0 distribution`);
}

process.exit(failed ? 1 : 0);
