# Privacy Policy

*Effective 24 November 2026*

Talqava is software you run on your own computer. **We do not collect your data.** Talqava has no accounts, no analytics, no tracking and no crash reporting, and it sends nothing to us. This policy explains what Talqava keeps on your computer, and what it sends to the services you choose to connect.

Talqava is developed by GR Investments LLC. "We" and "us" mean GR Investments LLC. "You" means the person or organization using the Talqava app.

## What stays on your computer

Everything Talqava knows is stored in its data folder on your computer:

- your organizations, positions and groups;
- chats, tasks, their reports, receipts and the audit log;
- memory, skills and schedules;
- workspace pages, Office documents, sheets and notes, their history and their tables;
- library documents, and the text read from them;
- your settings, including API keys and sign-ins you add.

On a Mac, the app keeps this in `~/Library/Application Support/Talqava Agents/data` (or `Talqava/data`). If you run Talqava from the source code or the installer, it is the `data` folder you chose. We cannot see or reach any of it.

**API keys and sign-ins** (for example an Anthropic key, OpenRouter or GitHub) are stored in that folder. Each is tied to the one service it belongs to, is sent only to that service, and is never shown to an AI agent.

## What leaves your computer, and where it goes

Talqava sends information off your computer only to services you choose to use, and only to do the work you ask for:

| When you… | Talqava sends… | To |
| --- | --- | --- |
| Chat, or give an agent a task | Your message, the agent's instructions, and the parts of your memory, workspace pages (and rows of their tables an agent reads) and library documents that match the task (never documents or pages you marked Private) | The AI model provider you chose: Anthropic, OpenRouter, or any provider you add. A model running on your own computer receives it locally, and nothing leaves. |
| Let an agent search or read the web | The search words, or the address of the page | Your AI provider's web search, or the web page's own site |
| Connect GitHub or a repository | Requests about the repositories you choose, signed with your GitHub sign-in | GitHub |
| Connect a service from the connector catalogue (Stripe, Airtable, monday.com, Intercom, Linear, GitHub) | The key you paste, and what an agent sends to that connector's tools | Only that service's own connector address |
| Add a connector (MCP server) | What an agent sends to that connector's tools | That connector's service |
| Store a key for another service | The requests an agent makes to that service, with your key | That service only |
| Use OpenRouter | The name "Talqava" and the address talqava.com, as OpenRouter asks apps to identify themselves. Nothing about you. | OpenRouter |
| Connect an AI service | A request to check the key and list the service's models, with your key | That service only |
| Look at a service's models, or use one | A request for OpenRouter's public list of models and prices, to show what each model costs and can do. It carries no key and nothing about you, only the name "Talqava" and talqava.com. Done at most once a day. | OpenRouter |
| Open Talqava, or look at a service's models | A download of LiteLLM's public list of model prices, to show what each model of a connected service costs and can do. It carries no key and nothing about you. Done at most once a day. | GitHub, where the list is published |
| Connect Langfuse (optional) | For each model call: the model's name, tokens, cost, time taken, the agent's title and the task's or chat's title. Never what was said. Sent with your Langfuse keys. | Your Langfuse project (Langfuse Cloud or your own) |
| Choose backup models | When your chosen model's service is down, busy or out of credit, the same request goes to the next backup's service | The backup's service |
| Add Talqava to the Claude desktop app | Nothing over the internet: Talqava adds itself to Claude's settings on your computer | Your computer |

Each of these services handles what it receives under **its own privacy policy and terms**, not this one. Read them before you connect a service, in particular your AI model provider's, since it receives the content of your chats and tasks.

## Your choices

- **Choose a local model** to keep everything on your computer.
- **Mark documents and pages Private** to keep them from every AI agent and model.
- **Remove a service** at any time under Integrations or Settings; Talqava stops sending anything to it.
- **Delete your data** by deleting the data folder (or an organization, a chat, a page or a document inside the app). There is no copy anywhere else for us to delete.

## Children

Talqava is made for businesses and is not directed at children under 13. We do not knowingly collect any information, from children or anyone else.

## Security

Talqava runs only on your computer by default and refuses requests from other websites. If you run it on a server, protect it with a password and an encrypted connection, as the readme explains. To report a security problem, see our [Security policy](../SECURITY.md).

## Our website

The website talqava.com is separate from the app, and may use its own cookies or analytics. This policy covers the Talqava app.

## Changes

If Talqava ever starts sending anything to us, we will say so here and in the app before it happens, and ask you first. We will update the date at the top whenever this policy changes; the history of every change is public on GitHub.

## Contact

Questions about privacy: contact us at [talqava.com/contact](https://talqava.com/contact).
