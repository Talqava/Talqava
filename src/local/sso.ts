// Single sign-on: people sign in through the company's identity provider (Microsoft Entra ID, Google Workspace,
// Okta and any other that speaks OpenID Connect). Talqava sends the person to the provider, the provider sends
// them back with a signed statement of who they are, and Talqava checks that statement (its signature, who issued
// it, who it is for, that it is fresh) before starting a session for the person with that email address.
import crypto from "node:crypto";
import { getConfig, saveConfig } from "./store.ts";
import { ROLES } from "./people.ts";
import type { Role } from "./people.ts";

export interface SsoSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Only people whose email ends in one of these domains may sign in. Empty means any the provider vouches for. */
  domains: string[];
  /** Whether someone who signs in for the first time gets an account (with the role below), or must be added first. */
  addPeople: boolean;
  role: Role;
  /** Passwords are switched off for everyone but the owner, whose password stays as the emergency way in. */
  only: boolean;
}

export const sso = (): SsoSettings | null => {
  const s = getConfig().sso;
  return s?.issuer && s.clientId ? { issuer: s.issuer, clientId: s.clientId, clientSecret: s.clientSecret ?? "", domains: s.domains ?? [], addPeople: s.addPeople === true, role: ROLES.includes(s.role as Role) && s.role !== "owner" ? (s.role as Role) : "member", only: s.only === true } : null;
};
/** The settings without the secret, for the page. */
export const ssoPublic = () => ((s) => (s ? { ...s, clientSecret: undefined, hasSecret: Boolean(s.clientSecret) } : null))(sso());

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
const found = new Map<string, { at: number; doc: Discovery }>();
const cleanIssuer = (text: unknown) => String(text ?? "").trim().replace(/\/+$/, "");
const httpsOrLocal = (address: string) => {
  const u = new URL(address);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) throw new Error("The provider's address must start with https://.");
  return u;
};

/** The provider's own description of itself: where to send people, where to exchange the code, where its keys are. */
export async function discover(issuer: string): Promise<Discovery> {
  const hit = found.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit.doc;
  httpsOrLocal(issuer);
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new Error("That address did not answer as an identity provider. Check the issuer address your provider gives you.");
  const doc = (await res.json()) as Discovery;
  if (cleanIssuer(doc.issuer) !== issuer) throw new Error("The provider says its issuer address is different from the one you gave. Copy it exactly.");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) httpsOrLocal(String(doc[key]));
  found.set(issuer, { at: Date.now(), doc });
  return doc;
}

/** Saves the settings after checking the provider answers. An empty issuer turns single sign-on off. */
export async function setSso(input: Record<string, unknown> | null): Promise<ReturnType<typeof ssoPublic>> {
  const issuer = cleanIssuer(input?.issuer);
  if (!input || !issuer) {
    saveConfig({ sso: undefined });
    return null;
  }
  const before = sso();
  const clientId = String(input.clientId ?? "").trim().slice(0, 300);
  if (!clientId) throw new Error("Give the client ID your provider shows for Talqava.");
  await discover(issuer);
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : String(input.domains ?? "").split(/[\s,]+/)).map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 50);
  saveConfig({
    sso: {
      issuer,
      clientId,
      clientSecret: input.clientSecret ? String(input.clientSecret).slice(0, 500) : (before?.clientSecret ?? ""),
      domains,
      addPeople: input.addPeople === true,
      role: ROLES.includes(input.role as Role) && input.role !== "owner" ? (input.role as Role) : "member",
      only: input.only === true,
    },
  });
  return ssoPublic();
}

// ---------- the sign-in itself ----------
const pending = new Map<string, { nonce: string; verifier: string; redirect: string; at: number }>();
const b64 = (buf: Buffer) => buf.toString("base64url");

/** Where to send the person's browser to sign in. `redirect` is this app's own address for the way back. */
export async function startSso(redirect: string): Promise<string> {
  const s = sso();
  if (!s) throw new Error("Single sign-on is not set up.");
  const doc = await discover(s.issuer);
  for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
  const state = b64(crypto.randomBytes(24));
  const nonce = b64(crypto.randomBytes(24));
  const verifier = b64(crypto.randomBytes(32));
  pending.set(state, { nonce, verifier, redirect, at: Date.now() });
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: "code", client_id: s.clientId, redirect_uri: redirect, scope: "openid email profile", state, nonce, code_challenge: b64(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" }).toString();
  return u.href;
}

/** Checks a signed statement (an ID token) from the provider and returns what it says. Throws when anything is off. */
export async function checkIdToken(token: string, s: SsoSettings, nonce: string, now = Date.now()): Promise<{ email: string; name: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("The provider's answer could not be read.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as { alg?: string; kid?: string };
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
  if (header.alg !== "RS256" && header.alg !== "ES256") throw new Error("The provider signed its answer in a way Talqava does not accept.");
  const doc = await discover(s.issuer);
  const keys = ((await (await fetch(doc.jwks_uri, { signal: AbortSignal.timeout(15_000) })).json()) as { keys: ({ kid?: string } & Record<string, unknown>)[] }).keys;
  const jwk = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new Error("The provider's answer was signed with a key it does not publish.");
  const key = crypto.createPublicKey({ key: jwk as never, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const ok = header.alg === "RS256" ? crypto.verify("RSA-SHA256", signed, key, signature) : crypto.verify("SHA256", signed, { key, dsaEncoding: "ieee-p1363" }, signature);
  if (!ok) throw new Error("The provider's answer did not pass its signature check.");
  if (cleanIssuer(claims.iss) !== s.issuer) throw new Error("The answer came from a different provider.");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(s.clientId)) throw new Error("The answer was made for a different app.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - 60_000) throw new Error("The answer is out of date. Sign in again.");
  if (claims.nonce !== nonce) throw new Error("The answer does not belong to this sign-in. Start again.");
  const email = String(claims.email ?? claims.preferred_username ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The provider did not say what your email address is. Ask your administrator to let Talqava read it.");
  if (claims.email_verified === false) throw new Error("Your provider has not confirmed your email address yet.");
  if (s.domains.length && !s.domains.includes(email.split("@")[1])) throw new Error("Your email address is not at one of the domains this organization allows.");
  return { email, name: String(claims.name ?? "").trim().slice(0, 80) || email.split("@")[0] };
}

/** Finishes a sign-in the provider sent back: exchanges the code and returns who the provider says the person is. */
export async function finishSso(code: unknown, state: unknown): Promise<{ email: string; name: string }> {
  const s = sso();
  const waiting = pending.get(String(state ?? ""));
  pending.delete(String(state ?? ""));
  if (!s || !waiting || Date.now() - waiting.at > 600_000) throw new Error("That sign-in took too long or was started somewhere else. Start again.");
  if (!code) throw new Error("The provider did not complete the sign-in.");
  const doc = await discover(s.issuer);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(code), redirect_uri: waiting.redirect, client_id: s.clientId, ...(s.clientSecret ? { client_secret: s.clientSecret } : {}), code_verifier: waiting.verifier }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => ({}))) as { id_token?: string; error_description?: string; error?: string } | undefined;
  if (!res?.ok || !data?.id_token) throw new Error(`The provider refused the sign-in${data?.error_description || data?.error ? `: ${String(data.error_description ?? data.error).slice(0, 200)}` : "."}`);
  return checkIdToken(data.id_token, s, waiting.nonce);
}
