# The Appliance Latent Space

**An instrument that fits in a backpack. Write the music. Play the code. Watch it move.**

A programmable audiovisual instrument by [Suzy Easton](https://suzyeaston.ca/).
The laptop is an instrument in its own right, with a shared control language that can eventually connect to the physical toaster and a local AI sound model.

Public hackathon build, heading into [Basecamp](https://basecampyvr.ca/), a creator residency at Jericho Beach, Vancouver. This is Suzy's independent project, not an official Basecamp product.

[Open the instrument](https://suzyeaston.github.io/appliance-latent-space-live/) (available after setup finishes and GitHub Pages completes its first build).

## Timeline update

Compact musical controls above the visual, with an eight-block playable arrangement below. Four saved scenes can be repeated and sequenced on bar boundaries. See [the timeline guide](docs/timeline.md).

## Live set update

Key and scale selection, five groove styles, four rhythm patterns, real sequencer swing, semitone transposition, drum-only changes and four saved scene slots. See [the DJ set guide](docs/dj-set.md).

## What is playable

- Write patterns with notes, chords, rests, ties, velocity, tempo, and multiple voices.
- Synthesized tone, bass and percussion; notes drive synchronized canvas visuals.
- Valid live edits take effect on the next bar. Invalid edits keep the previous pattern playing.
- Browning, destruction, memory, freeze, plunge, capture and immediate Kill.
- Local save and JSON import/export, plus deterministic variation proposals you can audition and accept.

The visual instrument can learn from your own paired musical/visual examples using local instance-based regression. It starts empty. No neural sound model, MIDI connection or appliance hardware is running yet. The three latent/neural sound controls remain disabled. Variation is a seeded musical transformation, not AI. See [the personal instrument guide](docs/personal-instrument.md).

## Run locally

Use Node 22 and npm. From this folder:

```bash
npm ci
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:5173/ and press **Start**. Start with a low listening level.
The examples are Service Elevator, Cold Start and Element Failure. Cmd+Enter queues your edit. Kill clears scheduled voices and delay.
Performance mode enables instrument shortcuts outside the editor.

The app downloads its static files on page load, then synthesizes and stores patterns locally. There is no service worker/offline reload cache; use the local server when working without internet. External project links use the network if clicked. Export JSON before switching between local, hosted and embedded versions: browser storage may be separate or blocked in an iframe.

## Public setup and later updates

The downloadable setup creates a new public repository with fresh history from the reviewed snapshot. It does not publish the original private repository's commits or local unpushed work.

After editing this public checkout, review and commit the files you intend to publish. Then:

```bash
npm run deploy
```

Deployment requires a clean main branch. It runs tests and builds, pushes main without force, commits only dist output to gh-pages, and requests GitHub Pages publication. Read [the launch guide](docs/launch.md).

`private: true` in package.json prevents accidental npm publication; it does not control GitHub visibility.

## WordPress

The app builds with relative asset URLs. Start by embedding the hosted instrument in a Custom HTML block on suzyeaston.ca using [wordpress-embed.html](docs/wordpress-embed.html). A later same-origin deployment can serve the dist folder under your domain. No changes to the live WordPress site are made by this setup.

## Checks and roadmap

```bash
npm run test:audio  # Chrome, renders the actual audio graph; not a listening test
npm run preview    # production preview on port 4173
npm run test:ui    # in another terminal, Chrome UI smoke test
```

Chrome is detected on macOS and Linux; CHROME_PATH can override its location.

Next: play and tune the instrument, then add Web MIDI through the existing semantic events. Follow with toaster input and a genuinely implemented AI sound/proposal layer, retaining explicit audition/accept and a reliable Kill.

- [Pattern language](docs/pattern-language.md)
- [Visual mapping](docs/visual-mapping.md)
- [Technical handoff](docs/handoff.md)
- [Hackathon brief](docs/HACKATHON.md)

This snapshot includes no license grant; public visibility alone does not make the code open source. Choose a license separately if you want to grant reuse rights.
