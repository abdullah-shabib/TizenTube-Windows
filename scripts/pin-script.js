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
 * Pin a TizenTube userscript release.
 *
 *   npm run pin-script            # re-pin the version already in config.js
 *   npm run pin-script -- 1.14.9  # move to a specific version
 *   npm run pin-script -- latest  # move to whatever npm currently tags latest
 *
 * Downloads the release, writes it to src/scripts/tizentube-bundle.js, and
 * updates scriptVersion / scriptSha256 in src/main/config.js so the bundled
 * build and the pinned digest can never drift apart.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'src', 'main', 'config.js');
const BUNDLE_PATH = path.join(ROOT, 'src', 'scripts', 'tizentube-bundle.js');
const PACKAGE = '@foxreis/tizentube';
const MIN_BYTES = 100000;

function get(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return resolve(get(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(url + ' returned HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function readPinnedVersion() {
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const m = src.match(/scriptVersion:\s*'([^']+)'/);
  if (!m) throw new Error('Could not find scriptVersion in ' + CONFIG_PATH);
  return m[1];
}

async function resolveVersion(requested) {
  if (requested && requested !== 'latest') return requested;
  if (!requested) return readPinnedVersion();
  const meta = JSON.parse((await get('https://registry.npmjs.org/' + encodeURIComponent(PACKAGE))).toString('utf8'));
  return meta['dist-tags'].latest;
}

async function main() {
  const version = await resolveVersion(process.argv[2]);
  const url = `https://cdn.jsdelivr.net/npm/${PACKAGE}@${version}/dist/userScript.js`;

  console.log('Fetching ' + url);
  const buffer = await get(url);
  if (buffer.length <= MIN_BYTES) {
    throw new Error(`Downloaded ${buffer.length} bytes; that is not a TizenTube build.`);
  }
  if (!buffer.toString('utf8').includes('tizentube')) {
    throw new Error('Downloaded file does not look like TizenTube.');
  }

  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  console.log(`  version ${version}`);
  console.log(`  bytes   ${buffer.length}`);
  console.log(`  sha256  ${digest}`);

  fs.writeFileSync(BUNDLE_PATH, buffer);

  let src = fs.readFileSync(CONFIG_PATH, 'utf8');
  src = src.replace(/scriptVersion:\s*'[^']*'/, `scriptVersion: '${version}'`);
  src = src.replace(/scriptSha256:\s*'[^']*'/, `scriptSha256: '${digest}'`);
  fs.writeFileSync(CONFIG_PATH, src);

  console.log('\nUpdated src/scripts/tizentube-bundle.js and the pin in src/main/config.js.');
  console.log('Existing installs keep their old config.json values until they are updated too.');
}

main().catch((err) => {
  console.error('pin-script failed:', err.message);
  process.exit(1);
});
