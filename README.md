<p align="center">
  <img src="desktop/assets/icon.svg" width="88" height="88" alt="Talqava logo">
</p>

<h1 align="center">Talqava</h1>

<p align="center"><strong>Run your organization with AI agents.</strong><br>
An open-source operating layer for businesses, startups and operations, that sits on top of any AI model.</p>

<p align="center">
  <a href="https://talqava.com">Website</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://github.com/Talqava/Talqava/issues">Report a problem</a> ·
  <a href="LICENSE">MIT License</a>
</p>

![The Organization page: groups with leads, goals and budgets, built by the owner](docs/images/organization.png)

Talqava gives you a team of AI agents, each in a role on an org chart that **you** draw: who reports to whom, which group they belong to, what each group is for and what it may spend. You hand out work in plain words; agents split it along your chart, check they have what they need before they start, report back, and stop at the budgets you set. Everything runs on your own computer, with the AI model of your choice.

## What it does

- **An organization you build.** Start with only you. Add positions one at a time, from 81 ready-made roles or your own, or accept positions suggested from your mission. Draw solid "reports to" lines and dotted "also works with" lines by dragging. Group positions into teams with a lead, a goal and a monthly budget. Drop a ready-made team under any position. Undo anything.
- **Work that follows your chart.** Give a task to anyone. Leads hand parts to the people below them, request work from other groups' leads, ask colleagues quick questions and escalate what is not theirs to decide. Every task knows why it exists: your mission, its group's goal, and the tasks above it.
- **Checks before spending.** Before a task starts, the agent checks it has what it needs (a repository, a file, an answer from you) and asks first instead of spending your budget guessing. Every task has a budget it shares with everything handed on from it; every agent and every group has a monthly budget that stops new work when it is used up.
- **An inbox like email.** Agents report to you as messages you can read, save, archive, search and sort. Give agents names of your own. Approve or decline steps, and positions agents propose, right from the message.
- **A full record.** An audit log of every operation, by you and by each agent, and a receipt for every task: what was done, what was not, what it cost, and which agent spent it.
- **A library for your documents.** A file manager for your organization's files, with folders. Each file or folder is either open to agents (all of them, some groups, or named agents) or private, never seen by any AI.
- **Memory that lasts.** Shared memory for the whole organization, each group and each agent, plus skills agents write for themselves and work on a schedule.
- **Any AI model, set up in a minute.** Integrations → AI models lists more than 20 services: Claude, OpenAI, Google Gemini, xAI, Mistral, DeepSeek, Groq, Together, OpenRouter, Azure OpenAI, a LiteLLM gateway, and free local models (Ollama, LM Studio, llama.cpp) that keep everything on your computer. Pick one, paste its key, done. Backup models take over if a service is down.
- **Works with the tools you have.** Git and GitHub, connectors (MCP servers) for other services, and Talqava itself as an MCP server, so Claude and other AI apps can use your team.
- **Light and dark.** A light theme by default and a dark one, in the Talqava greens.
- **Share an organization.** Export it as one readable file and import it on another computer. No keys, tasks, memory or documents go in the file.

![The Marketplace: ready-made roles and teams for every department](docs/images/marketplace.png)

## Get started

### The Mac app

