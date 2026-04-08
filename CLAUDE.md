# Task Management — Nexus CLI

Use `hyperspace tasks` commands to manage the project task board. Tasks persist in local SQLite across sessions.

## Task Workflow

1. **Check tasks** → `hyperspace tasks list`
2. **Start work** → `hyperspace tasks update <id> --status in_progress`
3. **Implement** → Write code
4. **Submit for review** → `hyperspace tasks update <id> --status review`
5. **Next task** → `hyperspace tasks list --status todo`

**Rules:**
- NEVER mark tasks as "done" — only move to "review". The user verifies and marks done.
- Check current tasks before starting new work.
- Create tasks for discovered sub-work: `hyperspace tasks add "title" --priority high`

## Command Reference

```bash
hyperspace tasks list                        # Active tasks (non-done)
hyperspace tasks list --all                  # All tasks including done
hyperspace tasks list --status todo          # Filter by status
hyperspace tasks add "Fix auth bug" --priority high
hyperspace tasks update <id> --status in_progress
hyperspace tasks update <id> --title "New title" --description "Details"
hyperspace tasks done <id>                   # Shorthand for --status done
hyperspace tasks search "auth"               # Search by title/description
```

Statuses: `todo`, `in_progress`, `review`, `done`
Priorities: `critical`, `high`, `medium`, `low`
IDs: Use first 8 chars of the task UUID.

---

Be extremely concise. Sacrifice grammar for the sake of concision.

## Code Modularity

**CRITICAL: `game.ts` is the core game loop and is already large. Do NOT dump new feature logic into it.**

- New features (tutorial, bosses, power-ups, etc.) get their own `.ts` file under `src/`.
- The feature module exports a controller/class and pure functions. `game.ts` calls into it with minimal glue (1-liner checks, action dispatch).
- Pattern: feature module returns action enums/strings, `game.ts` switches on them. Decision logic stays in the feature module.
- Inline checks in `game.ts` (e.g. `if (this.tutorial)` guards) are fine when they're 1-2 lines. Multi-line blocks belong in the feature module.
- Existing extracted modules to follow as examples: `physics.ts`, `upgrades.ts`, `shop.ts`, `islands.ts`, `render-game.ts`, `tutorial.ts`.

## Mobile Performance Rules

**CRITICAL — learned the hard way:**

1. **Fractional font sizes crash mobile browsers.** `ctx.font` with non-integer sizes (e.g. `12.3px`) thrashes the font cache. Always `Math.round()` font sizes. This applies to particle animations — round the computed size.

2. **Canvas shadowBlur at high DPR is O(DPR²) per draw.** At 3x DPR, each shadowBlur costs 9x more GPU work. Scale all blur values by `0.35` on mobile to maintain visual glow at acceptable cost. The `blur` multiplier in `render-game.ts` handles this.

3. **Dot field is the #1 CPU cost.** Dot physics iterates ALL dots × ALL balls per frame. Mobile uses spacing 22 (vs 14 desktop) → ~1600 dots vs ~5600. Do NOT reduce spacing below 22 on mobile.

4. **DOM operations during gameplay kill mobile.** `flushWordLog()` must skip when sidebar is closed. Never sort/reorder DOM in a game-tick hot path.

# BookBreaker

a version of Brick Breaker that is completely made with text and runs natively on the browser. This uses the new pretext library, which is a fast, accurate, and comprehensive text measurement library that can change UI design forever. So it can render and move things around very fast. We should be able to block out the book. The actual breaker will be at the top. The ball goes down and big pieces of the chapters will start to very slowly from the bottom rise up and your job is to break all of the words and get scores based off of letters.
The bar you move around, the bowl, everything is made of ASCII, but it needs to flow and feel incredibly smooth, using and abusing this new pretext library.


## Tech Stack

*Not yet defined*

## Project Guidelines

This project was initialized with HyperSpace. Follow these guidelines:

### Development Workflow

1. **Task-Driven Development**: Always work from tracked tasks (use `hyperspace tasks` CLI)
2. **Documentation First**: Update docs/CHANGELOG.md with all changes
3. **Structure as Needed**: Create directories and files following best practices for the chosen stack

### Agent System

This project uses specialized AI agents defined in `.claude/agents/`:

| Agent | Model | Role |
|-------|-------|------|
| **Maestro** | opusplan | Orchestrates and decomposes complex tasks |
| **Frontend-Dev** | opus | UI/UX implementation |
| **Backend-Dev** | opus | API and server development |
| **Unicorn** | opus | Full-stack features |
| **Paladin** | opus | Testing and QA |
| **Octocat** | opus | Git/GitHub operations |
| **Quill** | opus | Documentation |
| **Spyglass** | opus | Research and analysis |

### Key Documentation

- **docs/PRD.md** - Product requirements (update as requirements evolve)
- **docs/TODO.md** - Task tracking (use `hyperspace tasks` CLI for the Nexus board)
- **docs/STRUCTURE.md** - Document architecture as you build
- **docs/WORKFLOW.md** - Development processes
- **docs/ADR.md** - Record architectural decisions
- **docs/CHANGELOG.md** - Track all changes (MANDATORY before commits)

### Changelog Maintenance

**CRITICAL**: Update `docs/CHANGELOG.md` before every commit.

Categories:
- **Added**: New features
- **Changed**: Changes to existing functionality
- **Fixed**: Bug fixes
- **Security**: Security improvements
- **Deprecated**: Soon-to-be removed features
- **Removed**: Deleted features

### Documentation Discipline

**CRITICAL**: Whenever you make changes to the codebase, you MUST also update relevant documentation in the `docs/` folder:

| Document | Update When |
|----------|-------------|
| **TODO.md** | Tasks completed, new tasks discovered, priorities changed |
| **CHANGELOG.md** | **ALWAYS** - every change needs a record |
| **ADR.md** | Architectural decisions made (new patterns, libraries, approaches) |
| **STRUCTURE.md** | New components, modules, or significant refactoring |
| **PRD.md** | Requirements clarified or changed during implementation |
| **WORKFLOW.md** | Development process refined or changed |

This discipline is required even in normal (non-Memento) sessions. The `docs/` folder is the project's memory - it enables:
- Future sessions to understand context
- Memento Loop Mode to operate effectively
- Team members to stay in sync
- AI agents to make informed decisions

### Memento Loop Mode

This project supports **Memento Loop Mode** - an autonomous build/verify loop. Files are in `memento/`:
- `BUILD_PROMPT.md` - Instructions for builder sessions
- `VERIFY_PROMPT.md` - Instructions for verification sessions
- `PROGRESS.md` - Tracks incomplete work between sessions

To start Memento Loop Mode: `hyperspace start --memento` or select "Memento Loop Mode" at launch.
