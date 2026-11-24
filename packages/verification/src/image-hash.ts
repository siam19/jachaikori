/**
 * @file packages/verification/src/image-hash.ts
 * Worker-native (pure Web Standard, zero native deps) image validation,
 * SHA-256 hashing, and 64-bit perceptual difference hashing (`dHash`).
 *
 * Supports:
 * - Magic-byte MIME validation (JPEG, PNG, WebP) + 8 MB hard memory guard
 * - Pure-TS PNG pixel decoding via Web Standard `DecompressionStream('deflate')`
 * - Pure-TS Baseline JPEG luminance DC-grid decoding (exact 8x8 block brightness map!)
 * - Deterministic byte-histogram SimHash fallback for exotic/progressive/WebP streams
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB hard limit for Cloudflare Workers safety
export const MIN_IMAGE_BYTES = 32;
export const DEFAULT_DHASH_MAX_HAMMING = 6;

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: SupportedImageMime;
  ext: 'jpg' | 'png' | 'webp';
}

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function validateImageBytes(bytes: Uint8Array): ValidatedImage {
  if (bytes.byteLength < MIN_IMAGE_BYTES) {
    throw new Error('Image payload is too small or empty.');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds maximum allowed size of ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
  }
  const mimeType = detectImageMime(bytes);
  if (!mimeType) {
    throw new Error('Unsupported image format. Please upload a JPEG, PNG, or WebP image.');
  }
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { bytes, mimeType, ext };
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked conversion avoids call-stack limits on large buffers inside Workers
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const raw = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return bytesToHex(new Uint8Array(digest));
}

export interface GrayscaleGrid {
  width: number;
  height: number;
  luma: Float32Array;
}

/**
 * Computes a standard 64-bit difference hash (`dHash`) from any grayscale grid
 * by downsampling to 9x8 and comparing adjacent horizontal pixels.
 */
export function dHashFromGrayscaleGrid(grid: GrayscaleGrid): string {
  const targetW = 9;
  const targetH = 8;
  const small = new Float32Array(targetW * targetH);

  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor((y * grid.height) / targetH);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * grid.height) / targetH));
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor((x * grid.width) / targetW);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * grid.width) / targetW));
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1 && sy < grid.height; sy++) {
        const rowOff = sy * grid.width;
        for (let sx = x0; sx < x1 && sx < grid.width; sx++) {
          sum += grid.luma[rowOff + sx]!;
          count++;
        }
      }
      small[y * targetW + x] = count > 0 ? sum / count : 0;
    }
  }

  let bits = 0n;
  for (let y = 0; y < targetH; y++) {
    const rowOff = y * targetW;
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (small[rowOff + x]! < small[rowOff + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * Computes Hamming distance between two 16-hex-char 64-bit hashes.
 */
export function hammingDistanceHex64(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) {
    return 64;
  }
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let dist = 0;
  while (x > 0n) {
    x &= x - 1n;
    dist++;
  }
  return dist;
}

// ==========================================
// Pure-TS PNG Decoder (via Web DecompressionStream)
// ==========================================

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off]! << 24) |
      (buf[off + 1]! << 16) |
      (buf[off + 2]! << 8) |
      buf[off + 3]!) >>>
    0
  );
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(copy).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

