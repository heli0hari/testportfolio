# AI photo tagging (one-time, before deploy)

Chroma's filter chips come from tags on each photo. Two kinds are generated
automatically:

- **Pixel tags** — `black & white`, `night`, `bright` — computed from the
  image itself, always on, no setup.
- **AI tags** — everything meaningful (`forest`, `sea`, `wedding`, `car`,
  `concert`, …) — filled in by Google Gemini from a fixed vocabulary.

AI tagging is a one-time step you run on your own machine before deploying.
It costs nothing on Gemini's free tier for ~130 photos.

## The tag vocabulary

The AI may ONLY use these tags (it can't invent new ones):

```
sky, sea, beach, forest, park, mountain, water,
city, street, architecture, interior,
people, portrait, crowd, animal, car, food, plant,
wedding, concert, nightlife, festival, christmas, market, fairground,
silhouette, sunset, neon
```

To change this list, edit `VOCAB` at the top of `tagger.js`.

## Setup (once)

1. Get a free API key: https://aistudio.google.com/apikey
   (Sign in with a Google account, click "Create API key". Free.)

2. Set it as an environment variable in the terminal you'll run the build in:

   **macOS / Linux**
   ```
   export GEMINI_API_KEY=your_key_here
   ```

   **Windows PowerShell**
   ```
   $env:GEMINI_API_KEY = "your_key_here"
   ```

   This lasts for the current terminal session only. The key is never written
   to a file and never committed — that's deliberate.

3. Install dependencies (once):
   ```
   npm install sharp
   ```

## Run it

```
node build-photos.js
```

- `*` printed = a photo was sent to Gemini this run
- `.` printed = a photo was skipped (already tagged, cached)

The script **paces itself** (about one photo every 4 seconds) to stay under
the free tier's per-minute limit, and **retries automatically** if it still
hits a rate limit. So tagging ~130 photos takes roughly **9–10 minutes** —
let it run. It saves progress every 10 photos, so if it's interrupted you can
re-run and it resumes where it left off (already-tagged photos are cached).

### Free-tier limits worth knowing

Google retires and renames its free models often (2.0 Flash was shut down in
2026; some names get restricted to existing users). So the script **doesn't
hard-code a model** — on each run it asks your account which models it can
actually use and automatically picks the best available free vision model
(preferring the higher-limit Flash-Lite tier). You'll see which one it chose
printed at the start: `AI tagging: ON — model "…"`.

Typical free-tier limits for the models it picks:

| Model tier | Requests/min | Requests/day |
|-----------|-------------|--------------|
| Flash-Lite | ~30 | ~1,500 |
| Flash | ~15 | ~1,500 |

That comfortably covers a one-time run over 130 photos. If you ever see
`rate limited (429) after N retries`, you hit the **daily** cap — re-run
tomorrow (it resumes from cache). To force a specific model:

```
# macOS/Linux
export GEMINI_MODEL=gemini-2.5-flash
# Windows PowerShell
$env:GEMINI_MODEL = "gemini-2.5-flash"
```

If you skip the API key entirely, the build still runs and produces pixel tags
only — AI tags are simply omitted.

## Force a full re-tag

If a run reports `AI calls this run: 0` but your photos aren't tagged, an
older `photos.json` (e.g. one made before AI tagging existed) is being treated
as already-done. Force a clean pass:

```
node build-photos.js --retag
```

`--retag` ignores the cache and re-tags every photo. Use it once and normal
caching resumes afterward.

## After tagging: a quick skim

An AI gets most photos right but will occasionally miss or misjudge one
(a misty lake tagged `sea`, a dog in shadow missed). Open `photos.json` and
skim the `tags` arrays. To fix one, just edit its array:

```json
"tags": ["forest", "people"]
```

Hand edits are **preserved** on future re-runs — the build never overwrites a
tag you changed. Much faster than tagging 130 photos from scratch.

## Cost & privacy notes

- Free tier easily covers a one-time run over 100-200 photos.
- Only the 900px **thumbnail** is sent, not your full-resolution originals.
- Nothing runs at deploy time or for visitors — tags are baked into
  `photos.json`, which is a plain static file.
