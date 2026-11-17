# Deploying the deck

`dist/` is a self-contained static site: the deck, the demo UI in replay mode, fonts and the QR code. All paths are relative, so it works from a file, from a domain root, or from a sub-path such as GitHub Pages. On a public host the demo always runs the recorded replay; it never calls an API.

**Nothing has been deployed from this machine.** These are the steps to publish it yourself.

Before deploying:

```bash
npm run verify      # tests, build, audit, e2e
```

## Option A: GitHub Pages (account `discofuchsia`)

1. Create a public repository under `discofuchsia`, for example `calpoly-ai-agents-mcp`.
2. Add it as a remote and push `main`.
3. Publish `dist/` with one of these:

   **GitHub Actions (recommended).** In the repo, open Settings → Pages and set Source to "GitHub Actions". Add `.github/workflows/pages.yml`:

   ```yaml
   name: Deploy deck
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     deploy:
       runs-on: ubuntu-latest
       environment:
         name: github-pages
       steps:
         - uses: actions/checkout@v4
         - uses: actions/upload-pages-artifact@v3
           with:
             path: dist
         - uses: actions/deploy-pages@v4
   ```

   **gh-pages branch.** Push only the `dist/` folder to a `gh-pages` branch, then select that branch in Settings → Pages:

   ```bash
   git subtree push --prefix dist origin gh-pages
   ```

4. The site is served at `https://discofuchsia.github.io/<repo-name>/`. `dist/.nojekyll` is included so GitHub serves the files as they are.

## Option B: Netlify Drop

Open app.netlify.com/drop in a browser and drag the `dist/` folder onto the page. Netlify gives you a public URL right away.

## After deploying

- Open the URL in a private window (not signed in) and expect the deck to load (HTTP 200).
- Open it on a phone: it should show reading mode.
- Go to the demo slide and run the replay.
- Scan the QR code on the thank-you slide and check that it opens github.com/discofuchsia.
