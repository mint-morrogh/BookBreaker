import type { Book, Difficulty } from './content'
import { TAG_COLORS, PUNCTUATION_COLOR } from './colors'

// ── Tutorial phase definitions ─────────────────────────────────
export interface TutorialPhase {
  text: string
  mobileText?: string
  largeBricks: boolean
  fontSize?: number          // override brick font size (default 22 for large, 15 for normal)
  centerBricks?: boolean     // center brick rows instead of left-aligning
  dropsEnabled: boolean
  forceDrops: boolean        // guarantee upgrade drop from colored bricks
  breakoffsEnabled: boolean
  coloredBricks: boolean     // force all bricks to be colored (no gray)
  goToShopAfter: boolean
  giveRecall?: boolean       // auto-fill charge meter at phase start
}

export const TUTORIAL_PHASES: TutorialPhase[] = [
  // Phase 0: Welcome — extra large, centered
  {
    text: 'Welcome to Book Breaker!',
    largeBricks: true,
    fontSize: 30,
    centerBricks: true,
    dropsEnabled: false,
    forceDrops: false,
    breakoffsEnabled: false,
    coloredBricks: false,
    goToShopAfter: false,
  },
  // Phase 1: Recall — auto-filled charge, let them try it
  {
    text: 'Break bricks to charge your recall ability. Your meter is full, go on try it!',
    largeBricks: true,
    dropsEnabled: false,
    forceDrops: false,
    breakoffsEnabled: false,
    coloredBricks: false,
    goToShopAfter: false,
    giveRecall: true,
  },
  // Phase 2: Slam / speed
  {
    text: 'Increase the speed of your ball by clicking at the right time. The more precise, the higher speed and piercing effect!',
    mobileText: 'Increase the speed of your ball by tapping at the right time. The more precise, the higher speed and piercing effect!',
    largeBricks: true,
    dropsEnabled: false,
    forceDrops: false,
    breakoffsEnabled: false,
    coloredBricks: false,
    goToShopAfter: false,
  },
  // Phase 2: Upgrades — colored bricks, guaranteed drops
  {
    text: 'Colored bricks can occasionally drop upgrades.',
    largeBricks: true,
    dropsEnabled: true,
    forceDrops: true,
    breakoffsEnabled: false,
    coloredBricks: true,
    goToShopAfter: false,
  },
  // Phase 3: Break-off bonuses
  {
    text: 'Breaking bricks off in chunks of three or less will grant you break-off bonuses!',
    largeBricks: true,
    dropsEnabled: true,
    forceDrops: false,
    breakoffsEnabled: true,
    coloredBricks: false,
    goToShopAfter: false,
  },
  // Phase 4: Back wall speed
  {
    text: 'Hitting the back wall also increases the speed of the ball!',
    largeBricks: true,
    dropsEnabled: true,
    forceDrops: false,
    breakoffsEnabled: true,
    coloredBricks: false,
    goToShopAfter: false,
  },
  // Phase 5: Gold & shop — then goes to shop
  {
    text: 'Collect gold from colored bricks to spend at the end-of-level shop. Careful, because if you lose a life you also lose all the upgrades you have collected!',
    largeBricks: true,
    dropsEnabled: true,
    forceDrops: false,
    breakoffsEnabled: true,
    coloredBricks: true,
    goToShopAfter: true,
  },
  // Phase 6: Tier system — normal sized bricks, real gameplay
  {
    text: 'Colored bricks follow a tier system. Gray stopwords are common and low value. Cyan nouns and green adverbs are tier one. Amber verbs and pink names are tier two. Violet adjectives are tier three. Red words, with ten or more letters, are tier four and the most valuable!',
    largeBricks: false,
    dropsEnabled: true,
    forceDrops: false,
    breakoffsEnabled: true,
    coloredBricks: false,
    goToShopAfter: false,
  },
]

// ── Tutorial state machine ─────────────────────────────────────
// Actions returned by tick() — game.ts dispatches on these
export type TutorialTickAction =
  | 'normalGameplay'       // proceed with normal update loop
  | 'runPickupsAndReturn'  // run pickup/paddle physics, tick particles, skip rest
  | 'tickParticlesReturn'  // tick particles only, skip rest
  | 'advanceLevel'         // load next tutorial phase
  | 'startEndSequence'     // tutorial complete, run end sequence

type TransitionState = 'playing' | 'waitingPickups' | 'enjoying' | 'pausing'

export class TutorialController {
  phase = 0
  private state: TransitionState = 'playing'
  private timer = 0
  private pauseTimer = 0

  get currentPhase(): TutorialPhase { return TUTORIAL_PHASES[this.phase] }
  get isComplete(): boolean { return this.phase >= TUTORIAL_PHASES.length }
  get isLastPhase(): boolean { return this.phase === TUTORIAL_PHASES.length - 1 }

