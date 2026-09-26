/**
 * Reading Gmail's message payloads and writing outgoing RFC 822 mail. Ported
 * from the desktop's gmail-api.ts, with Buffer swapped for lib/encoding.
 */

import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  utf8Decode,
  utf8Encode,
} from "../lib/encoding";

export type Header = { name: string; value: string };

export type MimePart = {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
};

export type Attachment = { id: string; filename: string; mimeType: string; size: number };

export function getHeader(headers: Header[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

export function parseAddress(value: string): { name: string; email: string } {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1]!.trim().replace(/^"|"$/g, ""), email: match[2]!.trim() };
  return { name: value, email: value };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Gmail's snippets are HTML-escaped ("Don&#39;t"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
    const code =
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

/** The text and HTML bodies and the attachments of a `format=full` payload. */
export function readPayload(payload: MimePart | undefined): {
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: Attachment[];
} {
  const result = {
    bodyHtml: null as string | null,
    bodyText: null as string | null,
    attachments: [] as Attachment[],
  };
  const walk = (part: MimePart) => {
    const mimeType = part.mimeType ?? "";
    if (part.filename && part.body?.attachmentId) {
      result.attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType,
        size: part.body.size ?? 0,
      });
      return;
    }
    const data = part.body?.data;
    if (mimeType === "text/html" && result.bodyHtml === null && data) {
      result.bodyHtml = utf8Decode(base64Decode(data));
    } else if (mimeType === "text/plain" && result.bodyText === null && data) {
      result.bodyText = utf8Decode(base64Decode(data));
    }
    part.parts?.forEach(walk);
  };
  if (payload) walk(payload);
  return result;
}

// ── Outgoing mail ────────────────────────────────────────────────────────────

const CRLF = "\r\n";

const isPrintableAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

/**
 * RFC 2047 B-encoded word(s), chunked by code point so UTF-8 byte sequences
 * never split across words; continuation words are folded onto new lines.
 */
function encodeWords(value: string): string {
  const MAX_BYTES = 45; // "=?UTF-8?B?" + base64(45B → 60ch) + "?=" = 72 chars ≤ 75
  const chunks: string[] = [];
  let current = "";
  for (const ch of value) {
    if (current && utf8Encode(current + ch).length > MAX_BYTES) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => `=?UTF-8?B?${base64Encode(utf8Encode(c))}?=`).join(`${CRLF} `);
}

const encodeHeaderValue = (value: string) => (isPrintableAscii(value) ? value : encodeWords(value));

export function formatAddress(name: string, email: string): string {
  if (!name || name === email) return email;
  if (!isPrintableAscii(name)) return `${encodeWords(name)} <${email}>`;
  if (/[^A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~.]/.test(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  }
  return `${name} <${email}>`;
}

/**
 * Split a typed address list on commas outside double quotes. CR/LF collapse
 * to spaces: a raw newline would end the header line mid-value (injection).
 */
export function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.replace(/[\r\n]+/g, " ").trim()).filter((p) => p.length > 0);
}

function encodeAddressList(value: string): string {
  return splitAddressList(value)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/);
      if (!match) return entry;
      const name = match[1]!.trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
      return formatAddress(name, match[2]!.trim());
    })
    .join(", ");
}

export type OutgoingMessage = {
  /** Already formatted, e.g. via formatAddress(). */
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
};

/** A plain-text message, base64url-encoded for Gmail's `raw` field. */
export function buildRawMessage(message: OutgoingMessage): string {
  const headers = [`From: ${message.from}`];
  if (message.to) headers.push(`To: ${encodeAddressList(message.to)}`);
  if (message.cc) headers.push(`Cc: ${encodeAddressList(message.cc)}`);
  headers.push(`Subject: ${encodeHeaderValue(message.subject)}`);
  if (message.inReplyTo) headers.push(`In-Reply-To: ${message.inReplyTo}`);
  if (message.references) {
    // One message id per folded line keeps long reply chains within line limits.
    headers.push(`References: ${message.references.split(/\s+/).filter(Boolean).join(`${CRLF} `)}`);
  }
  headers.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  );
  const body =
    base64Encode(utf8Encode(message.body))
      .match(/.{1,76}/g)
      ?.join(CRLF) ?? "";
  return base64UrlEncode(utf8Encode([...headers, "", body].join(CRLF)));
}
