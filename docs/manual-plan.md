# Manual Generation Plan

## Approach

HTML manual with embedded `.webm` video clips, generated via Playwright MCP during
a single authoring session that also produces a reproducible generation script.

## Why this stack

- **Playwright MCP** — Claude drives the browser directly in the conversation; no test
  framework or separate script needed during authoring
- **`.webm` over GIF** — smaller files, better quality, no palette issues; embeds with
  a single `<video autoplay loop muted playsinline>` tag in HTML
- **HTML over Markdown** — native `<video>` support, self-contained, opens in any browser

## Screenshots vs videos

**Screenshots** — static state, no interaction needed:
- UI overview (toolbar, sidebar, canvas)
- Room properties panel with values
- Color / environment palette
- Keyboard shortcut reference
- Tool cursor states

**Videos (`.webm`)** — interactions that are hard to convey statically:
- Connecting rooms (drag between exits)
- Rubber band select
- Panning and zooming
- Custom line drawing
- Undo / redo flow

## Output

```
docs/
  manual.html        # finished manual (written during authoring session)
  generate.ts        # Playwright script that reproduces every clip/screenshot
  sample.dat         # stable sample map file (committed to repo)
  clips/
    ui-overview.png
    room-properties.png
    keyboard-shortcuts.png
    connect-rooms.webm
    rubber-band-select.webm
    pan-zoom.webm
    custom-line.webm
    undo-redo.webm
    ...
```

## Authoring session workflow

1. Add `@playwright/mcp` to Claude Code MCP config (one-time)
2. Commit a `docs/sample.dat` to use as consistent input
3. Run `npm run dev`
4. Start the session — Claude:
   - Drives the browser via MCP tools (navigate, click, record)
   - Simultaneously writes the equivalent `generate.ts` Playwright calls
   - Writes `manual.html` sections as each feature is captured

## Regenerating after UI changes

```bash
npm run dev &
npx tsx docs/generate.ts
```

The script re-records all `.webm` clips and re-captures screenshots; `manual.html`
already references the right filenames so it updates automatically.

## generate.ts structure (sketch)

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  recordVideo: { dir: 'docs/clips', size: { width: 1280, height: 720 } }
});
const page = await context.newPage();

await page.goto('http://localhost:5173');
await page.setInputFiles('input[type=file]', 'docs/sample.dat');

// --- each section ---
// e.g. Pan tool
await page.click('[data-tool="pan"]');
// ... interactions
// await page.screenshot({ path: 'docs/clips/pan-tool.png' });

await context.close(); // flushes all video files
await browser.close();
```

## One-time MCP setup

Add to Claude Code MCP config (`claude mcp add` or edit `settings.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

No npm install needed in the project — runs via npx.

## Open questions before starting

- [ ] Confirm a `sample.dat` file to commit (needs to show meaningful content)
- [ ] Verify Playwright MCP video recording flag/context option works as expected
- [ ] Decide on manual sections / feature coverage list
