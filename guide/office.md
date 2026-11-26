# Office: Documents, Sheets and Notes

Office is where you and your agents write things that are not procedures: letters, proposals and reports under **Documents**, budgets and forecasts that calculate under **Sheets**, and quick notes, meeting notes and ideas under **Notes**. Everything stays on this computer.

## What you'll see

- **Files** in the menu on the left. Its tabs across the top include **Office** (the home of this part), **Documents**, **Sheets**, **Slides** and **Notes**.
- **Documents.** A list of your documents by folder on the left. On the home screen: **+ New document**, a box to find a document, **Or ask an agent to write it**, anything **Waiting for you**, and a table of every document with who last changed it and who can read it.
- **Sheets.** A list of your sheet files by folder. On the home screen: **+ New sheet**, **Import a CSV file**, **Or ask an agent to build it**, anything **Waiting for you**, and a table of every sheet file.
- **An open sheet.** A title, a row of tools, a box showing what is in the selected cell, and the grid of cells. Under the grid are the sheets in the file and any charts. On the right is a panel with who can see it and how agents may change it.
- **Notes.** On the left: **+ Note**, **Search notes**, your **Notebooks**, your **Tags**, and the notes themselves, newest first.
- **An open document or note.** The same editor as a Workspace page: a title, a small toolbar, and the text. A document is shown as a sheet of paper. On the right is a panel with who can see it, how agents may change it, its **Folder** or **Notebook**, **Turn it into**, and **Download**.

- **Office home.** One place to start a document, sheet or note, ask an agent to make one, see what is **Waiting for you**, find recent files, **search** every file including the words inside, and **start from a template**.

## Key ideas

**Documents and notes follow the same rules as Workspace pages.** You choose who can see each one, an agent's change waits for you unless you let it through, **Protected** means agents never change it directly, and every version is kept in **History**. See [Workspace](workspace.md) for how each of these works.

**A note starts private.** No agent can find or read a new note, and it is never sent to an AI model, until you change **Who can see it**. The one other case is a picture you attach: pressing **Read the words** sends that picture, once, to your team's AI model.

**A document you make starts open to every agent.** Change **Who can see it** to limit it to some groups or agents, or make it private.

**A document an agent writes** can be seen by you, that agent and the agent's own group. Change that in the panel if others should see it.

**A sheet calculates.** Type a number or words into a cell, or a formula that starts with `=`. The cell shows the result; click it to see the formula. When a number changes, everything that depends on it changes too.

**Agents read the results and change cells under your rules.** An agent sees each cell's worked-out value with its formula beside it. When it wants to change cells, you see each one as "D3: 18400 → 19150" with its reason, on the sheet and in your **Inbox**, and the cells are outlined in the grid. Nothing changes until you press **Accept**. Agents can never change a cell you have locked.

**Agents' changes wait for you.** When an agent wants to change your document, you see what it would add and remove, with its reason, on the document and in your **Inbox**. Nothing changes until you press **Accept**.

## How to…

### Write a document

1. Open **Documents** and press **+ New document**.
2. Type a title, then write. Type `/` for headings, lists and tables. It saves as you type.
3. In the panel on the right, type a **Folder** such as Customers to keep related documents together.

### Ask an agent to write a document

1. Open **Documents**.
2. Under **Or ask an agent to write it**, say what the document should be, choose the agent, and press **Give the task**.
3. When the task is done, the document appears in **Documents**. The agent is told to follow your Workspace pages, such as your price list.

You can also give an open document to an agent from its panel: choose the agent under **Give this document to an agent**, say what to do, and press **Give the task**.

### Build a sheet

1. Open **Sheets** and press **+ New sheet**. Type a title.
2. Click a cell and type. Press **Enter** to move down; the arrow keys move up and down.
3. For a total, type a formula: `=SUM(B2:B6)` adds cells B2 to B6, and `=B2*1.1` is B2 plus ten percent. To use a cell on another sheet of the same file, write its name first: `=Rates!A1`.
4. To choose how numbers look, select the cells and pick **Number**, **Money** or **Percent** in the first box of the tools.
5. To select several cells, click the first, then hold **Shift** and click the last.

Formulas can use: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ROUND, ROUNDUP, ROUNDDOWN, ABS, IF, IFERROR, AND, OR, NOT, SUMIF, COUNTIF, CONCAT, LEN, UPPER, LOWER and TODAY, with + - * / ^ and comparisons such as > and <>.

### Bring a CSV file in, or take a sheet out

1. On the **Sheets** home screen press **Import a CSV file** and pick the file. It becomes a new sheet file. Anything in the file that starts with `=` comes in as plain words, not as a formula.
2. In an open sheet press **Export CSV** to download the sheet you are looking at, with its results.

### Lock cells so agents cannot change them

1. Select the cells, such as your headings and totals.
2. Press **Lock for agents**. Locked cells are shown with fine stripes. You can still change them yourself.
3. To undo, select them and press **Unlock**.

