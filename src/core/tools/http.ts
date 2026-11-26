// HTTP calls with stored secrets. The model writes {{secret:NAME}}; the value
// is filled in here, outside its view, and only for the host the secret is tied to.
import { clip, defineTool } from "../tooling.ts";
import { webRules } from "./page.ts";
import type { MaybePromise, Secret, Tool } from "../types.ts";

type Secrets = Record<string, Secret>;
const PLACEHOLDER = /\{\{secret:([A-Za-z0-9_]+)\}\}/g;
// Cloud metadata addresses, which hand out credentials to anything that asks.
const BLOCKED_HOSTS = /^(169\.254\.|metadata\.google\.internal$|fd00:ec2::)/i;

export function fillSecrets(text: string, host: string, secrets: Secrets): string {
  return String(text).replace(PLACEHOLDER, (_, name: string) => {
    const secret = secrets[name];
    if (!secret) throw new Error(`No secret named ${name}. The user can add it under Settings.`);
    const allowed = secret.host.toLowerCase();
    if (host !== allowed && !host.endsWith(`.${allowed}`)) {
      throw new Error(`Secret ${name} may only be sent to ${secret.host}, not ${host}.`);
    }
    return secret.value;
  });
}

interface HttpInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export function httpTool(getSecrets: () => MaybePromise<Secrets>): Tool {
  return defineTool<HttpInput>({
    name: "http_request",
    description:
      "Call an HTTP API. To use a stored API key, write {{secret:NAME}} in the URL, a header value or the body; it is filled in outside your view and only for the host that secret is tied to. You never see secret values.",
    properties: {
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
      url: { type: "string" },
      headers: { type: "object", description: "Header names to values." },
      body: { type: "string", description: "Request body as text (JSON should be a JSON string)." },
    },
    required: ["method", "url"],
    needsApproval: (input) => !["GET", "HEAD"].includes(input.method),
    async run(input, { signal }) {
      const secrets = await getSecrets();
      // The host is fixed before any secret is filled in, so a secret cannot change where it is sent.
      const host = new URL(input.url.replace(PLACEHOLDER, "x")).hostname.toLowerCase();
      if (BLOCKED_HOSTS.test(host)) throw new Error(`Requests to ${host} are not allowed.`);
      const url = new URL(fillSecrets(input.url, host, secrets));
      if (url.hostname.toLowerCase() !== host) throw new Error("A secret may not change the host of the URL.");
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are supported.");

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.headers ?? {})) headers[key] = fillSecrets(value, host, secrets);
      const body = input.body === undefined ? undefined : fillSecrets(input.body, host, secrets);

      // Redirects are followed by hand, one hop at a time, so that a key bound to one host is never carried to
      // another, and so that an organization's approved sites hold for every hop, not only the first address.
      let target = url;
      let method = input.method;
      let sendHeaders: Record<string, string> = headers;
      let sendBody = ["GET", "HEAD"].includes(method) ? undefined : body;
      let response: Response;
      for (let hop = 0; ; hop++) {
        const at = target.hostname.toLowerCase();
        if (BLOCKED_HOSTS.test(at)) throw new Error(`Requests to ${at} are not allowed.`);
        if (webRules.allowed && !webRules.allowed(at)) throw new Error(`${at} is not one of the sites this organization approves, so the request was not sent${hop ? " (the first address redirected there)" : ""}.`);
        response = await fetch(target, { method, headers: sendHeaders, body: sendBody, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(60_000), signal]) });
        const location = response.headers.get("location");
        if (!(response.status >= 300 && response.status < 400 && location)) break;
        if (hop >= 5) throw new Error("Too many redirects.");
        const next = new URL(location, target);
        if (!["http:", "https:"].includes(next.protocol)) throw new Error("Only http and https URLs are supported.");
        if (next.origin !== target.origin) {
          // Another site: nothing that was meant for the first one goes along.
          sendHeaders = {};
          sendBody = undefined;
          method = "GET";
        } else if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          sendBody = undefined;
        }
        target = next;
      }
      let text = await response.text();
      for (const secret of Object.values(secrets)) {
        if (secret.value) text = text.split(secret.value).join("[secret]");
      }
      return `HTTP ${response.status} ${response.statusText}\ncontent-type: ${response.headers.get("content-type") || "unknown"}\n\n${clip(text, 20_000)}`;
    },
  });
}
