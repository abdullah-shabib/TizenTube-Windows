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
 * Minimal Zero-Dependency QR Code SVG Generator
 * Encodes Byte-mode strings (URLs) into scannable SVG QR codes (Versions 2-4, ECC Level M).
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  EXP[i + 255] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x >= 128 ? 285 : 0);
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function getGenerator(ecCount) {
  let g = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= gfMul(g[j], EXP[i]);
      next[j + 1] ^= g[j];
    }
    g = next;
  }
  return g;
}

function calcEC(data, ecCount) {
  const g = getGenerator(ecCount);
  const msg = new Uint8Array(data.length + ecCount);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = msg[i];
    if (factor !== 0) {
      for (let j = 0; j < g.length; j++) {
        msg[i + j] ^= gfMul(g[j], factor);
      }
    }
  }
  return msg.slice(data.length);
}

const VERSIONS = [
  { version: 2, size: 25, ecCount: 16, dataCount: 28, align: [6, 18] },
  { version: 3, size: 29, ecCount: 26, dataCount: 44, align: [6, 22] },
  { version: 4, size: 33, ecCount: 36, dataCount: 64, align: [6, 26] }
];

function encode(text) {
  const bytes = Buffer.from(text, 'utf8');
  let ver = VERSIONS.find(v => bytes.length + 3 <= v.dataCount);
  if (!ver) ver = VERSIONS[VERSIONS.length - 1];

  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(4, 4);
  // Character count: 8 bits
  pushBits(bytes.length, 8);
  for (const b of bytes) {
    pushBits(b, 8);
  }
  // Terminator (up to 4 zeroes)
  const totalBits = ver.dataCount * 8;
  const termLen = Math.min(4, totalBits - bits.length);
  pushBits(0, termLen);
  // Pad to byte
  while (bits.length % 8 !== 0) bits.push(0);

  // Alternating pad bytes 0xEC, 0x11
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < totalBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const data = new Uint8Array(ver.dataCount);
  for (let i = 0; i < ver.dataCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    data[i] = b;
  }

  const ec = calcEC(data, ver.ecCount);
  const allCodewords = new Uint8Array(data.length + ec.length);
  allCodewords.set(data);
  allCodewords.set(ec, data.length);

  return { ver, allCodewords };
}

function makeMatrix(ver, codewords) {
  const size = ver.size;
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

  function set(r, c, val, func = true) {
    matrix[r][c] = val;
    if (func) isFunction[r][c] = 1;
  }

  // Finder patterns
  function addFinder(top, left) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = top + r, nc = left + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(nr, nc, isBlack ? 1 : 0);
      }
    }
  }
  addFinder(0, 0);
  addFinder(0, size - 7);
  addFinder(size - 7, 0);

  // Alignment pattern
  if (ver.align) {
    const coords = ver.align;
    for (const r of coords) {
      for (const c of coords) {
        if (isFunction[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBlack = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            set(r + dr, c + dc, isBlack ? 1 : 0);
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) set(6, i, i % 2 === 0 ? 1 : 0);
    if (!isFunction[i][6]) set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Dark module
  set(4 * ver.version + 9, 8, 1);

  // Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) set(8, i, 0);
    if (!isFunction[i][8]) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) set(8, size - 1 - i, 0);
    if (!isFunction[size - 1 - i][8]) set(size - 1 - i, 8, 0);
  }

  // Data module placement (zigzag right-to-left)
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    const cols = [right, right - 1];
    const rows = [];
    for (let r = 0; r < size; r++) rows.push(upwards ? size - 1 - r : r);
    upwards = !upwards;

    for (const r of rows) {
      for (const c of cols) {
        if (!isFunction[r][c]) {
          let bit = 0;
          if (bitIndex < totalBits) {
            const byteIdx = bitIndex >> 3;
            const bitOffset = 7 - (bitIndex & 7);
            bit = (codewords[byteIdx] >> bitOffset) & 1;
            bitIndex++;
          }
          // Mask 0: (row + col) % 2 === 0
          if ((r + c) % 2 === 0) {
            bit ^= 1;
          }
          matrix[r][c] = bit;
        }
      }
    }
  }

  // Format info (Mask 0, Level M: 0b101010000010010)
  const formatBits = 0b101010000010010;
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >> i) & 1;
    let r1, c1;
    if (i < 6) { r1 = 8; c1 = i; }
    else if (i === 6) { r1 = 8; c1 = 7; }
    else if (i < 9) { r1 = 8 - (i - 7); c1 = 8; }
    else { r1 = 14 - i; c1 = 8; }
    set(r1, c1, bit);

    let r2, c2;
    if (i < 8) {
      r2 = size - 1 - i;
      c2 = 8;
    } else {
      r2 = 8;
      c2 = size - 15 + i;
    }
    set(r2, c2, bit);
  }

  return matrix;
}

/**
 * Generate an SVG string representing a QR Code for the given text.
 * @param {string} text URL or text to encode
 * @param {number} size Pixel width/height of the SVG
 * @returns {string} XML SVG string
 */
function generateQRCodeSVG(text, size = 180) {
  try {
    const { ver, allCodewords } = encode(text);
    const matrix = makeMatrix(ver, allCodewords);
    const modCount = matrix.length;
    const margin = 2;
    const totalCells = modCount + margin * 2;
    const cellSize = size / totalCells;

    let paths = '';
    for (let r = 0; r < modCount; r++) {
      for (let c = 0; c < modCount; c++) {
        if (matrix[r][c] === 1) {
          const x = (c + margin) * cellSize;
          const y = (r + margin) * cellSize;
          paths += `M${x.toFixed(1)},${y.toFixed(1)}h${cellSize.toFixed(1)}v${cellSize.toFixed(1)}h-${cellSize.toFixed(1)}z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
      `<rect width="100%" height="100%" fill="#ffffff" rx="8"/>` +
      `<path d="${paths}" fill="#0f0f0f"/>` +
      `</svg>`;
  } catch (err) {
    console.warn('[TizenTube QR] Failed to generate QR code SVG:', err.message);
    return '';
  }
}

module.exports = {
  generateQRCodeSVG
};
