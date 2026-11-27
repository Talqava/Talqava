# Connections

Connections connect Talqava to the tools your business already uses, so your agents can work where the work is. Today there are five: **AI models** for the AI services your agents think with, **OpenRouter** for hundreds of models through one account, **Git and GitHub** for code and documents kept in repositories, **Connectors and AI apps** for using your team from Claude and for giving agents tools from other services and **API keys for other services**. Each one says plainly what agents can and cannot do with it.

## What you'll see

- **Connections** at the top, with a **search box**: type a service's name, or what you want to do, such as "email" or "invoice".
- **Everything**, **Connected**, **Available** and **Coming** buttons, each with a count, to show only those.
- **Category buttons**, from **Email and calendar** to **Advanced**, to show one kind of service.
- A card for each service with its name, a one-line status, a short summary of what agents could do with it, and a badge: **Connected**, **Not set up**, **Unavailable** or **Coming**.
- **Set up →**, **See what it can do →** or **Manage →** on each card. A service marked **Coming** is planned and cannot be connected yet; it is listed so you know where it stands.
- **← All integrations** on a service's own page takes you back.

## Key ideas

- **Your keys stay on your computer.** A key or sign-in is kept on this computer and is only ever sent to its own service. Agents never see it.
- **You stay in charge of changes.** Agents work on code in a separate copy, and connector tools ask before changing anything.
- **Removing is safe.** Removing an integration forgets its sign-in here. It does not delete anything on GitHub or OpenRouter.

## How to…

### Connect an AI service

Open **AI models**, press **Connect** on a service, paste its key and press **Connect**. Talqava checks the key and lists the service's models. The [AI models guide](ai-models.md) covers it all: free models on your computer, choosing your team's model, backups, and setting up a service by hand.

### Connect OpenRouter (one account for hundreds of models)

OpenRouter lets you pay one balance and use models from many companies. It is useful if you want to try different models, or give a cheaper one to automation work.

1. Open the **OpenRouter** card.
2. Press **Connect OpenRouter**. openrouter.ai opens in your browser. Sign in or make a free account.
3. Press **Authorize** on openrouter.ai. You can set a spending limit for the key there.
4. Come back to Talqava. The page notices by itself; while it waits it says **Waiting for you to approve on openrouter.ai…**

Already have a key? Open **Already have an OpenRouter key?**, paste it (it starts with sk-or-), and press **Save key**.

### Choose the model your team uses on OpenRouter

1. On the connected OpenRouter page, look at **Your account** for what you have used and any limit.
2. Under **Which model your team uses**, search (try "claude", "gpt" or "free") and pick an order: **Suggested first**, **Cheapest first**, **A to Z** or **Longest documents first**.
3. Each model shows a rough cost **about $… a task** and how much text it holds.
4. Press **Use for my team**. Agents you gave a model of their own keep theirs.

Press **Add credit** to top up on openrouter.ai, or **See activity on openrouter.ai** to see the real charges.

### Connect GitHub and choose repositories

A repository is a folder of code or documents with a full history of changes. The page shows **Three steps**.

1. Open **Git and GitHub**. If it says **Git is not on this computer yet**, press **Install Git**, follow the Mac installer, then press **Check again**.
2. Under **GitHub**, press **Connect GitHub**. A short code appears and GitHub opens in your browser. Type the code, press **Continue**, then **Authorize**. This page carries on by itself.
3. If one-click sign-in is not set up, Talqava shows **Connect with an access token** instead: open GitHub's token page, press **Generate token**, copy it, paste it and press **Connect**.
4. Press **Choose repositories**. Pick your own account or your company under **Whose repositories?**.
5. Tick the ones you want and press **Copy here and connect**. Each is copied to your computer. Nothing on GitHub changes.

### Use a repository for a task

1. On a connected repository's card, press **Use for new tasks**, or choose it in the **Repository** box at the top of **Agents**.
2. Assign a task to an agent that can change files.
3. When the task stops, its page shows the changes. Press **Keep the changes** or **Undo**.

