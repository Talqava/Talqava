# Privacy Policy

*Effective 24 November 2026*

Talqava is software you run on your own computer. **We do not collect your data.** Talqava has no accounts, no analytics, no tracking and no crash reporting, and it sends nothing to us. This policy explains what Talqava keeps on your computer, and what it sends to the services you choose to connect.

Talqava is developed by GR Investments LLC. "We" and "us" mean GR Investments LLC. "You" means the person or organization using the Talqava app.

## What stays on your computer

Everything Talqava knows is stored in its data folder on your computer:

- your organizations, positions and groups;
- chats, tasks, their reports, receipts and the activity log;
- memory, skills and schedules;
- workspace pages, Office documents, sheets and notes, their history and their tables;
- library documents, and the text read from them;
- the people you add under Security: their name, email, role, a scrambled form of their password that cannot be turned back into it, and when they signed in;
- your settings, including API keys and sign-ins you add;
- encrypted backups, when you set them up, in the folder you choose. Only a key made from your passphrase is kept, never the passphrase.

On a Mac, the app keeps this in `~/Library/Application Support/Talqava Agents/data` (or `Talqava/data`). If you run Talqava from the source code or the installer, it is the `data` folder you chose. We cannot see or reach any of it.

**A record of what was sent** is kept in that folder for 30 days: which AI models were called and how much text was sent, the titles and sensitivity levels of pages handed to agents, changes made in connected services, and the names of websites agents called. It holds no content and is sent nowhere; you read it under Security.

**API keys and sign-ins** (for example an Anthropic key, OpenRouter or GitHub) are stored in that folder. Each is tied to the one service it belongs to, is sent only to that service, and is never shown to an AI agent.

## What leaves your computer, and where it goes

Talqava sends information off your computer only to services you choose to use, and only to do the work you ask for:

| When you… | Talqava sends… | To |
| --- | --- | --- |
| Chat, or give an agent a task | Your message, the agent's instructions, and the parts of your memory, workspace pages (and rows of their tables an agent reads) and library documents that match the task (never documents or pages you marked Private) | The AI model provider you chose: Anthropic, OpenRouter, or any provider you add. A model running on your own computer receives it locally, and nothing leaves. |
| Mark an item Confidential or Restricted and limit where that level may go (Security) | Nothing from those items, to any AI service you did not allow for that level | Only the services you allowed |
| Let an agent search or read the web | The search words, or the address of the page | Your AI provider's web search, or the web page's own site |
| Talk to your assistant from Telegram (optional) | What you write to your bot, and what the assistant answers. Your bot's token is sent to Telegram with each request | Telegram |
| Have a recording written out, or speak instead of typing | Nothing you say. It is written out by a speech program on your own computer. The first time, Talqava downloads the speech model you choose; that request carries no information about you beyond what any download does (your internet address) | The whisper.cpp project's files on Hugging Face (huggingface.co), for the one download |
| Connect GitHub or a repository | Requests about the repositories you choose, signed with your GitHub sign-in | GitHub |
| Send the audit record to a monitoring system (Security) | Every audit entry: who did what, when, and what it cost. Never keys or passwords. | Only the address you give |
| Press **Read the words in this picture** on a picture in the Library | That picture | Your team's AI service (a Claude model), once, when you press it |
| Press **Read the words** on a picture attached to a note or document | That picture | Your team's AI service (a Claude model), once, when you press it |
| Connect a built-in service: HubSpot, Mailchimp, Slack, Asana, Trello, Calendly, Typeform, Zendesk, GitLab, Xero, Pipedrive, Todoist, Jira, ClickUp, Klaviyo or Square (Connections) | The key you paste, and what an agent reads or changes there: orders, products and customers; contacts, companies and deals; audiences and the people in them; channel messages; tasks and cards; booked meetings; form answers; support tickets; issues and merge requests; invoices, bills, contacts and accounting reports; deals, people and organizations; to-dos; payments, orders and items | Only that service (for WooCommerce, your own shop; for GitLab, gitlab.com or your company's own GitLab) |
| Connect Gmail, Google Calendar, Google Drive, Outlook or OneDrive (Connections) | Your own registered app's ID (and secret), the sign-in tokens, and what an agent reads or changes there: emails and drafts; calendar events; file names and the text of files it reads | Only Google or Microsoft |
| Sign in to a service through Talqava's website (only for services where Connections says the sign-in passes through auth.talqava.com) | The one-time sign-in code, and the sign-in tokens the service returns, as they pass through. Nothing is stored there | Talqava's sign-in service at auth.talqava.com, and the service you are signing in to |
| Connect a WordPress site (Connections) | Your user name and application password, and the posts and pages an agent reads, writes or changes | Only your own site |
| Add a connector (MCP server) | What an agent sends to that connector's tools | That connector's service |
| Store a key for another service | The requests an agent makes to that service, with your key | That service only |
| Use OpenRouter | The name "Talqava" and the address talqava.com, as OpenRouter asks apps to identify themselves. Nothing about you. | OpenRouter |
| Connect an AI service | A request to check the key and list the service's models, with your key | That service only |
| Look at a service's models, or use one | A request for OpenRouter's public list of models and prices, to show what each model costs and can do. It carries no key and nothing about you, only the name "Talqava" and talqava.com. Done at most once a day. | OpenRouter |
| Open Talqava, or look at a service's models | A download of LiteLLM's public list of model prices, to show what each model of a connected service costs and can do. It carries no key and nothing about you. Done at most once a day. | GitHub, where the list is published |
| Choose backup models | When your chosen model's service is down, busy or out of credit, the same request goes to the next backup's service | The backup's service |
| Add Talqava to the Claude desktop app | Nothing over the internet: Talqava adds itself to Claude's settings on your computer | Your computer |

Each of these services handles what it receives under **its own privacy policy and terms**, not this one. Read them before you connect a service, in particular your AI model provider's, since it receives the content of your chats and tasks.

## Your choices

- **Choose a local model** to keep everything on your computer.
- **Mark documents and pages Private** to keep them from every AI agent and model.
- **Remove a service** at any time under Connections or Settings; Talqava stops sending anything to it.
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
