// The model check: a short, fixed test of what agents need from a model.
// Run when a model is connected; the result says which bot types it can power.
import { defineTool } from "../tooling.ts";
import type { ContentBlock, Message, Tool, ToolResult } from "../types.ts";
import type { Model } from "./types.ts";

export interface CheckResult {
  model: string;
  label: string;
  checkedAt: string;
  /** Follows a plain instruction exactly. */
  instructions: boolean;
  /** Calls a tool with the right input and uses the result. */
  tools: boolean;
  /** Chains several tool calls, using one result to make the next call. */
  multiStep: boolean;
  /** Bot types this model is recommended for. */
  recommended: string[];
  notes: string[];
}

const ALL_TYPES = ["Scout", "Scribe", "Maker", "Keeper", "Counter", "Spark"];
const LIGHT_TYPES = ["Scout", "Scribe", "Keeper", "Spark"];

interface MiniRun {
  calls: { name: string; input: any }[];
  text: string;
}

/** A tiny agent loop, separate from the engine so a check never touches real tools or files. */
async function miniRun(model: Model, system: string, prompt: string, tools: Tool[], signal: AbortSignal, maxSteps = 6): Promise<MiniRun> {
  const messages: Message[] = [{ role: "user", content: prompt }];
  const calls: MiniRun["calls"] = [];
  let text = "";
  const quiet = { onText() {}, onThinking() {}, onToolStart() {} };
  for (let step = 0; step < maxSteps; step++) {
    const reply = await model.call({ system, messages, tools, hostedTools: [], mcpServers: [], signal }, quiet);
    messages.push({ role: "assistant", content: reply.content });
    const uses = reply.content.filter((block: ContentBlock) => block.type === "tool_use") as unknown as { id: string; name: string; input: any }[];
    text = reply.content
      .filter((block: ContentBlock) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("");
    if (!uses.length) break;
    const results: ToolResult[] = [];
    for (const use of uses) {
      calls.push({ name: use.name, input: use.input });
      const tool = tools.find((t) => t.name === use.name);
      const problem = tool ? tool.validate(use.input) : `unknown tool ${use.name}`;
      const content = problem ? `Error: ${problem}` : String(await tool!.run(use.input, { signal, conversation: {} as never }));
      results.push({ type: "tool_result", tool_use_id: use.id, content, ...(problem ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { calls, text };
}

const addTool = defineTool<{ a: number; b: number }>({
  name: "add",
  description: "Adds two numbers and returns the sum.",
  properties: { a: { type: "number" }, b: { type: "number" } },
  required: ["a", "b"],
  run: (input) => String(Number(input.a) + Number(input.b)),
});

const FACTS: Record<string, string> = { "capital of zorbia": "Quillon", "population of quillon": "84,312" };
const lookupTool = defineTool<{ key: string }>({
  name: "lookup",
  description: 'Looks up a fact in a reference book. Ask with a short key such as "capital of France" or "population of Paris".',
  properties: { key: { type: "string" } },
  required: ["key"],
  run: (input) => {
    const key = String(input.key).toLowerCase();
    const hit = Object.entries(FACTS).find(([k]) => key.includes(k));
    return hit ? hit[1] : "Not found. Try a shorter key.";
  },
});

export async function checkModel(model: Model, signal: AbortSignal = new AbortController().signal): Promise<CheckResult> {
  const notes: string[] = [];
  const attempt = async (label: string, test: () => Promise<boolean>) => {
    try {
      return await test();
    } catch (err) {
      notes.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const instructions = await attempt("Instructions", async () => {
    const run = await miniRun(model, "Reply with exactly the word READY and nothing else.", "Are you ready?", [], signal, 1);
    return run.text.trim().replace(/[.!"'`*]/g, "").toUpperCase() === "READY";
  });

  const tools = await attempt("Tools", async () => {
    const run = await miniRun(model, "You are a careful assistant. Use tools when asked.", "Use the add tool to add 17 and 25. Then reply with only the result.", [addTool], signal);
    const used = run.calls.some((call) => call.name === "add" && [call.input?.a, call.input?.b].map(Number).sort().join() === "17,25");
    if (!used) notes.push("Tools: did not call the add tool with 17 and 25.");
    return used && run.text.includes("42");
  });

  const multiStep = await attempt("Multi-step", async () => {
    const run = await miniRun(
      model,
      "You are a careful assistant. Use tools when asked, one step at a time.",
      "Use the lookup tool to find the capital of Zorbia. Then use the lookup tool again to find the population of that city. Reply with only the population.",
      [lookupTool],
      signal,
    );
    const lookups = run.calls.filter((call) => call.name === "lookup").length;
    if (lookups < 2) notes.push("Multi-step: did not chain two lookups.");
    return lookups >= 2 && /84,?312/.test(run.text);
  });

  const recommended = tools && multiStep && instructions ? ALL_TYPES : tools && instructions ? LIGHT_TYPES : ["Spark"];
  return { model: model.ref, label: model.label, checkedAt: new Date().toISOString(), instructions, tools, multiStep, recommended, notes };
}
