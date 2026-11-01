import { inflateSync } from "node:zlib";
import {
  SIGNATURE_MAX_HEIGHT,
  SIGNATURE_MAX_WIDTH,
  SIGNATURE_MIN_LONG_SIDE,
  SIGNATURE_MIN_SHORT_SIDE,
  SIGNATURE_PNG_MAX_BYTES,
} from "./signature-rules";

/**
 * Checks a drawn signature before it is kept as evidence. It arrives from a
 * public page as a data URL, so nothing about it is trusted: it must be a
 * real PNG (signature bytes, chunk CRCs, a single IHDR first, IEND last), no
 * bigger than the byte limit, of sane dimensions, and actually have ink on
 * it. The pixel data is inflated with a hard ceiling taken from the declared
 * size, so a decompression bomb fails instead of eating memory.
 *
 * Dependency-free apart from node:zlib, so the tests can exercise it.
 */

const PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The longest data URL that can hold SIGNATURE_PNG_MAX_BYTES; the action caps input at this. */
export const SIGNATURE_DATA_URL_MAX = PREFIX.length + Math.ceil(SIGNATURE_PNG_MAX_BYTES / 3) * 4;

export type SignatureImage = { bytes: Buffer; width: number; height: number };

export type SignatureImageResult =
  | { ok: true; image: SignatureImage }
  | { ok: false; error: string };

const UNREADABLE = { ok: false, error: "We couldn't read your signature. Clear it and draw it again." } as const;
const TOO_LARGE = { ok: false, error: "Your signature image is too large. Clear it and draw it again." } as const;
const EMPTY = { ok: false, error: "Your signature is empty. Draw it in the box, or switch to Type." } as const;
const TOO_SMALL = { ok: false, error: "Your signature is too small. Draw it a little larger in the box." } as const;

let crcTable: Uint32Array | null = null;

/** The CRC-32 every PNG chunk carries over its type and data. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Channels per pixel for each PNG colour type, and the bit depths it allows. */
const COLOR_TYPES: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};

/** A data URL from the signature pad → the checked PNG bytes. */
export function readSignatureDataUrl(dataUrl: unknown): SignatureImageResult {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIX)) return UNREADABLE;
  if (dataUrl.length > SIGNATURE_DATA_URL_MAX) return TOO_LARGE;
  const base64 = dataUrl.slice(PREFIX.length);
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return UNREADABLE;
  return checkSignaturePng(Buffer.from(base64, "base64"));
}

export function checkSignaturePng(bytes: Buffer): SignatureImageResult {
  if (bytes.length > SIGNATURE_PNG_MAX_BYTES) return TOO_LARGE;
  // Signature + IHDR (25) + IEND (12) is the smallest possible PNG.
  if (bytes.length < 8 + 25 + 12 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return UNREADABLE;

  let header: {
    width: number;
    height: number;
    depth: number;
    colorType: number;
    compression: number;
    filter: number;
    interlace: number;
  } | null = null;
  const pixelData: Buffer[] = [];
  let ended = false;
  let offset = 8;
  let chunks = 0;

  while (offset + 12 <= bytes.length) {
    if (++chunks > 1000) return UNREADABLE;
    const length = bytes.readUInt32BE(offset);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) return UNREADABLE;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) return UNREADABLE;
    const data = bytes.subarray(offset + 8, dataEnd);

    if (!header) {
      if (type !== "IHDR" || length !== 13) return UNREADABLE;
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IHDR") {
      return UNREADABLE;
    } else if (type === "IDAT") {
      pixelData.push(data);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header || !ended || pixelData.length === 0) return UNREADABLE;

  const { width, height, depth, colorType } = header;
  if (width < 1 || height < 1) return UNREADABLE;
  if (width > SIGNATURE_MAX_WIDTH || height > SIGNATURE_MAX_HEIGHT) return TOO_LARGE;
  if (Math.max(width, height) < SIGNATURE_MIN_LONG_SIDE || Math.min(width, height) < SIGNATURE_MIN_SHORT_SIDE) {
    return TOO_SMALL;
  }
  const format = COLOR_TYPES[colorType];
  // Interlacing is legal PNG, but no canvas produces it and it would make the
  // rows below a different shape; refusing it keeps this check simple.
  if (!format || !format.depths.includes(depth) || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    return UNREADABLE;
  }

  // Every row is a filter byte and then the packed pixels.
  const rowBytes = 1 + Math.ceil((width * format.channels * depth) / 8);
  const expected = rowBytes * height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(pixelData), { maxOutputLength: expected });
  } catch {
    return UNREADABLE;
  }
  if (raw.length !== expected) return UNREADABLE;

  // Filtering turns all-zero rows into all-zero rows whatever the filter, and
  // a transparent canvas is all zeros. So with an alpha channel, nothing but
  // zeros after the filter bytes means nothing was drawn. (Without one, zero
  // is a colour, so that proves nothing and isn't checked.)
  let ink = false;
  for (let row = 0; row < height; row++) {
    const start = row * rowBytes;
    if (raw[start] > 4) return UNREADABLE;
    if (ink) continue;
    for (let i = start + 1; i < start + rowBytes; i++) {
      if (raw[i] !== 0) {
        ink = true;
        break;
      }
    }
  }
  if (!ink && (colorType === 4 || colorType === 6)) return EMPTY;

  return { ok: true, image: { bytes, width, height } };
}

/** PNG bytes as a data URI, for an <img> or a PDF. */
export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}
