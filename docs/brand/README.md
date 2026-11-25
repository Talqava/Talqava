# Talqava brand guide

Talqava is the operating system for a business run with AI agents: the layer between people and any AI model or agent that gives the work an org chart, rules, memory and a receipt. The brand should feel like a well-run operations desk: calm and exact, with one green signal for what needs doing.

## The logo

The mark is a **T made of two parts**: a white bar, the layer Talqava adds on top, and a green block under it, the cursor of work in progress. It sits on a black rounded tile, so it reads the same on any background.

| File (in [logos/](logos)) | Use it for |
| --- | --- |
| `talqava-mark.svg` | App icon, favicon, avatars, anywhere square. Works on any background. |
| `talqava-lockup-dark.svg` | The main logo on dark grounds (dark grounds): website header, decks, the app's sign-in screen. |
| `talqava-lockup-light.svg` | The main logo on light grounds: documents, invoices, light slides. |
| `talqava-wordmark-dark.svg` / `-light.svg` | Wordmark with its cursor, where the mark already appears nearby (the app's top-left corner). |

**Wordmark.** TALQAVA in capitals, drawn as single-weight strokes the same thickness as the mark's bar (one eighth of its height). Corners on A and Q are rounded to 12 of 56 units; everything else is square. Written in running text the name is **Talqava**, capital T only.

**Clear space.** Keep space-8 (32px) clear around a 64px tile; scale it with the logo (half the tile's side).

**Smallest size.** Tile 16px on screen, 6mm in print. The lockup no smaller than 24px tall.

**Do not** recolour the bar or the cursor, put the mark without its tile on a mid-grey, stretch or rotate it, add shadows or glows, or set the name in another font in its place.

## Colour

Light is the default look of the product, and every colour has a light and a dark value. The exact values, with what each is for, are in [tokens.json](tokens.json); the app uses them as named colours in `public/theme.css`.

- **signal-green** is the brand. Use it for the one action on a screen (Assign task, Connect), the logo's cursor, and live states. If two things on a screen are green, one of them is wrong.
- **ground, panel, raised, line** build the surfaces, one step at a time; separate things with line, not with shadows.
- **ink, ink-soft, ink-muted** are the three strengths of text. Costs, times and helper text are ink-muted.
- **green-text** is green used as words or thin lines; on light grounds it becomes a darker green so it stays readable.
- **warning** and **critical** mean states only (waiting, failed, over budget), never decoration.

Primary button: signal-green fill, on-green text, radius-md. Secondary button: panel fill, line border, ink text.

## Type

- **Space Grotesk** (display) for website and deck headlines only.
- **Inter** (sans) for everything people read in the app.
- **JetBrains Mono** (mono) for uppercase labels and for numbers that line up: costs, counts, receipts. It carries the product's terminal heritage.

All three are free under the SIL Open Font License. The app bundles Inter and Space Grotesk (in `public/fonts`, with their licences); JetBrains Mono falls back to the system's monospace font.

## Voice

Plain, businesslike and specific, written for an owner who is not technical.

- Agents are named by their job: Head of Marketing, Bookkeeper. Never cute names.
- Say what happened and what it cost: "The Head of Finance finished the cash forecast. $0.08."
- Buttons say exactly what they do: "Assign to the team", "Connect OpenRouter".
- Say "agents", "tasks", "team", "organization". Avoid technical words: say "add credit", not "provision billing".

## Iconography and characters

Interface icons are simple line icons, 1.5px strokes, rounded ends, drawn in ink-soft and turning ink on hover.

**Agents are department tiles**, drawn from the logo: the same black tile (#0A0A0A, border #2A2A2A, radius a quarter of the side), the agent's role as a white line symbol (#F2F2F2), and under it a cursor block in its department's colour. The cursor shows what the agent is doing, as the logo's cursor shows work in progress: signal green and blinking while it works, warning amber with a dashed frame while it waits on the owner, critical red while it is stuck, and a green tick when it is done. The tile stays black in both themes.

| Department | On the tile and in dark | As text in light |
| --- | --- | --- |
| Executive | #E6E6E6 | #2B2B2B |
| Finance | #2CC5B5 | #0E7A70 |
| Sales | #6AA6FF | #1F5BC7 |
| Marketing | #B39BFF | #6446D0 |
| Operations | #9DB8C8 | #3E6680 |
| Technology | #5CD6EA | #0B7488 |
| People | #F2A0C2 | #A8396A |
| Legal | #D6C39B | #7A6536 |
| Customers | #F5B38A | #9A4E1C |
| Research | #C9D46A | #5F6A12 |
| Product | #D69BEA | #84389E |
| Other | #B8B8B8 | #5E625E |

Department colours are calm and differ in lightness as well as hue. Green, amber and red are never department colours: they are kept for status.

## Examples

- App header: the wordmark at 15px cap height, top left, cursor blinking once a second.
- Website hero: display-xl headline in ink on ground, one signal-green button, the lockup top left.
- Receipt: label style for headings, data style for every number, ink-muted for times.

## Using the brand

The Talqava name and logo belong to GR Investments LLC. The MIT licence covers Talqava's code, not its name or logo: you may use the logo to refer to Talqava, but not in a way that suggests your own product or version is the official Talqava, or is made or endorsed by us. See the [Terms of Use](../../legal/TERMS.md).

## GitHub pictures

`github/talqava-org-avatar.png` (500 × 500, the organization's picture) and `github/talqava-social-preview.png` (1280 × 640, the picture shown when the repository is shared) are drawn from the logo by `make-github-images.cjs` (run `npx electron ../docs/brand/make-github-images.cjs` from `app/desktop`). GitHub has no API for either, so they are uploaded by hand: the organization picture under the organization's Settings → Profile, and the social preview under the repository's Settings → General → Social preview.
