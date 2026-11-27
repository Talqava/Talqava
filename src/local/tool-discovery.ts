// Tools for connected services, brought into reach only when they are needed. Each connected service adds several
// tools, and a connector can add dozens; sending every one of them with every request costs money on each step and
// makes a model more likely to pick the wrong one. So once there are many, they are left off the list and the agent
// is given one small tool, find_tools, to look them up by a few words. What it finds is added to the list and stays
// for the rest of that conversation.
//
// A tool that is found is the very same tool, under its own name: the owner's rules, approvals, guardrails and the
// activity log all see it exactly as before. Nothing can be called that was not connected and allowed already;
// this only decides what is listed.
//
// The idea is common to agent tools (PicoClaw calls it tool discovery); the code here is Talqava's own.
import type { Tool } from "../core/index.ts";

/** With this many service tools or fewer, they are all simply listed. */
export const DISCOVER_FROM = 20;
/** How many a single search brings into reach. */
const AT_ONCE = 8;

/** Tools found earlier in each conversation, so they are still there on its next turn. */
const found = new Map<string, Set<string>>();
/** Forgets what a conversation had found (when it is deleted). */
export const forgetFound = (conversation: string) => found.delete(conversation);

const wordsOf = (t: Tool) => `${t.name.replace(/[_-]+/g, " ")} ${t.portable?.description ?? (t.definition as { description?: string })?.description ?? ""}`.toLowerCase();
/** The service a tool belongs to, from its name (asana__list_tasks is Asana's). */
const serviceOf = (name: string) => (name.includes("__") ? name.split("__")[0] : name.split(/[_-]/)[0]);

/** The tools that fit a few words best, most fitting first. Every word that appears counts; a match in the name counts more. */
export function rank(query: string, tools: Tool[]): Tool[] {
  const asked = String(query ?? "").toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  if (!asked.length) return [];
  return tools
    .map((t) => {
      const name = t.name.toLowerCase();
      const text = wordsOf(t);
      const score = asked.reduce((sum, w) => sum + (name.includes(w) ? 3 : text.includes(w) ? 1 : 0), 0);
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
    .map((x) => x.t);
}

/**
 * The tools for one run. When the service tools are few, the list is returned as it is. When they are many, they
 * are held back (except those this conversation already found) and find_tools is added. The array returned is the
 * one the run keeps, so a tool found during the run is in reach on its very next step.
 */
export function withDiscovery(conversation: string, tools: Tool[]): { tools: Tool[]; note: string } {
  const service = tools.filter((t) => t.lazy);
  if (service.length <= DISCOVER_FROM) return { tools, note: "" };
  const mine = found.get(conversation) ?? new Set<string>();
  found.set(conversation, mine);
  const listed: Tool[] = tools.filter((t) => !t.lazy || mine.has(t.name));
  const services = [...new Set(service.map((t) => serviceOf(t.name)))].sort();
  const finder: Tool = {
    name: "find_tools",
    definition: { name: "find_tools", description: "Looks up tools for the connected services that are not listed yet, and brings the ones that fit into reach.", input_schema: { type: "object", properties: { query: { type: "string", description: "A few words: the service's name, or what you want to do." } }, required: ["query"] } } as Tool["definition"],
    portable: {
      description: `Looks up tools for the connected services (${services.join(", ")}) that are not listed yet, and brings the ones that fit into reach for the rest of this conversation. Give a few words: the service's name, or what you want to do, such as "asana tasks" or "send an invoice".`,
      parameters: { type: "object", properties: { query: { type: "string", description: "A few words: the service's name, or what you want to do." } }, required: ["query"] },
    },
    validate: (input) => (input && typeof input === "object" && typeof (input as { query?: unknown }).query === "string" && (input as { query: string }).query.trim() ? null : "say what to look for, in a few words"),
    needsApproval: () => false,
    run: (input: { query: string }) => {
      const hits = rank(input.query, service).slice(0, AT_ONCE);
      if (!hits.length) return `Nothing fits “${String(input.query).slice(0, 80)}”. The connected services are: ${services.join(", ")}. Try the name of one of them, or other words for what you want to do.`;
      for (const t of hits) {
        mine.add(t.name);
        if (!listed.includes(t)) listed.push(t);
      }
      return `Now in reach (use them as usual; the owner's approval rules apply as always):\n${hits.map((t) => `- ${t.name}: ${(t.portable?.description ?? "").replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}`;
    },
  };
  listed.push(finder);
  const note = `Tools for connected services: ${service.length} are connected (${services.join(", ")}) and ${service.length - (listed.length - 1 - tools.filter((t) => !t.lazy).length)} of them are not listed, to keep this short. When a task needs one, call find_tools with a few words (the service's name, or what you want to do) to bring the right ones into reach; they stay for the rest of this conversation. Do not guess a tool's name.`;
  return { tools: listed, note };
}
