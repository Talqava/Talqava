// Optional real browser, used only if Playwright is installed (npm install playwright).
import { defineTool } from "../core/index.ts";
import type { Tool, ToolOutput } from "../core/index.ts";
import { webRules } from "../core/tools/page.ts";

// Loaded by name at run time so the app works without the package.
let playwright: any;
let page: any;

export async function browserAvailable(): Promise<boolean> {
  if (playwright === undefined) {
    try {
      const packageName = "playwright";
      playwright = await import(packageName);
    } catch {
      playwright = null;
    }
  }
  return Boolean(playwright);
}

async function getPage() {
  if (page && !page.isClosed()) return page;
  const browser = await playwright.chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  return page;
}

async function describe(p: any): Promise<string> {
  const text: string = await p.evaluate("document.body?.innerText || ''");
  return `${await p.title()}\n${p.url()}\n\n${text.slice(0, 15_000)}`;
}

// A target is a CSS selector if it matches something, otherwise visible text.
async function locate(p: any, target: string) {
  try {
    const bySelector = p.locator(target);
    if (await bySelector.count()) return bySelector.first();
  } catch {}
  return p.getByText(target, { exact: false }).first();
}

interface BrowserInput {
  action: "goto" | "read" | "click" | "type" | "screenshot";
  url?: string;
  target?: string;
  text?: string;
  submit?: boolean;
}

/**
 * Where an organization holds agents to approved sites, the browser is held to them wherever it ends up: a link, a
 * form or a redirect that leaves them is undone, and the agent is told.
 */
async function stayOnApproved(p: { url(): string; goto(url: string): Promise<unknown> }): Promise<void> {
  if (!webRules.allowed) return;
  let at: URL;
  try {
    at = new URL(p.url());
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(at.protocol) || webRules.allowed(at.hostname)) return;
  await p.goto("about:blank").catch(() => {});
  throw new Error(`${at.hostname} is not one of the sites this organization approves, so the browser left it. Stay on the approved sites.`);
}

async function act(input: BrowserInput): Promise<ToolOutput> {
  if (!(await browserAvailable())) throw new Error("The browser is not installed.");
  const p = await getPage();
  const out = await step(p, input);
  await stayOnApproved(p);
  return out;
}

async function step(p: Awaited<ReturnType<typeof getPage>>, input: BrowserInput): Promise<ToolOutput> {
  switch (input.action) {
    case "goto": {
      const url = new URL(input.url ?? "");
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https pages can be opened.");
      await p.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      return describe(p);
    }
    case "read":
      return describe(p);
    case "click":
      await (await locate(p, input.target ?? "")).click({ timeout: 15_000 });
      await p.waitForLoadState("domcontentloaded").catch(() => {});
      return describe(p);
    case "type": {
      const field = await locate(p, input.target ?? "");
      await field.fill(input.text ?? "", { timeout: 15_000 });
      if (input.submit) {
        await field.press("Enter");
        await p.waitForLoadState("domcontentloaded").catch(() => {});
      }
      return describe(p);
    }
    case "screenshot": {
      const data: string = (await p.screenshot({ type: "png" })).toString("base64");
      return [{ type: "image", source: { type: "base64", media_type: "image/png", data } }];
    }
    default:
      throw new Error(`Unknown browser action "${input.action}".`);
  }
}

export const browserTool: Tool = defineTool<BrowserInput>({
  name: "browser",
  description:
    "A real web browser for pages that need JavaScript, clicking or typing. For plain reading prefer web_fetch. goto opens a URL; read returns the visible text; click and type take a CSS selector or the visible text of the element; screenshot shows you the page.",
  properties: {
    action: { type: "string", enum: ["goto", "read", "click", "type", "screenshot"] },
    url: { type: "string" },
    target: { type: "string", description: "CSS selector, or the visible text of a link or button." },
    text: { type: "string", description: "For type: the text to enter." },
    submit: { type: "boolean", description: "For type: press Enter afterwards." },
  },
  required: ["action"],
  needsApproval: (input) => ["click", "type"].includes(input.action),
  run: (input) => act(input),
});
