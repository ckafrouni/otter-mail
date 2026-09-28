import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { InvalidTokenError, verifyGoogleJwt } from "./google-jwt.ts";

const AUDIENCE = "client.apps.googleusercontent.com";

let google: CryptoKey;
let forger: CryptoKey;
let keys: JWTVerifyGetKey;

const claims = {
  iss: "https://accounts.google.com",
  aud: AUDIENCE,
  sub: "1234",
  email: "Someone@Example.com",
  email_verified: true,
};

function sign(payload: Record<string, unknown>, key = google, expiresIn = "1h") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  google = pair.privateKey;
  forger = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1" }] });
});

describe("verifyGoogleJwt", () => {
  it("accepts a token Google signed for this audience, with the address lowercased", async () => {
    const verified = await verifyGoogleJwt(await sign(claims), AUDIENCE, keys);
    expect(verified.sub).toBe("1234");
    expect(verified.email).toBe("someone@example.com");
  });

  it("accepts the bare issuer Google also uses", async () => {
    const token = await sign({ ...claims, iss: "accounts.google.com" });
    await expect(verifyGoogleJwt(token, AUDIENCE, keys)).resolves.toBeTruthy();
  });

  it.each([
    ["another audience", { ...claims, aud: "someone-else" }],
    ["another issuer", { ...claims, iss: "https://evil.example" }],
    ["an unverified address", { ...claims, email_verified: false }],
    ["no address", { ...claims, email: undefined }],
  ])("rejects %s", async (_label, payload) => {
    await expect(verifyGoogleJwt(await sign(payload), AUDIENCE, keys)).rejects.toThrow(
      InvalidTokenError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await sign(claims, google, "-5m");
    await expect(verifyGoogleJwt(token, AUDIENCE, keys)).rejects.toThrow("ERR_JWT_EXPIRED");
  });

  it("rejects a signature from another key", async () => {
    const token = await sign(claims, forger);
    await expect(verifyGoogleJwt(token, AUDIENCE, keys)).rejects.toThrow(InvalidTokenError);
  });

  it("rejects malformed tokens", async () => {
    await expect(verifyGoogleJwt("a.b.c", AUDIENCE, keys)).rejects.toThrow(InvalidTokenError);
  });
});