### Connect a folder already on your computer

1. Open **Already have a repository on this computer?**
2. Press **Search this computer for repositories** and then **Connect** beside one. Or type its location under **Connect a folder by its location** and press **Connect**.
3. To copy one from a web address, paste it under **Copy one from a web address** and press **Copy it here and connect**.

### Use your Talqava team from Claude

1. Open **Connectors and AI apps**.
2. Under **Use your Talqava team from Claude**, press **Add Talqava to Claude**. Nothing else in Claude's settings changes, and a copy of them is kept first.
3. Quit Claude completely and open it again. Keep Talqava open while you use it.
4. Ask Claude, for example, "What agents are on my Talqava team?" Claude can see your team, give an agent a task, read how it went, list recent tasks, and search or add to your organization's memory. Work that changes files or sends something still waits for your approval in Talqava.

### Connect your WordPress website

1. Open **Connections** and press **WordPress** (under **Websites**).
2. In your WordPress site, open **Users › Profile**, scroll to **Application Passwords**, type the name Talqava and press **Add New Application Password**. Copy the password it shows.
3. Back in Talqava, type your site's address and your WordPress user name, paste the application password, and press **Check and connect**. Talqava checks it with your site before saving.
4. Choose **What agents may do on this site**:
   - **Agents write drafts only; I publish them in WordPress** (the starting choice). Nothing an agent writes is public until you publish it.
   - **Agents ask me before each publish.** Each post waits for your approval.
   - **Agents publish without asking.** Whatever an agent writes goes live straight away.

Agents with the **connected services** power can then read your posts and pages, save drafts, and update a post or page. They never delete anything, and WordPress keeps earlier versions under **Revisions**. On a drafts-only site an agent cannot change a post that is already public.

A post can be given **categories**, **tags** and a **featured image**. Agents choose only from the categories your site already has (add new ones yourself in WordPress), make tags as needed, and pick the featured image from pictures already in your site's media library. They do not upload pictures.

### Have an agent write a blog post every day

1. On the **WordPress** page, find your site and **Have an agent write a blog post on a schedule**.
2. Say what your blog is about, choose the agent, the days and the time, and press **Set up the automation**.
3. Each run, the agent reads your recent posts so it does not repeat one, follows your Workspace pages, writes the post and saves it as a draft (or publishes it, if you allow that). Change, pause or remove it under **Automations**.

To ask for one post or one change by hand, give a task in your own words, such as "Write a post about our winter opening hours for the blog" or "Update the About page on our website with our new address".

### Connect a built-in service (HubSpot, Mailchimp, Slack, Asana, Trello, Calendly, Typeform, Zendesk, GitLab, Xero, Pipedrive, Todoist, Jira, ClickUp, Klaviyo, Square)

These services are built into Talqava and all work the same way.

1. Open **Connections** and choose the service, for example **Asana**.
2. Read **What agents can do**: what they can read, what they can change, and what they can delete (deleting always asks you first).
3. Sign in:
   - **Asana, HubSpot, Typeform, Trello, Zendesk, GitLab, Xero, Todoist, ClickUp, Square, Klaviyo, Jira, Pipedrive and Mailchimp** sign in through your browser. The page shows **Sign in to** the service first. The service asks for an app registered with it; you register your own once, following the numbered steps on the page, then press the button and approve in the browser. The tab says **Connected**. For Trello you copy only its public API key; there is no token to copy.
   - Where Talqava has its own app registered with a service, there are no steps: press the button, sign in and approve. For some of these the page says the sign-in passes through Talqava's website (auth.talqava.com). That website completes the sign-in with the service and keeps nothing; your sign-in is stored only on your computer. You can still register and use your own app instead.
   - If you would rather paste a key, open **Use a key instead** on the same page.
   - **Slack and Calendly** send your browser back only to a secure website address, which an app on your own computer cannot be. So their browser sign-in appears once Talqava's maker has registered Talqava's app with them; until then they connect with a key: follow the numbered steps, paste it, and press **Check and connect**.
   - Talqava offers only services that can sign in through your browser. Shopify, WooCommerce, Freshdesk, Brevo and Telegram were removed for that reason; if you had connected one, its saved key was forgotten when Talqava updated, and nothing at the service was changed.
   
   Talqava checks the sign-in with the service before saving it.
