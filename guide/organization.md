# Organization

The Organization page is your org chart. It is where you decide which AI agents work for you, which group (team or department) each one belongs to, and who reports to whom. Those lines matter: they decide who can hand work to whom, where requests between groups go, and who takes decisions up to whom.

## What you'll see

- **The heading.** Your organization's name and its mission underneath. If you have more than one organization, a drop-down next to the name lets you switch. The **Settings** button sits on the right.
- **The summary strip.** How many positions and groups you have, and the most your agents can spend in a month (their monthly budgets added up). If none are set, it says **No monthly limits set**.
- **Five views:** **Groups**, **Chart**, **List**, **Access** and **Memory**.
  - **Groups** shows a **You, the owner** bar at the top, then one box per group. Each box shows the group's lead first, with the rest of the group nested under whoever they report to.
  - **Chart** shows the whole tree, starting from you.
  - **List** puts each position on one row. You can change its group, who it reports to, and its dotted line right there in the row.
  - **Access** shows, for each agent and the Talqava assistant, everything it can reach: what it can do, whether it asks before changes, who it can hand work to, request work from and ask, which library documents and workspace pages it can read or change, and its limits.
  - **Memory** holds what the organization remembers: notes for everyone, for one group, and each agent's own notes and past work.
- **Buttons on the strip:** **Suggest positions**, **Undo** and **History**. **History** opens the audit log, where every change is recorded.
- **The Add bar** on the left. It has a search box (**Find a role or a team**) and the **+ Group** button. It lists **Your agents, not on the chart**, **Ready-made teams**, and roles **From the marketplace**.
- **The side panel.** Click a position or a group's heading and its details open on the right. Every field there can be edited.
- **Warnings** above the chart when something needs fixing, each with a button to fix it.
- **Status tags** on positions: **Working**, **Needs you** or **At budget**. A **Lead** tag marks the position that leads its group.

When the chart is empty, you see a starting panel instead: **Right now it's just you.** It has a box for your mission and two steps to get going.

## Key ideas

**Organization.** A complete setup: a chart, groups, a mission and settings. You can have several organizations, for example one per business. Your agents belong to you, not to an organization, so the same agent can appear in more than one.

**Mission.** One sentence about what the organization is for. Every agent is told it, and it shapes the positions the app suggests. You can also write **How you run it**, which is your management approach in your own words. Every agent is told that too.

**Positions.** A position is a job on the chart, such as "Head of Sales", filled by one agent. It has a title, an optional **Responsible for** note (the agent is told this), a group, and a manager. You can put a different agent into the same position and every line stays as it is.

**Groups.** A group is a team or department, such as Sales or Customer care. Every position belongs to one group. Each group has:
- a **Lead**. Work you give the group goes to the lead first, and requests from other groups arrive there too. If you don't pick a lead, the app picks the position at the top of the group. It may pick again as the group changes, so choose one yourself if you want it to stay.
- a **Purpose**. Its positions are told this.
- an optional **monthly budget** shared by everyone in the group.

**Who reports to whom.** These lines are the governance rules of your organization. The app enforces them, so your agents work the way your chart says:
- An agent can **hand work to** anyone below it on the chart, and to anyone on a dotted line to it.
- An agent can **request work from** the lead of another group. The lead accepts or declines it, because a request is not an order. Work for a group never goes around its lead.
- **Decisions go up** the line. When something isn't the agent's to decide, it goes to that agent's manager. For positions that report to you, it comes to you.

The side panel for each position spells this out under **How work moves for this position**. If a group has no lead, requests from other groups have nowhere to go. That's why the page warns you about it.

**Dotted lines.** A position can also work with a second position, for example a project lead. That second position can then hand it work too. A dotted line doesn't change the position's manager or group.

**Examples (structures).** Under **Settings → Copy an example**, you choose a kind of business and a way of organizing it. The options are **Functional departments**, **Traditional hierarchy**, **Matrix**, **Outcome teams** and **Flat**. The app then adds the example's positions and lines to your chart. It is only a starting point. It never removes or moves anything you already have, and afterwards work still follows the lines on your chart. To work differently, change the lines.

**Budgets.** Each agent can have its own monthly budget, and each group can have one for all its positions together. When a group reaches 80% of its budget, the page marks it as over 80% used. When it reaches 100%, it's used up: its positions start no new work until you raise the budget or the month turns. Work counts towards the group the agent was in when the task started.

**Approval limit.** In **Settings**, **Commitments above this many dollars need your approval** sets the amount. If you leave it empty, every spending, order or commitment needs your approval. Agents never pay, send or sign anything themselves.

**Proposals.** While working, an agent may decide your organization needs a role it doesn't have, and propose it. A proposal names the role, its group, who it would report to and why. Proposals appear at the top of the chart and in your Inbox. Nothing changes until you approve. If you decline, the agent won't propose that role again. An organization can have at most three proposals waiting at once.

## How to…

### Write the mission and settings
1. Click **Settings**.
2. Fill in **Name** and **Mission**, and if you like, how you run the organization.
3. Optionally set the approval limit.
4. Click **Save**.

### Get suggested positions
1. On an empty chart, type your mission and click **Suggest positions**. On a chart that already has positions, click **Suggest positions** on the strip.
2. Read each suggestion and its reason. Click **Accept** to add it or **Skip** to drop it. Click **Suggest others** for more.
3. Nothing is added until you accept it. If your main AI model can't be reached, suggestions are matched to the words in your mission instead.

### Copy an example
1. Click **Settings**. Under **Copy an example**, pick a kind of business and an example.
2. Click **Copy**, then confirm.

### Add a position
- **Drag** an agent or marketplace role from the Add bar:
  - onto a position, to report to it and join its group
  - onto a group's box, to join that group
  - onto **You**, to report to you
