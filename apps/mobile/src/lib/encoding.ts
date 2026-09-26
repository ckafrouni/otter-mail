/**
 * UTF-8 and base64 without Node's Buffer, which React Native doesn't have.
 * Gmail sends message bodies as base64url and takes outgoing mail the same way.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((ch, index) => [ch, index]));

export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000)
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i]!;
    const size = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    let code = size === 1 ? byte : byte & (0xff >> (size + 1));
    for (let k = 1; k < size; k++) code = (code << 6) | ((bytes[i + k] ?? 0) & 63);
    // A stray continuation byte (not UTF-8 after all) reads as U+FFFD.
    out += String.fromCodePoint(byte >= 0x80 && byte < 0xc0 ? 0xfffd : code);
    i += size;
  }
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : ALPHABET[c & 63];
  }
  return out;
}

/** Decodes standard or url-safe base64, padded or not. */
export function base64Decode(text: string): Uint8Array {
  const clean = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => LOOKUP.get(clean[i + k] ?? ""));
    if (a === undefined || b === undefined) break;
    bytes.push((a << 2) | (b >> 4));
    if (c !== undefined) bytes.push(((b & 15) << 4) | (c >> 2));
    if (c !== undefined && d !== undefined) bytes.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(bytes);
}

export const base64UrlEncode = (bytes: Uint8Array) =>
  base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
