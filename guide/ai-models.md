# AI models

AI models is where you connect the AI services your agents think with: Claude, OpenAI, Google Gemini, Mistral, DeepSeek, Azure, Amazon Bedrock, Google Vertex AI, Portkey, a LiteLLM gateway and more than 20 others, or free models that run on your own computer. You pick a service, paste its key, and Talqava checks it and finds its models. Open it from **Connections → AI models**.

## What you'll see

- **Your connected services**, one row each, with **Models** and **Disconnect** buttons. The one your team uses is tagged **Your team's model**. A model program on this computer, such as Ollama, also shows whether it is running now and how many models it has.
- **Backup models**, once at least one service is connected.
- **Every service you can connect**, in groups: **The best-known model makers**, **Fast, low-cost hosts of open models**, **More model makers**, **One account for many models, or your company's own**, and **On this computer: free and private**.
- **Advanced: set up a service by hand, with its prices and size** (folded away), at the bottom.

## Key ideas

- **An AI service** is the company (or program on your computer) whose model does the thinking for your agents. Talqava itself is not an AI; it organizes the work.
- **Why connect more than one.** Your whole team uses one model, but any agent can use a different one: a strong model for managers, a cheaper one for automation work. A second service also gives you backups.
- **Backups keep work going.** If your main service is down, busy or out of credit, the first backup answers instead, then the next. Each switch is noted in the **Activity log**.
- **Keys stay on your computer.** A key is checked with its service before it is saved, kept on this computer, and only ever sent to that service. Agents never see it.
- **Local models are free and private.** Programs such as Ollama or LM Studio run models on your own computer. Nothing leaves it, but they are usually slower and less capable than paid services, and you must download a model in the program before Talqava can use it.
- **Prices are estimates.** Prices, sizes and whether a model can use tools come from two public lists of models, OpenRouter's and the LiteLLM project's, which need no account and are refreshed once a day. Your service's bill is the real figure.

## How to…

### Connect an AI service

1. Open **Connections** and choose **AI models**.
2. Find the service in its group and press **Connect**. A window opens with a link to where you get a key.
3. Get a key from that service's website, copy it, and paste it in.
4. Press **Connect**. Talqava says **Checking with…**, checks the key with the service and finds its models.
5. The models list opens. Press **Use for my team** beside the one you want, or close it to keep your current model.

Anthropic (Claude) is the standard choice and works best for agent work; web search and connectors run on Claude. OpenRouter has its own sign-in: press **Set up** on its card.

### Use a free model on your computer

1. Install a model program such as Ollama or LM Studio, download a model in it, and start it. A model that can use tools works best for agents.
2. Under **On this computer: free and private**, press **Find models on this computer**. Talqava connects every one that is running.
3. Or press **Connect** on one card. No key is needed.
4. Press **Models** beside it and choose **Use for my team**.

If the row says it has no models, download one in the model program first.

### Choose your team's model

1. Press **Models** beside a connected service.
2. Use **Find a model** to search. Each model says **Works for agents**, **Cannot use tools** or **Not known if it can use tools**, how much it holds and its prices.
3. Press **Use for my team**. The service shows the tag **Your team's model**.
4. If a model is not listed, type its name under **Or type a model's name** and press **Use this**.

Agents work through tools, so choose a model that **Works for agents**. Agents you gave a model of their own keep it. To test a model first, use **Check this model** in **Settings**.

**Is each service still working?** Talqava checks every connected service online now and then (every few hours, for free: the same request as when you connected it). A service whose key expired, or whose account ran out of credit, shows **Not working** here with what is wrong, and a message arrives in your Inbox. Connecting it again with a new key usually fixes it.

**A model for a group.** On the Organization page, open a group and choose **Model for its positions**: for example a strong model for leadership and a cheaper one for a whole department. The choices are your team's model and your backup models. An agent with a model of its own keeps it.

**More than one key for a service.** Press **+ Key** beside a connected service to add another key for it (up to five). The keys take turns, and when one reaches the service's rate limit, the others keep going. With only one key, Talqava waits up to 20 seconds for the limit to pass; for a longer wait, your backup model takes over. Each switch or wait is noted in the activity log.

For models on your computer, Talqava also shows each model's size and whether it fits in your computer's memory:
- **Too big for this computer's memory**: it would be very slow or not run. Choose a smaller one (models with 4b or 3b in the name are small). Talqava asks before using it.
- **Only just fits**: it works, but close other apps while agents use it.
- With Ollama, Talqava asks Ollama which models can use tools. With other local programs it recognises common families that can (Qwen 2.5 and 3, Llama 3.1 to 3.3, Mistral, GPT-OSS and others).

Checking a model on your computer first loads it into memory, which can take a minute or two. If it doesn't answer within 5 minutes, Talqava says so and suggests a smaller model.

### Add backup models

1. Connect at least one service. The **Backup models** box appears.
2. Choose a model from **Add a backup model…**. You can add up to four.
3. Use **↑** to change the order, and **Remove** to take one out.

Pick backups from a different company than your main model, so an outage at one does not stop the other.

### Disconnect a service

1. Press **Disconnect** beside it and confirm.
2. Its key is forgotten on this computer. If your team was using it, the team goes back to Claude, and any backups from it are removed.

### Set up a service by hand (Advanced)

For a service not in the list, or to set prices and size yourself:

1. Open **Advanced: set up a service by hand, with its prices and size**.
2. Fill in a short id, a name, its address (ending in /v1), and a key if it needs one.
3. Optionally add its price per million tokens in and out (a token is about three quarters of a word), and its context size: how much text the model holds at once.
4. Press **Add provider**.

Without prices, only the step budget can stop a task. Set the context size to what the model really holds, so long tasks are shortened to fit.

## Tips

- Connect two services from different companies: one for your team, one as a backup.
- Set a spending limit on each AI service's own website too, as a second safety net.
- For a company gateway such as LiteLLM, ask whoever runs it for its address and a key.

## If something goes wrong

- **"… did not accept that key."** Copy the whole key again from the service's website and connect again.
- **"That looks like a key for …, not …"** You pasted a key from another service into the wrong card.
- **"A key for … starts with …"** The key is incomplete or from the wrong page.
- **"… is not running on this computer."** Start the model program, then press **Connect** again.
- **"… could not be reached at …"** Check your internet connection, or the address you typed.
- **"… does not list its models, so type the name of the model you want."** Use **Or type a model's name**.
- **"No model runner is running on this computer."** Install Ollama or LM Studio, download a model, start it, then look again.
- **"That does not look like an Azure resource name."** Type only the first part of the address, for example my-company.
- **Google Vertex AI** needs a service account's key file, not a pasted key. In Google Cloud, open **IAM → Service accounts**, choose or create one with the **Vertex AI User** role, then **Keys → Add key → JSON**, and choose that file in Talqava. Leave the region empty for global. Some companies block key files by policy; ask whoever runs your Google Cloud. If Talqava says **"Google did not accept the service account key"**, the key was deleted or disabled: make a new one and connect again.
- **"That does not look like an AWS region."** For Amazon Bedrock, type your region, for example us-east-1. You can see it at the top right of the AWS console. The key is a Bedrock API key, made in the Bedrock console under **API keys**. Long-term keys expire on the date chosen when they were made; when one expires, connect again with a new key.
- **"Up to four backups."** Remove one before adding another.
- **"… rejected the API key."** during a task: the key was revoked or ran out. Connect the service again with a new key.

## Related guides

- [Connections](integrations.md)
- [Settings](settings.md) (testing a model, cost saving, approvals and budgets)
- [Activity log](audit-log.md)
- [Getting started](getting-started.md)