- Or **click** it to add it reporting to you.
- Type in **Find a role or a team** to search the marketplace.

### Add a ready-made team
1. Find it under **Ready-made teams** in the Add bar.
2. Drag it onto the position it should report to or into a group. You can also click it to put it under you. Its lead and members arrive together, and a single **Undo** takes the whole team back.

### Create a group
1. Click **+ Group** in the Add bar, or the **New group** box in the Groups view.
2. Enter a **Name**, choose a **Lead** (or **Choose later**), and add a purpose if you like.
3. Click **Create**. The lead moves into the group. Then drag other positions in.

### Change who reports to whom
- Drag a position onto another position. To add a dotted line instead, click the position and choose under **Dotted line: also works with** (or hold **Option** while you drop).
- Or open the position and change **Reports to** or **Dotted line: also works with**. The List view has the same choices in each row.

### Build the chart with the keyboard, without dragging
Everything dragging does can be done from the keyboard, and each change is announced to screen readers.
1. Press **Tab** to reach a row in the **Add** list, a position, or a group's heading.
2. Press **Enter** or **Space**. A row in the Add list joins the chart reporting to you. A position or a group opens its panel, and the focus moves into it.
3. In a position's panel, **Reports to**, **Dotted line: also works with** and **Group** move it; **Take off the chart** removes it. **Undo** takes back the last change.

### Edit a position
Click it, then change **Title**, **Responsible for** or **Group**. Changes save when you leave the field. The side panel also has these:
- **Give a task**
- **Chat**
- **Change** next to **Monthly budget** or **Model**, which opens the agent's own page
- **Put another agent in this position…**, to swap in someone else

### Set a group budget
1. Click the group's heading.
2. Type an amount in **Monthly budget, all its positions together ($)**. Leave it empty for no limit.
3. The group's box shows what it has spent this month against the budget.

### Remove a position or group
- **Position:** open it and click **Take off the chart**. Anyone who reported to it moves up to its manager. The agent stays on your team.
- **Group:** open it, choose where its positions should move, and click **Remove**. An empty group can be removed straight away.

### See what an agent can reach

1. Press **Access**.
2. Open an agent's card, or type its name in **Find an agent**.
3. Read what it can do, who it can hand work to and ask, which documents and pages it can read or change, and its limits. Anything not listed, it is refused.
4. To change it, press **Change its powers and limits**, or change who may see a library folder or a workspace page.

The first card is the Talqava assistant. It works for you, so by default it may read documents and pages limited to some groups (never Private ones). Untick **The assistant may read documents and pages limited to some groups** on its card to keep those to their groups only.

### Undo a change
Click **Undo** on the strip, or in the note that appears after a change. You can also press Cmd-Z when you're not typing in a box.

### Review proposals
Click **Approve** to add the position. Click **Decline** to turn it down, and optionally say why so the agent knows.

### Switch, add or delete organizations
- **Switch:** use the drop-down next to the organization's name.
- **New:** go to **Settings → New organization**, enter a name, and click **Create**. It starts with an empty chart.
- **Start over:** go to **Settings → Start over (empty chart)**. Every agent stays on your team, and chats, tasks and memory are kept.
- **Delete:** go to **Settings → Delete this organization**. This only appears when you have more than one organization.

### Export or import
In **Settings**, click **Export this organization** to save one readable file. It holds the chart and the agents you made or edited, but no keys, tasks, memory or library files. Click **Import an organization…** to load such a file as a new organization.

### Add to the organization's memory
1. Open the **Memory** view.
2. Type a fact, and choose **Whole organization** or a group.
3. Click **Remember this**. Click **Forget** to remove a note.

## Tips

- Start with a mission. It makes suggestions far better, and every agent works with it in mind.
- Give every group a lead. Otherwise other groups can't send it work.
- Keep it small at first. A few leads with one or two specialists each is easier to follow than a large example.
- Set group budgets so spending is capped across a whole team, not just per agent.
- Use **Responsible for** to say in plain words what you expect. The agent is told this.
- **Give a task** on a group's box sends the work to its lead, who shares it out and brings back one result.

## If something goes wrong

- **"X is above Y, so it cannot report to it."** Your chart can't loop. Move Y somewhere else first, or pick a different manager.
- **"A team joins with reporting lines. Drop it without Option…"** You can't add a ready-made team on a dotted line. Drop it without holding Option.
- **"A team cannot report to one of its own members."** Drop the team on a position that isn't part of it.
- **"There is already a group called…"** or **"There is already an organization called…"** Pick a different name.
- **"A group needs a name."** or **"An organization needs a name."** Fill in the name.
- **"A budget is dollars a month, from 0 to 100000."** Enter a whole amount in that range, or leave it empty for no limit.
- **"The approval limit is an amount in dollars."** Enter a number, or leave it empty.
- **"… already has a position here."** That agent is already on the chart. Take it off first, or choose someone else.
- **"Write the mission first…"** Add a mission in **Settings** before asking for suggestions.
- **"… has no lead, so requests from other groups have nowhere to go."** Click **Choose a lead**.
- **"… is not in a group."** Click **Choose a group**.
- **A group says "used up", or agents stop starting work.** The group or agent has reached its monthly budget. Raise it, or wait for the new month.
- **The group's Remove button is greyed out.** A group with positions in it can only be removed when there is another group to move them to. Create one first.
- **Deleted an organization by mistake.** This can't be undone. The agents themselves are kept, but the chart, along with that organization's memory and library, is removed. Export important organizations first.

## Related guides

- [Getting started](getting-started.md)
- [Tasks](tasks.md)
- [Agents](work-in-progress.md)
- [Marketplace](marketplace.md)
- [Settings](settings.md)
