# Audit log

The Audit log is a complete record of what happens in Talqava: every change you make and every action each agent takes. For each one it shows who did it, what they did, whether it worked and what it cost. It is kept on your computer, and keys and passwords are never written into it.

## What you'll see

- **Audit log** at the top, with an **Export CSV** button on the right.
- A row of filters:
  - A search box: **Search: a command, a file, a task…**
  - **Who**: **Everyone**, **You**, **All agents**, or one agent by name.
  - **Kind**: **Everything**, **Tasks**, **Agent actions**, **Approvals**, **Spending**, **Problems**, **Library**, **Settings**, **Integrations**, **Organization**, **Chats** or **Inbox**.
  - **When**: **All time**, **Last 24 hours**, **Last 7 days** (the starting choice) or **Last 30 days**.
- Four totals for what the filters show: the number of **operations**, how many were **by agents**, how many **did not work**, and how much was **spent**.
- The list itself, newest first. Each line shows the time, who did it (you, an agent, or Talqava itself), the kind, what was done and, if it cost money, the cost. Lines that did not work are marked with **✕** and highlighted.

Click a line to open it. You see the full detail (for example the exact command or the file touched), whether it **worked** or **did not work**, the cost, and a button to **Open the task** or **Open the chat** it belongs to.

## Key ideas

- **Why it matters.** Agents act for you. The audit log lets you check exactly what they did, when, and at what cost, so nothing happens out of sight.
- **What is recorded.** Your own changes (settings, your organization, the library, integrations), each tool an agent uses, each approval it asks for and your answer, every problem, and what each run cost. When a backup model takes over because your main AI service is down, that switch is recorded too.
- **Who "Talqava" is.** Some lines are by the app itself rather than by you or an agent, for example an automatic step.
- **Secrets stay out.** Anything that looks like a key, token or password is hidden before a line is saved.
- **It only grows.** Lines are added, never edited. Very large logs are kept in an older file and a new one is started.
- **Costs are estimates.** Spending is worked out from each AI service's list prices. Your AI provider's bill is the real figure.

**The record is sealed.** Each entry is sealed to the one before it. At the top of the page, **Record intact** means Talqava has just checked every sealed entry and none was changed, removed or added by hand. If the record was edited outside Talqava, a red message says so and near which entry. Entries written before this feature existed are counted as "not covered". The seal's key is kept on this computer, so it shows quiet edits; it cannot stop someone with full use of this computer and the skill to forge the seal as well.

## How to…

### See what one agent did this week

1. Open **Audit log** in the left menu.
2. Under **Who**, choose the agent.
3. Leave **When** on **Last 7 days**.
4. Click any line to see the detail.

### Find what went wrong

1. Set **Kind** to **Problems**.
2. Or look at the **did not work** total, and scan the list for lines marked **✕**.
3. Open a line and press **Open the task** to see the whole task.

### Check what you have spent

1. Set **Kind** to **Spending**.
2. Choose a period under **When**, for example **Last 30 days**.
3. Read the **spent** total at the top.

### Find a command, file or task

1. Type a word into the search box, such as a file name or part of a task title.
2. Press Enter.

### Keep a copy or share it with your accountant

1. Set the filters to what you want.
2. Press **Export CSV**. A spreadsheet file is saved by your browser.
3. The file holds up to 5,000 lines that match your filters, with the time, who, kind, what, detail, task, cost and whether it worked.

## Tips

- Check **Approvals** now and then to see what agents asked to do and what you allowed.
- Use **All agents** under **Who** to hide your own changes and see only agent work.
- The page shows the newest 1,000 lines. Narrow the filters to see older ones, or use **Export CSV**.

## If something goes wrong

- **"Nothing recorded for these filters."** Nothing matches. Set **When** to **All time**, **Kind** to **Everything** and **Who** to **Everyone**, and clear the search.
- **"Showing the newest 1,000 of …"** There is more than the page shows. Narrow the filters, or export.
- **Export CSV is greyed out.** There are no lines to export for the current filters.
- **A red box instead of the list.** The log could not be loaded. Reopen the page; if it persists, restart Talqava.

- **"The audit record does not match its seals."** The log file was changed outside Talqava: edited by hand, restored from an old copy, or damaged. Entries before the point named are still good. If you restored the data folder from a backup on purpose, that explains it.

## Related guides

- [Settings](settings.md) (approvals, budgets and backup models)
- [Tasks](tasks.md)
- [Inbox](inbox.md)
- [Integrations](integrations.md)
- [Getting started](getting-started.md)
