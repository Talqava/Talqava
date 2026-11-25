# Security: people, roles and sign-in

Security is where you decide who can open Talqava, how they prove who they are, and what each person may do. It is for the people in your business. Your agents' limits are set on each agent's page and shown under **Organization › Access**.

## What you'll see

- **Security** in the menu on the left, under **Oversight**.
- **Where you stand**, at the top: how many protections are on, anything that needs you now, each protection in plain words with what to do next, and **Download a security report**. The report states your settings for your records or an auditor; it is not a certificate.
- **Before you turn it on:** a note that one person uses Talqava without signing in, and a form to make your own account.
- **After you turn it on:**
  - **Your sign-in**: your name, role, whether your second step is on, and a form to change your password.
  - **People**: everyone with an account, their role, whether their second step is on, and when they last signed in.
  - **What each role may do.**
  - **Rules for everyone**: require a second step, how long before people are signed out, and who is signed in now.
- **Sign out** at the bottom of the menu.

## Key ideas

**Off by default.** With nobody added, Talqava works as it always has: whoever uses this computer can do everything, with no sign-in. That suits one owner on their own computer.

**Once on, everyone signs in, including you.** Each person has their own email and password. Passwords are stored in a scrambled form that cannot be turned back into the password.

**Roles decide what a person may do.**

| Role | May do |
| --- | --- |
| **Owner** | Everything, including people and security. There is one owner. |
| **Administrator** | Everything except changing or removing the owner. |
| **Manager** | Gives and approves work; changes the chart, budgets, routines and the Marketplace. No settings, connections or people. |
| **Member** | Gives tasks, chats, approves steps, and edits pages, documents, notes and sheets. Cannot change the chart, budgets, settings or connections, or read the audit log. |
| **Auditor** | Reads everything, including the audit log and who has access. Changes nothing. |

These limits are enforced by the app itself. A person who tries something their role does not allow is told so, and the attempt is written in the audit log.

**A second step.** With a second step on, signing in needs a 6-digit code from an authenticator app on the person's phone as well as the password. A stolen password alone is then not enough.

**Sensitive changes ask for your password again.** Changing people, roles, the rules for agents or sensitive information, or where the audit record is sent asks you to type your password again, unless you did in the last 10 minutes. This stops someone at an unlocked computer from changing your security. You can turn it off under **Rules for everyone**.

**Wrong passwords lock the account.** After 5 wrong passwords an account is locked for 15 minutes. An administrator can set a new password to unlock it sooner.

**The audit log names people.** Once people are set up, each entry in the **Audit log** says who did it and their role.

**Sensitivity levels decide what may reach an AI service.** Every page, document, note, sheet and Library document has a level: **Public**, **Internal** (the starting level), **Confidential** or **Restricted**. Under **Sensitive information** you decide, for each level, where it may be sent: any connected AI service, only approved services, only models on this computer, or no AI model at all. An agent whose AI service may not receive a level is not given those items; it is told why, so it says so in its report, and the attempt is logged. A **Restricted** item is also hidden from every agent you have not named on it. Until you change these rules, every level may go to any service, as before.

**What is stored, and how it is protected.** Talqava keeps its data on this computer. What sits on the disk is protected by the computer's own disk encryption (FileVault on a Mac, BitLocker on Windows); **Backups and stored data** tells you whether it is on. Backups are encrypted by Talqava itself with your passphrase, so a copy kept elsewhere cannot be read without it. Talqava does not add a second layer of encryption to the files on this disk, or keep keys in a company key service.

**Alerts and reviews.** Under **Alerts and reviews**, Talqava lists what deserves a look from the last 7 days: a run of refused sign-ins, changes to people or rules, and agents refused again and again. Alerts are shown here and in your monitoring system if you connect one; Talqava does not send email.

**Agent guardrails are rules above every agent.** Under **Agent guardrails** you set rules for the whole installation: whether changes always ask a person, whether agents may run commands, use connected services or the web, which sites are approved, and the most a task may spend or run. An agent's own settings can be stricter than these, never looser. They work whether or not people and sign-in are turned on, and apply to tasks that start after you change them.

## How to…

### Turn on people and sign-in

1. Open **Security**.
2. Type your name, your email and a password of at least 12 characters. A few unrelated words work well.
3. Press **Turn on people and sign-in** and confirm. You are now the Owner, and signed in.

### Add a person

