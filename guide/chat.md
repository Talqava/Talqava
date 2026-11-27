# Chat

Chat is where you talk with your assistant, or with one of your agents, in a conversation. Ask questions, think things through, or have the assistant hand work to your team. Use chat when you want an answer now. Use a task when you want work done in the background.

## What you'll see

**On the right: Overview**, once there is something to show. Three short lists, so you can see where things stand without leaving the chat: **Waiting on you** (what needs your yes, in amber), **Working** (what your agents are doing now) and **Done today**. Click any line to open it in the Inbox. With nothing waiting, running or done, the panel is not shown; in a narrow window it is hidden too. The Inbox shows the same things.

**On the left**, once you have a session or a project (before that, the page is just the question and the box):

- **Project**: a menu to choose which project's chats you see, with **＋ New project**. "General" is the default.
- Your sessions: chats and the tasks you gave your agents, in one list. **Pinned** ones are at the top, then **Today**, then **Earlier**. A green dot means it is working, an amber one that it waits for you, a red one that it stopped before finishing.
- Point at a row and press **⋯** to **Pin**, **Rename**, **Archive** or (for a chat) **Delete** it. **Show archived** at the bottom lists the ones you put away; **Bring back** returns one to the list.

**In the middle:** the conversation, and a message box with **Send** at the bottom. At the top are the chat's title, how much it has used, and buttons to **Pin**, **Delete** and move it to another project. Under the message box you choose the AI model (for a chat with the assistant; how hard it thinks is **Effort**, under Settings), and there is a microphone if your copy of Talqava can write out speech. A chat with the assistant also has a menu to choose the AI model.

A new chat opens with a greeting and a few ideas to start from.

## Key ideas

**Two kinds of chat.**
- **With the assistant.** It can search the web, work with files and remember what matters to you. It can also hand tasks to any agent on your organization chart, or ask one a question. When the work comes back, it tells you what came back in its own words.
- **With one agent.** The chat uses that agent's job, instructions, powers, model and limits. If the agent leads others, it can hand them tasks, and their reports come back into the chat as "… reported back".

**Projects keep things apart.** A project here is a folder for chats with its own memory. A chat in a project uses that project's memory as well as your general memory. What it learns there stays in that project. (Projects on the Tasks page are a different thing: they group tasks under a goal.)

**What it did, in plain words.** When the assistant works through several steps (reads a file, searches the web, runs a command), the chat shows one line, such as "4 steps · Read prices.pdf". **Show the steps** lists each one in plain words; click a step to see exactly what was run and what came back.

**When an answer fails.** If the AI service cannot be reached or refuses, the chat says so in plain words and keeps saying so when you open it later; the session has a red dot in the list. **Try again** asks the same thing once more, without adding anything to the chat. In Telegram the assistant tells you it did not work, and you send your message again.

**Approvals in chat.** Before a step that changes something, the chat asks you first. You can change this: for the assistant in Settings, and for an agent on its own page under **Approvals**. After a chat reads anything from outside, such as a web page, every change asks first whatever the setting.

**Chat or task?** A chat waits for you and answers in the conversation. A task runs in the background, waits its turn in the agent's queue, and comes back to you to review.

## How to…

**Start a chat**
1. Open **New** in the menu, type your question in the box and press Enter. To see the chat page with your earlier chats, press **Your earlier chats** at the bottom of that screen, then **New chat**.
2. Type your message, or click one of the ideas.
3. Press Enter or click **Send**. Shift+Enter adds a new line.

**Chat with one agent**
1. Go to **Organization**, select the agent and click **Chat**. Or, in the **Marketplace**, click **Chat with** an agent already on your team.
2. The chat opens with that agent's name and role at the top.

**Ask the assistant to get work done by your team**
1. In a chat with the assistant, say what you need and who should do it, for example "Ask the Head of Sales to find ten wholesale bakeries near us".
2. The assistant hands it over as a task. The task waits in that agent's queue, and the report comes back into this chat.

**Assign an agent with @**
1. Click the box at the top of the window, or press ⌘K (Ctrl+K on Windows).
2. Type @ and the agent's name, then the task, for example "@sales Draft a follow-up for a quiet prospect".
3. Choose **Assign to** that agent and press Enter. This creates a task, not a chat.
4. If you type without @, choose **Ask in a new chat** to start a chat with it.

**Answer an approval**
1. The chat shows a card with the agent's question in plain words, such as "Send data to api.example.com?" or "Gmail: send email?", and one line on what exactly. **Show the details** opens the full step.
2. Click **Allow**, or **Don't allow**. Nothing happens until you do. **Always allow … in this chat**, under the card, lets it take that kind of step without asking for the rest of the chat.

**Stop a reply**
1. While the chat is working, the **Send** button reads **Stop**. Click it.

**Choose the AI model**
1. In a chat with the assistant, pick a model from the menu at the top.
2. Choose **Add or set up models…** to go to Settings. A chat with one agent always uses that agent's model.

**Organize chats**
1. Click **☆** next to a chat, or **Pin** at the top, to keep it at the top of the list.
2. Use the "In …" menu at the top to move the open chat to another project.
3. Click **＋ New project**, give it a name and click **Create project**.

**Delete a chat**
1. Click **✕** next to it in the list, or **Delete** at the top, and confirm. This cannot be undone.

## Tips

- For anything that takes more than a few minutes, give a task instead. The greeting has an **Assign an agent** link for that.
- Use a project for each client or piece of work, so their memory stays separate.
- Put everything the agent needs in your message. Agents you hand work to can't see the chat.

## If something goes wrong

- **The chat doesn't answer, or reports a model error**: no AI model is set up. Choose one with the model menu, or under Settings.
- **The assistant says it can't hand the work to anyone**: your organization chart has no agents yet. Add some on the Organization page or from the Marketplace.
- **The assistant says too many tasks are still open**: a chat can have at most eight hand-offs open at once. Wait for their reports, then ask again.
- **"Delete the chat? This cannot be undone."**: deleting a chat is permanent. Pin or move it to a project instead if you only want it out of the way.
- **A chat has a waiting dot**: it needs your approval. Open it and answer.

## Related guides

- [Tasks and goals](tasks.md)
- [Agents](work-in-progress.md)
- [Inbox](inbox.md)
- [Organization](organization.md)
- [Settings and AI models](settings.md)
- [Getting started](getting-started.md)
