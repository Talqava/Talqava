// Signing in to Google Cloud with a service account, for Vertex AI. Google's AI endpoints take no plain API key: an
// app signs a short note with the service account's private key, trades it at Google for an access token, and uses
// that token for up to an hour. This does that with Node's own cryptography, so nothing extra is installed. The
// service account file stays on this computer; only the signed note goes to Google.
import crypto from "node:crypto";

/** Where tokens come from. Tests point it at a stand-in. */
const tokenUrl = () => process.env.TALQAVA_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** The service account in a pasted or chosen key file, or a plain-words reason it isn't one. */
export function parseServiceAccount(text: unknown): ServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(String(text ?? "").trim());
  } catch {
    throw new Error("That is not a Google Cloud key file. Choose the .json file you downloaded for the service account.");
  }
  if (data.type !== "service_account" || typeof data.client_email !== "string" || typeof data.private_key !== "string" || typeof data.project_id !== "string") {
    throw new Error("That file is not a service account key. In Google Cloud, open IAM → Service accounts, choose the account, then Keys → Add key → JSON.");
  }
  return { project_id: data.project_id, client_email: data.client_email, private_key: data.private_key };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The signed note (a JWT) Google trades for a token. */
export function signedAssertion(account: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: tokenUrl(), iat: now, exp: now + 3600 }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), account.private_key);
  return `${head}.${body}.${b64url(signature)}`;
}

const tokens = new Map<string, { token: string; until: number }>();

/** An access token for this service account, kept until five minutes before it runs out. */
export async function accessToken(account: ServiceAccount): Promise<string> {
  const kept = tokens.get(account.client_email);
  if (kept && kept.until > Date.now() + 5 * 60_000) return kept.token;
  let r: Response;
  try {
    r = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(account) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach Google to sign in. Check the internet connection.");
  }
  const data = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !data.access_token) throw new Error(`Google did not accept the service account key${data.error_description ? `: ${data.error_description}` : ""}. It may have been deleted or disabled; make a new key and connect again.`);
  tokens.set(account.client_email, { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

/** For tests: forgets kept tokens. */
export function forgetTokens() {
  tokens.clear();
}
