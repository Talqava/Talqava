# Office: Documents, Sheets and Notes

Office is where you and your agents write things that are not procedures: letters, proposals and reports under **Documents**, budgets and forecasts that calculate under **Sheets**, and quick notes, meeting notes and ideas under **Notes**. Everything stays on this computer.

## What you'll see

- **Documents**, **Sheets** and **Notes** in the menu on the left, under **Office**.
- **Documents.** A list of your documents by folder on the left. On the home screen: **+ New document**, a box to find a document, **Or ask an agent to write it**, anything **Waiting for you**, and a table of every document with who last changed it and who can read it.
- **Sheets.** A list of your sheet files by folder. On the home screen: **+ New sheet**, **Import a CSV file**, **Or ask an agent to build it**, anything **Waiting for you**, and a table of every sheet file.
- **An open sheet.** A title, a row of tools, a box showing what is in the selected cell, and the grid of cells. Under the grid are the sheets in the file and any charts. On the right is a panel with who can see it and how agents may change it.
- **Notes.** On the left: **+ Note**, **Search notes**, your **Notebooks**, your **Tags**, and the notes themselves, newest first.
- **An open document or note.** The same editor as a Workspace page: a title, a small toolbar, and the text. A document is shown as a sheet of paper. On the right is a panel with who can see it, how agents may change it, its **Folder** or **Notebook**, **Turn it into**, and **Download**.

- **Office home.** One place to start a document, sheet or note, ask an agent to make one, see what is **Waiting for you**, find recent files, **search** every file including the words inside, and **start from a template**.

## Key ideas

**Documents and notes follow the same rules as Workspace pages.** You choose who can see each one, an agent's change waits for you unless you let it through, **Protected** means agents never change it directly, and every version is kept in **History**. See [Workspace](workspace.md) for how each of these works.

**A note starts private.** No agent can find or read a new note, and it is never sent to an AI model, until you change **Who can see it**.

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

### Open or save Word and Excel files

- **Save a document as a Word file:** open it and press **Word file (.docx)** under **Download**.
- **Bring a Word file in:** on the **Documents** home screen, press **Import a Word file**. It opens as a new document.
- **Save a sheet as an Excel file:** open it and press **Excel file (.xlsx)** in its toolbar. Formulas go with it.
- **Bring an Excel file in:** on the **Sheets** home screen, press **Import an Excel file**. Each sheet in the file becomes a sheet here.

What is kept: text, headings, lists, tables, bold and italic; cell values, formulas and sheet names. What is not: fonts, colours, page layout, pictures, charts, merged cells and comments. A formula that uses a function Sheets does not have shows **#NAME?** after import. Older .doc and .xls files need saving as .docx or .xlsx first.

### Download or print

1. Open the document or note.
2. Under **Download**, press **Word file (.docx)** to get a file that opens in Microsoft Word and similar programs, or **Print or save as PDF**.

## What is not built yet

- Slides: a chart linked to a sheet, pictures, layouts other than a title with text, and saving as a PowerPoint file.
- Saving slides as a PowerPoint file, and opening one.
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
