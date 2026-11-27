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

### The set-up chat

The first time, Talqava opens on a short chat with your assistant. It asks one thing at a time:

1. **Where do you want to start?** Choose **Build my team**, **Connect an AI model**, or **Just let me ask something** to skip.
2. For your team, say what your business does in one sentence (or press one of the examples), and press **Continue**.
3. Talqava lists the positions it suggests, all ticked. Untick any you do not want and press **Add these**. Nothing is added before that.
4. It then points you to the one thing left, usually connecting an AI model.

**Back** takes you one question back. The panel on the right shows what is done. **Skip set-up** closes the chat for good; you can still do each step yourself, as described below, and **Set up** on the home screen opens the team questions again while you have no team.

### 2. Connect an AI service

Your agents need an AI model to think with.

1. Press the account button at the bottom left, then **Connections**, and choose **AI models**. (The set-up chat takes you there.) Pick a service: **Anthropic (Claude)** is the standard and works best for agent work.
2. Press **Connect**, follow the link to get a key from that company's website, paste it in, and press **Connect**.
3. Choose a model and press **Use for my team**.

Prefer something free and private? Install Ollama or LM Studio, download a model, start it, and press **Find models on this computer**. Your key stays on your computer and is only sent to its own service. See [AI models](ai-models.md) for more.

### 3. Build your organization

1. The set-up chat does this with you. To do it yourself, open **Team**, then **Organization**. At first it is just you.
2. Under **What is your organization for?**, write your mission in one sentence, for example "We sell handmade furniture online and deliver across the UK." Every agent is told it.
3. Press **Suggest positions**, then accept the ones you want. Nothing is added until you choose it.
4. Or drag a role or a ready-made team onto the chart, or add agents from the **Marketplace**.

Start with two or three positions. You can always add more. See [Organization](organization.md).

### 4. Give your first task

1. On **New**, type **@**, the agent's name and what you want, and press Enter. Or open **Tasks** and press **+ New task**, which has more options. (You can also give a task from **Agents**, or to one agent with **Give a task**.)
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

The menu is a narrow strip of icons down the left side. Point at an icon to see its name. It follows one idea: **you ask, agents do the work, you stay in control.** The first time you open Talqava, a short welcome says the same; **Show the welcome again** at the bottom of the home screen brings it back.

Some places hold a few pages, shown as tabs across the top. Talqava remembers the tab you last used in each place. When a guide says "open **Connections**" or any other page, find its place in the list below, or type the page's name in the box at the top.

In a narrow window or on a phone the strip stays where it is, and pages with two columns stack into one.

The box at the top finds anything: files by name or by the words inside, tasks, chats, agents, and any page of the app.

**New** (the green button): Where Talqava opens. One box: ask for anything in your own words and press Enter. Plain words go to your assistant as a chat. Start with **@** and an agent's name to give that agent a task. Under the box are three things to try, and links to make a document, sheet, presentation or note. Below that: what is waiting on you, what is being worked on, and what got done today. **Your earlier chats** at the bottom opens the chat page. See [Chat](chat.md).

**Sessions**: One list of everything you have asked for: your chats with the assistant and the tasks you gave your agents, newest first. Point at a row and press **⋯** to pin it to the top, rename it or archive it; **Show archived** at the bottom of the list brings archived ones back into view. Opening a chat shows the conversation; opening a task shows the agent's work. The box you type in lets you choose the AI model and how hard it thinks, and has a microphone if your copy of Talqava can write out speech.

**Inbox** (near the bottom of the strip, with a number when something waits on you): Everything that needs you, in one place: plans to approve, questions, finished work to review, changes agents want to make, and reminders.

**Tasks and projects**: The work. Its tabs:
- **Tasks**: every task in your organization: queued, working, needing you, to review and done.
- **Projects**: one folder for each body of work, with its tasks and chats.

**Automations** (the clock): repeating work your agents do on their own, such as a morning news digest every weekday. See [Automations](schedules.md).

**Team**: Who does the work, and what they know. Its tabs:
- **Agents**: your agents and what each is doing right now. Assign work and open any agent's page.
- **Organization**: your org chart. Add positions, draw who reports to whom, group them into teams with leads, and set budgets.
- **Memory**: what agents should always remember. See [Memory](memory.md).
- **Skills**: procedures agents wrote down for themselves. See [Skills](skills.md).
- **Marketplace**: ready-made agents, teams, page packs and Office templates, free.

**Files**: What you make and what your agents work from, in one place.
- **All files** lists everything together, newest change first: documents, notes, workspace pages and the files in your library. Buttons above the list show one kind at a time. The search box finds documents, notes and pages by the words inside them. Start a document or a note from the top, or ask an agent to make one.
- **Work in one kind**, lower on the page, opens the full page for Documents, Notes, Workspace pages or the Library (where you add and organize files). See [Office](office.md), [Workspace](workspace.md) and [Library](library.md). **Sheets** and **Slides** are set aside; see Labs below.

**Search**: Puts you in the box at the top, which finds anything.

**The account button**, the round one at the very bottom. It opens a menu with:
- **Connections**: connect AI models, other services, and keys.
- **Security**: who can open Talqava and what each person may do, which AI services may receive sensitive information, rules every agent must follow, alerts, and backups. See [Security](security.md).
- **Activity log**: a full record of every operation, by you and by each agent, sealed so that changes to it show.
- **Usage**: what your AI models cost, day by day, and which model and which agent it went to. Choose the last 7, 30 or 90 days, or 12 months. It counts from the day this page arrived, and the figures are estimates from list prices: your bill from the AI service is what counts.
- **Settings**: approvals, budgets, cost saving, privacy and how Talqava looks.

**Help**: Opens these guides, at the page that explains the screen you are on.

## Labs: parts that are set aside

To keep Talqava simple, some parts are built but hidden until you switch them on. Open the account button at the bottom left, then **Settings**, and scroll to **Labs**:

- **Sheets and Slides**: spreadsheets that calculate and presentation decks, under Files.
- **Organization designer**: example structures to copy, how you run the organization, and each position's goals and decisions.
- **Company features**: people with their own sign-in and roles, single sign-on, rules for sensitive information, record-keeping rules and a feed for a monitoring system, under Security.
- **Company templates and playbooks**, in the Marketplace.
- **Git repositories**: let agents work on code in repositories on this computer, under Connections.

Nothing is deleted when a part is off. Whatever you made with it is kept, agents can still use it, and it comes back when you switch it on. A part you were already using (people and sign-in, a connected repository, a record-keeping rule) stays visible without the switch. Other guides describe these parts as if they are switched on.

## Good habits from day one

- **Keep approvals on.** With **Ask**, agents stop before commands, file changes and writes to other services.
- **Set budgets.** Every task has a budget ($1 and 40 steps unless you change it). Give each agent and group a monthly budget too: at 80% you get a warning, at 100% no new work starts.
- **Add a backup model** from a second AI service, so work carries on if one is down.
- **Share only what agents need.** Keep sensitive files private in the Library.
- **Glance at the Activity log** now and then to see what your agents did.
- **Back up your data.** Everything Talqava knows is in its data folder on your computer. Copy that folder and you have backed up everything.

## Words

Every word Talqava uses, in one place: [Words Talqava uses](glossary.md).

## Where to get help

- Press **Guide** at the top right of any page for that page's guide, or open **Help** from the account button at the bottom left.
- Each page's guide has an **If something goes wrong** section with the common messages and fixes.
- Visit talqava.com, or report a problem on the project's GitHub page (github.com/Talqava/Talqava/issues).