1. Under **People**, fill in **Add a person**: their name, email, role and a first password.
2. Press **Add person**.
3. Tell them the password in person. They should change it after signing in, under **Your sign-in**.

### Change someone's role, or remove them

1. Find them under **People**.
2. Choose another role in the **Role** column. They are signed out and sign in again with the new role.
3. To remove them, press **Remove**. They are signed out at once.

### Set up your second step

1. Under **Your sign-in**, press **Set up a second step**.
2. Open an authenticator app on your phone and add an account by typing the key shown.
3. Type the 6-digit code the app shows and press **Turn on**.

### Require a second step for everyone

1. Under **Rules for everyone**, tick **Require a second step for everyone**.
2. Anyone without one is asked to set it up the next time they sign in, before they can do anything else. Set up your own first.

### Help someone who is locked out

- **Forgot their password, or locked after wrong tries:** press **New password** next to their name, type one, and tell it to them in person.
- **Lost their phone:** press **Lost phone** to take off their second step. They sign in with their password and set it up again. Do this only when you are sure it is really them asking.

### See who is signed in, or sign everyone out

1. Under **Rules for everyone**, press **See who is signed in**.
2. Press **Sign everyone else out** if a computer was lost or you are unsure. You stay signed in.

### Mark something as sensitive

1. Open the page, document, note or sheet.
2. In its side panel, under **Sensitivity**, choose **Confidential** or **Restricted**.
3. For **Restricted**, also name the agents who may read it: under **Who can see it**, choose **Only some groups or agents** and tick those agents by name. Being in a ticked group is not enough for a Restricted item.

A page made inside a sensitive page starts at the same level. Tables follow their page. A Library document's level is set in its details in the **Library**. Memory has one level as a whole, set under **Sensitive information**.

### Decide which AI services may receive each level

1. Open **Security** and find **Sensitive information**.
2. For each level, choose where it may be sent. **Use the recommended settings** sets Confidential to approved services only and Restricted to models on this computer only.
3. Under **Approved AI services**, tick the services you trust. Check each service's terms first: that it does not train on your data, and where it processes it.

### Sign in with your company account (single sign-on)

1. In your identity provider (Microsoft Entra ID, Google Workspace, Okta, or another that supports OpenID Connect), register a new web application called Talqava.
2. Under **Single sign-on** in Talqava, copy the **redirect address** shown and give it to your provider.
3. Copy the provider's **issuer address**, **client ID** and **client secret** into Talqava and press **Turn on single sign-on**. Talqava checks the provider answers before saving.
4. Choose who gets in: only people you have already added under **People** (their email must match), or anyone your provider signs in, who then joins with the role you pick. You can limit it to your email domains.
5. Open Talqava in a private window and press **Sign in with your company account** to try it, while you stay signed in here.
6. When it works, you can tick **Only single sign-on** to switch passwords off for everyone except the owner. The owner's password stays as the emergency way in.

### Limit sign-in to your networks

1. Under **Rules for everyone**, type your office or VPN network ranges under **Only allow signing in from these networks**, one on each line, such as `203.0.113.0/24`.
2. Press **Save the networks**. Signing in, and using Talqava, from anywhere else is refused. The computer Talqava runs on is always allowed, so you cannot lock yourself out of it.

### Keep records for a set time, or stop all deleting

1. Under **Alerts and reviews**, find **Keeping and deleting records**.
2. Choose how long chats and finished tasks are kept. Once a day, older ones are deleted for good. Pinned chats, running work and tasks with changes you have not kept or undone are never deleted.
3. Tick **Legal hold** when records must be kept for a dispute or investigation. While it is on, the daily deletion stops and every **Delete** button is refused.

### Answer someone who asks what you hold about them

1. Under **Keeping and deleting records**, type their name or email under **Find everything about one person** and press **Search**.
2. Talqava lists every page, document, note, sheet, Library document, memory, chat and task where it appears. **Download this list** for your records.
3. Open each place to correct or delete it. Talqava does not erase it for you, because a name can sit inside text you still need.

### Back up everything, encrypted

1. Under **Backups and stored data**, type a passphrase of at least 12 characters and press **Set up backups**. Write the passphrase down somewhere safe: without it a backup cannot be opened, by you or anyone.
2. Change the folder if you want backups kept somewhere that is copied off this computer, such as a synced drive.
3. A backup is made every night while Talqava is open. Press **Back up now** to make one straight away. The newest 7 are kept.
4. Press **Test a restore** now and then. Talqava opens the newest backup with your passphrase and reads every file back, without changing anything, so you know it works before you need it.