4. Choose **What agents may do with this account**:
   - **Agents only read; they change nothing.**
   - **Agents ask me before each change** (the starting choice).
   - **Agents make changes without asking.** Changes happen straight away in your real account, so choose this only for work you trust.

What each one does:

- **Slack**: read the channels the bot has been invited to, and post messages and replies. You make the bot in your own Slack workspace; the page lists the permissions to give it.
- **Asana**: see projects and tasks, add tasks, change them or mark them done, and comment.
- **HubSpot**: find and read contacts, companies and deals; add and change them. It connects with a HubSpot service key.
- **Mailchimp**: see audiences and campaigns, look people up, and add or update someone on a list. Adding someone always says how they start: with Mailchimp's confirmation email first, subscribed at once, or recorded without sending. Agents do not create or send campaigns.
- **Trello**: see boards, lists and cards; add, change, move and archive cards; comment.
- **Calendly**: see booked meetings, who booked them and their answers, and your booking links. Reading only.
- **Typeform**: see forms and the answers people sent. Reading only.
- **Zendesk**: see and search support tickets and read their conversations; add internal notes, change a ticket's status or priority, and open a ticket. A reply to the customer always asks you first, because Zendesk sends it to them. It signs in through your browser: a Zendesk administrator adds an OAuth client of the kind **Public** once (the page lists the steps), and you type your subdomain and its Identifier. A new ticket can start a task.
- **GitLab**: see your projects, issues and merge requests and read their comments; open an issue, comment, close or reopen an issue, and change its title or labels. Agents do not see or change code. It works with gitlab.com or your company's own GitLab: you add an application under your GitLab profile once (the page lists the steps), then type your GitLab address and paste its Application ID. No secret is needed.
- **Xero**: see sales invoices and bills, contacts, the chart of accounts, profit and loss and the balance sheet; add a contact; and draft an invoice or bill. A draft is never approved or sent from Talqava: you review and approve it in Xero. You add an app of the kind **Auth Code with PKCE** in Xero's developer pages once (the page lists the steps) and paste its Client ID; it has no secret. Xero lets a new app connect up to five organisations and make 1,000 requests a day for each.
- **Pipedrive**: see and search deals, people and organizations; add them; move a deal to another stage or mark it won or lost; add notes; plan a call, meeting or task. Sign in through your browser with an app you make in a Pipedrive developer sandbox account, or use the simpler way: your personal API token and your company domain (the first part of yourcompany.pipedrive.com).
- **Todoist**: see your projects and open to-dos (also with a Todoist filter such as *today | overdue*); add, change, comment on and tick off to-dos. Deleting a to-do always asks you first. Sign in through your browser with an app you make in Todoist's App Management Console, or paste your API token.
- **Jira**: see projects, find and read issues with their comments; open an issue, comment, move it to another step, change its summary or labels, or assign it to yourself. Sign in through your browser with an app you make in Atlassian's developer console, or connect with your site name, your Atlassian email and an API token of the plain kind (not the kind with scopes). Atlassian's tokens expire after at most a year; make a new one then and connect again. A browser sign-in renews itself.
- **ClickUp**: see your spaces, folders and lists, the tasks in a list and the tasks assigned to you; add tasks, change them (for example their status), and comment. Sign in through your browser with an app a workspace owner or admin makes under Settings › Apps, or paste your personal API token (it starts with pk_).
- **Klaviyo**: see lists and profiles, add a person or update their name, and take someone off a list. Subscribing someone to a list records their consent and always asks you first; on a double opt-in list Klaviyo emails them to confirm. Campaigns are not included yet. Sign in through your browser with an app you make in Klaviyo, or paste a private key.
- **Square**: see payments, orders, customers, locations and items with prices, and add a customer. Agents take no payments and give no refunds. Sign in through your browser with the Application ID of an application you create in Square's Developer Console; Talqava then asks only to see payments, orders, customers and items and to add customers. If Square refuses the return address on your computer, use the application's Production access token instead; that token reaches everything in your own Square account.

