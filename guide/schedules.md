# Routines

Routines let work happen by itself at set times: a morning news digest every weekday, a check of last week's orders every Monday, a month-end reminder, or a one-off job on a certain date. You write the instructions once, choose when they run and who does them, and each run ends with a short report of what was done.

## What you'll see

- **A note at the top** saying routines run while Talqava is open.
- **Your routines**, one card each. A card shows the name, when it runs in plain words (for example "Every weekday at 8:00 am"), when it runs next (or **paused**), when it last ran, who does it, and the instructions.
- **Buttons on each card:** **Last run**, **Run now**, **Edit**, **Pause** or **Resume**, and **Delete**.
- **New routine**, a form with **Name**, **When**, **Who does it** and **Instructions**, and an **Add routine** button.

## Key ideas

**A routine is a name, a time, someone to do it, and instructions.**

**Choosing when.** The **When** box gives you plain choices, all in your computer's time:

- **Every day**, **Every weekday (Monday to Friday)**, **Every week** (pick the day) or **Every month** (pick a date from the 1st to the 28th, which every month has), each at a time you choose.
- **Every few hours** or **Every few minutes**: pick how many.
- **Once**: pick a date and time. After it runs, the routine shows as paused.
- **Custom (advanced)**: for anything else, type the timing by hand, such as **every 30m**, **at 2027-01-15T09:00**, or a cron line such as **0 9 \* \* 1-5** (9:00 am on weekdays). The card still shows it in plain words when it can.

**Choosing who does it.**

- **The Talqava assistant, in a chat** (the standard choice). Each run starts a fresh chat titled with a clock (⏰) and the routine's name. It finishes with a short report.
- **An agent from your organization chart, as a task in their queue.** Each run becomes a task on the **Tasks** board for that agent, with the routine's name as its title. It waits its turn in the agent's queue like any other task. The agent can hand parts to the people below them, and the result comes back to you **To review**, where you accept it or send it back. This is the best choice for regular work that belongs to a department, such as a weekly sales pipeline for your Head of Sales.

**A routine belongs to the position.** When you put a different agent into a position (Organization → the position → change who fills it), its routines carry on with the new agent. A position's panel on the Organization page lists its routines, with **+ Routine** to add one.

If the position you chose leaves the chart, the assistant does the job instead, and the **Activity log** says so. The card tells you, and you can **Edit** it to choose someone else.

**Routines run while Talqava is open.** Talqava checks for due routines every few seconds. In the Mac app, closing the window keeps Talqava running in the background; choosing **Quit** stops it. If Talqava was stopped or your computer was off when a routine was due, it runs once as soon as you open Talqava again, then carries on as normal.

**Approvals still apply.** A run follows your **Approvals** choice in **Settings**:

- **Ask me before commands, file changes and API writes** (the standard). When a run wants to make a change, such as running a command, changing a file, sending data to another service or clicking in a web page, it stops and waits for you. It shows on **Agents** under **Waiting on you**.
- **Run everything without asking.** The run goes ahead on its own. Even so, once it has read outside content, such as web pages, every change asks you first.

Reading and searching never need approval. Your spending and step limits apply to routined runs too.

**You can also ask in a chat.** Say "every weekday at 8am, send me a summary of new orders", and the Talqava assistant (or any agent with the **Routines** power) sets it up. It then appears on this page, where you can change it.

## How to…

### Add a routine

1. Under **New routine**, type a **Name**, for example "Morning news digest".
2. In **When**, choose how often, then the day and time.
3. In **Who does it**, keep the assistant, or choose an agent from your organization.
4. In **Instructions**, write what should be done each time, as you would to a new colleague. The run can't ask you questions first, so include everything it needs: where to look, what to produce, and where to put it.
5. Press **Add routine**. The card shows when it runs next.

### Change a routine

1. Press **Edit** on its card.
2. Change the name, the time, who does it or the instructions.
3. Press **Save changes**. A new time starts counting from now, and a paused routine starts again.

### Try a routine straight away

1. Press **Run now** on its card.
2. If the assistant does it, the new chat opens so you can watch. If an agent does it, the **Tasks** board opens on the new task.

### See what a routine did

1. Press **Last run** on its card. It opens the latest run's chat, or its task on the **Tasks** board.
2. Read the report. For a task, accept it or send it back with a comment.

### Pause, resume or delete a routine

1. Press **Pause** to stop it for now. The card shows **paused**.
2. Press **Resume** to start it again; it runs at the next time due.
3. Press **Delete** and confirm to remove it. Past runs, their chats and tasks, are kept.

## Tips

- Press **Run now** after adding a routine, to check the instructions do what you expect.
- Give regular department work to that department's lead, so it lands in their queue and comes back to you for review.
- For a routine that makes changes, leave approvals on **Ask me…** until you trust it.
- Keep Talqava running, and your computer awake, at the times your routines are due.

## If something goes wrong

- **"Give the routine a name, e.g. Morning news digest."** Fill in **Name**.
- **"Write the instructions: what should be done each time?"** Fill in **Instructions**.
- **"That time is already in the past."** A **Once** date has already gone. Pick a future date and time.
- **"That time could not be read…"** A **Custom** routine was not in a form Talqava understands. Choose one of the plain options instead, or use one of the forms shown.
- **"The shortest interval is 1 minute."** Use **Every few minutes** with 1 or more.
- **"Choose an agent from your organization chart, or the Talqava assistant."** The agent you picked is not on the chart of the organization you have open. Choose again.
- **"That one-time job has already passed."** You pressed **Resume** on a **Once** routine that already ran. **Edit** it and pick a new date.
- **A routine seems stuck.** It is probably waiting for your approval (see **Waiting on you** on **Agents**), or, for an agent, waiting its turn in the queue (see **Tasks**).

## Related guides

- [Tasks and goals](tasks.md)
- [Agents](work-in-progress.md)
- [Organization](organization.md)
- [Chat](chat.md)
- [Settings](settings.md)
- [Getting started](getting-started.md)
