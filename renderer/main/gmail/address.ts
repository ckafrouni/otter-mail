/**
 * Lightweight RFC 5322-ish address-list helpers for compose fields
 * (comma-separated "Name <email>" / bare-email entries).
 */

export type ParsedAddress = { name: string; email: string };

/** Split an address list on commas outside double quotes. */
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
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function parseAddressEntry(entry: string): ParsedAddress {
  const trimmed = entry.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: "", email: trimmed };
}

export function formatAddressEntry(name: string, email: string): string {
  if (!name || name === email) return email;
  if (/[",<>;\\]/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  return `${name} <${email}>`;
}
