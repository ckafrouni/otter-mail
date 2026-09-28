/**
 * Bytes, text and base64 without Node's Buffer, so core runs in a browser
 * too. Gmail speaks base64url; everything here accepts either alphabet.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8Encode = (text: string): Uint8Array => encoder.encode(text);
export const utf8Decode = (bytes: Uint8Array): string => decoder.decode(bytes);

export function fromBase64(base64: string): Uint8Array {
  const standard = base64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export const toBase64Url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomHex(byteCount: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}
