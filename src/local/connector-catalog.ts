// The connector catalogue: well-known services that publish their own connector (an MCP server) and accept a key the
// owner pastes. Each entry says, before connecting, what its tools can read and what they can change, as the service's
// own documentation describes it, and where to make the key. Connecting checks the key with the service first.
//
// Only services whose official documentation was read are listed (November 2026). Services that sign in through the
// browser with an app registered by Talqava (Gmail, Google Calendar, Microsoft 365, QuickBooks, HubSpot and others)
// are not here yet: each needs Talqava to be registered with that company first.
import { getConfig, saveConfig } from "./store.ts";
import { closeConnectors, probeConnector } from "./connectors.ts";

export interface CatalogEntry {
  id: string;
  name: string;
  category: "Payments" | "Customer records" | "Customer support" | "Projects" | "Code";
  about: string;
  /** The connector's address, from the service's documentation. */
  url: string;
  reads: string;
  changes: string;
  /** Where the owner makes the key, in the service's own words. */
  keyHelp: string;
  docs: string;
  note?: string;
}

/** A service people ask for that cannot be offered yet, and plainly why. */
export interface ComingEntry {
  name: string;
  category: string;
  why: string;
}

const NEEDS_REGISTRATION = "Signing in needs Talqava to be registered with this company first. Until then, add it by hand if you have its connector address and a token.";

/** Listed so nobody has to wonder: these are known, and not possible yet. */
export const COMING: ComingEntry[] = [
  { name: "Dropbox and Box", category: "Email, calendar and files", why: NEEDS_REGISTRATION },
  { name: "QuickBooks", category: "Accounting", why: "QuickBooks' connector is open by invitation only for now." },
  { name: "Xero", category: "Accounting", why: NEEDS_REGISTRATION },
  { name: "HubSpot and Salesforce", category: "Customer records", why: NEEDS_REGISTRATION },
];

export const CATALOG: CatalogEntry[] = [
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments",
    about: "Payments, invoices and subscriptions in your Stripe account.",
    url: "https://mcp.stripe.com",
    reads: "Customers, payments, invoices, subscriptions and balances.",
    changes: "Creates and updates invoices, subscriptions and refunds. Stripe asks for a person's confirmation before refunds and moving money.",
    keyHelp: "In the Stripe Dashboard, create a restricted API key for an agent, with only the permissions you want it to have.",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "Customer records",
    about: "Your Airtable bases: customer lists, trackers and inventories.",
    url: "https://mcp.airtable.com/mcp",
    reads: "Bases, tables and records it is given access to, with search.",
    changes: "Creates and updates records, bases and interfaces.",
    keyHelp: "In Airtable, create a personal access token and choose which bases it may use.",
    docs: "https://support.airtable.com/docs/using-the-airtable-mcp-server",
  },
  {
    id: "monday",
    name: "monday.com",
    category: "Customer records",
    about: "Boards and items in your monday.com account.",
    url: "https://mcp.monday.com/mcp",
    reads: "What your account can see in monday.com.",
    changes: "What your account can change in monday.com. The connector's own tool list says exactly which.",
    keyHelp: "In monday.com, open Developers → My access tokens and copy your personal API token.",
    docs: "https://developer.monday.com/api-reference/docs/mcp-api-token",
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "Customer support",
    about: "Customer conversations and help articles in Intercom.",
    url: "https://mcp.intercom.com/mcp",
    reads: "Conversations, contacts and articles.",
    changes: "Writes help articles and internal notes only. It does not reply to customers.",
    keyHelp: "In Intercom's Developer Hub, create an access token for your workspace.",
    docs: "https://developers.intercom.com/docs/guides/mcp",
    note: "For workspaces hosted in the United States. For Europe, add it by hand with the address https://mcp.eu.intercom.com/mcp.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "Projects",
    about: "Issues and projects in Linear.",
    url: "https://mcp.linear.app/mcp",
    reads: "Issues, projects and comments.",
    changes: "Creates and updates issues, projects and comments.",
    keyHelp: "In Linear, open Settings → Security & access and create a personal API key.",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Code",
    about: "Issues, pull requests and code on GitHub, beyond the repositories connected under Git and GitHub.",
    url: "https://api.githubcopilot.com/mcp/",
    reads: "Repositories, issues and pull requests the token can see.",
    changes: "What the token allows: a read-only token changes nothing; a read and write token can open issues and pull requests.",
    keyHelp: "On GitHub, open Settings → Developer settings → Personal access tokens and create a fine-grained token with only the access you want.",
    docs: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server",
  },
];

/** The catalogue, with which entries are connected, and the services that cannot be offered yet. */
export function listCatalog() {
  const connected = new Set(getConfig().mcpServers.map((s) => s.name));
  return { connectors: CATALOG.map((e) => ({ ...e, connected: connected.has(e.id) })), coming: COMING };
}

/** A connector's name as people know it: "Stripe" for the catalogue's "stripe", otherwise the name it was given. */
export const connectorLabel = (name: string) => CATALOG.find((e) => e.id === name)?.name ?? name;

/** Disconnects a catalogue entry. Its key is forgotten. */
export async function disconnectCatalog(id: string) {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error("The catalogue has no such connector.");
  saveConfig({ mcpServers: getConfig().mcpServers.filter((s) => s.name !== entry.id) });
  await closeConnectors();
  return { ok: true };
}

/** Connects a catalogue entry: the key is checked with the service (its tools are listed) before anything is saved. */
export async function connectCatalog(id: string, key: unknown): Promise<{ tools: number; readOnly: number }> {
  const entry = CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error("The catalogue has no such connector.");
  const token = String(key ?? "").trim();
  if (!token) throw new Error(`Paste the key. ${entry.keyHelp}`);
  let found: { tools: number; readOnly: number };
  try {
    found = await probeConnector({ name: entry.id, url: entry.url, token });
  } catch (err) {
    const why = (err as Error).message || "";
    throw new Error(/401|403|unauthor|forbidden|invalid/i.test(why) ? `${entry.name} did not accept that key. ${entry.keyHelp}` : `${entry.name}'s connector could not be reached: ${why.slice(0, 200)}`);
  }
  const cfg = getConfig();
  saveConfig({ mcpServers: [...cfg.mcpServers.filter((s) => s.name !== entry.id), { name: entry.id, url: entry.url, token }] });
  await closeConnectors();
  return found;
}