### Add a chart

1. Select the cells to chart: a column of names and a column of numbers next to it, or one row of numbers.
2. Press **Bar chart** or **Line chart** and give it a name. The chart appears under the grid and follows the numbers.
3. Press **Remove** on a chart to take it away.

### Keep several sheets in one file

Under the grid, press **+ Add a sheet**, **Rename** or **Remove this sheet**. Click a sheet's name to switch to it.

### Ask an agent to work on a sheet

1. To have one built: on the **Sheets** home screen, say what it should work out under **Or ask an agent to build it** and press **Give the task**.
2. To have an open sheet updated or checked: in the panel on the right, choose the agent under **Ask an agent about this sheet**, say what to do, and press **Give the task**.
3. Review its changes under **Waiting for you** at the top of the sheet. Press **Accept** or **Decline**.

### Take a quick note

1. Open **Notes** and press **+ Note**.
2. Type a title and the note. Use the checklist button in the toolbar for things to do.
3. In the panel, type a **Notebook** such as Meetings, and **Tags** separated by commas.

### Make a presentation

1. Open **Slides** and press **+ New slides**.
2. Each slide has a **Slide title**, the text **On the slide** (a few short points, one on each line starting with `- `), and **Speaker notes** that only you see.
3. Press **+ Slide** to add one after the current slide. **Move earlier**, **Move later** and **Delete slide** rearrange them.
4. Press **Present** to show them full screen. Arrow keys or a click move on; **Esc** leaves.
5. **Print or save as PDF** puts one slide on each page.

To put a chart on a slide, press **Add a chart from a sheet** under the slide's text, choose the sheet and the chart, and press **Add to the slide**. The chart is read from the sheet each time the slide is shown, so it always matches the sheet's numbers. In a PowerPoint file it goes as a line of words naming the chart.

To have an agent draft slides, use **Or ask an agent to draft them** on the Slides home screen: choose a document, sheet or note to build from, or describe the subject. An agent's change to slides you already have waits for you: **Look at them**, then **Accept** or **Decline**.

### Start from a template

1. Open **Office home** and scroll to **Start from a template**: a proposal, a quote, a payment reminder letter, meeting notes, a monthly budget and a cash forecast.
2. Press **Use this template**. A new file opens with the parts to fill in marked in [SQUARE BRACKETS].
3. Delete the file if you do not want it. The same templates are in the **Marketplace** under **Office templates**.

### Keep a note or document at the top

1. Open it and tick **Pinned** in the panel. Pinned files come first in their list.

### Be reminded of a note or document

1. Open it. Under **Remind me**, pick a date and time.
2. When the time comes, a reminder appears in your **Inbox**. **Open it** or **Done** clears it.

### Attach a photo or file to a note or document

1. Open the note. In the panel, under **Attachments**, press **Attach a photo or file**, or drop files onto that box. Each file can be up to 15 MB.
2. A picture shows as a small preview; click it to see it larger. Click a file's name to download it. **Remove** deletes it.
3. To find a note by the words in a photo (a receipt, a whiteboard, a business card), press **Read the words** beside the picture and confirm. The picture is sent to your team's AI model once, which writes out the words it sees. From then on, searching Notes for any of those words finds the note. **Show words** shows what was found.

### Record a voice memo in a note

1. Open the note. Under **Attachments**, press **Record a voice memo**. The first time, your computer asks whether Talqava may use the microphone; allow it.
2. Speak, then press **Stop recording** (20 minutes at most). The memo is attached to the note with the date and time in its name, and a player to listen to it.

A voice memo is kept as sound on this computer. Talqava does not write it out as text yet, and it is not sent to any AI service. If recording does not start on a Mac, open **System Settings › Privacy & Security › Microphone** and switch Talqava on.

Reading the words needs a Claude model as your team's model, and the note's sensitivity level must be one your rules let that AI service receive. Attachments stay with you: agents are not given them, even on a note you share.

### Save a web page as a note

1. Open **Notes** and press **Save a web page as a note**.
2. Paste the page's address. Its text is saved as a private note in the notebook **Saved from the web**, with the address at the top.

### Find a note

1. Type in **Search notes**, or
2. Click a notebook, or a tag, to see only those notes. Click the tag again to see all notes.

### Let agents read a note

1. Open the note.
2. In the panel, under **Who can see it**, choose **Every agent** or **Only some groups or agents**.

### Turn a note into something else

In the panel, under **Turn it into**:

- **A document**: it moves to **Documents**, for when a note grows into a letter or proposal.
- **A Workspace page**: it moves to the Workspace, for when it becomes a procedure your agents should follow.
- **Something to remember**: its text is saved to **Memory**, so your agents remember it in later tasks. This works for short notes.

To make it a task, choose an agent under **Give this note to an agent** and press **Give the task**. Share the note with that agent first, or the agent cannot read it.

### Turn a checklist item into a task

