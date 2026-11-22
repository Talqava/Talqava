# Talqava Agents

A self-hosted AI agent you run yourself. You talk to it on a private web page. It can:

- **Run code and commands** in its own working folder
- **Read and write files** there
- **Search and read the web** (and drive a real browser, optionally)
- **Call APIs**, using keys you store that it can use but never see
- **Remember** facts about you across every conversation, and search past chats
- **Write itself skills**: procedures it saves after working out how to do something
- **Work on a schedule**: "every weekday at 8, send me a digest" runs on its own
- **Use connectors** (remote MCP servers) for ready-made tools

It runs on Claude through the Anthropic API. You need an API key from [console.anthropic.com](https://console.anthropic.com); usage is billed to that key.

A map of how it is built is in [docs/architecture.html](docs/architecture.html) (open it in a browser), with the same content as data in [docs/architecture.json](docs/architecture.json).

The plan for turning this into a desktop app with a crew of bots, any model, and safe work on real code is in [docs/architecture-plan.md](docs/architecture-plan.md). It is a plan; only its first stage is built.

## Run it on your computer

You need [Node.js](https://nodejs.org) 22.18 or newer.

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:8787>. The first time, the Settings page asks for your Anthropic API key. Then start a chat.

Everything the agent knows is in the `data/` folder: chats, memory, skills, schedules, settings, and `data/workspace/`, the folder it works in. Back that folder up and you have backed up the agent. Delete it and the agent starts fresh.

Scheduled jobs run only while the agent is running. A job that came due while it was off runs once when it next starts.

## Run it on a server (always on)

On any small Linux server with Docker:

```bash
cp .env.example .env
```

Edit `.env`: set `ANTHROPIC_API_KEY` and a long `TALQAVA_PASSWORD`. Then:

```bash
docker compose up -d --build
```

The page listens on the server's own `127.0.0.1:8787` only. Reach it from your computer with an SSH tunnel:

```bash
ssh -L 8787:localhost:8787 you@your-server
```

and open <http://localhost:8787>. Tailscale, or an HTTPS reverse proxy such as Caddy in front of it, also work. Do not publish port 8787 to the internet over plain HTTP: the password would travel unencrypted.

Inside Docker the agent's shell can only touch the container and the `data/` folder, which makes "run everything without asking" a reasonable setting there.

## Safety

This is a program that lets an AI run commands. The guards it has:

- **Approvals.** By default it asks before every shell command, file change, API write and browser click. You can allow a tool for the rest of one chat, or switch approvals off in Settings.
- **Workspace.** The file tool cannot read or write outside `data/workspace/`. The shell starts there, but on your own computer a shell command can reach anything your user account can, which is why commands ask first. Use Docker for a hard wall.
- **Secrets.** Each stored key is tied to one host and is filled in outside the model's view. The shell does not inherit the agent's own API key or password.
- **The page.** Without a password it answers only as `localhost`, and refuses requests coming from other websites. It will not start on a network address without a password.
- **Web content.** The agent is told to treat what it reads as information, not instructions. That lowers the risk of a web page talking it into something; it does not remove it. Keep approvals on when it browses sites you do not trust.

## Settings

| Setting | Where | Notes |
| --- | --- | --- |
| API key | Settings page or `ANTHROPIC_API_KEY` | |
| Model | Settings page | Claude Opus 5.5 by default |
| Effort | Settings page | Higher thinks longer and costs more |
| Approvals | Settings page | Ask (default) or run everything |
| Password | `TALQAVA_PASSWORD` in `.env` | Required off `localhost` |
| Address | `HOST`, `PORT` in `.env` | Default `127.0.0.1:8787` |
| Data folder | `TALQAVA_DATA_DIR` in `.env` | Default `./data` |

## The optional browser

For pages that need clicking or typing:

```bash
npm install playwright
```

```bash
npx playwright install chromium
```

Restart, and the agent gains a `browser` tool. Without it, it still searches and reads the web.

## How the code is laid out

| Folder | What it is |
| --- | --- |
| `src/core` | The shared core: the agent loop, scheduling, the system prompt, and the tools every edition has. It reaches storage only through interfaces, so it does not care whether data lives in files or a database. |
| `src/local` | This edition: JSON file storage, the shell and file tools, and the web server. |
| `public` | The chat page. |
| `test` | Tests for the core (against in-memory storage) and for the local edition. |

The code is TypeScript. Node runs it directly, so there is no build step.

## Tests

```bash
npm run check
```

This type-checks the code and runs the tests. The tests run the agent loop against a stand-in for the Anthropic API, so they need no key and cost nothing.
