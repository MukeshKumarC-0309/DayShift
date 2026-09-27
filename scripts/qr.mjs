/**
 * (Copied from the SentinelFeed project, same author.)
 *
 * A small QR encoder, byte mode, error-correction level M.
 *
 * Written out rather than pulled in because the project has no dependencies,
 * and a QR code is a fixed, well-specified algorithm: encode the bytes, append
 * Reed-Solomon correction, lay the modules out around the finder patterns, then
 * pick the mask that scores best. Enough versions are supported to hold a LAN
 * URL comfortably.
 */

/* ---- Galois field GF(256), primitive polynomial 0x11d ------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    // Coefficients run highest-degree first, so multiplying by (x + a^i)
    // shifts each term up one degree (same index) and adds the scaled term
    // one index later. Getting these two the wrong way round silently
    // produces a mirrored polynomial and codes that never scan.
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

export function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < count; i += 1) remainder[i] ^= mul(gen[i + 1], factor);
  }
  return remainder;
}

/* ---- Version tables (level M only) ------------------------------------- */

/**
 * Per version: total data codewords, EC codewords per block, and the block
 * split [count1, count2] where group two holds one extra data codeword.
 */
const VERSIONS = {
  1: { data: 16, ecPerBlock: 10, blocks: [1, 0] },
  2: { data: 28, ecPerBlock: 16, blocks: [1, 0] },
  3: { data: 44, ecPerBlock: 26, blocks: [1, 0] },
  4: { data: 64, ecPerBlock: 18, blocks: [2, 0] },
  5: { data: 86, ecPerBlock: 24, blocks: [2, 0] },
  6: { data: 108, ecPerBlock: 16, blocks: [4, 0] },
  7: { data: 124, ecPerBlock: 18, blocks: [4, 0] },
  8: { data: 154, ecPerBlock: 22, blocks: [2, 2] },
  9: { data: 182, ecPerBlock: 22, blocks: [3, 2] },
  10: { data: 216, ecPerBlock: 26, blocks: [4, 1] },
};

const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Pre-computed version information is only needed from version 7 up. */
const VERSION_INFO = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

/* ---- Bit stream --------------------------------------------------------- */

class BitBuffer {
  constructor() {
    this.bits = [];
  }

  put(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length() {
    return this.bits.length;
  }

  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] || 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/* ---- Encoding ----------------------------------------------------------- */

function chooseVersion(byteLength) {
  for (const version of Object.keys(VERSIONS).map(Number).sort((a, b) => a - b)) {
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (VERSIONS[version].data * 8 >= needed) return version;
  }
  throw new Error('content too long for the supported QR versions');
}

function buildCodewords(bytes, version) {
  const spec = VERSIONS[version];
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);

  // Terminator, then pad to a byte boundary, then alternating pad bytes.
  const capacity = spec.data * 8;
  const terminator = Math.min(4, capacity - buffer.length);
  buffer.put(0, terminator);
  while (buffer.length % 8 !== 0) buffer.bits.push(0);

  const data = buffer.toBytes();
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < spec.data) {
    data.push(pads[padIndex % 2]);
    padIndex += 1;
  }

  // Split into blocks; group two carries one extra data codeword each.
  const [g1, g2] = spec.blocks;
  const totalBlocks = g1 + g2;
  const shortLen = Math.floor(spec.data / totalBlocks);
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < totalBlocks; i += 1) {
    const length = i < g1 ? shortLen : shortLen + 1;
    const chunk = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: chunk, ec: ecCodewords(chunk, spec.ecPerBlock) });
  }

  // Interleave data, then interleave error correction.
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