1. Open a note or document that has a checklist (lines starting with an empty box).
2. In its side panel, under **Checklist**, press **Make a task** beside an item.
3. Choose the agent and press **Create task**.

The item then shows its task and how far along it is; press it to open the task. The note itself is not changed.

### Find what agents noted for you

When an agent has a short finding worth keeping, it can save it as a note. These notes go to the **From agents** notebook under **Notes**, so you find them in one place.

### Open or save Word, Excel and PowerPoint files

- **Save a document as a Word file:** open it and press **Word file (.docx)** under **Download**.
- **Bring a Word file in:** on the **Documents** home screen, press **Import a Word file**. It opens as a new document.
- **Save a sheet as an Excel file:** open it and press **Excel file (.xlsx)** in its toolbar. Formulas go with it.
- **Bring an Excel file in:** on the **Sheets** home screen, press **Import an Excel file**. Each sheet in the file becomes a sheet here.
- **Save slides as a PowerPoint file:** open them and press **PowerPoint file (.pptx)**. Titles, bullet points, bold and italic, and speaker notes go with it; a table goes as lines of text.
- **Bring a PowerPoint file in:** on the **Slides** home screen, press **Import a PowerPoint file**. Each slide's title, text, tables and notes come in; pictures, charts, colours and animations do not.

What is kept: text, headings, lists, tables, bold and italic; cell values, formulas and sheet names. What is not: fonts, colours, page layout, pictures, charts, merged cells and comments. A formula that uses a function Sheets does not have shows **#NAME?** after import. Older .doc and .xls files need saving as .docx or .xlsx first.

### Give groups and agents different levels

By default one setting covers everyone who can see a file. To let some read, some comment and some edit:

1. Open the file. In its side panel, under **Levels**, press **Set a level for each group**.
2. Choose a level for **Every agent**, then for each group, and under **Agents by name** for single agents:
   - **No access**: cannot find or read it.
   - **Read**: reads it; changes nothing.
   - **Comment**: reads it and leaves notes for you.
   - **Suggest**: its changes wait for you to accept.
   - **Edit**: changes it straight away; every version is kept.
3. Press **Save levels**. The most specific level wins: an agent's own, then its group's, then the one for every agent.

A **Protected** file never goes above **Suggest**, and a **Private** file is for you alone, whatever the levels say. **Back to the simple settings** removes the levels. This works the same on pages, documents, sheets, slides and notes, and tables follow their page.

### Read and answer comments

1. Open the file. **Comments** in its side panel lists notes from you and from agents that may comment.
2. Type in **Leave a comment** and press **Add comment**, or press **Resolve** on one that is dealt with.

### Put a file in a project

1. Open the document, sheet, slides or note. In its side panel, choose a project under **Project**.
2. The file is then listed under the project's **Files** tab, and agents working on that project's tasks are told about it.
3. You can also start a new file from the project itself: open the project, go to **Files**, and press **+ Document**, **+ Sheet**, **+ Slides** or **+ Note**.

Every file's side panel has the same parts in the same order: who can see it, how agents may change it, **Protected**, **Sensitivity**, **Project**, giving it to an agent, the tasks that used it, **History** and **Delete**.

### Download or print

1. Open the document or note.
2. Under **Download**, press **Word file (.docx)** to get a file that opens in Microsoft Word and similar programs, or **Print or save as PDF**.

## What is not built yet

- Slides: pictures, and layouts other than a title with text.
- Notes: voice memos written out, and searching the words in photos.

## Tips

- Keep prices and rules in the [Workspace](workspace.md), and tell agents to write documents from them. Then one change to the price list is followed everywhere.
- Use **Protected** for contracts and anything that must never change without you.
- Tables of records (customers, stock) can be added under a document's text, as on a Workspace page.

## If something goes wrong

- **#DIV/0!** in a cell: the formula divides by zero or by an empty cell.
- **#NAME?**: the formula uses a function the sheet does not know. Check the spelling against the list above.
- **#REF!**: the formula points at a sheet that is not in this file. Check the sheet's name.
- **#VALUE!**: the formula does arithmetic on words. Check the cells it points at hold numbers.
- **#CYCLE!**: the formula depends on its own cell, directly or through other cells.
- **#ERROR!**: the formula cannot be read. Check its brackets and quotation marks.
- **An agent says a cell is locked.** You locked it. Unlock it, or change it yourself.
- **"This note is too long to remember whole."** Memory is for short facts. Put the part that matters in a shorter note and remember that.
- **"This page has pages inside it. Move them out first."** A Workspace page with pages inside it cannot become a document or note. Move the inner pages out, then try again.
- **An agent says it cannot find a note.** Notes are private. Open the note and change **Who can see it**.
- **The Word file looks plain.** The download carries the text, headings, lists and tables. Fonts and page layout are set in Word.

## Related guides

- [Workspace](workspace.md)
- [Tasks](tasks.md)
- [Memory](memory.md)
- [Inbox](inbox.md)
