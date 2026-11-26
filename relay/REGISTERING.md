# Registering Talqava's apps with each service

For Talqava's maker. One app per service, registered in the company's name, so that owners sign in with nothing to register themselves. Do one service at a time and test it before the next.

The places and labels below are as each service's own pages described them in November 2026. Services move their menus; if a label is not where this says, look for the nearest match and keep the three things that matter exact: the **return address**, the **permissions**, and where the **secret** goes.

## The same for every service

- **App name:** Talqava
- **Return address** (also called Redirect URL, Callback URL or Redirect URI): `https://auth.talqava.com/callback.php`
  Type it exactly. No slash at the end, no spaces.
- **Client ID** (also called App ID or Application ID): safe to share. It goes in two places: the website's settings file, and the Talqava app (`RELAY_APPS` in `src/local/connector-kit.ts`).
- **Client secret:** goes in one place only, the website's settings file `talqava-auth-config.php`, one folder above `public_html`. Never in the app, never in this repository, never in an email or a chat.
- **After registering:** connect the service once from a fresh copy of Talqava (Connections, choose the service, press the sign-in button) and check that the tab says Connected.

## Services that need a secret (they go through auth.talqava.com)

| Service | Where to register | Kind of app | Permissions to choose | Line in the settings file |
|---|---|---|---|---|
| Asana | Asana developer console (My apps), Create new app | OAuth app | `users:read`, `workspaces:read`, `projects:read`, `tasks:read`, `tasks:write`, `stories:write` | `'asana'` (already there) |
| HubSpot | A HubSpot developer account, Apps, Create app | Public app | `oauth`, and read and write for contacts, companies and deals (`crm.objects.contacts.read`, `crm.objects.contacts.write`, and the same two for `companies` and `deals`) | `'hubspot'` (already there) |
| Typeform | Typeform account settings, Developer apps, Register a new app | OAuth app | Chosen at sign-in: `forms:read`, `responses:read`, `offline` | `'typeform'` (already there) |
| Todoist | Todoist App Management console, Create a new app | OAuth app | Chosen at sign-in: `data:read_write` | `'todoist'` (already there) |
| ClickUp | ClickUp Settings, Apps (ClickUp API), Create an App | OAuth app | None to choose: the person picks which Workspaces at sign-in | `'clickup'` (already there) |
| Mailchimp | In Mailchimp: Profile, Extras, Registered apps, Register An App | OAuth app | None to choose | `'mailchimp'` |
| Slack | api.slack.com/apps, Create New App. Add the return address under OAuth & Permissions, then turn on Manage Distribution, Activate Public Distribution so other workspaces can install it | Slack app with a bot. Do **not** turn on PKCE or token rotation: neither can be turned off again, and PKCE apps may not ask for a bot's permissions | Bot Token Scopes: `channels:read`, `groups:read`, `channels:history`, `groups:history`, `chat:write`, `users:read`, `users:read.email` | `'slack'` |
| Calendly | Calendly, profile menu, Developer, OAuth apps. Choose **Production** (a Sandbox app is separate). It takes exactly one return address | OAuth app | `users:read`, `scheduled_events:read`, `event_types:read` | `'calendly'`, with `'style' => 'basic_with_id'` |
| Klaviyo | klaviyo.com/manage-apps, Create app | OAuth app | `accounts:read`, `lists:read`, `lists:write`, `profiles:read`, `profiles:write`, `subscriptions:write` | `'klaviyo'`, with `'style' => 'basic'` |
| Jira | developer.atlassian.com/console/myapps, Create, OAuth 2.0 integration | OAuth 2.0 (3LO) | Add **Jira API**, then `read:jira-work`, `write:jira-work`, `read:jira-user`. The app must also be set to **Sharing** (distribution) before people outside the company can sign in | `'jira'`, with `'style' => 'json'` |
| Pipedrive | A Pipedrive developer sandbox account, Settings, Developer Hub, Create an app | Start with a private app to test; a public app needs Pipedrive's review before other companies can use it | Full access to deals, contacts and activities; read access to search and users | `'pipedrive'`, with `'style' => 'basic'` and `'pass' => ['api_domain']` |

`config.example.php` has each of these lines ready to copy, with the right address and style.

## Services that need no secret (they do not go through the website)

For these the app proves itself with a one-time proof made on the owner's computer (PKCE), so there is no secret to keep. Only the Client ID is needed, and it goes in `BUILT_IN_APPS` in `src/local/connector-kit.ts`.

Their return address is on the owner's own computer, not the website. Talqava's Connections page shows the exact address to register for each: open the service there and read step 2.

| Service | Where to register | Permissions | Not yet known |
|---|---|---|---|
| Xero | developer.xero.com, My Apps, New app, choose the kind for apps that cannot keep a secret (Auth Code with PKCE) | The ones listed on Talqava's Xero page | |
| GitLab | Each owner's own GitLab address differs, so one shared app is possible only for gitlab.com: User settings, Applications, untick Confidential | `api` | |
| Zendesk | Each account has its own address; a shared app needs Zendesk's global OAuth client, which is requested from Zendesk | `read`, `write` | Whether Zendesk grants one for this use |
| Square | developer.squareup.com/apps, the application's OAuth page, Production | `MERCHANT_PROFILE_READ`, `PAYMENTS_READ`, `ORDERS_READ`, `CUSTOMERS_READ`, `CUSTOMERS_WRITE`, `ITEMS_READ` | Whether Square accepts a return address on the owner's own computer in Production. Try it; if refused, Square moves to the table above |

## Services that stay on a key, and why

| Service | Why |
|---|---|
| Telegram | Its bots have a token and nothing else; there is no sign-in page for other apps. |
| Freshdesk | Its own pages describe only an API key. Its parent company has a sign-in for some of its other products; nothing confirms it covers Freshdesk. |
| WooCommerce | It has an approval page, but it hands the new key to a public https address, not to the browser. Receiving it would mean Talqava's website holding a shop's key for a moment, which the sign-in service is built never to do. |
| Brevo | It has a sign-in, but an app for other companies is made with Brevo's command-line tool and reviewed by Brevo first (about a week, by its pages). Its pages also give two different sets of addresses. Worth doing after the others; nothing is built for it yet. |
| Shopify | Owners already connect with their own app's ID and secret, exchanged for a short-lived token. One shared app for every shop needs Shopify's approval, and approval again for customer data. Worth doing after the others. |

## Things to know before registering Slack

- Slack limits how often an app that is shared with other workspaces but not listed in its Marketplace may read a channel's messages: once a minute, fifteen messages at a time. Posting is not limited this way. A Marketplace listing lifts the limit and needs Slack's review.

## Uploading again

Calendly needs one small change to `lib.php` on the website (the `basic_with_id` style). Upload the new `lib.php` before filling in Calendly's line. Nothing else on the website changes.

## What has been tried

- The website's pages have been tried with made-up values (see the README). No real app has been registered yet, so **no real sign-in has gone through any of these**. The first one registered is the test of the whole path.
- Klaviyo, Jira, Pipedrive, Square, Mailchimp, Slack and Calendly sign-ins are tested only against stand-ins that behave as each service's pages describe.
