# Tunnel Through Time

A scroll-driven visualization where photos taken on September 3rd across
different years are arranged in circular "rings" — one ring per year —
nested like a tunnel. Scrolling walks you through the tunnel, year by
year, from the most recent year (largest, closest) back toward the
oldest (smallest, deepest).

## Project structure

```
year-tunnel/
├── index.html          the page
├── style.css            styling
├── script.js             the tunnel/scroll logic
├── data/
│   └── dataset.json      photos grouped by year (already generated)
└── photos/                <-- YOU NEED TO ADD YOUR ACTUAL PHOTOS HERE
```

## Before this will work: add your photos

`data/dataset.json` references photos by filename only (e.g.
`"Colorful ropes heap on Reykjavik port 2.jpg"`), and `script.js` looks
for them at `photos/<filename>`.

**Copy every JPG from your `commons_photos/` folder into this
project's `photos/` folder**, keeping the exact same filenames. Nothing
needs to be renamed — just copy the files in.

If you regenerate `commons_dataset.json` again later (new photos, a
re-sync, etc.), let me know and I'll regenerate `data/dataset.json` to
match — it's a small derived file (just filename + year + color per
photo), not a copy of your full dataset.

## Running it locally

Because this loads `data/dataset.json` via `fetch()`, opening
`index.html` directly as a `file://` URL won't work in most browsers
(they block local fetch requests for security). Run a tiny local
server instead, from inside the `year-tunnel/` folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Publishing with GitHub Pages

1. Create a new repository on GitHub (public, since GitHub Pages on
   the free tier requires a public repo unless you have GitHub Pro/Team).
2. From inside this `year-tunnel/` folder:
   ```
   git init
   git add .
   git commit -m "Initial tunnel visualization"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub: go to the repo → **Settings → Pages** → under "Build and
   deployment," set **Source** to "Deploy from a branch," pick
   **main** branch and **/ (root)** folder → Save.
4. After a minute or two, your site will be live at:
   `https://<your-username>.github.io/<repo-name>/`

**Heads up on repo size:** with ~250 photos, your repo could end up in
the tens-to-low-hundreds of MB depending on file sizes. GitHub's free
tier handles this fine (limits are much higher — 100MB per file, a few
GB is a reasonable repo size), but it's worth knowing before you push.

## Tuning the effect

All the visual "feel" knobs live at the top of `script.js`, in the
`CONFIG` object — clearly commented. Things you can adjust without
touching the rest of the logic:

- `vhPerYear` — how much scrolling it takes to move through one year
  (bigger = slower/more gradual).
- `baseRadiusPx`, `baseImgWidthPx`, `baseImgHeightPx` — how big the
  entrance ring/photos are.
- `focalOffset`, `scaleConstant` — control how dramatically things grow
  as they approach the camera.
- `farFadeStartsAt` / `farFadeEndsAt` — how many "years deep" a ring
  can be before it fades from view.
- `perRingRotationOffsetDeg` — small per-year rotation so rings don't
  perfectly align (set to `0` to disable).

## What's not built yet

This is the first pass — the core tunnel mechanic. Not yet included:
click/tap interactions on individual photos, a way to jump directly to
a specific year, mobile touch-scroll tuning, or any text/story content
layered into the tunnel. Let me know what you want next.