  // Feature gates
  get dropsEnabled(): boolean { return this.currentPhase?.dropsEnabled ?? true }
  get forceDrops(): boolean { return this.currentPhase?.forceDrops ?? false }
  get breakoffsEnabled(): boolean { return this.currentPhase?.breakoffsEnabled ?? true }
  get largeBricks(): boolean { return this.currentPhase?.largeBricks ?? false }
  get fontSize(): number | undefined { return this.currentPhase?.fontSize }
  get centerBricks(): boolean { return this.currentPhase?.centerBricks ?? true }
  get goToShopAfter(): boolean { return this.currentPhase?.goToShopAfter ?? false }
  get isTransitioning(): boolean { return this.state !== 'playing' || this.pauseTimer > 0 }

  advancePhase(): void {
    this.phase++
    this.state = 'playing'
    this.timer = 0
    this.pauseTimer = 0
  }

  /** Called when all bricks are dead. Returns what game.ts should do. */
  handleLevelClear(hasPickups: boolean): 'wait' | 'shop' | 'pause' | 'endSequence' {
    if (this.isLastPhase) return 'endSequence'
    if (this.goToShopAfter) return 'shop'
    if (hasPickups) {
      this.state = 'waitingPickups'
      return 'wait'
    }
    if (this.forceDrops) {
      this.state = 'enjoying'
      this.timer = 5.0
      return 'wait'
    }
    return 'pause'
  }

  /** Start the pseudo-pause between phases (called by game.ts) */
  startPause(): void {
    this.pauseTimer = 1.5
  }

  /**
   * Main tutorial tick — called every frame from game.ts update().
   * Encapsulates all pause/transition state machine logic.
   * Returns an action telling game.ts what to do this frame.
   */
  tick(dt: number, hasPickups: boolean): TutorialTickAction {
    // ── Pseudo-pause timer (between phases) ──
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt
      if (this.pauseTimer <= 0) {
        this.advancePhase()
        return this.isComplete ? 'startEndSequence' : 'advanceLevel'
      }
      return 'tickParticlesReturn'
    }

    // ── Transition states (waiting for pickups / enjoying upgrade / pausing) ──
    if (this.state === 'waitingPickups') {
      if (!hasPickups) {
        if (this.currentPhase?.forceDrops) {
          this.state = 'enjoying'
          this.timer = 5.0
        } else {
          this.state = 'pausing'
          this.timer = 1.5
          return 'tickParticlesReturn'
        }
      }
      return 'runPickupsAndReturn'
    }
    if (this.state === 'enjoying') {
      this.timer -= dt
      if (this.timer <= 0) {
        this.state = 'pausing'
        this.timer = 1.5
        return 'tickParticlesReturn'
      }
      return 'runPickupsAndReturn'
    }
    if (this.state === 'pausing') {
      this.timer -= dt
      if (this.timer <= 0) {
        this.advancePhase()
        return this.isComplete ? 'startEndSequence' : 'advanceLevel'
      }
      return 'tickParticlesReturn'
    }

    return 'normalGameplay'
  }

  /** Force stopword-colored bricks to be colored during coloredBricks phases */
  overrideBrickColor(color: string, idx: number): string {
    if (!this.currentPhase?.coloredBricks) return color
    // Punctuation keeps its own color even in coloredBricks phases
    if (color === PUNCTUATION_COLOR) return color
    if (color !== TAG_COLORS.stopword) return color
    const palette = [
      TAG_COLORS.noun, TAG_COLORS.adverb, TAG_COLORS.verb,
      TAG_COLORS.person, TAG_COLORS.adjective,
    ]
    return palette[idx % palette.length]
  }

  getText(isMobile: boolean): string {
    const phase = this.currentPhase
    if (!phase) return ''
    return (isMobile && phase.mobileText) ? phase.mobileText : phase.text
  }
}

// ── Tutorial book creation ─────────────────────────────────────
export function createTutorialBook(isMobile: boolean): Book {
  const ctrl = new TutorialController()
  const paragraphs: string[] = []
  for (let i = 0; i < TUTORIAL_PHASES.length; i++) {
    ctrl.phase = i
    paragraphs.push(ctrl.getText(isMobile))
  }
  return {
    title: 'Tutorial',
    author: 'BookBreaker',
    difficulty: 'Tutorial' as Difficulty,
    chapters: [{
      title: 'Tutorial',
      paragraphs,
    }],
  }
}

// ── Persistence ────────────────────────────────────────────────
export function isTutorialDone(): boolean {
  return localStorage.getItem('bb_tutorial_done') === '1'
}

export function markTutorialDone(): void {
  localStorage.setItem('bb_tutorial_done', '1')
}
