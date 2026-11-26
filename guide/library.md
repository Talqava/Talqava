# Library

The Library holds your organization's files: contracts, price lists, policies, reports, spreadsheets and the like. Talqava reads each file so your agents can search inside it and quote the part they need. You decide, file by file or folder by folder, which agents may use it, or lock it as private.

## What you'll see

- **A toolbar.** The folder path (starting at **Library**), a box to **Find a file or folder by name**, a sort menu (**Name**, **Last changed**, **Size**), and the buttons **New folder**, **Upload files** and **Upload a folder**.
- **A status line.** How many files you have and how many are private. Inside a folder it shows that folder's AI access instead. On the right are **Show in Finder** and **Deleted**.
- **The file list.** Each row shows the name, an **AI access** chip (such as **All agents**, a group's name, or **Private**), the size and when it changed. Each file row also has **Open**, **Rename**, **Move** and **Delete**.
- **A preview panel** when you click a file. It shows the file (text, PDF, picture, video or sound), the buttons **Open**, **Show in Finder** and **Download**, and an **AI access** switch: **All agents**, **Some** or **Private**. It also says **Read for agents**: how many parts were read, or **Name only**.
- **Check what your agents will find**, a box near the bottom.

## Key ideas

**Your files stay on this computer.** The library is an ordinary folder; the line at the bottom of the page says where it is. You can add files through the app or straight into that folder; Talqava picks up changes the next time you open the Library page or an agent searches it.

**Agents only get the passages they need.** Talqava splits each readable file into short parts. When an agent works on a task, the few parts that best match it are put in front of the agent, and it can search for more. Only those matching parts are sent to the AI model, never the whole library. Agents are told to say which document an answer came from.

**What can be read.** PDF, Word, PowerPoint, Excel, text, Markdown, CSV, web pages and similar files. Pictures, videos and other files are kept and can be found by name, but their contents are not read. A scanned PDF (pictures of pages) has no text to read.

**Who may use a file.** There are four choices:

- **All agents can use it**.
- **Only some departments or agents**: tick the groups or the individual agents.
- **Private: locked from AI**: no agent ever sees, finds or reads it, and it is never sent to any AI model. Only you, in this app.
- **Same as its folder**: the file follows its folder's setting.

The library starts with a folder called **Everyone**, which every agent may use, and one folder per group, which only that group's agents may use. A file without its own setting follows the nearest folder above it that has one. The general Talqava assistant you chat with, which works for you directly, may use every file that is not private.

**Deleted files wait 30 days.** Anything you delete goes to **Deleted**, where you can put it back for 30 days. No agent can use anything in there.

## How to…

### Add files

1. Open the folder you want them in.
2. Press **Upload files**, or **Upload a folder** to bring a whole folder with everything inside it.
3. Or drag files and folders from your computer straight onto the list, or onto a folder row.

### Make a folder

1. Press **New folder**.
2. Type a name and press Enter.

### Choose who may use a file or folder

1. Click the **AI access** chip on its row.
2. Pick one of the four choices. For **Only some departments or agents**, tick who.
3. Press **Save**. A folder's setting covers everything inside it, unless something inside has its own setting.

To lock one file quickly, open its preview and press **Private**.

### Change several items at once

1. Tick the boxes on the left of the rows.
2. Use the bar that appears: **Move**, **AI access** or **Delete**. **Clear** unticks them.

### Move or rename

1. Drag a row onto a folder, or onto a folder name in the path at the top.
2. Or use **Move** and pick a folder, then press **Move here**.
3. To rename, press **Rename**, type, and press Enter.

### Find a picture by the words in it

A photo or screenshot you add (PNG, JPEG, WebP or GIF, up to 5 MB) is kept and found by its name. To find it by its words too, such as a receipt or a whiteboard:

1. Click the picture and, in its details, press **Read the words in this picture**.
2. Confirm. The picture is sent to your team's AI model, which writes out the words it sees; they are kept with the picture, so you and your agents can find it by them. It costs about as much as a short question.

This needs a Claude model as your team's model, because it can look at pictures. A picture whose sensitivity level may not be sent to that AI service is not sent; Talqava says so instead. The call appears under **Security › What was sent**.

### Check what an agent will find

1. Open **Check what your agents will find**.
2. Type a question, for example "what is our refund policy?".
3. Choose **As you** or one agent, and press **Search**. You see only what that agent is allowed to use.

### Put back or empty deleted files

1. Press **Deleted** on the status line.
2. Press **Restore** to put a file back where it was, or **Delete forever**.
3. **Empty Deleted** removes everything there for good. This cannot be undone.

## Tips

- Name files clearly. Agents see the names, and files that can't be read are found by name only.
- If a PDF shows **Name only**, it is probably a scan. Save a text version next to it.
- Use **Check what your agents will find** after changing access, to be sure an agent sees what it should, and nothing more.

## If something goes wrong

- **"That file is larger than 60 MB."** Very large files can't be uploaded through the app. Put it in the library folder yourself; files over 60 MB are skipped and not read.
- **"That file is empty."** The file has nothing in it. Check you picked the right one.
- **"There is already something called … here."** Choose another name, or put it in a different folder.
- **"A folder cannot go inside itself."** Drop the folder somewhere else.
- **"No text was found in this PDF. It may be a scan."** The file is kept, but only its name can be searched.
- **Not added: …** after an upload lists each file that failed and why.

## Related guides

- [Workspace](workspace.md)
- [Memory](memory.md)
- [Skills](skills.md)
- [Routines](schedules.md)
- [Settings](settings.md)
- [Getting started](getting-started.md)