### Get your data back from a backup

1. Press **Restore into a new folder** and type your passphrase. The backup's files are written to a new folder named `restored-…` next to Talqava's data folder. Your current data is not touched.
2. To switch to the restored copy: quit Talqava, rename the current `data` folder (for example to `data-old`), rename the `restored-…` folder to `data`, and open Talqava again.

### Do an access review

1. Under **Alerts and reviews**, press **Start a review**. Talqava lists every person and every agent with what each can do.
2. For each line, press **Still right** or **Needs a change**, and add a note if you like.
3. Make any changes on the usual pages (**People**, or the agent's page); marking a line only records your answer.
4. Press **Finish the review**. It is recorded in the audit log, and the next one is due in 90 days.

### Send events to your monitoring system

1. In your monitoring system, create an address that accepts events over HTTPS (often called a webhook or HTTP collector).
2. Under **Alerts and reviews**, paste it into **Send every event to your monitoring system**, add a signing secret if your system checks one, and press **Start sending**.
3. Every audit entry is then also sent there as it is written. If a delivery fails, the page says why and tries again with the next event.

### Hold agents to approved websites

1. Under **Agent guardrails**, set **The web** to **Only the sites approved below**.
2. Type one site on each line, such as `example.com`, and press **Save the list**. A site covers its pages and sub-sites.
3. An agent that tries another site is refused, told not to look for a way round, and the attempt appears under **Refused by these rules**.

### Make every change ask a person

1. Under **Agent guardrails**, set **When an agent wants to change something** to **Always ask a person first**.
2. From then on, no agent runs changes without asking, even one you had set to run without asking, and "always allow" no longer skips the question.

### Cap what a task may spend or how long it may run

1. Under **Agent guardrails**, type an amount in **Most one task may spend** or a number of minutes in **Longest one task may run**.
2. Leave a box empty for no extra cap. An agent with a lower budget of its own keeps it.

### Stop every agent at once

1. Under **Agent guardrails**, press **Stop everything** and confirm.
2. Every agent on your chart pauses. Resume them from **Tasks**.

## Tips

- Give each person the lowest role that lets them do their job. Most people are Members.
- Make your accountant or adviser an **Auditor**: they can check everything and change nothing.
- Turn on **Require a second step for everyone** before letting people open Talqava from other computers.

## What is not built yet

- Single sign-on has been tested against a stand-in provider only, not yet against a real one. SAML, and adding and removing people automatically from your directory (SCIM), are not built: remove a leaver under **People** as well, or they keep their role if they are ever let back in.
- Limiting sign-in to computers your company manages, and needing two administrators for a security change.
- Approved networks are checked against the address the connection comes from. Behind a proxy or tunnel that hides it, every connection looks the same.
- Approved sites hold page reading, including redirects, and the AI service's own web search. Calls to web services with saved keys and the built-in browser are checked at the address the agent gives; a redirect or a link clicked inside the browser is not checked yet.
- Whether an item may leave by email or a connector; suggesting a higher level when card numbers or payroll figures are spotted; and a view of exactly what was sent to AI services.
- Rules by kind of action (send, pay, delete) with named approvers, and a list of approved connectors and Marketplace items.
- Limiting a manager or member to their own groups: a manager can change the whole chart.
- Handing the Owner role to someone else.
- Using your Talqava team from the Claude app while sign-in is on.

## If something goes wrong

- **"That email and password do not match."** Check both. The message is the same whether the email or the password is wrong, on purpose.
- **"Too many wrong passwords."** Wait 15 minutes, or ask an administrator for a new password.
- **"That code is not right."** Type the code the app shows now; codes change every 30 seconds. Check the phone's clock is set automatically.
- **An agent says it could not read something marked Confidential or Restricted.** Its AI service is not allowed that level, or it is not named on a Restricted item. Change the level, name the agent, approve its service under **Sensitive information**, or give the task to an agent that runs on a model on this computer.
- **"Your role does not allow that."** Ask an owner or administrator to do it, or to change your role.
- **The owner forgot their password and nobody else is an administrator.** On the computer Talqava runs on, quit Talqava, open its data folder, and move the file `people.json` out of it. Talqava then starts without sign-in and you can turn it on again. Everyone's accounts are made again; nothing else is lost. Anyone who can do this already has full use of that computer.

## Related guides

- [Audit log](audit-log.md)
- [Organization](organization.md)
- [Settings](settings.md)
