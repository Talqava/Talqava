// Checks a task before any agent starts on it, for things it cannot do without:
// a working model key, and a repository for work on code. These checks cost
// nothing (no model is asked), so a task that would only fail, or wander through
// a whole team looking for something that is not there, is caught at the door
// and the person is told what to set up.
import type { Bot } from "../core/index.ts";
import { apiKey, getConfig } from "./store.ts";
import { splitRef } from "./models.ts";

export interface Need {
  id: "model-key" | "repository" | "choose-repository";
  title: string;
  detail: string;
  /** Where the person fixes it. */
  fix: "settings" | "integrations-ai-models" | "integrations-git" | "integrations-openrouter" | "choose-repository";
  /** Whether the task could still be started without it (a model with no key cannot run at all). */
  canSkip: boolean;
}

// Words that say a task is about code or a repository. Kept to ones that rarely mean anything else.
const CODE_WORDS = /\b(repo|repos|repository|repositories|code ?base|source code|our code|the code|code review|review (?:the |our )?code|github|git|pull requests?|refactor\w*|stack ?trace|unit tests?|test suite|ci pipeline|\.tsx?|\.jsx?|\.py)\b/i;

/** Whether a task's words say it is about code. */
export const aboutCode = (text: string) => CODE_WORDS.test(text.replace(/\[This task is for your whole team[\s\S]*$/, ""));

/** What a task needs that is missing. Empty when it can start. */
export function needsFor({ bot, text, project }: { bot: Bot; text: string; project?: string | null }): Need[] {
  const cfg = getConfig();
  const needs: Need[] = [];

  // The model the agent runs on must be reachable with a key.
  const ref = bot.model ? (bot.model.includes("/") ? bot.model : `anthropic/${bot.model}`) : cfg.model;
  const { providerId } = splitRef(ref);
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) {
    needs.push({ id: "model-key", title: "Choose a model", detail: `${bot.name} is set to use "${ref}", which is not available. Connect its service under Connections → AI models, or choose another model.`, fix: "integrations-ai-models", canSkip: false });
  } else if (provider.kind === "anthropic" && !apiKey(cfg)) {
    needs.push({ id: "model-key", title: "Add your Anthropic key", detail: `${bot.name} runs on Claude, and no Anthropic key is saved, so the task would fail straight away. Connect Anthropic under Connections → AI models, or connect another AI service and choose one of its models.`, fix: "integrations-ai-models", canSkip: false });
  } else if (provider.id === "openrouter" && !provider.apiKey) {
    needs.push({ id: "model-key", title: "Connect OpenRouter", detail: `${bot.name} runs on an OpenRouter model, and OpenRouter is not connected.`, fix: "integrations-openrouter", canSkip: false });
  }

  // Work on code needs a repository to work on.
  if (!project && aboutCode(text)) {
    if (!cfg.projects.length) {
      needs.push({
        id: "repository",
        title: "Connect a repository",
        detail: "This task is about code, and no repository is connected, so the agents would have no code to look at. Connect one under Connections → Git first. Or start anyway, if the task does not need the code itself.",
        fix: "integrations-git",
        canSkip: true,
      });
    } else {
      needs.push({
        id: "choose-repository",
        title: "Choose the repository",
        detail: `This task is about code, and ${cfg.projects.length} repositories are connected. Choose the one it is about, so the agents work on the right code.`,
        fix: "choose-repository",
        canSkip: true,
      });
    }
  }
  return needs;
}
