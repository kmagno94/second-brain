# 2nd Brain

A private web page for Kevin's second brain: today's synced Notion notes, and a box to capture a thought. Live at [kmagno94.github.io/second-brain](https://kmagno94.github.io/second-brain/).

## How it fits together

| Piece | Where | Job |
|---|---|---|
| This repo (public) | GitHub Pages | The web page. Code only, no notes. |
| second-brain-vault (private) | GitHub | The Obsidian vault. A daily Action writes Notion content to `Daily/`. |
| Obsidian on the Mac | Your computer | Opens the vault and pulls new files with Obsidian Git. |

The page reads and writes the private vault through GitHub's API with a fine-grained token limited to that one repo. The token is locked behind a PIN on each device and only sent in request headers. Nothing private is ever published here.

## Stack

Same as Speak to Prompt and Shower Thoughts: Svelte 5 and Vite 8, source in `app/`, built for Safari 16, deployed to Pages by GitHub Actions. Smoke tests run first, and a failing test stops the deploy.

```
npm install
npm run dev     # local preview
npm test        # build, then smoke tests at iPhone size
```

One-time setup: Settings, Pages, Source: GitHub Actions.