A downloadable Mac app is on its way; watch the [releases](https://github.com/Talqava/Talqava/releases). Until then you can build it yourself (see [The desktop app](#the-desktop-app)) or run Talqava in your browser with the one-line install below.

### Install it (macOS and Linux)

You need [git](https://git-scm.com) and [Node.js](https://nodejs.org) 22.18 or newer. Then one line:

```bash
curl -fsSL https://raw.githubusercontent.com/Talqava/Talqava/main/install.sh | sh
```

It puts the app in `~/.talqava`, adds a `talqava` command, and opens the app in your browser. Run the same line again to update; your data in `~/.talqava/data` is kept. On Windows, use WSL for now.

### Run it from the source

You need [Node.js](https://nodejs.org) 22.18 or newer.

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:8787> (or start it with `node src/local/main.ts --open` to open it for you). The first time, Settings asks for an AI model: an Anthropic key, an OpenRouter account, or a free local model. Then open **Organization**, write your mission in a sentence, and add your first positions.

Everything Talqava knows is in the `data/` folder: organizations, chats, tasks, memory, the library, skills, schedules and settings. Back that folder up and you have backed up everything. Delete it and Talqava starts fresh.

## User guide

Every page in the app has a **Guide** button (top right) that opens its full guide, and **User guide** at the bottom of the menu opens them all. You can also read them here: start with [Getting started](guide/getting-started.md), then [Organization](guide/organization.md), [Tasks and goals](guide/tasks.md), [Work in progress](guide/work-in-progress.md), [Inbox](guide/inbox.md), [Chat](guide/chat.md), [Schedules](guide/schedules.md), [Marketplace](guide/marketplace.md), [Workspace](guide/workspace.md), [Library](guide/library.md), [Memory](guide/memory.md), [Skills](guide/skills.md), [Audit log](guide/audit-log.md), [Integrations](guide/integrations.md) and [Settings and AI models](guide/settings.md).

## How it works

### Organizations

- **You draw the chart.** A new organization holds only you. A position is a role (a job title, responsibilities, the agent that fills it) in a group. Drag a position onto another to make it report there and join its group; hold Option to draw a dotted line instead; drop it on a group to join it, or on **You** to report to you. The **Groups**, **Chart** and **List** views show the same organization. Every change can be undone (⌘Z), and **History** shows each one.
- **Groups.** A group is a team or department with a lead, a goal in a sentence, and an optional monthly budget for all its positions together. Work is charged to the group its agent was in when the task started; a group at its budget starts nothing new, and work under way stops with what was done kept.
- **Starting points, not templates.** **Suggest positions** proposes a few roles for your mission, each with a reason, to accept or skip. **Copy an example** (functional, hierarchical, matrix, outcome teams or flat, for six kinds of business) adds the example's positions you do not have yet; it never removes, moves or redraws anything you have. Ready-made teams (10 of them, from a marketing team to a starter company) drop under the position you choose.
- **Agents may propose; only you decide.** A lead that keeps meeting work nobody can do may propose a new position with a reason. It arrives in your inbox; nothing changes until you approve. A declined role is not proposed again.
- **Rules come from your lines.** An agent may hand work to anyone below it and to those on a dotted line with it; it may request work from other groups' leads; anyone may ask anyone a question. When two leads want different things, the agent's manager decides; above them, you do.

### Tasks and budgets

- **A task is checked before it starts.** One small model call looks for what is missing. If something is, the task waits in your inbox with plain questions instead of running.
- **Hand-offs are bounded.** Work goes at most 5 levels down, 8 open hand-offs per conversation, 3 questions to colleagues per task, and 6 tasks at once. Questions run on a small budget of their own.
- **One budget per task, shared with everything handed on from it** (a dollar by default; change it under Settings). The task stops before it goes over, and keeps a share for its lead to finish and report.
- **Monthly budgets** for each agent, each group and all agents together: a warning at 80%, no new work at 100%. Spend is estimated from list prices.
- **Nothing is lost.** Every step of a task is written to a journal as it happens. If the app closes mid-task, the task picks up where it stopped when the app starts again.

### Tasks on code

Connect a repository under **Integrations** (GitHub through your browser, or a folder on your computer), then choose it when you give a task. An agent that can change files gets its own branch and working copy, starting from your last commit, so your own files and branches are not touched. When it stops, the task shows the changes: **Keep the changes** makes one commit on the task's branch (merge it when you like), and **Undo** removes the branch and copy as if it never happened. Agents never push, merge or deploy.

Five ready-made tasks (write the changelog, add tests for a file, triage open issues, a morning report, research with sources) are each checked by the app before they count as done: if the check fails, the agent is told exactly what failed and sent back to fix it.

### The library

Drop files on the **Library** page or straight into the library folder (`data/organizations/<organization>/Library/`). Each organization has its own SQLite database (Node's built-in SQLite, so nothing extra is installed) holding every document's text in passages with a full-text index. PDF, Word, PowerPoint, Excel, text, Markdown, CSV and web pages are read; other files are kept and found by name. Agents search with a `library` tool and are sent only the passages that match their task, never a private file.

### Models

Everything is under **Integrations → AI models**. Pick a service, paste its key, and Talqava checks the key with the service, finds its models and fills in the rest. Connect as many as you like: the team uses one model, and any agent can use another.

- **Model makers:** Anthropic (Claude), OpenAI, Google Gemini, xAI (Grok), Mistral, DeepSeek, Moonshot (Kimi), Alibaba (Qwen) and Cohere. Claude gets Anthropic's web search and connectors.
- **Hosts of open models:** Groq, Together AI, Fireworks, Cerebras, NVIDIA and Hugging Face.
- **One account or your company's own:** OpenRouter (sign in through the web), Microsoft Azure OpenAI, a LiteLLM gateway (which can reach Amazon Bedrock, Google Vertex and others), or any other service with the common "chat completions" format.
- **On this computer, free and private:** Ollama, LM Studio, llama.cpp, Jan and vLLM. **Find models on this computer** connects every one that is running.

Each model's list shows which models can use tools (agents need them), how much text they hold and, where known, their prices. Prices and sizes come from OpenRouter's public list of models, which needs no account. **Backup models** take over, in the order you choose, when a service is down, busy or out of credit; each switch is noted in the audit log. Press **Check this model** for three short tests of which kinds of work a model can do.

Talqava talks to these services itself, in their own formats. No gateway software is bundled or needs installing.

With **cost saving** on (Settings), a lead that plans keeps your main model, an agent doing its part uses a mid-size model, and a quick question uses the small one. With it off, every agent uses your model.

### Connectors and other AI apps

Connectors (MCP servers) are reached from your computer, so they work with every model. A connector's tools ask before changing anything unless the connector marks them read-only. Talqava is also an MCP server: **Add Talqava to Claude** under Integrations lets the Claude desktop app see your team, give an agent a task, read the result and use the organization's memory, with the same approvals.

### Safety

Talqava lets an AI run commands, so it has guards:

- **Approvals.** By default it asks before every shell command, file change, API write and browser click. You can allow a tool for the rest of one chat, or switch approvals off.
- **Caution after the web.** Once a task has read a web page or an API reply, every change it wants to make asks first, whatever the agent's approval setting.
- **Workspace.** The file tool cannot read or write outside `data/workspace/`. The shell starts there, but on your own computer a shell command can reach anything your user account can, which is why commands ask first. Use Docker for a hard wall.
- **Secrets.** Each stored key is tied to one host and is filled in outside the model's view. Agents never see your keys.
- **The page.** Without a password it answers only on `localhost` and refuses requests from other websites. It will not start on a network address without a password.

Found a security problem? Please report it privately: see [SECURITY.md](SECURITY.md).

## The desktop app

The Mac app is the same app in its own window, with nothing else to install. To build it on an Apple-chip Mac:

```bash
cd desktop
```

```bash
npm install
```

```bash
npm run dist:test
```

The app is written to `desktop/dist/mac-arm64/Talqava.app`. Copy it to your Applications folder to use it. It keeps its data in `~/Library/Application Support/`. The app is not signed yet, so the first time, right-click it and choose **Open**.

**Windows and Linux (not yet tried by a person).** `npm run dist:win` builds a Windows installer and `npm run dist:linux` builds a Linux AppImage, each on its own kind of computer. The **Desktop builds** workflow on GitHub builds both and checks that the packaged app's server starts; the installers can be downloaded from the run's page for a week. On Windows, the agents' shell tool needs [Git for Windows](https://git-scm.com). If you try one, please [tell us how it went](https://github.com/Talqava/Talqava/issues/20).

## Run it on a server (always on)

On any small Linux server with Docker:

```bash
cp .env.example .env
```

Edit `.env`: set `ANTHROPIC_API_KEY` and a long `TALQAVA_PASSWORD`. Then:

```bash
docker compose up -d --build
```

The page listens on the server's own `127.0.0.1:8787` only. Reach it from your computer with an SSH tunnel:

```bash
ssh -L 8787:localhost:8787 you@your-server
```

and open <http://localhost:8787>. Tailscale, or an HTTPS reverse proxy such as Caddy in front of it, also work. Do not publish port 8787 to the internet over plain HTTP: the password would travel unencrypted.

## Settings

| Setting | Where | Notes |
| --- | --- | --- |
| AI model | Integrations → AI models | Claude, OpenAI, Gemini, Mistral, OpenRouter, Azure, LiteLLM, local models and more |
| API key | Settings or `ANTHROPIC_API_KEY` | For Claude |
| Budget per task | Settings | 40 steps and $1 by default, shared with everything handed on |
| Check before starting | Settings | On by default |
| Cost saving | Settings | Off by default |
| Approvals | Settings | Ask (default) or run everything |
| Appearance | Settings → Look | Light (default), dark, or match your computer |
| Password | `TALQAVA_PASSWORD` in `.env` | Required off `localhost` |
| Address | `HOST`, `PORT` in `.env` | Default `127.0.0.1:8787` |
| Data folder | `TALQAVA_DATA_DIR` in `.env` | Default `./data` |

For pages that need clicking or typing, install the optional browser (`npm install playwright`, then `npx playwright install chromium`) and restart: agents gain a `browser` tool.

## For developers

### How the code is laid out

| Folder | What it is |
| --- | --- |
| `src/core` | The shared core: the agent loop, budgets, the system prompt, and the tools every edition has. It reaches storage only through interfaces. |
| `src/core/models` | The model layer: one interface, with an adapter for Claude and one for chat-completions services, prices, and the model check. |
| `src/local` | This edition: file storage, organizations (`orgs.ts`), tasks and their journal (`quests.ts`), the library (`library.ts`), budgets (`spend.ts`), the audit log, integrations, the MCP server, and the web server (`server.ts`). |
| `public` | The page: plain JavaScript (`app.js`), the stylesheets, the brand video and fonts. |
| `crew` | The six starter agents, one YAML file each. |
| `marketplace` | The 81 ready-made roles and the ready-made teams (`teams.yaml`). |
| `quests` | The five ready-made checked tasks. |
| `desktop` | The Electron desktop app (Mac; Windows and Linux builds). |
| `evals` | The task test suite and its saved baselines. |
| `test` | Tests for the core and the local edition. |
| `docs` | The architecture map ([open it in a browser](docs/architecture.html)), plans, and the [brand guide](docs/brand/README.md) with the logos. |

The code is TypeScript, run directly by Node: there is no build step. Agents are files: a short YAML file each, with a name, a role, instructions, powers, a model, approvals and a budget. A file with the same name in your data folder's `crew/` folder replaces a starter.

### Tests

```bash
npm run check
```

This type-checks the code and runs the tests. The tests run against stand-ins for the AI models and for GitHub, so they need no key and cost nothing. Before a release, run the checked tasks against each model you support:

```bash
npm run eval -- --model local/qwen3:8b
```

A run that scores worse than the saved baseline in `evals/baselines/` exits with an error.

## Contributing

Talqava is open source and contributions are welcome: bug reports, ideas, new marketplace roles, translations of plain-language wording, and code. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Copyright (c) 2026 GR Investments LLC, which develops Talqava. Talqava includes open-source components under their own licences, listed with their notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); how we choose and track them is in our [open-source policy](legal/OPEN_SOURCE_POLICY.md).

Using Talqava is covered by our [Terms of Use](legal/TERMS.md), [Privacy Policy](legal/PRIVACY.md) and [Acceptable Use Policy](legal/ACCEPTABLE_USE.md). In short: Talqava runs on your computer and sends nothing to us; your data goes only to the services you connect. The app shows all of these under Settings → About and legal, and in the Mac app's Help menu.