Talqava checks every few hours that each key still works. If a service stops accepting its key, the account shows **Needs attention**, and your Inbox gets a note saying which connection and why; make a new key and connect again, and the account keeps its settings.

You can connect more than one account of a service. To disconnect, press **Disconnect** on the account; its key is forgotten and nothing in the service is changed.

### Choose which agents may use an account, and which actions are on

On a connected account of a built-in service:

- **Which agents may use it:** tick agents to limit the account to them. With none ticked, every agent with the "connected services" power may use it.
- **Which actions are on:** untick an action to switch it off for that account, for example changing prices. Agents are then not offered it.

### Start a task when something happens (a new order, email, booking or form answer)

1. Open the service under **Connections** and, on the connected account, open **When something happens**.
2. Choose the event, the agent that should handle it, and say what the agent should do each time.
3. Press **Start watching**.

Talqava looks every five minutes. Only things that happen after you set it up start a task, each thing starts one task only, and at most five start at a time. The task shows up like any other and waits for your review. You can **Pause** or **Remove** it on the same card.

Events today: a new payment (Square), a new email (Gmail, Outlook), a new booking (Calendly) and a new form answer (Typeform).

What the service sends, such as the words of an email, is given to the agent as information, never as instructions. Each task costs what the AI model charges, so watch a busy inbox with care; with Gmail you can limit it to emails matching search words.

### Connect Gmail, Google Calendar, Google Drive, Outlook or OneDrive

These sign in through your browser instead of a pasted key. Google and Microsoft ask for an app registered with them; you register your own once (about ten minutes, free), and it stays yours. The service's page in Talqava lists the exact steps.

1. Open **Connections** and choose the service, for example **Gmail**.
2. Follow the numbered steps to register your app, then paste its **Client ID** (and, for Google, its **Client secret**).
3. Press **Sign in**. Your browser opens the service; approve, and the tab says **Connected**. Go back to Talqava.
4. Choose what agents may do with the account, as for any built-in service.

What each one does:

- **Gmail** and **Outlook**: search and read email, and write drafts and replies. A draft is never sent by itself: **sending always asks you first**, whatever rule you chose.
- **Google Calendar** and **Outlook's calendar**: see events and free time; add, change and remove events. Removing always asks first. On Google, guests are emailed only when you ask for that; on Outlook, agents add events without guests, because Microsoft emails every guest at once.
- **Google Drive** and **OneDrive**: find files, read text files (and Google Docs, Sheets and Slides as text), and save new text files. Agents never replace an existing file.

Good to know:

- **Google asks you to sign in again every seven days** while your Google app is in "Testing", which is the case for a personal Google account. With Google Workspace, choose **Internal** when registering and there is no such limit. When a sign-in runs out, the account shows **Needs attention** and your Inbox gets a note.
- One Google project serves Gmail, Calendar and Drive; you sign in to each separately, so each gets only the permission it needs.

### Give agents tools from another service (a connector)

1. On the **Connectors and AI apps** page, under **Add a connector**, type a short name and the web address the service gives you.
2. Add an access token only if the service needs one.
3. Press **Add connector**. Remove it any time with **Remove**.

A connector that runs as a program on your computer is added further down the same page, under **All connectors, and ones that run on this computer**: give it a name and the program to run, then press **Add connector**.

### Talk to your assistant from Telegram

