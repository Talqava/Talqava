# Talqava's sign-in service

A few small pages that run on Talqava's own website (auth.talqava.com), so that an owner can connect a service by signing in, with nothing to register or paste.

## Why it exists

Many services give an app a **secret** when it is registered. A secret must never be put inside an app that runs on someone's computer, because anyone could read it there. So for those services:

1. Talqava's maker registers one app with the service.
2. The app's **ID** (safe to publish) goes in the Talqava app. The **secret** goes in this service's settings, on the website.
3. When an owner signs in, the service sends the browser to `callback.php` here, which sends it straight on to the Talqava app on the owner's own computer.
4. The Talqava app asks `token.php` to swap the one-time code for tokens, and later asks `refresh.php` to renew them.

## What it keeps

Nothing. It has no database and writes no log of codes or tokens. The tokens a service returns go straight back to the Talqava app that asked, and are kept only on that owner's computer.

What it does see, as it passes through: the one-time code, and the tokens in the service's answer. The privacy policy says so.

## The pages

| Page | Called by | What it does |
|---|---|---|
| `callback.php` | The owner's browser, sent by the service | Sends the browser on to `http://localhost:<port>/api/oauth/callback`. Only ever to localhost; the port comes from the `state` the Talqava app made. |
| `token.php` | The Talqava app | `POST` JSON `{service, code, code_verifier?, asked?}`. Adds the app's ID and secret and asks the service for tokens. |
| `refresh.php` | The Talqava app | `POST` JSON `{service, refresh_token, asked?}`. Renews. |
| `lib.php` | The pages above | What they share. Does nothing when opened by itself. |
| `index.html` | Anyone | A line saying what this address is for. |

Answers are JSON: the service's `access_token`, `refresh_token`, `expires_in`, `token_type` and `scope`, or `{"error": "…"}`.

## Putting it on the website

1. Upload `callback.php`, `token.php`, `refresh.php`, `lib.php` and `index.html` into the subdomain's folder (on this hosting: `public_html/auth`).
2. Copy `config.example.php` to **one folder above `public_html`** and name it `talqava-auth-config.php`. It must not be inside `public_html`.
3. For each service, register an app in the company's name with the return address `https://auth.talqava.com/callback.php`, and paste its ID and secret into that file. [REGISTERING.md](REGISTERING.md) says where, which kind of app and which permissions, service by service.
4. Put the same ID in the Talqava app (`RELAY_APPS` in `src/local/connector-kit.ts`). Until then the Talqava app does not use this service for it.
5. Open `https://auth.talqava.com/` and check it shows the one line. Open `https://auth.talqava.com/token.php` and check it answers `{"error":"Send this with POST."}`.

It needs PHP 8.1 or newer with the curl extension.

## Care taken

- `callback.php` redirects only to `http://localhost` with a port between 1024 and 65535. It cannot be used to send someone to another website.
- A value that becomes part of a service's address (an account's subdomain) must look like one label of a host name.
- Requests to a service go only over https, follow no redirects, and stop after 20 seconds.
- Only the fields the Talqava app needs are passed back.
- Nothing is cached, and nothing secret is written to an answer or a log.

## What it does not do yet

- It does not limit how often one address may call it. The hosting's own protection is relied on for that.
- It has been read through carefully but **not yet run**: the computer it was written on has no PHP. The Talqava app's side is tested against a stand-in that behaves as these pages are meant to. Before it holds a real secret, each page should be tried once on the website with a test app.
