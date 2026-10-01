# Sales & Commission Tracker

A standalone, installable web app (PWA) version of the Sales & Commission Tracker.
Everything is static: no build step and no server.

- `index.html` – the app
- `sw.js`, `manifest.webmanifest`, `icons/` – offline support and home-screen install
- `vendor/` – pdf.js 3.11.174, pdf-lib 1.17.1, and the Anthropic TypeScript SDK bundled for the browser

## Hosting

`.github/workflows/sales-tracker-pages.yml` publishes this folder to GitHub Pages on every push
that touches it. Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

To try it locally: `npx serve sales-tracker` (the service worker needs http://localhost, not file://).

## Data

- Sales and settings are saved in the browser (`localStorage`) on each device.
  Use **Settings → Download backup / Restore from backup** to move them between devices.
- Reading PDF sales logs calls Claude (`claude-opus-5-5`) directly from the browser with the
  user's own Anthropic API key, which is stored only on that device. Adding sales by hand,
  reports and printing work without a key and offline.

## Updating the vendored Anthropic SDK

```sh
npm i @anthropic-ai/sdk esbuild
echo 'import Anthropic from "@anthropic-ai/sdk"; window.Anthropic = Anthropic;' > entry.js
npx esbuild entry.js --bundle --minify --format=iife --target=es2020 --outfile=sales-tracker/vendor/anthropic.min.js
```

Bump `CACHE` in `sw.js` whenever files change so installed copies pick up the new version.
