# Settings

Settings is where you choose how careful, how thrifty and how independent your agents are, change the look of the app, and read Talqava's licence and policies. Connecting AI services, repositories, connectors and keys for other services is under **Integrations**; see [AI models](ai-models.md) and [Integrations](integrations.md).

## What you'll see

The page is one long column, in this order:

- **Look**: light or dark appearance, and an accent colour.
- **Agent**: your agent's name, the team's model, **Check this model**, effort, cost saving, checking before starting, approvals and the budget per run. Press **Save** after changing anything here.
- **Connections**: a link to **Integrations**, where AI models, repositories, connectors and API keys now live.
- **About and legal**, with where your files and data are kept on this computer.

If no AI service is connected yet, a banner at the top links to **Integrations → AI models**.

## Key ideas

- **The team's model** is chosen here or under **Integrations → AI models**; both change the same setting. Connect the service first under **AI models**.
- **Approvals protect you.** With **ask**, an agent stops before it runs a command, changes a file or writes to another service, and waits for your yes.
- **Budgets stop spending.** Every task stops before it goes over its step limit or its dollar limit. Monthly budgets for each agent and group are set on the Organization page and on each agent's page.

## How to…

### Test a model before relying on it

1. In the **Agent** section, choose the model under **Model comes from** and **Model**.
2. Press **Check this model**. It runs three short tests in under a minute and costs a few cents at most.
3. Read the result: **follows instructions**, **uses tools**, **chains steps**, and **Good for**.

### Change how agents work (the Agent section)

1. **Name**: what your main agent is called.
2. **Effort, for Claude**: higher thinks longer and costs more.
3. **Cost saving for your team of agents**: **Off: every agent uses my model**, or **On: match the model to the work**. With Claude Opus or Fable as your model, managers who plan keep your model, team members doing their own part use Claude Sonnet 5.5 (about half the price), and quick questions between agents use Claude Haiku 5.5. An agent you gave a model of its own keeps it.
4. **Before starting a task**: **Check first, and ask me if something is missing** (the default) or **Start straight away**. Checking means an agent first makes sure it has the information, documents or access it needs. If something is missing, it asks you in your Inbox instead of spending money guessing. The check costs a few cents and shows on the task's receipt.
5. **Plans for your approval**: **Tasks I give to a lead: plan first, for my approval** (the default), **Every task I give: plan first, for my approval**, or **Never: start straight away**. With plans on, the agent sends you a plan (the steps, who does each, and its cost estimate) and changes nothing until you approve it or ask for changes.
6. **Approvals**: **Ask me before commands, file changes and API writes** (the default) or **Run everything without asking**. Only choose the second if nothing on the computer would matter if lost. With "ask", a scheduled job that needs approval waits until you open its chat and answer.
7. **Budget per run: steps (model calls)**: 40 by default.
8. **Budget per run: estimated spend in US dollars**: $1 by default. Leave it empty for no dollar limit.
9. Press **Save**.

A run stops before going over either limit, and you can say "continue" to carry on. Spend is estimated from list prices; your provider's bill is the real figure.

### How Talqava keeps long tasks cheap

Every step of a task sends the whole conversation to the AI service again, so long tasks cost more per step as they go. Talqava does three things for you, with nothing to switch on:

- **Shortening old steps.** Once an agent has used a large result, such as a long web page or file, later steps send a short version of it: its start and end, and a note that it was shortened. The newest results always go whole, and the agent can run the step again if it needs all of it. With Claude, Anthropic does this on its side. You still see every result in full in the chat.
- **Reading from cache.** The AI service remembers the parts of the conversation it has already read and charges about a tenth of the price for them.
- **A size limit on each result.** No single result can fill the conversation.

At the top of a chat, the line of tokens and cost shows how much was read **from cache**, and about how much shortening old steps **saved**. Point at the line for an explanation. A task's receipt shows the same for the whole task.

### Change the look

1. Under **Look**, choose **Light**, **Dark** or **Match my computer**.
2. Click a colour swatch to change the accent colour used for buttons and highlights. This changes at once, without saving, in this browser or app window.

### Read the licence and policies

Under **About and legal**, press **Terms of Use**, **Privacy Policy**, **Acceptable Use Policy**, **Licence (MIT)**, **Security policy**, **Open-source policy**, **Approved licence list** or **Third-party notices**. Talqava runs on your computer and sends nothing to its makers; your data goes only to the services you connect.

## Tips

- Keep **Check first** and **Ask** on while you get to know your agents.
- Start with the $1 budget per run. Raise it only for tasks that keep stopping short.
- Set a spending limit on the AI service's own website too, as a second safety net.

## If something goes wrong

- **"Choose a model" or "Add your Anthropic key" before a task starts.** The model is not connected. Press **Open AI models** in that message, connect the service, then try the task again.
- **A task keeps stopping short.** It reached its budget per run. Say "continue" in the task, or raise **Budget per run** and press **Save**.
- **Nothing happens when I change the effort.** Effort only applies to Claude models.

## Related guides

- [AI models](ai-models.md) (connecting AI services and backups)
- [Integrations](integrations.md) (OpenRouter, GitHub, connectors, API keys)
- [Audit log](audit-log.md)
- [Organization](organization.md) (monthly budgets for groups)
- [Inbox](inbox.md) (approvals and questions)
- [Getting started](getting-started.md)
