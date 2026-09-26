# Launch and WordPress integration

## What setup does

Creates ~/Downloads/Appliance-Latent-Space-Public/project from the bundled reviewed source. Requires Node 22, git and GitHub CLI; existing Homebrew can install missing Node 22/gh automatically. It uses your existing login, or launches GitHub's device login. Never paste a token into source files.

Runs npm ci, the 84 unit tests and the production build before creating a remote. Initializes fresh local history and creates **suzyeaston/appliance-latent-space-live** as public. Pushes main plus a gh-pages branch containing only the built app. Configures GitHub Pages to serve gh-pages. It opens Cursor if installed and can launch the local instrument.

Nothing is copied from other folders or the original private repository. The ZIP snapshot cannot contain uncommitted changes or other branches. Keep those originals for later deliberate migration.

The default launch script publishes when run. `--local-only` prepares the checkout and opens the dev server without creating or changing a GitHub repository. `--no-open` suppresses app/browser launch. Re-running the launch script reuses its own managed folder, does not overwrite edits, and attempts to resume publication. An unrelated existing folder or remote is refused.

If the script says GitHub Pages needs setup, open the printed settings URL, choose Deploy from a branch, gh-pages and /(root). Then rerun `npm run deploy` from the project folder. The repo can be public while the first Pages build is still pending. It can take several minutes. Check the printed Pages URL and GitHub Actions before sharing it as live.

## Local development

`npm run dev` serves only localhost. A successful setup leaves dependencies installed. Commit intended changes before `npm run deploy`. Deployment refuses dirty worktrees, unexpected remotes, private remotes, or a branch other than main. It never force-pushes. A conflicting remote change stops publication for review.

GitHub Pages is a static build. There are no secrets or model endpoints in this project. `dist` is ignored on main and explicitly committed on gh-pages. The gh-pages checkout is temporary; each later deployment adds a regular commit, retaining previous deployed versions.

## WordPress now

1. Wait for the Pages URL to load.
2. Create a draft page in WordPress. Add a Custom HTML block with docs/wordpress-embed.html.
3. Preview the page, press Start inside the frame, test Kill and export/import. Publish the WordPress page when ready.

The iframe keeps instrument styling and JavaScript separate from the WordPress theme. Audio still starts on a click. Fullscreen is permitted. Some WordPress roles/configurations strip iframe HTML; use an administrator account or a reviewed shortcode plugin if that happens. Security headers/plugins may also need to permit this frame's origin.

Cross-origin iframe storage can be blocked or partitioned, particularly in Safari. Export/import JSON is the portable fallback, and the standalone link is always available. Test Chrome and Safari on your Mac. No WordPress credentials or hosting edits are required by this setup.

## WordPress later

Serve the built dist folder from a directory such as https://suzyeaston.ca/instruments/appliance-latent-space/ and point the iframe there. Relative asset URLs already support this. Deployment must preserve the entire assets folder. Confirm the hosting server serves static files before WordPress rewrites. Choose the exact route and upload method after inspecting your hosting configuration.

A native WordPress plugin can be a later milestone; it should enqueue the built assets only on the instrument page and scope the CSS. Embedding the standalone app is the minimal integration today.

## Sources checked September 26, 2026

- https://basecampyvr.ca/
- https://cli.github.com/manual/gh_repo_create
- https://docs.github.com/en/rest/pages/pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://vite.dev/guide/build
