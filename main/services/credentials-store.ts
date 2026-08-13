/**
 * credentials-store.ts
 *
 * Built-in Google OAuth Client ID + Secret, shared by every install of this
 * app so users don't need their own GCP project. Per RFC 8252, a distributed
 * desktop app's OAuth secret can't be kept confidential — PKCE plus the
 * user's own Google sign-in is the real security boundary, not this value.
 */

const CLIENT_ID = "701744856350-0uaum6pgdshhh5icam480iqs2e0jvlob.apps.googleusercontent.com";
const CLIENT_SECRET = "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";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getCredentials(): Promise<GoogleCredentials> {
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
}

export async function hasCredentials(): Promise<boolean> {
  return true;
}
