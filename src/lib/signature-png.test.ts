import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { checkSignaturePng, crc32, readSignatureDataUrl } from "./signature-png";
import { SIGNATURE_PNG_MAX_BYTES } from "./signature-rules";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG built by hand: `ink` sets pixels in the raw rows before compressing. */
function png(opts: {
  width: number;
  height: number;
  colorType?: number;
  interlace?: number;
  ink?: (raw: Buffer, rowBytes: number) => void;
  idat?: Buffer;
  end?: boolean;
}): Buffer {
  const colorType = opts.colorType ?? 6;
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(opts.width, 0);
  header.writeUInt32BE(opts.height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[12] = opts.interlace ?? 0;
  const rowBytes = 1 + opts.width * channels;
  const raw = Buffer.alloc(rowBytes * opts.height); // filter 0, all transparent
  opts.ink?.(raw, rowBytes);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", opts.idat ?? deflateSync(raw)),
    ...(opts.end === false ? [] : [chunk("IEND", Buffer.alloc(0))]),
  ]);
}

/** One opaque navy pixel in the middle row: a stroke, as far as the check cares. */
const stroke = (raw: Buffer, rowBytes: number) => {
  const row = Math.floor(raw.length / rowBytes / 2);
  raw.set([15, 23, 42, 255], row * rowBytes + 1 + 4 * 10);
};

const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

test("crc32 matches the PNG spec's IEND checksum", () => {
  assert.equal(crc32(Buffer.from("IEND", "latin1")), 0xae426082);
});

test("a drawn signature is accepted with its size", () => {
  const bytes = png({ width: 600, height: 200, ink: stroke });
  const result = readSignatureDataUrl(dataUrl(bytes));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.image.width, 600);
    assert.equal(result.image.height, 200);
    assert.ok(result.image.bytes.equals(bytes));
  }
});

test("anything that isn't a PNG data URL is refused", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(60)]);
  for (const bad of [
    "",
    42,
    null,
    "data:image/jpeg;base64,/9j/4AAQ",
    `data:image/png;base64,${jpeg.toString("base64")}`,
    "data:image/png;base64,not base64!",
    "data:image/png;base64,abc",
  ]) {
    assert.equal(readSignatureDataUrl(bad).ok, false, String(bad));
  }
});

test("a corrupted chunk, a missing IEND or a second header is refused", () => {
  const bytes = png({ width: 300, height: 100, ink: stroke });
  const flipped = Buffer.from(bytes);
  flipped[45] ^= 0xff; // inside the IDAT data: its CRC no longer matches
  assert.equal(checkSignaturePng(flipped).ok, false);
  assert.equal(checkSignaturePng(png({ width: 300, height: 100, ink: stroke, end: false })).ok, false);
  const header = bytes.subarray(8, 33);
  const doubled = Buffer.concat([bytes.subarray(0, 33), header, bytes.subarray(33)]);
  assert.equal(checkSignaturePng(doubled).ok, false);
});

test("an empty canvas is refused; one without alpha isn't judged on emptiness", () => {
  const empty = checkSignaturePng(png({ width: 600, height: 200 }));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /empty/);
  assert.equal(checkSignaturePng(png({ width: 600, height: 200, colorType: 2 })).ok, true);
});

test("dimensions must be those of a signature", () => {
  const tooWide = checkSignaturePng(png({ width: 1201, height: 100, ink: stroke }));
  assert.equal(tooWide.ok, false);
  const tooTall = checkSignaturePng(png({ width: 300, height: 401, ink: stroke }));
  assert.equal(tooTall.ok, false);
  const dot = checkSignaturePng(png({ width: 20, height: 20, ink: stroke }));
  assert.equal(dot.ok, false);
  if (!dot.ok) assert.match(dot.error, /too small/);
  assert.equal(checkSignaturePng(png({ width: 1200, height: 400, ink: stroke })).ok, true);
});

test("interlaced images are refused", () => {
  assert.equal(checkSignaturePng(png({ width: 300, height: 100, ink: stroke, interlace: 1 })).ok, false);
});

test("pixel data that inflates past its declared size is refused, not expanded", () => {
  // ~10 MB of zeros compresses to a few KB: a small upload, a big surprise.
  const bomb = png({ width: 100, height: 50, idat: deflateSync(Buffer.alloc(10_000_000)) });
  assert.ok(bomb.length < SIGNATURE_PNG_MAX_BYTES);
  assert.equal(checkSignaturePng(bomb).ok, false);
});

test("more than the byte limit is refused before it is parsed", () => {
  const big = Buffer.concat([SIGNATURE, Buffer.alloc(SIGNATURE_PNG_MAX_BYTES)]);
  const result = checkSignaturePng(big);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /too large/);
  const longUrl = `data:image/png;base64,${"A".repeat(210_000)}`;
  assert.equal(readSignatureDataUrl(longUrl).ok, false);
});