async function decodePngToGrayscale(bytes: Uint8Array): Promise<GrayscaleGrid | null> {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];
  let palette: Uint8Array | null = null;

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = readU32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) break;

    if (type === 'IHDR' && len >= 13) {
      width = readU32BE(bytes, dataStart);
      height = readU32BE(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (
    width <= 0 ||
    height <= 0 ||
    width * height > 25_000_000 ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    idatParts.length === 0
  ) {
    return null;
  }

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) return null;

  const totalIdat = idatParts.reduce((acc, p) => acc + p.byteLength, 0);
  const compressed = new Uint8Array(totalIdat);
  let pos = 0;
  for (const part of idatParts) {
    compressed.set(part, pos);
    pos += part.byteLength;
  }

  const raw = await inflateZlib(compressed);
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;

  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);
  const luma = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let x = 0; x < stride; x++) {
      const val = raw[rowStart + 1 + x]!;
      const left = x >= channels ? curRow[x - channels]! : 0;
      const up = prevRow[x]!;
      const upLeft = x >= channels ? prevRow[x - channels]! : 0;
      let recon = val;
      if (filter === 1) recon = (val + left) & 0xff;
      else if (filter === 2) recon = (val + up) & 0xff;
      else if (filter === 3) recon = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paethPredictor(left, up, upLeft)) & 0xff;
      curRow[x] = recon;
    }

    const rowOut = y * width;
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      if (colorType === 0 || colorType === 4) {
        luma[rowOut + x] = curRow[i]!;
      } else if (colorType === 3 && palette) {
        const idx = curRow[i]! * 3;
        const r = palette[idx] ?? 0;
        const g = palette[idx + 1] ?? 0;
        const b = palette[idx + 2] ?? 0;
        luma[rowOut + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      } else {
        luma[rowOut + x] = 0.299 * curRow[i]! + 0.587 * curRow[i + 1]! + 0.114 * curRow[i + 2]!;
      }
    }
    prevRow.set(curRow);
  }

  return { width, height, luma };
}

// ==========================================
// Pure-TS Baseline JPEG DC-Luminance Decoder
// ==========================================

interface HuffTable {
  minCode: Int32Array;
  maxCode: Int32Array;
  valPtr: Int32Array;
  values: Uint8Array;
}

function buildHuffmanTable(counts: Uint8Array, values: Uint8Array): HuffTable {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17).fill(-1);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const c = counts[len - 1]!;
    if (c > 0) {
      valPtr[len] = k;
      minCode[len] = code;
      k += c;
      code += c;
      maxCode[len] = code - 1;
    }
    code <<= 1;
  }
  return { minCode, maxCode, valPtr, values };
}

