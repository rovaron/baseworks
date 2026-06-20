/**
 * Pure-JS image header dimension parser (Phase 28 / IMG-03).
 *
 * Reads {width, height, format} from an image's leading bytes WITHOUT decoding
 * the pixel buffer. This is the bomb-safe metadata source for the imagescript
 * adapter (which has no header-only reader — its only option is a full
 * `Image.decode()` that would allocate the entire pixel buffer and OOM on the
 * 50000x50000 decompression-bomb fixture, defeating layer (c) of the bomb
 * defense). PNG/JPEG/GIF/WebP magic + dimension fields are parsed directly.
 *
 * Used by:
 * - ImagescriptImageTransform.metadata() — the canonical bomb-safe dim reader.
 *
 * Unknown/unsupported magic → throws `unsupported_image` (structured).
 */

export interface ParsedImageHeader {
  width: number;
  height: number;
  format: "png" | "jpeg" | "gif" | "webp";
}

/**
 * Parse image dimensions + format from header bytes only. Never decodes pixels.
 * @throws Error("unsupported_image") when the magic bytes are unrecognized or
 *         the header is too short / malformed.
 */
export function parseImageHeader(input: Uint8Array): ParsedImageHeader {
  const b = input;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk. Width/height are big-endian
  // 32-bit ints at byte offsets 16 and 20.
  if (
    b.length >= 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = dv.getUint32(16, false);
    const height = dv.getUint32(20, false);
    return { width, height, format: "png" };
  }

  // GIF: "GIF87a" / "GIF89a". Logical-screen width/height are little-endian
  // 16-bit ints at byte offsets 6 and 8.
  if (
    b.length >= 10 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = dv.getUint16(6, true);
    const height = dv.getUint16(8, true);
    return { width, height, format: "gif" };
  }

  // WebP: "RIFF" .... "WEBP" then a chunk fourCC (VP8 / VP8L / VP8X).
  if (
    b.length >= 30 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return parseWebpDimensions(b);
  }

  // JPEG: SOI marker FF D8, then scan segments for a Start-Of-Frame (SOFn).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    return parseJpegDimensions(b);
  }

  throw new Error("unsupported_image");
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpegDimensions(b: Uint8Array): ParsedImageHeader {
  // Walk marker segments starting after the SOI (offset 2). Each marker is
  // 0xFF followed by a type byte; non-standalone markers carry a 2-byte length.
  let offset = 2;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (offset + 4 < b.length) {
    if (b[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = b[offset + 1];
    // Padding (FF FF) and standalone markers (RSTn, SOI, EOI, TEM) have no
    // length field — skip the marker byte and continue.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLength = dv.getUint16(offset + 2, false);
    if (SOF_MARKERS.has(marker)) {
      // SOFn payload: precision(1) height(2) width(2)
      const height = dv.getUint16(offset + 5, false);
      const width = dv.getUint16(offset + 7, false);
      return { width, height, format: "jpeg" };
    }
    offset += 2 + segLength;
  }
  throw new Error("unsupported_image");
}

function parseWebpDimensions(b: Uint8Array): ParsedImageHeader {
  const fourCC = String.fromCharCode(b[12], b[13], b[14], b[15]);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  if (fourCC === "VP8 ") {
    // Lossy: width/height are 14-bit little-endian at offset 26/28.
    const width = dv.getUint16(26, true) & 0x3fff;
    const height = dv.getUint16(28, true) & 0x3fff;
    return { width, height, format: "webp" };
  }
  if (fourCC === "VP8L") {
    // Lossless: 14-bit dims packed into 4 bytes starting at offset 21.
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, format: "webp" };
  }
  if (fourCC === "VP8X") {
    // Extended: 24-bit (canvas-1) dims little-endian at offset 24/27.
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height, format: "webp" };
  }
  throw new Error("unsupported_image");
}
