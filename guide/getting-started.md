# Getting started

Talqava lets you run your organization with a team of AI agents. You draw the org chart, hand out work in plain words, and the agents do it, report back to you, and stop at the budgets you set. This guide takes you from installing the app to your first finished task, then gives a short tour of every page.

## What Talqava is

Think of Talqava as an office for a team of AI assistants, each in a role you choose: a bookkeeper, a marketing lead, a researcher. Each agent knows your mission, who it reports to and what it may spend. Leads split work and hand parts to the people below them. Before an agent spends money, it checks it has what it needs, and it asks you before anything risky.

Talqava is not an AI itself. It uses an AI service you connect, such as Claude from Anthropic, or a free model running on your own computer. Everything else (your organization, tasks, documents and memory) is kept on your computer.

## Your first five steps

### 1. Install and open Talqava

A ready-to-download Mac app is on its way. Until then, the simplest way is the one-line install. You need git and Node.js (version 22.18 or newer) on your Mac or Linux computer first. Then open the Terminal app, paste this line and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/Talqava/Talqava/main/install.sh | sh
```

It installs Talqava and opens it in your web browser. Run the same line again later to update; your data is kept.

If you have been given the Talqava Mac app, copy it to your Applications folder. The first time, right-click it and choose **Open**.

### 2. Connect an AI service

The first time, Talqava asks for an AI model.

1. Open **Integrations** and choose **AI models**. (Talqava opens it for you the first time.) Pick a service: **Anthropic (Claude)** is the standard and works best for agent work.
2. Press **Connect**, follow the link to get a key from that company's website, paste it in, and press **Connect**.
3. Choose a model and press **Use for my team**.

Prefer something free and private? Install Ollama or LM Studio, download a model, start it, and press **Find models on this computer**. Your key stays on your computer and is only sent to its own service. See [AI models](ai-models.md) for more.

### 3. Build your organization

1. Open **Organization**. At first it is just you.
2. Under **What is your organization for?**, write your mission in one sentence, for example "We sell handmade furniture online and deliver across the UK." Every agent is told it.
3. Press **Suggest positions**, then accept the ones you want. Nothing is added until you choose it.
4. Or drag a role or a ready-made team onto the chart, or add agents from the **Marketplace**.

Start with two or three positions. You can always add more. See [Organization](organization.md).

### 4. Give your first task

1. Open **Tasks** and press **+ New task**. (You can also give a task from **Work in progress**, or to one agent with **Give a task**.)
2. Under **Task**, write what you want in one line, for example "Find ten wholesale bakeries near us".
3. Under **Details**, say what a good result looks like.
4. Choose who to **Assign to** and the **Priority**, then press **Create task**.

With **Check first** on (the standard setting), the agent first checks it has what it needs. If something is missing, it asks you plain questions in your Inbox instead of guessing.

### 5. Answer, review and finish

1. Watch the number on **Inbox**. Agents report there, ask questions, and ask for your approval before risky steps such as changing files.
2. Open a message and answer, or press approve or decline.
3. When the task is done, open it to read the result. Its **Receipt** shows what was done, what was not, what it cost, and which agent spent it.

That's it: you have run your first task. From here, add more agents, set budgets, and share documents in the Library.

## A tour of the menu

The menu on the left is in groups. Every page also has a **Guide** button at the top right that opens the guide for that page.

**Chat**: Talk to your main agent directly, like a messaging app. Good for quick questions, drafts and ideas that do not need a formal task. See [Chat](chat.md).

**Inbox**: Your agents report to you here as messages, like email. It shows what needs you, what is being worked on and what got done. You approve or decline steps, answer questions and accept positions agents propose, right from the message. See [Inbox](inbox.md).

### Work

**Tasks**: Every task in your organization in one place: queued, working, needing you, to review and done. Create tasks, comment on them, send work back, and set goals and projects for tasks to serve. See [Tasks](tasks.md).

**Work in progress**: Your agents and what each is doing right now. Assign work, clear what is waiting on you, choose a repository for code tasks, and see how each department is doing. See [Work in progress](work-in-progress.md).

**Routines**: Repeating work your agents do on their own, such as a morning news digest every weekday. Each run appears as a new chat. You can pause, resume, run now or delete a job. See [Routines](schedules.md).

### Team

**Organization**: Your org chart. Add positions, draw who reports to whom, group positions into teams with a lead, a goal and a monthly budget, and copy an example structure. Every change can be undone. See [Organization](organization.md).

**Marketplace**: Ready-made agents and teams for every department, free. Read every agent's full instructions, and what it can and cannot do, before you add it. See [Marketplace](marketplace.md).

### Knowledge

**Workspace**: Pages your agents work from: how your business runs, procedures, checklists and decisions. Agents read them before they start and suggest changes for you to accept. See [Workspace](workspace.md).

**Library**: Your organization's files, in folders, kept on your computer. For each file or folder you choose whether agents may use it or it stays private. Private files are never sent to any AI. See [Library](library.md).

**Memory**: Things your agents should always remember about you and your business. Keep separate memory for each client or project. See [Memory](memory.md).

**Skills**: Procedures an agent has written down for itself after working out how to do something, so it can repeat it. Ask an agent to "save that as a skill" after a task you will want again. See [Skills](skills.md).

### Oversight

**Audit log**: A full record of every operation, by you and by each agent: what was done, whether it worked and what it cost. Filter it, search it and export it. See [Audit log](audit-log.md).

### At the bottom

**Integrations**: Connect the tools you already use: OpenRouter for many AI models in one account, Git and GitHub for code, and MCP to use your team from Claude or give agents tools from other services. See [Integrations](integrations.md).

**Settings**: Connect AI services and choose models and backups, and set approvals, budgets, cost saving, the look of the app and more. See [Settings](settings.md).

**User guide**: Opens these guides.

## Good habits from day one

- **Keep approvals on.** With **Ask**, agents stop before commands, file changes and writes to other services.
- **Set budgets.** Every task has a budget ($1 and 40 steps unless you change it). Give each agent and group a monthly budget too: at 80% you get a warning, at 100% no new work starts.
- **Add a backup model** from a second AI service, so work carries on if one is down.
- **Share only what agents need.** Keep sensitive files private in the Library.
- **Glance at the Audit log** now and then to see what your agents did.
- **Back up your data.** Everything Talqava knows is in its data folder on your computer. Copy that folder and you have backed up everything.

## Where to get help

- Press **Guide** at the top right of any page for that page's guide, or open **User guide** in the menu.
- Each page's guide has an **If something goes wrong** section with the common messages and fixes.
- Visit talqava.com, or report a problem on the project's GitHub page (github.com/Talqava/Talqava/issues).