You can write to your Talqava assistant from your phone, in a private Telegram chat, and it answers as it does in the app.

1. In Telegram, open a chat with **@BotFather** (the one with the blue tick) and send `/newbot`. Give the bot a name, then a username ending in "bot".
2. BotFather answers with a token: digits, a colon, then letters. Copy it.
3. In Talqava, open **Connections**, choose **Telegram**, paste the token and press **Check and connect**.
4. Talqava shows a 6-digit code. In Telegram, open a chat with your new bot, press **Start**, and type the code. The page says **Connected**.

From then on, write to the bot as you would in Talqava. `/new` starts a fresh conversation.

- **It answers only you.** The first chat to type the code is the only one it answers. Anyone else who finds the bot is told it is private, and nothing they write reaches your assistant.
- **Approvals stay in Talqava.** Anything that would send, change or delete waits for your yes in the Inbox. The bot tells you so, and writes again once you have answered there.
- **It answers while Talqava is running** on your computer.
- **Text only for now.** Voice notes, photos and files are not read.
- **What you write passes through Telegram's servers**, as in any Telegram chat. Do not use it for things you would not put in Telegram.
- Telegram offers no sign-in page for bots, so this is the one connection that uses a pasted token. To stop, press **Disconnect**: the token is forgotten and the bot stops answering.

### Store a key for another service

So agents can call a service that has no integration of its own, without seeing your key:

1. Open **API keys for other services**.
2. Type a name in capitals (for example WEATHER_KEY), the key, and the host it may be sent to (for example api.example.com).
3. Press **Add key**. Agents use it by name; the value is only ever sent to that host. Press **Remove** to forget it.

## Tips

- Only agents that can change files get their own branch. The Git page lists them. Others can read a repository but not change it.
- Agents never push, merge or deploy. Those stay with you.

## If something goes wrong

- **"WordPress refused that…"** The user name or application password is not accepted. Make a new application password under **Users › Profile** and paste it again. Some security plugins switch application passwords off; allow them for your user.
- **Your web host drops the sign-in details.** Some hosts remove the sign-in before it reaches WordPress. Talqava notices and uses WordPress's older entrance (called XML-RPC) instead, where the sign-in travels inside each request; you do nothing, and agents work the same way. The site's card says it is connected through WordPress's older entrance when this is the case.
- **"…did not receive your user name and password… also tried WordPress's other entrance."** The host drops the sign-in details and the older entrance is switched off too, usually by a security plugin or the host. Either allow `xmlrpc.php`, or ask your host to "pass the Authorization header to PHP" (on many hosts, adding this line near the top of the site's `.htaccess` file does it: `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1`), then connect again.
- **"…sent the request on to another address."** Use the exact address your browser shows when you open your site, with or without `www`, starting with `https://`.
- **"That address does not answer as a WordPress site."** Check the address. Some hosts or plugins switch off the site's REST API, which this needs.

- **"GitHub did not accept the token. It may have expired or been revoked."** Make a new token and connect again.
- **"The code ran out before it was approved."** Press **Connect GitHub** for a new code.
- **"GitHub would not list the repositories of …"** Your company must allow Talqava first. See **My company is not listed**.
- **"An agent is working in that repository right now. Stop its task first."** Wait for the task, or stop it, before removing the repository.
- **"A repository needs at least one commit before an agent can work on it."** The folder has no saved history yet. Save a first version with Git, then try again.
- **"This sign-in has expired or was already used."** Press **Connect OpenRouter** again.
- **"OpenRouter did not accept that key."** Check the key at openrouter.ai/keys.
- **"The saved key no longer works."** Press **Connect OpenRouter** to connect again.
- **"The Claude desktop app was not found on this computer."** Install Claude, open it once, then come back.

## Related guides

- [Settings](settings.md) (AI models, connectors, API keys)
- [Agents](work-in-progress.md)
- [Tasks](tasks.md)
- [Activity log](audit-log.md)
- [Getting started](getting-started.md)
