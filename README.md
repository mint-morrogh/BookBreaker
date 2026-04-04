# BookBreaker

A text-rendered brick breaker game that turns classic literature into an arcade experience. Every element (paddle, ball, bricks, particles) is drawn with text characters on an HTML Canvas. Words from real book chapters rise from the bottom as bricks; smash them to score points based on Scrabble-style letter values.

Built on [`@chenglou/pretext`](https://github.com/chenglou/pretext), a precise text measurement library, to ensure pixel-accurate sizing and layout of all text-based game elements at 60fps.

## How It Works

**The loop:** A paddle sits at the top. A ball launches downward. Rows of words pulled from actual book chapters scroll upward from the bottom. Break words by bouncing the ball into them.

**Scoring:** Each letter has a point value (common letters like E = 1pt, rare letters like Z = 10pt), multiplied by word length. Big words (10+ letters) get a 3x bonus. A combo multiplier (up to 10x) rewards consecutive hits and decays over time. Missing words costs 50 points each.

**Upgrades** drop from broken bricks based on word rarity:

| Upgrade | Effect |
|---------|--------|
| Widen | Expands the paddle |
| Multiball | Spawns extra balls |
| Safety | Adds a bounce bar above the paddle |
| Blast | Charges the ball to explode on next hit |
| Slow | Reduces ball speed |
| Magnet | Pulls the ball toward the paddle |
| Piercing | Ball passes through multiple bricks |

**End of chapter:** Remaining bricks pop one by one, scores tally up, and you receive a grade (S through F) based on completion percentage.

## Books Included

- A Tale of Two Cities
- Moby Dick
- Pride and Prejudice
- Alice in Wonderland
- The Great Gatsby

Each book has 3 playable chapters. Words are NLP-tagged using [Compromise](https://github.com/spencermountain/compromise) for part-of-speech classification, which determines brick color and upgrade drop rates.

## How Pretext Is Used

The [`@chenglou/pretext`](https://github.com/chenglou/pretext) library provides two key functions:

- **`prepareWithSegments(text, font)`** prepares text content for measurement with full font metric analysis
- **`layoutWithLines(prepared, maxWidth, lineHeight)`** computes precise layout dimensions

These are used to accurately size the paddle (based on "BOOK BREAKER" text width), the safety bar, and every word brick, ensuring Canvas `fillText` calls and their bounding boxes match exactly. Standard Canvas `measureText` is inconsistent across browsers; Pretext eliminates that.

The game renders at a fixed 900x950 virtual resolution and scales to fit the viewport, avoiding DPR resampling artifacts that cause text shimmer.

## Architecture

```
src/
  main.ts          Book picker UI, game initialization
  game.ts          Core Game class: state, loop, input
  physics.ts       Collision detection (ball/paddle/bricks/walls)
  render-game.ts   Main render pass
  renderer.ts      Canvas utilities, game-over screen
  colors.ts        Color palettes, word-to-color mapping
  tagger.ts        NLP tagging via Compromise
  scoring.ts       Point calculation, high-score persistence
  upgrades.ts      Power-up activation logic
  sidebar.ts       DOM sidebar bridge (score, lives, combo)
  content.ts       Book chapter text data
  types.ts         Shared TypeScript interfaces
```

**Key design choices:**

- **No framework.** Pure TypeScript + Canvas 2D API
- **Event-driven physics.** `physics.ts` emits `PhysicsEvent` objects; `game.ts` applies them to state
- **World-space bricks.** Bricks live in world coordinates with a scroll offset, enabling smooth continuous spawning
- **Throttled DOM updates.** Sidebar refreshes at ~10Hz to minimize reflow
- **Dot field.** 1000+ background dots repelled by the ball, with force scaling by speed

## Controls

| Input | Action |
|-------|--------|
| Mouse | Move paddle |
| Arrow keys / A, D | Move paddle (acceleration-based) |
| Space / Enter / Click | Launch ball, advance menus |

## Getting Started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Tech Stack

- **TypeScript** (strict mode, ES2020 target)
- **Vite** (dev server and bundler)
- **@chenglou/pretext** (text measurement and layout)
- **Compromise** (NLP part-of-speech tagging)
- **Canvas 2D** (all rendering)
- **localStorage** (high score persistence per book)