/* ---- Matrix ------------------------------------------------------------- */

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFinder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const onEdge = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[rr][cc] = onEdge || inCore ? 1 : 0;
        reserved[rr][cc] = true;
      }
    }
  };

  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0;
    modules[6][i] = value;
    modules[i][6] = value;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Alignment patterns, skipping those that collide with the finders.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === centres[centres.length - 1]) || (r === centres[centres.length - 1] && c === 6)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          modules[r + dr][c + dc] = ring === 1 ? 0 : 1;
          reserved[r + dr][c + dc] = true;
        }
      }
    }
  }

  // Dark module, always set.
  modules[size - 8][8] = 1;
  reserved[size - 8][8] = true;

  // Reserve the format information areas.
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Version information blocks, versions 7 and above.
  if (version >= 7) {
    const info = VERSION_INFO[version];
    for (let i = 0; i < 18; i += 1) {
      const bit = (info >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      modules[r][c] = bit;
      modules[c][r] = bit;
      reserved[r][c] = true;
      reserved[c][r] = true;
    }
  }

  return { size, modules, reserved };
}

/** Walk the matrix in the specified zigzag and drop the codeword bits in. */
function placeData(matrix, codewords) {
  const { size, modules, reserved } = matrix;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // skip the vertical timing column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        const byte = codewords[bitIndex >> 3];
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        modules[row][col] = bit;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Format information: EC level M (0b00) plus mask, BCH(15,5) with XOR mask. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >> (i + 10)) & 1) value ^= 0b10100110111 << i;
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

function applyFormat(matrix, mask) {
  const { size, modules } = matrix;
  const bits = formatBits(mask);

  // Bit i is the i-th least significant bit of the format value, and each bit
  // is written twice. Column 8 skips row 6 (timing) and row size-8 (the
  // always-dark module); row 8 skips column 6 (timing).
  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >> i) & 1;

    // Copy in column 8: down the left of the top-left finder, then up from
    // the bottom-left one.
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[size - 15 + i][8] = bit;

    // Copy in row 8: right of the top-right finder, then back along the top.
    if (i < 8) modules[8][size - 1 - i] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;
  }
}

/** Standard penalty rules; lower is better. */
function penalty(modules, size) {
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  for (let r = 0; r < size; r += 1) score += runScore(modules[r]);
  for (let c = 0; c < size; c += 1) score += runScore(modules.map((row) => row[c]));

  // 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  // Finder-like patterns in any line.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (line, start) => pattern.every((p, i) => line[start + i] === p);
  const quiet = (line, from, to) => {
    for (let i = from; i < to; i += 1) if (line[i] !== 0) return false;
    return true;
  };
  const scanLine = (line) => {
    for (let i = 0; i + 7 <= line.length; i += 1) {
      if (!hasPattern(line, i)) continue;
      if (i >= 4 && quiet(line, i - 4, i)) score += 40;
      else if (i + 11 <= line.length && quiet(line, i + 7, i + 11)) score += 40;
    }
  };
  for (let r = 0; r < size; r += 1) scanLine(modules[r]);
  for (let c = 0; c < size; c += 1) scanLine(modules.map((row) => row[c]));

  // Overall balance of dark modules.
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) dark += modules[r][c];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** Encode `text` and return the finished module matrix. */
export function encodeQr(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = createMatrix(version);
    placeData(matrix, codewords);

    // Mask only the data region; function patterns stay untouched.
    for (let r = 0; r < matrix.size; r += 1) {
      for (let c = 0; c < matrix.size; c += 1) {
        if (!matrix.reserved[r][c] && MASKS[mask](r, c)) matrix.modules[r][c] ^= 1;
      }
    }
    applyFormat(matrix, mask);

    const score = penalty(matrix.modules, matrix.size);
    if (!best || score < best.score) best = { score, matrix, mask };
  }

  return { size: best.matrix.size, modules: best.matrix.modules, version, mask: best.mask };
}

/**
 * Render as SVG. The quiet zone is part of the symbol - without it many
 * scanners simply will not lock on.
 */
export function qrSvg(text, { scale = 6, quiet = 4, dark = '#05070b', light = '#ffffff' } = {}) {
  const { size, modules } = encodeQr(text);
  const dimension = (size + quiet * 2) * scale;

  let path = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) {
        path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="QR code">` +
    `<rect width="${dimension}" height="${dimension}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`;
}