function decodeBaselineJpegDcLuma(bytes: Uint8Array): GrayscaleGrid | null {
  let offset = 2;
  let width = 0;
  let height = 0;
  const comps: Array<{ id: number; h: number; v: number; qt: number; dcId: number; acId: number }> = [];
  const quantY = new Int32Array(64).fill(1);
  const dcTables = new Map<number, HuffTable>();
  const acTables = new Map<number, HuffTable>();
  let restartInterval = 0;
  let sosOffset = -1;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 2 > bytes.length) break;
    const segLen = (bytes[offset]! << 8) | bytes[offset + 1]!;
    const segStart = offset + 2;
    const segEnd = offset + segLen;
    if (segEnd > bytes.length) break;

    if (marker === 0xc2) {
      // Progressive JPEG not supported by DC-only fast decoder -> fall back cleanly
      return null;
    }
    if (marker === 0xc0) {
      // SOF0 baseline
      const precision = bytes[segStart]!;
      if (precision !== 8) return null;
      height = (bytes[segStart + 1]! << 8) | bytes[segStart + 2]!;
      width = (bytes[segStart + 3]! << 8) | bytes[segStart + 4]!;
      const numComps = bytes[segStart + 5]!;
      for (let i = 0; i < numComps; i++) {
        const base = segStart + 6 + i * 3;
        comps.push({
          id: bytes[base]!,
          h: bytes[base + 1]! >> 4,
          v: bytes[base + 1]! & 0x0f,
          qt: bytes[base + 2]!,
          dcId: 0,
          acId: 0,
        });
      }
    } else if (marker === 0xdb) {
      // DQT
      let p = segStart;
      while (p < segEnd) {
        const pqTq = bytes[p++]!;
        const pq = pqTq >> 4;
        const tq = pqTq & 0x0f;
        const size = pq === 0 ? 64 : 128;
        if (p + size > segEnd) break;
        if (tq === 0) {
          for (let i = 0; i < 64; i++) {
            quantY[i] = pq === 0 ? bytes[p + i]! : (bytes[p + i * 2]! << 8) | bytes[p + i * 2 + 1]!;
          }
        }
        p += size;
      }
    } else if (marker === 0xc4) {
      // DHT
      let p = segStart;
      while (p < segEnd) {
        const tcTh = bytes[p++]!;
        const tc = tcTh >> 4;
        const th = tcTh & 0x0f;
        const counts = bytes.subarray(p, p + 16);
        p += 16;
        let total = 0;
        for (let i = 0; i < 16; i++) total += counts[i]!;
        const vals = bytes.subarray(p, p + total);
        p += total;
        const tbl = buildHuffmanTable(counts, vals);
        if (tc === 0) dcTables.set(th, tbl);
        else acTables.set(th, tbl);
      }
    } else if (marker === 0xdd) {
      restartInterval = (bytes[segStart]! << 8) | bytes[segStart + 1]!;
    } else if (marker === 0xda) {
      // SOS
      const ns = bytes[segStart]!;
      for (let i = 0; i < ns; i++) {
        const cid = bytes[segStart + 1 + i * 2]!;
        const tdta = bytes[segStart + 2 + i * 2]!;
        const c = comps.find((x) => x.id === cid);
        if (c) {
          c.dcId = tdta >> 4;
          c.acId = tdta & 0x0f;
        }
      }
      sosOffset = segEnd;
      break;
    }

    offset = segEnd;
  }

  if (sosOffset < 0 || width <= 0 || height <= 0 || comps.length === 0) return null;
  const maxH = Math.max(...comps.map((c) => c.h));
  const maxV = Math.max(...comps.map((c) => c.v));
  const mcuW = maxH * 8;
  const mcuH = maxV * 8;
  const mcusX = Math.ceil(width / mcuW);
  const mcusY = Math.ceil(height / mcuH);
  const yComp = comps[0]!;
  const gridW = mcusX * yComp.h;
  const gridH = mcusY * yComp.v;
  if (gridW <= 0 || gridH <= 0 || gridW * gridH > 500_000) return null;

  let pos = sosOffset;
  let bitBuf = 0;
  let bitCount = 0;

  const nextByte = (): number => {
    if (pos >= bytes.length) return -1;
    const b = bytes[pos++]!;
    if (b === 0xff) {
      const next = bytes[pos];
      if (next === 0x00) {
        pos++; // byte stuffing
        return 0xff;
      }
      return -1;
    }
    return b;
  };

  const readBit = (): number => {
    if (bitCount === 0) {
      const b = nextByte();
      if (b < 0) return -1;
      bitBuf = b;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuf >> bitCount) & 1;
  };

  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const bit = readBit();
      if (bit < 0) return -1;
      val = (val << 1) | bit;
    }
    return val;
  };

  const decodeHuff = (tbl: HuffTable): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      const bit = readBit();
      if (bit < 0) return -1;
      code = (code << 1) | bit;
      if (tbl.maxCode[len]! >= 0 && code <= tbl.maxCode[len]!) {
        const idx = tbl.valPtr[len]! + (code - tbl.minCode[len]!);
        return tbl.values[idx] ?? -1;
      }
    }
    return -1;
  };

  const receiveExtend = (len: number): number => {
    if (len === 0) return 0;
    const v = readBits(len);
    if (v < 0) return 0;
    const threshold = 1 << (len - 1);
    return v < threshold ? v - ((1 << len) - 1) : v;
  };

  const prevDc = new Int32Array(comps.length);
  const luma = new Float32Array(gridW * gridH);
  const dcScale = quantY[0]! / 8;
  let mcuCount = 0;

  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      if (restartInterval > 0 && mcuCount > 0 && mcuCount % restartInterval === 0) {
        prevDc.fill(0);
        bitCount = 0;
        // Skip RST marker if present
        if (pos + 1 < bytes.length && bytes[pos] === 0xff && bytes[pos + 1]! >= 0xd0 && bytes[pos + 1]! <= 0xd7) {
          pos += 2;
        }
      }
      for (let ci = 0; ci < comps.length; ci++) {
        const c = comps[ci]!;
        const dcTbl = dcTables.get(c.dcId);
        const acTbl = acTables.get(c.acId);
        if (!dcTbl || !acTbl) return null;

        for (let bv = 0; bv < c.v; bv++) {
          for (let bh = 0; bh < c.h; bh++) {
            const s = decodeHuff(dcTbl);
            if (s < 0) return null;
            const diff = receiveExtend(s);
            prevDc[ci]! += diff;

            if (ci === 0) {
              const gx = mx * c.h + bh;
              const gy = my * c.v + bv;
              const val = Math.max(0, Math.min(255, 128 + prevDc[0]! * dcScale));
              luma[gy * gridW + gx] = val;
            }

            // Skip 63 AC coefficients
            let k = 1;
            while (k < 64) {
              const rs = decodeHuff(acTbl);
              if (rs < 0) return null;
              if (rs === 0x00) break; // EOB
              const r = rs >> 4;
              const sAc = rs & 0x0f;
              if (rs === 0xf0) {
                k += 16;
                continue;
              }
              k += r;
              if (sAc > 0) readBits(sAc);
              k++;
            }
          }
        }
      }
      mcuCount++;
    }
  }

  return { width: gridW, height: gridH, luma };
}

