# Integrations

Integrations connect Talqava to the tools your business already uses, so your agents can work where the work is. Today there are six: **AI models** for the AI services your agents think with, **OpenRouter** for hundreds of models through one account, **Git and GitHub** for code and documents kept in repositories, **MCP** for using your team from Claude and for giving agents tools from other services, **API keys for other services**, and **Langfuse** for seeing your agents' costs in Langfuse if you use it. Each one says plainly what agents can and cannot do with it.

## What you'll see

- **Integrations** at the top, with category buttons: **All**, **AI models**, **Code and repositories**, **AI apps and connectors** and **Other services**.
- A card for each integration with its name, a one-line status (for example "2 repositories connected"), a short summary and a badge: **Connected**, **Not set up** or **Unavailable**.
- **Set up →** or **Manage →** on each card opens its own page. **← All integrations** takes you back.

## Key ideas

- **Your keys stay on your computer.** A key or sign-in is kept on this computer and is only ever sent to its own service. Agents never see it.
- **You stay in charge of changes.** Agents work on code in a separate copy, and connector tools ask before changing anything.
- **Removing is safe.** Removing an integration forgets its sign-in here. It does not delete anything on GitHub or OpenRouter.

## How to…

### Connect an AI service

Open **AI models**, press **Connect** on a service, paste its key and press **Connect**. Talqava checks the key and lists the service's models. The [AI models guide](ai-models.md) covers it all: free models on your computer, choosing your team's model, backups, and setting up a service by hand.

### Connect OpenRouter (one account for hundreds of models)

OpenRouter lets you pay one balance and use models from many companies. It is useful if you want to try different models, or give a cheaper one to routine work.

1. Open the **OpenRouter** card.
2. Press **Connect OpenRouter**. openrouter.ai opens in your browser. Sign in or make a free account.
3. Press **Authorize** on openrouter.ai. You can set a spending limit for the key there.
4. Come back to Talqava. The page notices by itself; while it waits it says **Waiting for you to approve on openrouter.ai…**

Already have a key? Open **Already have an OpenRouter key?**, paste it (it starts with sk-or-), and press **Save key**.

### Choose the model your team uses on OpenRouter

1. On the connected OpenRouter page, look at **Your account** for what you have used and any limit.
2. Under **Which model your team uses**, search (try "claude", "gpt" or "free") and pick an order: **Suggested first**, **Cheapest first**, **A to Z** or **Longest documents first**.
3. Each model shows a rough cost **about $… a task** and how much text it holds.
4. Press **Use for my team**. Agents you gave a model of their own keep theirs.

Press **Add credit** to top up on openrouter.ai, or **See activity on openrouter.ai** to see the real charges.

### Connect GitHub and choose repositories

A repository is a folder of code or documents with a full history of changes. The page shows **Three steps**.

1. Open **Git and GitHub**. If it says **Git is not on this computer yet**, press **Install Git**, follow the Mac installer, then press **Check again**.
2. Under **GitHub**, press **Connect GitHub**. A short code appears and GitHub opens in your browser. Type the code, press **Continue**, then **Authorize**. This page carries on by itself.
3. If one-click sign-in is not set up, Talqava shows **Connect with an access token** instead: open GitHub's token page, press **Generate token**, copy it, paste it and press **Connect**.
4. Press **Choose repositories**. Pick your own account or your company under **Whose repositories?**.
5. Tick the ones you want and press **Copy here and connect**. Each is copied to your computer. Nothing on GitHub changes.

### Use a repository for a task

1. On a connected repository's card, press **Use for new tasks**, or choose it in the **Repository** box at the top of **Work in progress**.
2. Assign a task to an agent that can change files.
3. When the task stops, its page shows the changes. Press **Keep the changes** or **Undo**.

### Connect a folder already on your computer

1. Open **Already have a repository on this computer?**
2. Press **Search this computer for repositories** and then **Connect** beside one. Or type its location under **Connect a folder by its location** and press **Connect**.
3. To copy one from a web address, paste it under **Copy one from a web address** and press **Copy it here and connect**.

