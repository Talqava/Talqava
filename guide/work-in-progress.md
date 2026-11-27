# Agents

This page is **Work in progress**. It is set aside to keep Team simple: switch on **Work in progress page** under Settings › Labs and it becomes the second tab under **Team**. (The first tab, **People**, shows one card for each agent with what it is doing and a **Give a task** button.) Work in progress is your control room. You hand out work, clear what is waiting on you, and watch what each agent is doing right now. From here you can also open any single task to follow it step by step, or open an agent to change how it works.

## What you'll see

**On the left: your agents**, grouped by department. Each shows its name, its job, and a status:

- **Available**, with how many tasks it finished this week
- **● Working · step 3**
- **◌ Waiting on you**
- **■ At its monthly budget**

**Chart →** opens your Organization page. **+ Add from the marketplace** and **+ Create an agent** are at the bottom.

**In the middle:**

- **Assign a task to**: a box for giving work to one agent or a whole team, with suggested tasks for that department.
- Once work has been given, four numbers: **Waiting on you**, **In progress**, **Finished this week** and **Spent this week**. Before that, the page is only the box above and the ready-made tasks: the numbers, **Under way** and the departments table appear with the first task.
- **Waiting on you**: approvals, reviews and failures, with **Open inbox →**.
- **Under way**: every task running now. A task an agent handed on appears indented under the one it came from.
- **Latest results**: your three most recent finished tasks.
- **Departments this week**: a table showing, for each department, how many agents are working, waiting on you and finished, how many tasks were "not clean", and what was spent. A sentence above it points out anything worth your attention.
- **Ready-made tasks**: tasks whose result is checked automatically before they count as done. The ones that work on code are offered only when Git repositories is switched on under Labs, or a repository is connected.

**On the right: Completed work**, your recent finished tasks, each with how it ended. The column appears with the first finished task.

## Key ideas

**One agent, or a whole team.** In **Assign a task to**, you can pick a single agent or a team. A team's task goes to its lead. The lead splits it up, hands the parts to its team, checks their reports and gives you one combined result. Each hand-off appears under **Under way**, indented beneath the task it came from.

**Everything you assign is a task.** Work you give here joins the agent's queue on the Tasks page and comes back to you to review. If the agent is busy, it waits its turn.

**Approvals.** Each agent either **asks before any change** (the default) or **runs everything without asking**. If it asks, a step that changes something, such as running a command or editing a file, waits for you. After an agent has read anything from outside, such as a web page, every change asks first, whatever the setting.

**Budgets stop runaway work.** Each task has a spending limit and a step limit. The agent stops and asks when either runs out. A task and everything handed on from it share one budget. An agent, a group, or all your agents together can also have a monthly budget. Once it is reached, no new work starts until you raise it or the month turns. A task that reaches a monthly budget partway is stopped, and its work so far is kept.

**Receipts.** Every task has a receipt: what it cost in total and per agent, every action taken, and what was not done. Costs are estimated from each model's list price.

## How to…

**Assign a task**
1. Under **Assign a task to**, choose an agent or a team.
2. Write what to do and what a good result looks like, or click a suggestion to start from it.
3. If you have connected code repositories, choose one under **Repository** when the task is about your code.
4. Click **Assign task** (or **Assign to the team**), or press ⌘↵.

**Answer an approval**
1. Find the card under **Waiting on you**. It shows what the agent wants to do.
2. Click **Allow**, **Don't allow**, or **Always, for this task**. "Always" lets the agent take that kind of step without asking for the rest of that task.

**Follow one task**
1. Click a task under **Under way**, **Latest results** or **Completed work**, or click a working agent on the left.
2. The task page shows **Steps** on the left, the work in the middle and **Why**, **Budget**, **Model** and the agent on the right.
3. Use the tabs: **Conversation** shows everything the agent said and did. **Receipt** shows the costs. Code tasks also have a **Changes** tab.

**Talk to an agent during a task**
1. On the task page, open **Conversation** and type in the box at the bottom.
2. Click **Send**. While the agent is working, the button reads **Stop**, and clicking it stops the run.

**Continue a task that hit its budget**
1. Open the task. It shows **■ Hit its budget**.
2. In **Conversation**, type "continue" and send it. Continuing uses more budget.

**Review code changes**
1. On a code task, open **Changes**.
2. Click **Keep the changes**, **Ask for changes** (then say what to change), or **Undo whole task**.

**Read or save a receipt**
1. Open the task and click **Receipt**.
2. Click a part to see each action and whether it worked.
3. Click **Copy receipt** or **Save as a file**.

**Save a report for later**
1. On a finished task, click **Save the report as a page** and choose where it goes in your Workspace.

**See why a task exists**
1. On the task page, look under **Why**. It traces the task from your mission and goal, through the task you gave, down each hand-off to this one.

**Edit an agent**
1. Double-click an agent on the left, or click **Edit**.
2. Under **Role**, set its **Name**, **Job title**, **Department**, **Kind of work** and **Instructions**.
3. Under **Model**, keep the **Default model** or give it **A model of its own**.
4. Under **What it may do**, tick what it is allowed to do, such as **Search the web and read pages** or **Read and write files**. Its name, department, AI model and per-task limits are under **Advanced**; its symbol and colour are under **Change how it looks**.
5. Under **Limits**, choose **Approvals**, and set **Budget per run ($)**, **Steps per run** and **Monthly budget ($)**.
6. Click **Save**.

**Start a checked template**
1. Under **Ready-made tasks**, click one, fill in its fields and click **Start**.
2. If its check fails, the agent is sent back to fix it. If it still fails, **Hand to Claude** passes it to a stronger model.

## Tips

- Give big jobs to a team. The lead knows who does what.
- If "Waiting on you" is not zero, clear it first. Agents waiting for approval are not working.
- Raise **Steps per task** for agents that do long jobs, and lower **Budget per task ($)** for ones that should stay cheap.

## If something goes wrong

- **"Failed"** in Completed work: open the task. The reason is in a red banner. Fix it, then retry from the Tasks page.
- **"its own monthly budget is used up"**: raise **Monthly budget ($)** on the agent's page, or wait for next month. **"The … group: its monthly budget is used up"**: raise the group's monthly budget on the Organization page. **"All agents: the monthly budget for all agents is used up"**: raise it in Settings.
- **"6 quests are already under way"**: only six tasks run at once. Wait for one to finish, or stop one.
- **"✕ Check failed"**: open the task to see which check failed, and use **Hand to Claude** if it is offered.
- **"No model"** next to an agent: set one under Settings or on the agent's page.

## Related guides

- [Tasks and goals](tasks.md)
- [Inbox](inbox.md)
- [Chat](chat.md)
- [Organization](organization.md)
- [Settings and AI models](settings.md)
- [Getting started](getting-started.md)
