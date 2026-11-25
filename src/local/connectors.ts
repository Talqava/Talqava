// Connectors (MCP servers), reached from this machine. The app is the MCP
// client, so a connector's tools work with every model, not only Claude.
// A connector is either a web address (Streamable HTTP, with the older SSE
// transport as a fallback) or a program on this computer (stdio).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BRAND, clip } from "../core/index.ts";
import type { McpServer, Tool } from "../core/index.ts";

interface Connection {
  key: string;
  client: Client;
  tools: Tool[];
  listedAt: number;
}

const LIST_FOR_MS = 60_000;
/** A connector that does not answer in this time is skipped, so it cannot hold up a run. */
const CONNECT_MS = 10_000;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} seconds.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
const connections = new Map<string, Connection>();

/** A connector's tools are named "<connector>__<tool>", kept to what every model accepts. */
export function toolName(server: string, tool: string): string {
  return `${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

const keyOf = (server: McpServer) => JSON.stringify([server.name, server.url, server.command, server.args, Boolean(server.token)]);

/** Connects over one transport; on failure, closes everything it opened so nothing is left running. */
async function attach(transport: { close(): Promise<void> }): Promise<Client> {
  const client = new Client({ name: BRAND.slug, version: "0.1.0" });
  try {
    await client.connect(transport as never);
    return client;
  } catch (err) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    throw err;
  }
}

async function connect(server: McpServer): Promise<Client> {
  if (server.command) {
    // A program on this computer. It gets a plain environment, not the app's keys.
    const env: Record<string, string> = {};
    for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "LANG"]) {
      if (process.env[name]) env[name] = process.env[name]!;
    }
    return attach(new StdioClientTransport({ command: server.command, args: server.args ?? [], env, stderr: "ignore" }));
  }
  if (!server.url) throw new Error(`Connector ${server.name} has no address or program.`);
  const url = new URL(server.url);
  const requestInit = server.token ? { headers: { authorization: `Bearer ${server.token}` } } : undefined;
  try {
    return await attach(new StreamableHTTPClientTransport(url, { requestInit }));
  } catch (first) {
    // Older servers speak SSE only.
    try {
      return await attach(new SSEClientTransport(url, { requestInit }));
    } catch {
      throw first;
    }
  }
}

/** What a tool call returned, as text the model can read. */
function resultText(result: { content?: unknown; structuredContent?: unknown }): string {
  const parts = Array.isArray(result.content) ? (result.content as { type: string; text?: string; resource?: { text?: string; uri?: string } }[]) : [];
  const text = parts
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "resource") return part.resource?.text ?? `[resource ${part.resource?.uri ?? ""}]`;
      if (part.type === "image") return "[an image was returned]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  return result.structuredContent ? JSON.stringify(result.structuredContent, null, 2) : "(no content)";
}

async function open(server: McpServer): Promise<Connection> {
  const key = keyOf(server);
  const existing = connections.get(server.name);
  if (existing && existing.key === key && Date.now() - existing.listedAt < LIST_FOR_MS) return existing;
  let client = existing?.key === key ? existing.client : null;
  if (!client) {
    await existing?.client.close().catch(() => {});
    client = await connect(server);
  }
  const listed = await client.listTools();
  const conn: Connection = { key, client, listedAt: Date.now(), tools: [] };
  conn.tools = listed.tools.map((tool) => {
    const schema = (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
    const description = `${tool.description ?? tool.name} (from the ${server.name} connector)`;
    const name = toolName(server.name, tool.name);
    const readOnly = Boolean(tool.annotations?.readOnlyHint);
    return {
      name,
      definition: { name, description, input_schema: schema as never },
      portable: { description, parameters: schema },
      validate: (input) => (input && typeof input === "object" && !Array.isArray(input) ? null : "input is not an object"),
      // A connector can change things elsewhere, so its tools ask first unless it says they only read.
      needsApproval: () => !readOnly,
      async run(input, { signal }) {
        const result = await client!.callTool({ name: tool.name, arguments: input as Record<string, unknown> }, undefined, { signal, timeout: 120_000 });
        const text = clip(resultText(result as never));
        if (result.isError) throw new Error(text);
        return text;
      },
    } satisfies Tool;
  });
  connections.set(server.name, conn);
  return conn;
}

/**
 * The tools of every connector that answers. A connector that cannot be
 * reached is reported in `problems` instead of stopping the run.
 */
export async function connectorTools(servers: McpServer[]): Promise<{ tools: Tool[]; problems: string[] }> {
  const tools: Tool[] = [];
  const problems: string[] = [];
  await Promise.all(
    servers.map(async (server) => {
      try {
        tools.push(...(await within(open(server), CONNECT_MS, `Connector ${server.name}`)).tools);
      } catch (err) {
        connections.delete(server.name);
        problems.push(`${server.name}: ${(err as Error).message}`);
      }
    }),
  );
  return { tools, problems };
}

/** Closes every connection, e.g. when settings change or the app stops. */
export async function closeConnectors() {
  await Promise.all([...connections.values()].map((c) => c.client.close().catch(() => {})));
  connections.clear();
}

/**
 * Checks a connector before it is saved: connects, lists its tools, and closes again. Says how many tools it has and
 * how many of them only read.
 */
export async function probeConnector(server: McpServer): Promise<{ tools: number; readOnly: number }> {
  const client = await within(connect(server), CONNECT_MS, `Connector ${server.name}`);
  try {
    const listed = await within(client.listTools(), CONNECT_MS, `Connector ${server.name}`);
    return { tools: listed.tools.length, readOnly: listed.tools.filter((t) => t.annotations?.readOnlyHint).length };
  } finally {
    await client.close().catch(() => {});
  }
}
