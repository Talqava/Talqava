// Helpers for defining tools and checking what Claude sends them.
import type { Tool, ToolContext, ToolOutput, MaybePromise } from "./types.ts";

export const MAX_OUTPUT = 30_000;

/** Shortens long output, keeping the start and the end. */
export function clip(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n\n[... ${text.length - max} characters left out ...]\n\n${text.slice(-half)}`;
}

interface Property {
  type: "string" | "boolean" | "object" | "number" | "array";
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
}

interface ToolSpec<Input> {
  name: string;
  description: string;
  properties: Record<string, Property>;
  required?: string[];
  needsApproval?(input: Input): boolean;
  run(input: Input, context: ToolContext): MaybePromise<ToolOutput>;
}

// Tool inputs stream in unvalidated, so check them against the schema before running.
export function checkInput(input: unknown, properties: Record<string, Property>, required: string[]): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input is not an object";
  const values = input as Record<string, unknown>;
  for (const key of required) if (values[key] === undefined) return `missing "${key}"`;
  for (const [key, value] of Object.entries(values)) {
    const spec = properties[key];
    if (!spec) continue;
    const type = Array.isArray(value) ? "array" : typeof value;
    if (type !== spec.type) return `"${key}" should be ${spec.type}`;
    if (spec.enum && !spec.enum.includes(value as string)) return `"${key}" must be one of ${spec.enum.join(", ")}`;
  }
  return null;
}

/** A tool of our own, described to Claude with a JSON schema. */
export function defineTool<Input = any>(spec: ToolSpec<Input>): Tool {
  const required = spec.required ?? [];
  return {
    name: spec.name,
    definition: {
      name: spec.name,
      description: spec.description,
      eager_input_streaming: true,
      input_schema: { type: "object", properties: spec.properties, required },
    },
    portable: { description: spec.description, parameters: { type: "object", properties: spec.properties, required } },
    validate: (input) => checkInput(input, spec.properties, required),
    needsApproval: (input) => spec.needsApproval?.(input) ?? false,
    run: spec.run,
  };
}