/**
 * Fallback deterministic 64-bit byte-window SimHash when a progressive JPEG or WebP
 * cannot be pixel-decoded in pure JS without external decoders.
 */
function byteWindowSimHash64(bytes: Uint8Array): string {
  const buckets = new Float64Array(64);
  const start = Math.min(64, bytes.length);
  const step = Math.max(1, Math.floor((bytes.length - start) / 4096));
  for (let i = start; i + 3 < bytes.length; i += step) {
    // FNV-1a 32-bit over 4-byte sliding window
    let h = 2166136261;
    h = Math.imul(h ^ bytes[i]!, 16777619);
    h = Math.imul(h ^ bytes[i + 1]!, 16777619);
    h = Math.imul(h ^ bytes[i + 2]!, 16777619);
    h = Math.imul(h ^ bytes[i + 3]!, 16777619);
    const b0 = h & 63;
    const b1 = (h >>> 6) & 63;
    buckets[b0]! += ((h >>> 12) & 1) ? 1 : -1;
    buckets[b1]! += ((h >>> 13) & 1) ? 1 : -1;
  }
  let bits = 0n;
  for (let i = 0; i < 64; i++) {
    bits = (bits << 1n) | (buckets[i]! >= 0 ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * Computes a 16-hex-char 64-bit perceptual hash (`dHash`) for PNG and baseline JPEG,
 * with deterministic fallback for progressive JPEG / WebP.
 */
export async function computePerceptualHash(
  bytes: Uint8Array,
  mimeType: SupportedImageMime
): Promise<{ hash: string; method: 'dhash_png' | 'dhash_jpeg_dc' | 'simhash_fallback' }> {
  try {
    if (mimeType === 'image/png') {
      const grid = await decodePngToGrayscale(bytes);
      if (grid) {
        return { hash: dHashFromGrayscaleGrid(grid), method: 'dhash_png' };
      }
    } else if (mimeType === 'image/jpeg') {
      const grid = decodeBaselineJpegDcLuma(bytes);
      if (grid) {
        return { hash: dHashFromGrayscaleGrid(grid), method: 'dhash_jpeg_dc' };
      }
    }
  } catch {
    // Fall through cleanly to deterministic fallback
  }
  return { hash: byteWindowSimHash64(bytes), method: 'simhash_fallback' };
}
