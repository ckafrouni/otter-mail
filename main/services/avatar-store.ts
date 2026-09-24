/**
 * Sender avatars. Gmail exposes no sender photos, so this resolves them from
 * side channels, best first:
 *   1. Google People API (contacts + "other contacts") — real profile photos
 *   2. Gravatar
 *   3. The sender domain's favicon/logo (Google s2, then DuckDuckGo icons;
 *      tried for the exact domain and its registrable root, skipped for
 *      free-mail domains)
 * Results — including misses — are cached in the mail store's kv table so each
 * sender costs at most one network cascade per TTL window.
 */

import { createHash } from "node:crypto";
import { logger } from "@glaze/core/backend";
import { getAccessToken } from "./gmail-oauth.js";
import { getKv, setKv } from "./mail-store.js";

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // found photos: refresh monthly
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // misses: retry weekly
const MAX_IMAGE_BYTES = 300 * 1024;
const FETCH_TIMEOUT_MS = 6_000;

/** Domains where a "company logo" would be wrong for a personal sender. */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "aol.com",
  "mail.com",
  "zoho.com",
  "hey.com",
  "fastmail.com",
  "t-online.de",
  "orange.fr",
  "free.fr",
]);

type CacheEntry = { dataUrl: string | null; fetchedAt: number };

const inFlight = new Map<string, Promise<string | null>>();

// v2: bumped when the source cascade changes so stale misses re-resolve.
function cacheKey(email: string): string {
  return `avatar2:${email}`;
}

type FetchInit = { headers?: Record<string, string> };

async function fetchWithTimeout(url: string, init?: FetchInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** Downloads an image and returns it as a data URL (null on miss/oversize/non-image). */
async function fetchImageAsDataUrl(url: string, init?: FetchInit): Promise<string | null> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return `data:${contentType.split(";")[0]};base64,${bytes.toString("base64")}`;
}

type PeoplePerson = {
  photos?: { url?: string; default?: boolean }[];
  emailAddresses?: { value?: string }[];
};

function photoFromPeopleResults(
  results: { person?: PeoplePerson }[],
  email: string,
): string | null {
  for (const result of results) {
    const person = result.person;
    if (!person) continue;
    const matches = (person.emailAddresses ?? []).some((e) => e.value?.toLowerCase() === email);
    if (!matches) continue;
    const photo = (person.photos ?? []).find((p) => p.url && !p.default);
    if (photo?.url) return photo.url;
  }
  return null;
}

/** Real contact photos via the People API (needs the contacts scopes). */
async function fromPeopleApi(accountId: string, email: string): Promise<string | null> {
  const token = await getAccessToken(accountId);
  const headers = { Authorization: `Bearer ${token}` };
  const query = encodeURIComponent(email);
  const readMask = "readMask=photos,emailAddresses";
  const endpoints = [
    `https://people.googleapis.com/v1/people:searchContacts?query=${query}&${readMask}`,
    `https://people.googleapis.com/v1/otherContacts:search?query=${query}&${readMask}`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpoint, { headers });
    // 403 = token predates the contacts scopes; skip the People source quietly.
    if (!response.ok) continue;
    const body = (await response.json()) as { results?: { person?: PeoplePerson }[] };
    const photoUrl = photoFromPeopleResults(body.results ?? [], email);
    if (photoUrl) {
      // lh3 photo URLs accept a size suffix.
      const sized = photoUrl.includes("=") ? photoUrl : `${photoUrl}=s128`;
      const dataUrl = await fetchImageAsDataUrl(sized);
      if (dataUrl) return dataUrl;
    }
  }
  return null;
}

async function fromGravatar(email: string): Promise<string | null> {
  const hash = createHash("sha256").update(email).digest("hex");
  return fetchImageAsDataUrl(`https://www.gravatar.com/avatar/${hash}?s=128&d=404`);
}

/** Width of a PNG from its IHDR chunk (0 when not parseable). */
function pngWidth(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return 0;
  return bytes.readUInt32BE(16);
}

/** "notify.cloudflare.com" → "cloudflare.com" (naive eTLD+1). */
function registrableDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);
  const take = secondLevel.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join(".");
}

async function domainLogoFor(domain: string): Promise<string | null> {
  // Google's favicon service answers for nearly every domain but substitutes a
  // 16×16 globe for misses — only a ≥32px answer is a real hit.
  const s2 = await fetchImageAsDataUrl(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  );
  if (s2 && pngWidth(s2) >= 32) return s2;
  // DuckDuckGo 404s cleanly on misses and often carries icons s2 lacks.
  return fetchImageAsDataUrl(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
}

async function fromDomainLogo(email: string): Promise<string | null> {
  const domain = email.split("@")[1];
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return null;
  const exact = await domainLogoFor(domain);
  if (exact) return exact;
  // Corporate mail often comes from subdomains (notify.cloudflare.com).
  const root = registrableDomain(domain);
  if (root !== domain && !FREEMAIL_DOMAINS.has(root)) return domainLogoFor(root);
  return null;
}

async function resolveAvatar(accountId: string, email: string): Promise<string | null> {
  const sources: (() => Promise<string | null>)[] = [
    () => fromPeopleApi(accountId, email),
    () => fromGravatar(email),
    () => fromDomainLogo(email),
  ];
  for (const source of sources) {
    try {
      const dataUrl = await source();
      if (dataUrl) return dataUrl;
    } catch {
      // network hiccup or missing scope — fall through to the next source
    }
  }
  return null;
}

/** Cached sender avatar as a data URL, or null (renderer falls back to initials). */
export async function getSenderAvatar(accountId: string, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;

  const cached = getKv(cacheKey(normalized));
  if (cached) {
    try {
      const entry = JSON.parse(cached) as CacheEntry;
      const ttl = entry.dataUrl ? HIT_TTL_MS : MISS_TTL_MS;
      if (Date.now() - entry.fetchedAt < ttl) return entry.dataUrl;
    } catch {
      // corrupt entry — refetch
    }
  }

  const pending = inFlight.get(normalized);
  if (pending) return pending;

  const promise = (async () => {
    const dataUrl = await resolveAvatar(accountId, normalized);
    const entry: CacheEntry = { dataUrl, fetchedAt: Date.now() };
    setKv(cacheKey(normalized), JSON.stringify(entry));
    logger.debug("avatar-store", "resolved sender avatar", {
      email: normalized,
      hit: dataUrl != null,
    });
    return dataUrl;
  })().finally(() => {
    inFlight.delete(normalized);
  });
  inFlight.set(normalized, promise);
  return promise;
}
