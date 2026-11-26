# Settings

Settings is where you choose how careful, how thrifty and how independent your agents are, change the look of the app, and read Talqava's licence and policies. Connecting AI services, repositories, connectors and keys for other services is under **Connections**; see [AI models](ai-models.md) and [Connections](integrations.md).

## What you'll see

The page is one long column, in this order:

- **Look**: light or dark appearance, and an accent colour.
- **Agent**: your agent's name, which model your team uses (with **Check this model**), effort, cost saving, the two steps before a task starts, approvals and budgets. Press **Save** after changing anything here.
- **Connections**: a link to **Connections**, where AI models, repositories, connectors and API keys now live.
- **About and legal**, with where your files and data are kept on this computer.

If no AI service is connected yet, a banner at the top links to **Connections → AI models**.

## Key ideas

- **The team's model** is chosen in one place: **Connections → AI models**. Settings shows it, with a button that takes you there, and **Check this model** to test it.
- **Approvals protect you.** With **ask**, an agent stops before it runs a command, changes a file or writes to another service, and waits for your yes.
- **Budgets stop spending.** Every task stops before it goes over its step limit or its dollar limit. Monthly budgets for each agent and group are set on the Organization page and on each agent's page.

## How to…

### Test a model before relying on it

1. Choose the model under **Connections → AI models** (Settings has a button that takes you there).
2. Press **Check this model**. It runs three short tests in under a minute and costs a few cents at most.
3. Read the result: **follows instructions**, **uses tools**, **chains steps**, and **Good for**.

### Change how agents work (the Agent section)

1. **Name**: what your main agent is called.
2. **Effort, for Claude**: higher thinks longer and costs more.
3. **Cost saving for your team of agents**: **Off: every agent uses my model**, **Balanced: match the model to the work**, or **Cheapest: cheaper models wherever they can do it**. Balanced, with Claude Opus or Fable as your model: managers who plan keep your model, team members doing their own part use Claude Sonnet 5.5 (about half the price), and quick questions between agents use Claude Haiku 5.5. Cheapest also gives managers Sonnet. With another AI service, the cheaper models come from your **backup models**, so Talqava never uses a model you didn't choose: add cheaper backups under Connections → AI models to make it work. An agent you gave a model of its own keeps it, and the receipt shows which model did each step.
4. **Before a task starts, 1. Missing information check**: **On** (the default) or **Off**. The agent first makes sure it has the information, documents or access it needs. If something is missing, it asks you in your Inbox instead of spending money guessing. The check costs a few cents and shows on the task's receipt.
5. **Before a task starts, 2. Plan for your approval**: **Tasks I give to a lead: plan first, for my approval** (the default), **Every task I give: plan first, for my approval**, or **Never: start straight away**. This comes after the check in step 1: the agent sends you a plan (the steps, who does each, and its cost estimate) and changes nothing until you approve it or ask for changes. Step 1 asks whether the agent has what it needs; step 2 asks whether you agree with how it will do the work.
6. **Leads' daily check-in**: **On** (the default) or **Off**. With it on, your Inbox gets one message a day: for every group, what moved since yesterday, what is stuck or waiting on you, and what is next. It is built from your tasks, so it costs nothing.
7. **When a task gets stuck**: **On** (the default) or **Off**. A task is stuck when it tries the same step again and again, or every step fails. With this on, it first carries on once with the strongest model you set up (your team's model or a backup) that costs clearly more than the one it was using, within the same budget. A model on your own computer never moves up to one online. If it's still stuck, it stops and leaves a hand-over note as before.
8. **Privacy: hide personal details from AI services**: **Off** (the default) or **On**. With it on, email addresses, phone numbers, card numbers and US Social Security numbers are replaced with placeholders such as [EMAIL 1] before anything is sent to an AI service, and put back in the answer, so an agent can still email the right person. Your chats keep the real details. It doesn't catch names, street addresses or details inside pictures. Models on your own computer send nothing out, so they see everything.
9. **Approvals**: **Ask me before commands, file changes and API writes** (the default) or **Run everything without asking**. Only choose the second if nothing on the computer would matter if lost. With "ask", a scheduled job that needs approval waits until you open its chat and answer.
10. **Steps per run (model calls)**: 40 by default.
11. **Budget per task, in US dollars**: $1 by default. The most one task and everything handed on from it may spend together; each run of an agent stops there too. Leave it empty for no dollar limit.
   **Monthly budget for all agents together**: when all your agents together reach it in a calendar month, none starts new work until you raise it or the month turns. Empty means no limit.
12. Press **Save**.

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
- **A task keeps stopping short.** It reached its budget per run. Say "continue" in the task, or raise **Budget per task** and press **Save**.
- **Nothing happens when I change the effort.** Effort only applies to Claude models.

## Related guides

- [AI models](ai-models.md) (connecting AI services and backups)
- [Connections](integrations.md) (OpenRouter, GitHub, connectors, API keys)
- [Activity log](audit-log.md)
- [Organization](organization.md) (monthly budgets for groups)
- [Inbox](inbox.md) (approvals and questions)
- [Getting started](getting-started.md)
