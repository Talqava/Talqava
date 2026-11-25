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

1. Open **Tasks** and press **+ New task**. (You can also give a task from **Agents**, or to one agent with **Give a task**.)
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

The menu on the left follows one idea: **you give work, agents do it, you stay in control.**

**Home**: Where Talqava opens. What needs you, what is being worked on, quick ways to start something, and the files you were last working on.

**Chat**: Talk to your main agent directly, like a messaging app. Good for quick questions, drafts and ideas.

**Inbox**: Everything that needs you, in one place: plans to approve, questions, finished work to review, changes agents want to make, and reminders.

### Work

**Tasks**: Every task in your organization: queued, working, needing you, to review and done.

**Projects**: One folder for each body of work, with its tasks and chats.

**Routines**: Repeating work your agents do on their own, such as a morning news digest every weekday.

### Team

**Agents**: Your agents and what each is doing right now. Assign work, clear what is waiting on you, and open any agent's page.

**Organization**: Your org chart. Add positions, draw who reports to whom, group them into teams with leads, and set budgets.

**Marketplace**: Ready-made agents, teams, company templates, playbooks, page packs, Office templates and connectors, free.

### Make and know

**Office**: What you and your agents make together. Its parts are tabs across the top: **Documents** (letters, proposals, reports), **Sheets** (budgets and forecasts that calculate), **Slides** (presentations) and **Notes** (quick, private notes). See [Office](office.md).

**Knowledge**: What your agents work from. Its parts are tabs across the top: **Workspace** (procedures, price lists and decisions as pages), **Library** (your files, in folders), **Memory** (what agents should always remember) and **Skills** (procedures agents wrote down for themselves).

### Admin

Fold this group away with the small arrow when you do not need it.

**Security**: Who can open Talqava and what each person may do, which AI services may receive sensitive information, rules every agent must follow, alerts, and backups. See [Security](security.md).

**Audit log**: A full record of every operation, by you and by each agent, sealed so that changes to it show.

**Integrations**: Connect AI models, Git and GitHub, connectors to other services, and keys.

**Settings**: Approvals, budgets, cost saving, privacy and how Talqava looks.

**User guide**: Opens these guides, at the page that explains the screen you are on.

## Good habits from day one

- **Keep approvals on.** With **Ask**, agents stop before commands, file changes and writes to other services.
- **Set budgets.** Every task has a budget ($1 and 40 steps unless you change it). Give each agent and group a monthly budget too: at 80% you get a warning, at 100% no new work starts.
- **Add a backup model** from a second AI service, so work carries on if one is down.
- **Share only what agents need.** Keep sensitive files private in the Library.
- **Glance at the Audit log** now and then to see what your agents did.
- **Back up your data.** Everything Talqava knows is in its data folder on your computer. Copy that folder and you have backed up everything.

## Words

Every word Talqava uses, in one place: [Words Talqava uses](glossary.md).

## Where to get help

- Press **Guide** at the top right of any page for that page's guide, or open **User guide** in the menu.
- Each page's guide has an **If something goes wrong** section with the common messages and fixes.
- Visit talqava.com, or report a problem on the project's GitHub page (github.com/Talqava/Talqava/issues).