### Use your Talqava team from Claude

1. Open **MCP**.
2. Under **Use your Talqava team from Claude**, press **Add Talqava to Claude**. Nothing else in Claude's settings changes, and a copy of them is kept first.
3. Quit Claude completely and open it again. Keep Talqava open while you use it.
4. Ask Claude, for example, "What agents are on my Talqava team?" Claude can see your team, give an agent a task, read how it went, list recent tasks, and search or add to your organization's memory. Work that changes files or sends something still waits for your approval in Talqava.

### Connect a well-known service from the catalogue

The catalogue lists services that publish their own connector and accept a key you make: **Stripe**, **Airtable**, **monday.com**, **Intercom**, **Linear** and **GitHub**. It is on the **MCP** page under **From the catalogue**, and in the **Marketplace** under **Connectors**.

1. Press **See what it can do** on a service. Read what it **can read** and **can change** before anything is connected.
2. Make a key in that service, following the line under the key box (the link opens the service's own instructions). Give the key only the access you want your agents to have: the key decides what the connector can reach.
3. Paste the key and press **Check the key and connect**. Talqava checks the key with the service first; a key the service refuses is not saved.
4. To stop, press **Disconnect** on its card. The key is forgotten.

Only agents with the **connected services** power can use a connector, and each one shows under **Connected services** on that agent's line in **Organization → Access**. Tools that change something ask you first, unless the service marks them read-only.

**Not available yet** lists services people ask for that cannot be offered yet, and why: Gmail, Google Calendar and Drive, Microsoft 365, QuickBooks and others need Talqava to be registered with those companies first.

### Give agents tools from another service (a connector)

1. On the **MCP** page, under **Add a connector**, type a short name and the web address the service gives you.
2. Add an access token only if the service needs one.
3. Press **Add connector**. Remove it any time with **Remove**.

A connector that runs as a program on your computer is added further down the same page, under **All connectors, and ones that run on this computer**: give it a name and the program to run, then press **Add connector**.

### Send your agents' costs to Langfuse (optional)

1. In your Langfuse project, open **Settings → API keys** and create a pair.
2. In Talqava, open **Integrations → Langfuse**, choose where your Langfuse is (Europe, United States, Japan, or your own address), paste the public and secret keys, and press **Connect**. Talqava checks them with Langfuse first.
3. From then on, every model call your agents make is sent there, grouped by task: the model, tokens, cost, time and which agent. What was said is never sent.
4. Press **Disconnect** to stop.

### Store a key for another service

So agents can call a service that has no integration of its own, without seeing your key:

1. Open **API keys for other services**.
2. Type a name in capitals (for example WEATHER_KEY), the key, and the host it may be sent to (for example api.example.com).
3. Press **Add key**. Agents use it by name; the value is only ever sent to that host. Press **Remove** to forget it.

## Tips

- Only agents that can change files get their own branch. The Git page lists them. Others can read a repository but not change it.
- Agents never push, merge or deploy. Those stay with you.

## If something goes wrong

- **"GitHub did not accept the token. It may have expired or been revoked."** Make a new token and connect again.
- **"The code ran out before it was approved."** Press **Connect GitHub** for a new code.
- **"GitHub would not list the repositories of …"** Your company must allow Talqava first. See **My company is not listed**.
- **"An agent is working in that repository right now. Stop its task first."** Wait for the task, or stop it, before removing the repository.
- **"A repository needs at least one commit before an agent can work on it."** The folder has no saved history yet. Save a first version with Git, then try again.
- **"This sign-in has expired or was already used."** Press **Connect OpenRouter** again.
- **"OpenRouter did not accept that key."** Check the key at openrouter.ai/keys.
- **"The saved key no longer works."** Press **Connect OpenRouter** to connect again.
- **"The Claude desktop app was not found on this computer."** Install Claude, open it once, then come back.

## Related guides

- [Settings](settings.md) (AI models, connectors, API keys)
- [Work in progress](work-in-progress.md)
- [Tasks](tasks.md)
- [Audit log](audit-log.md)
- [Getting started](getting-started.md)
