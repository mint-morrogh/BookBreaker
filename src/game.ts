import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { BOOKS, type Book } from './content'
import type { WordTag } from './tagger'
import type { Brick, Ball, Particle, Pickup, Dot, Shrapnel, ShopItem } from './types'
import { scoreWord, getHighScores, saveHighScore, markBookBeaten } from './scoring'
export { getTopScore } from './scoring'
import { TAG_COLORS, PUNCTUATION_COLOR, wordColor, isPunctuation, setActiveTagMap, colorTier } from './colors'
import { sidebarEls, initLetterGrid, clearWordLog, flushWordLog } from './sidebar'
import { renderGameOver, renderPause, renderTutorialComplete } from './renderer'
import { updateBalls, type PhysicsState } from './physics'
import { activateUpgrade as runActivateUpgrade, hitBrick as runHitBrick, type UpgradeState } from './upgrades'
import { renderGame, type RenderState } from './render-game'
import { generateShopItems, isShopItemMaxed, renderShop, type ShopRenderState } from './shop'
import { detectIslands, updateIslandGroups, type IslandGroup } from './islands'
import { saveToStorage, loadFromStorage, clearSave, snapBrick, unsnapBrick, snapBall, unsnapBall, snapPickup, unsnapPickup, type SaveState } from './save'
import { TutorialController, markTutorialDone } from './tutorial'

// ── Upgrade caps ──────────────────────────────────────────────
export const MAX_WIDEN = 8
export const MAX_SAFETY = 8
const BASE_BALL_R = 5.6  // default ball radius (20% smaller than legacy 7)

// ── Game ────────────────────────────────────────────────────────
// Fixed virtual resolution — all game logic runs in this coordinate space
const VIRTUAL_W = 900
const VIRTUAL_H = 1200

export class Game {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private W = VIRTUAL_W
  private H = VIRTUAL_H
  private dpr = 1
  private scale = 1    // physical-to-virtual scale factor

  // paddle
  private paddleX = 0
  private paddleW = 120
  private paddleH = 20
  private paddleY = 0
  private paddleTargetX = 0
  private paddleBaseY = 50
  private paddleTargetY = 50
  private paddleVy = 0
  private paddleVyInternal = 0  // acceleration state for forward slam
  private prevPaddleY = 50
  private paddleText = 'BOOK BREAKER'
  private paddlePadX = 14

  // ball
  private balls: Ball[] = []
  private ballSpeed = 400

  // bricks
  private bricks: Brick[] = []
  private brickFont = ''
  private brickFontSize = 16
  private brickLineH = 22
  private brickPadX = 8
  private brickPadY = 4
  private bricksScrollY = 0      // how far bricks have scrolled up
  private bricksDriftSpeed = 6.4  // px/sec upward drift (20% slower)

  // book / chapter / paragraph
  private book!: Book
  private chapterIdx = 0
  private paragraphIdx = 0
  private wordsInParagraph: string[] = []
  private wordCursor = 0
  private totalWordsInParagraph = 0
  private levelBasePoints = 0     // sum of raw base points for all bricks in this paragraph
  private levelParagraphCount = 1 // how many paragraphs this level spans

  // particles
  private particles: Particle[] = []
  private shrapnel: Shrapnel[] = []

  // pickups (falling upgrades)
  private pickups: Pickup[] = []
  private widenLevel = 0   // how many widen upgrades collected this level

  // safety bar
  private safetyHits = 0       // stacked hits remaining
  private safetyX = 0          // current X position
  private safetyDir = 1        // 1 = right, -1 = left
  private safetyW = 80
  private safetyH = 20
  private safetyY = 20         // above the main paddle

  // freeze upgrade
  private freezeTimer = 0         // seconds remaining of freeze (scroll stops)
  private baseDriftSpeed = 6.4    // normal drift speed

  // back wall — activates after all bricks enter play space
  private backWallActive = false
  private backWallReveal = 0      // 0→1 animation progress

  // charge mechanic
  private charge = 0              // 0-1, fills as bricks break, click to recall ball

  // shop bonuses (persist across levels, reset on restart)
  private dropBonus = 0           // flat % added to upgrade drop chance (Lucky Drops)
  private ballSizeBonus = 0       // 0-1.0 (0%-100%), each tier adds 0.1, cap 1.0
  private magnetCharges = 0       // remaining magnet catches (ball sticks to paddle)
  private _homingDbg = 0           // debug throttle timer (temp)

  // dot field
  private dots: Dot[] = []
  private dotSpacing = 14

  // scoring
  private score = 0
  private multiplier = 1.0       // smooth-decaying, 1.0–10.0
  private wordsBroken = 0
  private letterCounts: Record<string, number> = {}
  private lives = 3
  private alphabetCompletions = 0
  private nextLifeScore = 100000  // award +1 life every 100k points
  private gold = 0

  // shop
  private paragraphsCompleted = 0
  private shopItems: ShopItem[] = []
  private shopRects: { x: number; y: number; w: number; h: number }[] = []
  private shopContinueRect = { x: 0, y: 0, w: 0, h: 0 }

  // end-of-chapter sequence
  private levelWords: { word: string; color: string; points: number }[] = []
  private levelState: 'playing' | 'grayCleanup' | 'endPopping' | 'endTally' | 'endGrade' | 'shop' = 'playing'
  private grayPopBricks: Brick[] = []
  private grayPopIdx = 0
  private grayPopTimer = 0
  private endTimer = 0
  private endPopIdx = 0          // which brick we're popping
  private endPopBricks: Brick[] = []  // remaining alive bricks to pop
  private endTallyIdx = 0        // which scored word we're tallying
  private endTallyScore = 0      // running tally of scored words
  private endPenaltyTotal = 0    // total deduction for missed words
  private endPenaltyShown = false
  private endGrade = ''
  private endTotalWords = 0
  private endBrokenWords = 0
  private levelLivesLost = 0

  // high scores (set on game over)
  private endScores: number[] = []
  private isNewHigh = false

  // input
  private mouseX = -1
  private mouseDown = false   // left click held = paddle pushes forward
  private slamActive = false  // true while paddle is traveling forward (click or hold)
  private slamCooldown = 0    // seconds until next slam allowed
  private slamWallTimer = 0   // how long paddle has been sitting at max extension
  private keysDown = new Set<string>()
  private isMobile = false
  private moveTouchId: number | null = null
  private slamTouchId: number | null = null
  private touchStarts = new Map<number, { x: number; y: number; t: number }>()  // swipe-up tracking

  // state
  private started = false
  private hasLaunched = false    // true after first launch this run
  private hasRecalled = false    // true after first recall this run
  private gameOver = false
  private brickHitThisLevel = false  // true once a ball breaks any brick this level
  paused = false
  private sidebarTimer = 0
  private purgeTimer = 0
  private islandCheckTimer = 0
  private islandGroups = new Map<number, IslandGroup>()
  private nextIslandId = 1

  // tutorial
  tutorial: TutorialController | null = null
  private _bookIdx = -1
  onGameEnd?: () => void  // callback when tutorial ends

  constructor(canvas: HTMLCanvasElement, bookIdx: number, tagMap: Map<string, WordTag>, tutorial?: TutorialController | null) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this._bookIdx = bookIdx
    this.tutorial = tutorial ?? null
    this.book = this.tutorial ? BOOKS[bookIdx] : this.mergeShortParagraphs(BOOKS[bookIdx])
    setActiveTagMap(tagMap)
    // Detect mobile before resize so virtual width can adapt
    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (this.isMobile) {
      const cw = this.canvas.parentElement!.getBoundingClientRect().width
      if (cw < 600) this.W = 560
    }
    this.resize()
    this.loadParagraph(0, 0)
    this.spawnBall()
    initLetterGrid()
    sidebarEls.bookName.textContent = this.book.title
    this.updateSidebar()

    let resizeTimer = 0
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => this.resize(), 150) as unknown as number
    })
    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = (e.clientX - rect.left) / rect.width * this.W
    })
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.key)
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (this.levelState === 'playing') this.launchBalls()
      }
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key))

    // Left click: hold to push paddle forward, release to snap back
    // Click: slam paddle forward (also launches ball if stuck)
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      if (this.gameOver) {
        if (this.onGameEnd) this.onGameEnd()
        return
      } else if (this.paused) {
        this.paused = false
      } else if (this.levelState === 'shop') {
        const rect = this.canvas.getBoundingClientRect()
        const vx = (e.clientX - rect.left) / rect.width * this.W
        const vy = (e.clientY - rect.top) / rect.height * this.H
        this.handleShopClick(vx, vy)
      } else if (this.levelState === 'endGrade' && this.endTimer > 1.0) {
        if (this.tutorial) {
          this.gameOver = true
          markTutorialDone()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          this.openShop()
        }
      } else {
        // Slam paddle — launches stuck ball on slam start
        if (this.slamCooldown <= 0) this.mouseDown = true
      }
    })
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouseDown) {
        this.mouseDown = false
        this.slamCooldown = 0.3  // brief cooldown after release
      }
    })

    // Right click: recall ball
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (this.charge >= 1.0 && this.balls.some(b => !b.stuck)) {
        this.recallBall()
      }
    })

    // ── Touch controls (mobile) — multi-touch + swipe-up recall ──
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()

      // State transitions — any touch
      if (this.gameOver) {
        if (this.onGameEnd) this.onGameEnd()
        return
      }
      if (this.paused) { this.paused = false }  // don't return — let touch register as move finger
      if (this.levelState === 'shop') {
        const touch = e.changedTouches[0]
        if (touch) {
          const rect = this.canvas.getBoundingClientRect()
          const vx = (touch.clientX - rect.left) / rect.width * this.W
          const vy = (touch.clientY - rect.top) / rect.height * this.H
          this.handleShopClick(vx, vy)
        }
        return
      }
      if (this.levelState === 'endGrade' && this.endTimer > 1.0) {
        if (this.tutorial) {
          this.gameOver = true
          markTutorialDone()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          this.openShop()
        }
        return
      }

      // Multi-touch: first finger moves paddle, second finger slams
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const rect = this.canvas.getBoundingClientRect()
        const vx = (touch.clientX - rect.left) / rect.width * this.W

        // Track start position for swipe-up recall detection
        this.touchStarts.set(touch.identifier, { x: touch.clientX, y: touch.clientY, t: performance.now() })

        if (this.moveTouchId === null) {
          // First finger — paddle movement only
          this.moveTouchId = touch.identifier
          this.mouseX = vx
        } else if (this.slamTouchId === null) {
          // Second finger — slam paddle forward
          this.slamTouchId = touch.identifier
          if (this.slamCooldown <= 0) this.mouseDown = true
        }
      }
    }, { passive: false })

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === this.moveTouchId) {
          const rect = this.canvas.getBoundingClientRect()
          this.mouseX = (touch.clientX - rect.left) / rect.width * this.W
        }
      }
    }, { passive: false })

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]

        // Swipe-up recall: fast upward flick on any finger
        const start = this.touchStarts.get(touch.identifier)
        if (start) {
          this.touchStarts.delete(touch.identifier)
          const dy = start.y - touch.clientY  // positive = upward
          const dx = Math.abs(touch.clientX - start.x)
          const dt = performance.now() - start.t
          // Require: >60px upward, <300ms, mostly vertical (dy > dx)
          if (dy > 60 && dy > dx && dt < 300 && this.charge >= 1.0 && this.balls.some(b => !b.stuck)) {
            this.recallBall()
          }
        }

        if (touch.identifier === this.moveTouchId) {
          this.moveTouchId = null
        } else if (touch.identifier === this.slamTouchId) {
          this.slamTouchId = null
          if (this.mouseDown) {
            this.mouseDown = false
            this.slamCooldown = 0.3
          }
        }
      }
    }
    window.addEventListener('touchend', handleTouchEnd)
    window.addEventListener('touchcancel', handleTouchEnd)

    // Pause on any focus loss — tab switch, app switch, etc.
    // Also snapshot state so continue-run restores exactly here
    window.addEventListener('blur', () => {
      if (!this.gameOver) {
        this.paused = true
        if (!this.tutorial) saveToStorage(this.getSaveState())
      }
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.gameOver) {
        this.paused = true
        if (!this.tutorial) saveToStorage(this.getSaveState())
      }
    })
  }

  private resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return  // guard against layout thrashing

    if (this.isMobile) {
      // Mobile: render at full device DPR for smooth sub-pixel text scrolling
      // Drift is <1 canvas pixel/frame at low DPR → text snaps to pixel grid
      const dpr = window.devicePixelRatio || 1
      const cw = this.canvas.clientWidth || Math.round(rect.width)
      const ch = this.canvas.clientHeight || Math.round(rect.height)
      this.canvas.width = Math.round(cw * dpr)
      this.canvas.height = Math.round(ch * dpr)
      this.scale = this.canvas.width / this.W
      this.H = Math.round(this.canvas.height / this.scale)
    } else {
      // Desktop: fit with aspect ratio, center in container
      const scaleW = rect.width / this.W
      const scaleH = rect.height / VIRTUAL_H
      if (scaleW <= scaleH) {
        this.scale = scaleW
        this.H = Math.round(rect.height / this.scale)
      } else {
        this.scale = scaleH
        this.H = VIRTUAL_H
      }
      const physW = Math.round(this.W * this.scale)
      const physH = Math.round(this.H * this.scale)
      this.canvas.width = physW
      this.canvas.height = physH
      this.canvas.style.width = physW + 'px'
      this.canvas.style.height = physH + 'px'
    }

    // Guard against NaN/Infinity from zero-size containers
    if (!isFinite(this.H) || this.H < 100) this.H = VIRTUAL_H
    if (!isFinite(this.scale) || this.scale <= 0) this.scale = 1

    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)

    // Scale drift speed proportional to field height so timing stays consistent
    // Slightly faster for harder difficulties (imperceptible per step, adds up)
    const diffMult = this.book.difficulty === 'Medium' ? 1.08
      : this.book.difficulty === 'Hard' ? 1.18
      : this.book.difficulty === 'Very Hard' ? 1.28
      : 1.0  // Easy / Custom
    this.baseDriftSpeed = 6.4 * diffMult * (this.H / VIRTUAL_H)
    if (this.freezeTimer <= 0) this.bricksDriftSpeed = this.baseDriftSpeed

    // Heavy reinitialization only when not actively playing
    // (avoids GC pressure from iOS Safari URL bar resize events)
    if (!this.started || this.gameOver) {
      this.paddleBaseY = 50
      this.paddleY = this.paddleBaseY
      this.paddleTargetY = this.paddleBaseY
      this.prevPaddleY = this.paddleBaseY
      this.measurePaddle()
      this.brickFontSize = this.tutorial?.fontSize ?? (this.tutorial?.largeBricks ? 22 : 15)
      this.brickLineH = this.brickFontSize + 6
      this.brickFont = `${this.brickFontSize}px 'JetBrains Mono', 'Courier New', monospace`
      this.initDots()
    }
  }

  private initDots() {
    this.dots = []
    // Wider spacing on mobile: 1600 dots vs 4000+ (60% less CPU/GPU per frame)
    const spacing = this.isMobile ? 22 : this.dotSpacing
    const cols = Math.ceil(this.W / spacing) + 1
    const rows = Math.ceil(this.H / spacing) + 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * spacing
        const y = r * spacing
        this.dots.push({ homeX: x, homeY: y, x, y, vx: 0, vy: 0 })
      }
    }
  }

  private measurePaddle() {
    const font = `bold ${this.paddleH - 5}px 'JetBrains Mono', 'Courier New', monospace`
    const prepared = prepareWithSegments(this.paddleText, font)
    const result = layoutWithLines(prepared, 9999, this.paddleH)
    const textW = result.lines.length > 0 ? result.lines[0].width : this.paddleText.length * (this.paddleH - 5) * 0.6
    this.paddleW = textW + this.paddlePadX * 2
  }

  private safetyLabel = ''

  private measureSafety() {
    const hits = Math.min(this.safetyHits, 9)
    if (hits <= 0) {
      this.safetyLabel = ''
      this.safetyW = 0
      return
    }
    const equals = '═'.repeat(hits)
    this.safetyLabel = `${equals} SAFETY ${equals}`
    const font = `bold ${this.safetyH - 5}px 'JetBrains Mono', 'Courier New', monospace`
    const prepared = prepareWithSegments(this.safetyLabel, font)
    const result = layoutWithLines(prepared, 9999, this.safetyH)
    const textW = result.lines.length > 0 ? result.lines[0].width : this.safetyLabel.length * 7
    this.safetyW = textW + 28
  }

  // ── Merge short paragraphs so dialogue-heavy books don't create tiny brick groups ──
  private mergeShortParagraphs(book: Book): Book {
    const MIN_WORDS = 25
    return {
      ...book,
      chapters: book.chapters.map(ch => {
        const merged: string[] = []
        let buffer = ''
        for (const p of ch.paragraphs) {
          if (buffer) buffer += ' ' + p
          else buffer = p
          if (buffer.split(/\s+/).length >= MIN_WORDS) {
            merged.push(buffer)
            buffer = ''
          }
        }
        // Flush remainder: merge into last paragraph if too short, else push as-is
        if (buffer) {
          if (merged.length > 0 && buffer.split(/\s+/).length < MIN_WORDS) {
            merged[merged.length - 1] += ' ' + buffer
          } else {
            merged.push(buffer)
          }
        }
        return { ...ch, paragraphs: merged }
      }),
    }
  }

  // ── Chapter / Paragraph / Brick loading ─────────────────────
  // Each "level" loads up to 3 consecutive paragraphs with gaps between them
  private static readonly PARA_BREAK = '\x00'  // sentinel for paragraph gap
  private static readonly PARAS_PER_LEVEL = 3

  private loadParagraph(chapterIdx: number, paragraphIdx: number) {
    this.chapterIdx = chapterIdx % this.book.chapters.length
    const chapter = this.book.chapters[this.chapterIdx]
    this.paragraphIdx = paragraphIdx % chapter.paragraphs.length

    // Tutorial: apply custom brick font size per phase
    if (this.tutorial) {
      this.brickFontSize = this.tutorial.fontSize ?? (this.tutorial.largeBricks ? 22 : 15)
      this.brickLineH = this.brickFontSize + 6
      this.brickFont = `${this.brickFontSize}px 'JetBrains Mono', 'Courier New', monospace`
    }

    // Combine paragraphs — tutorial loads 1 at a time, normal loads up to 3
    const words: string[] = []
    const parasPerLevel = this.tutorial ? 1 : Game.PARAS_PER_LEVEL
    const count = Math.min(parasPerLevel, chapter.paragraphs.length - this.paragraphIdx)
    for (let i = 0; i < count; i++) {
      if (i > 0) words.push(Game.PARA_BREAK)
      const text = chapter.paragraphs[this.paragraphIdx + i]
      for (const token of text.split(/\s+/).filter(w => w.length > 0)) {
        // Split leading/trailing punctuation into separate bricks
        const m = token.match(/^([^a-zA-Z0-9'']*)(.+?)([^a-zA-Z0-9'']*)$/)
        if (m) {
          if (m[1]) words.push(m[1])
          words.push(m[2])
          if (m[3]) words.push(m[3])
        } else {
          words.push(token)
        }
      }
    }
    // Track how many paragraphs this level spans (for advanceLevel)
    this.levelParagraphCount = count

    this.wordsInParagraph = words
    this.totalWordsInParagraph = words.filter(w => w !== Game.PARA_BREAK).length
    this.levelBasePoints = 0
    this.wordCursor = 0
    this.bricks = []
    this.bricksScrollY = 0
    this.brickHitThisLevel = false
    this.islandGroups.clear()
    this.nextIslandId = 1
    // Spawn enough rows to fill from start to well below the screen
    this.spawnBrickRows(30, this.H * 0.70)

    // Tutorial: auto-fill charge for recall demo phase
    if (this.tutorial?.currentPhase?.giveRecall) {
      this.charge = 1.0
    }
  }

  private spawnBrickRows(rowCount: number, startWorldY?: number) {
    const margin = 20
    const gapX = 6
    const gapY = 6
    const areaW = this.W - margin * 2

    // World Y: screen position + scroll offset
    let curY = startWorldY ?? (this.H + this.bricksScrollY + 20)
    // Find the lowest existing brick to continue below it (all in world coords)
    for (const b of this.bricks) {
      if (b.alive) curY = Math.max(curY, b.y + b.h + gapY)
    }

    for (let row = 0; row < rowCount; row++) {
      // Paragraph break — just consume the sentinel and keep flowing
      while (this.wordCursor < this.wordsInParagraph.length && this.wordsInParagraph[this.wordCursor] === Game.PARA_BREAK) {
        this.wordCursor++
      }

      let curX = margin
      let rowH = this.brickLineH + this.brickPadY * 2
      const rowBricks: Brick[] = []

      while (curX < areaW + margin && this.wordCursor < this.wordsInParagraph.length) {
        const word = this.wordsInParagraph[this.wordCursor]
        if (word === Game.PARA_BREAK) break  // stop row at paragraph boundary
        const prepared = prepareWithSegments(word, this.brickFont)
        const result = layoutWithLines(prepared, 9999, this.brickLineH)
        const textW = result.lines.length > 0 ? result.lines[0].width : word.length * this.brickFontSize * 0.6
        const isPunc = isPunctuation(word)
        // Minimum brick width so punctuation bricks are hittable
        const bw = Math.max(isPunc ? 28 : 0, textW + this.brickPadX * 2)

        if (curX + bw > areaW + margin && rowBricks.length > 0) break

        let color = wordColor(word)
        if (this.tutorial) color = this.tutorial.overrideBrickColor(color, this.wordCursor)
        const isStop = color === TAG_COLORS.stopword
        const brick: Brick = {
          word,
          x: curX,
          y: curY,
          w: bw,
          h: rowH,
          alive: true,
          alpha: 1,
          color,
          points: isPunc ? 5 : scoreWord(word, isStop),
          boxed: true,
          breakOff: 0,
          breakOffVx: 0,
          breakOffAngle: 0,
          breakOffGroupId: 0,
          breakOffOrigX: 0,
          breakOffOrigY: 0,
        }
        rowBricks.push(brick)
        this.bricks.push(brick)
        this.levelBasePoints += brick.points
        curX += bw + gapX
        this.wordCursor++
      }

      // No words placed — all content exhausted, stop spawning
      if (rowBricks.length === 0) break

      // ── Paragraph break after partial row — just consume, no filler rows ──
      if (this.wordCursor < this.wordsInParagraph.length
        && this.wordsInParagraph[this.wordCursor] === Game.PARA_BREAK) {
        this.wordCursor++
      }

      // ── Center row with uniform gaps, pad sides with fillers ──
      if (rowBricks.length > 0) {
        const usedW = rowBricks.reduce((sum, b) => sum + b.w, 0) + (rowBricks.length - 1) * gapX
        const centerOffset = (areaW - usedW) / 2
        for (const b of rowBricks) b.x += centerOffset

        // Fill remaining space on left and right with uniform-sized filler bricks
        const firstX = rowBricks[0].x
        const lastB = rowBricks[rowBricks.length - 1]
        const lastX = lastB.x + lastB.w
        const leftGap = firstX - margin
        const rightGap = (margin + areaW) - lastX
        const fillerW = 28  // same as min punctuation brick width

        const spawnFillers = (startX: number, totalW: number) => {
          if (totalW < fillerW) return
          const fitW = fillerW + gapX
          const count = Math.max(1, Math.floor((totalW + gapX) / fitW))
          const actualW = (totalW - gapX * (count - 1)) / count
          for (let i = 0; i < count; i++) {
            this.bricks.push({
              word: '', x: startX + i * (actualW + gapX), y: curY,
              w: actualW, h: rowH,
              alive: true, alpha: 1, color: '#3a3f4a', points: 0, boxed: true,
              breakOff: 0, breakOffVx: 0, breakOffAngle: 0,
              breakOffGroupId: 0, breakOffOrigX: 0, breakOffOrigY: 0,
            })
          }
        }

        if (leftGap > gapX + 10) spawnFillers(margin, leftGap - gapX)
        if (rightGap > gapX + 10) spawnFillers(lastX + gapX, rightGap - gapX)
      }

      curY += rowH + gapY
    }
  }


  // ── Ball ────────────────────────────────────────────────────
  private get ballR(): number {
    return BASE_BALL_R * (1 + this.ballSizeBonus)
  }

  private spawnBall() {
    this.balls.push({
      x: this.paddleX + this.paddleW / 2,
      y: this.paddleY + this.paddleH + 10,
      vx: 0,
      vy: 0,
      r: this.ballR,
      trail: [],
      stuck: true,
      backWallHits: 0,
      slamStacks: 0,
      blastCharge: 0,
      pierceLeft: 0,
      magnetSpeed: 0,
      magnetImmunity: 0,
      magnetOffsetX: 0,
      homingLeft: 0,
      homingCooldown: 0,
      ghostLeft: 0, ghostPhasedBricks: new Set(),
    })
  }

  /** Update radius on all existing balls after size bonus changes */
  private applyBallSize() {
    const r = this.ballR
    for (const ball of this.balls) ball.r = r
  }

  private launchBalls() {
    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.stuck = false
        const wasMagnet = ball.magnetSpeed > 0
        const speed = wasMagnet ? ball.magnetSpeed : this.ballSpeed
        ball.magnetSpeed = 0
        if (wasMagnet) ball.magnetImmunity = 0.15  // prevent immediate re-catch

        if (ball.homingLeft > 0) {
          // Homing: aim at highest-value visible brick (steering continues in-flight)
          const target = this.findHomingTarget(ball)
          if (target) {
            const bsy = target.y - this.bricksScrollY
            const dx = (target.x + target.w / 2) - ball.x
            const dy = (bsy + target.h / 2) - ball.y
            const angle = Math.atan2(dy, dx)
            ball.vx = Math.cos(angle) * speed
            ball.vy = Math.sin(angle) * speed
          } else {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6
            ball.vx = Math.cos(angle) * speed
            ball.vy = Math.sin(angle) * speed
          }
          // Don't decrement here — decrement on brick hit so ball curves until impact
        } else {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6
          ball.vx = Math.cos(angle) * speed
          ball.vy = Math.sin(angle) * speed
        }

        this.started = true
        this.hasLaunched = true
      }
    }
  }

  /** Find nearest alive brick in ball's forward half-plane for homing */
  private findHomingTarget(ball: Ball): Brick | null {
    let best: Brick | null = null
    let bestDist = Infinity
    for (const b of this.bricks) {
      if (!b.alive || b.breakOff > 0) continue
      const screenY = b.y - this.bricksScrollY
      if (screenY < -50 || screenY > this.H + 50) continue
      const dx = (b.x + b.w / 2) - ball.x
      const dy = (screenY + b.h / 2) - ball.y
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = b
      }
    }
    return best
  }

  /** Spawn break visual effects (sparks, corners, edges, ring) for a brick */
  private spawnBreakFx(brick: Brick, brickScreenY: number) {
    const cx = brick.x + brick.w / 2
    const cy = brickScreenY + brick.h / 2
    const combo = this.multiplier
    const comboT = Math.min(1, (combo - 1) / 6)

    // Spark dots
    const sparkCount = 4 + Math.floor(comboT * 5)
    const sparkSpeed = 80 + comboT * 100
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.8
      const speed = sparkSpeed + Math.random() * 120
      this.particles.push({
        x: cx + (Math.random() - 0.5) * brick.w * 0.4,
        y: cy + (Math.random() - 0.5) * brick.h * 0.3,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        char: '*', life: 0.3 + Math.random() * 0.2, maxLife: 0.5,
        color: brick.color, size: 14 + Math.random() * 4 + comboT * 4,
      })
    }

    // Corner fragments
    if (combo >= 2) {
      const corners = [
        { x: brick.x, y: brickScreenY, vx: -1, vy: -1 },
        { x: brick.x + brick.w, y: brickScreenY, vx: 1, vy: -1 },
        { x: brick.x, y: brickScreenY + brick.h, vx: -1, vy: 1 },
        { x: brick.x + brick.w, y: brickScreenY + brick.h, vx: 1, vy: 1 },
      ]
      const cSpeed = 40 + comboT * 80
      for (const c of corners) {
        if (Math.random() > 0.4 + comboT * 0.3) continue
        this.particles.push({
          x: c.x, y: c.y,
          vx: c.vx * cSpeed + (Math.random() - 0.5) * 30,
          vy: c.vy * cSpeed + (Math.random() - 0.5) * 30,
          char: '+', life: 0.4 + comboT * 0.3, maxLife: 0.8,
          color: brick.color, size: 16 + comboT * 4,
        })
      }
    }

    // Edge fragments
    if (combo >= 4) {
      const edgeCount = 2 + Math.floor(comboT * 3)
      for (let i = 0; i < edgeCount; i++) {
        const ch = Math.random() > 0.5 ? '-' : '|'
        const ex = ch === '-' ? brick.x + Math.random() * brick.w
          : (Math.random() > 0.5 ? brick.x : brick.x + brick.w)
        const ey = ch === '-' ? (Math.random() > 0.5 ? brickScreenY : brickScreenY + brick.h)
          : brickScreenY + Math.random() * brick.h
        const eAngle = Math.atan2(ey - cy, ex - cx) + (Math.random() - 0.5) * 0.5
        const eSpeed = 60 + Math.random() * 80
        this.particles.push({
          x: ex, y: ey,
          vx: Math.cos(eAngle) * eSpeed, vy: Math.sin(eAngle) * eSpeed,
          char: ch, life: 0.3 + Math.random() * 0.2, maxLife: 0.6,
          color: brick.color, size: 16 + comboT * 4,
        })
      }
    }

    // Ring at high combo
    if (combo >= 6) {
      this.particles.push({
        x: cx, y: cy, vx: 0, vy: 0,
        char: 'o', life: 0.35, maxLife: 0.4,
        color: brick.color, size: 28 + comboT * 16,
      })
    }

    // White flash
    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      char: '*', life: 0.15 + comboT * 0.05, maxLife: 0.25,
      color: '#ffffff', size: 18 + brick.word.length * 0.5 + comboT * 8,
    })
  }

  private recallBall() {
    const activeBalls = this.balls.filter(b => !b.stuck)
    if (activeBalls.length === 0) return
    this.hasRecalled = true

    // Recall ALL active balls
    for (const ball of activeBalls) {
      const targetX = this.paddleX + this.paddleW / 2
      const targetY = this.paddleY + this.paddleH / 2
      const dx = targetX - ball.x
      const dy = targetY - ball.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      let pathBlocked = false
      if (dist > 1) {
        const steps = Math.ceil(dist / 5)
        const stepX = dx / steps
        const stepY = dy / steps
        for (let i = 0; i <= steps; i++) {
          const px = ball.x + stepX * i
          const py = ball.y + stepY * i
          for (const brick of this.bricks) {
            if (!brick.alive) continue
            const by = brick.y - this.bricksScrollY
            if (px > brick.x && px < brick.x + brick.w && py > by && py < by + brick.h) {
              pathBlocked = true
              break
            }
          }
          if (pathBlocked) break
        }
      }

      if (pathBlocked) {
        // Path blocked — redirect toward paddle
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
        const angle = Math.atan2(dy, dx)
        ball.vx = Math.cos(angle) * speed
        ball.vy = Math.sin(angle) * speed
        this.particles.push({
          x: ball.x, y: ball.y,
          vx: 0, vy: -30,
          char: '↑ RECALL', life: 0.6, maxLife: 0.6,
          color: '#fbbf24', size: 12,
        })
      } else {
        // Clear path — teleport home
        for (let i = 0; i < 10; i++) {
          const t = i / 10
          this.particles.push({
            x: ball.x + dx * t, y: ball.y + dy * t,
            vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
            char: '✦', life: 0.6, maxLife: 0.8,
            color: '#fbbf24', size: 10 + Math.random() * 6,
          })
        }
        ball.x = targetX
        ball.y = this.paddleY + this.paddleH + ball.r + 2
        ball.stuck = true
        ball.trail = []
        ball.backWallHits = 0
        ball.slamStacks = 0
      }
    }
    this.charge = 0
  }

  // ── Update ──────────────────────────────────────────────────
  update(dt: number) {
    if (this.paused) return
    if (this.gameOver) {
      if (this.keysDown.has(' ') || this.keysDown.has('Enter')) {
        if (this.onGameEnd) this.onGameEnd()
      }
      return
    }

    // ── Tutorial state machine (logic lives in tutorial.ts) ──
    if (this.tutorial?.isTransitioning) {
      const action = this.tutorial.tick(dt, this.pickups.length > 0)
      if (action === 'advanceLevel') { this.advanceLevel(); return }
      if (action === 'startEndSequence') { this.startEndSequence(); return }
      if (action === 'tickParticlesReturn') {
        this.tickParticlesAndFade(dt)
        return
      }
      // 'runPickupsAndReturn' / 'normalGameplay' — fall through to normal update
      // (balls bounce, safety patrols, pickups float, dots animate)
    }

    // ── End-of-chapter sequence (all in-field, no overlays) ──

    // Phase 0: Gray cleanup — only grays left, pop them in series with base points
    if (this.levelState === 'grayCleanup') {
      this.grayPopTimer += dt
      const popsPerSec = 10
      const targetIdx = Math.floor(this.grayPopTimer * popsPerSec)
      while (this.grayPopIdx < this.grayPopBricks.length && this.grayPopIdx < targetIdx) {
        const brick = this.grayPopBricks[this.grayPopIdx]
        brick.alive = false
        // Base points only — no multiplier, no combo boost
        this.score += brick.points
        this.levelWords.push({ word: brick.word, color: brick.color, points: brick.points })
        this.wordsBroken++
        // Gray puff particles
        const bsy = brick.y - this.bricksScrollY
        for (let i = 0; i < brick.word.length; i++) {
          this.particles.push({
            x: brick.x + (i / brick.word.length) * brick.w + 8,
            y: bsy + brick.h / 2,
            vx: (Math.random() - 0.5) * 120,
            vy: (Math.random() - 0.6) * 100,
            char: brick.word[i],
            life: 0.8, maxLife: 1.0,
            color: '#888', size: 14,
          })
        }
        this.grayPopIdx++
      }
      this.tickParticlesAndFade(dt)
      // When all grays popped, brief pause for final particles then transition
      const popDuration = this.grayPopBricks.length / popsPerSec + 0.6
      if (this.grayPopIdx >= this.grayPopBricks.length && this.grayPopTimer > popDuration) {
        if (this.tutorial && !this.tutorial.isLastPhase) {
          this.levelState = 'playing'
          this.handleTutorialLevelClear()
        } else {
          this.startEndSequence()
        }
      }
      return
    }

    // Phase 1: Pop remaining bricks one by one
    if (this.levelState === 'endPopping') {
      this.endTimer += dt
      // Skip straight to tally if nothing to pop (clean clear)
      if (this.endPopBricks.length === 0) {
        if (this.endTimer > 0.5) {
          this.levelState = 'endTally'
          this.endTimer = 0
        }
        this.tickParticlesAndFade(dt)
        return
      }
      const popsPerSec = 16
      const targetIdx = Math.floor(this.endTimer * popsPerSec)
      while (this.endPopIdx < this.endPopBricks.length && this.endPopIdx < targetIdx) {
        const brick = this.endPopBricks[this.endPopIdx]
        brick.alive = false
        // Red explosion particles
        const bsy = brick.y - this.bricksScrollY
        for (let i = 0; i < brick.word.length; i++) {
          this.particles.push({
            x: brick.x + (i / brick.word.length) * brick.w + 8,
            y: bsy + brick.h / 2,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.8) * 180,
            char: brick.word[i],
            life: 1.0, maxLife: 1.2,
            color: '#f87171', size: 16,
          })
        }
        this.endPopIdx++
      }
      // Tick particles + fade bricks
      this.tickParticlesAndFade(dt)
      // When done popping, move to tally (min 1s pause to see final explosions)
      const popDuration = this.endPopBricks.length / popsPerSec + 0.5
      if (this.endPopIdx >= this.endPopBricks.length && this.endTimer > Math.max(popDuration, 1.0)) {
        this.levelState = 'endTally'
        this.endTimer = 0
      }
      return
    }

    // Phase 2: Score tally — count up broken words, then deduct missed
    if (this.levelState === 'endTally') {
      this.endTimer += dt
      const tallyPerSec = 32
      const targetIdx = Math.floor(this.endTimer * tallyPerSec)
      while (this.endTallyIdx < this.levelWords.length && this.endTallyIdx < targetIdx) {
        this.endTallyScore += this.levelWords[this.endTallyIdx].points
        this.endTallyIdx++
      }
      // After tally finishes, show penalty deduction then move to grade
      const tallyDone = this.endTallyIdx >= this.levelWords.length
      const tallyEndTime = this.levelWords.length / tallyPerSec + 0.8
      const missed = this.endTotalWords - this.endBrokenWords
      if (tallyDone && !this.endPenaltyShown && this.endTimer > tallyEndTime) {
        // Deduct penalty for missed words (only if any were missed)
        this.endPenaltyTotal = missed * 50
        if (this.endPenaltyTotal > 0) {
          this.score = Math.max(0, this.score - this.endPenaltyTotal)
        }
        this.endPenaltyShown = true
      }
      // Skip penalty pause if nothing was missed
      const penaltyDelay = missed > 0 ? 1.5 : 0.3
      if (tallyDone && this.endPenaltyShown && this.endTimer > tallyEndTime + penaltyDelay) {
        // Calculate grade
        const pct = this.endTotalWords > 0 ? this.endBrokenWords / this.endTotalWords : 0
        const scoreRatio = this.levelBasePoints > 0 ? this.endTallyScore / this.levelBasePoints : 0
        if (pct >= 1.0 && this.levelLivesLost === 0 && scoreRatio >= 2.5) this.endGrade = 'S'
        else if (pct >= 0.90) this.endGrade = 'A'
        else if (pct >= 0.75) this.endGrade = 'B'
        else if (pct >= 0.60) this.endGrade = 'C'
        else if (pct >= 0.40) this.endGrade = 'D'
        else this.endGrade = 'F'
        this.levelState = 'endGrade'
        this.endTimer = 0
      }
      this.tickParticlesAndFade(dt)
      this.sidebarTimer -= dt
      if (this.sidebarTimer <= 0) { this.updateSidebar(); this.sidebarTimer = 0.1 }
      return
    }

    // Phase 3: Grade shown (or game over tally done) — wait for input
    if (this.levelState === 'endGrade') {
      this.endTimer += dt
      this.tickParticlesAndFade(dt)
      if (this.endTimer > 1.0 && (this.keysDown.has(' ') || this.keysDown.has('Enter'))) {
        if (this.tutorial) {
          this.gameOver = true
          markTutorialDone()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          this.openShop()
        }
      }
      return
    }

    // Phase 4: Shop — between levels, wait for purchases / continue
    if (this.levelState === 'shop') {
      if (this.keysDown.has(' ') || this.keysDown.has('Enter')) {
        this.closeShopAndAdvance()
      }
      this.tickParticlesAndFade(dt)
      return
    }

    // Paddle movement — horizontal
    if (this.mouseX >= 0) {
      this.paddleTargetX = this.mouseX - this.paddleW / 2
    }
    this.paddleTargetX = Math.max(0, Math.min(this.W - this.paddleW, this.paddleTargetX))
    this.paddleX += (this.paddleTargetX - this.paddleX) * Math.min(1, dt * 22.5)

    // Paddle movement — vertical: click fires paddle to wall, release eases back
    if (this.slamCooldown > 0) this.slamCooldown -= dt
    const maxY = this.paddleBaseY + 55

    // Activate slam on mousedown — also launches stuck balls
    if (this.mouseDown && !this.slamActive) {
      this.slamActive = true
      this.launchBalls()
    }

    if (this.slamActive) {
      // Accelerate into the wall — 2x speed
      this.paddleVyInternal = Math.min(1600, this.paddleVyInternal + 4800 * dt)
      this.paddleY = Math.min(maxY, this.paddleY + this.paddleVyInternal * dt)
      // Once at the wall, stop accelerating. Only return when mouse is released.
      if (this.paddleY >= maxY) {
        this.paddleY = maxY
        this.paddleVyInternal = 0
        this.slamWallTimer += dt  // track time sitting at max extension
        if (!this.mouseDown) this.slamActive = false
      } else {
        this.slamWallTimer = 0  // still in transit — reset
      }
    } else {
      // Ease back to base — smooth exponential
      this.paddleVyInternal = 0
      this.slamWallTimer = 0  // not slamming — reset
      this.paddleY += (this.paddleBaseY - this.paddleY) * Math.min(1, dt * 14)
    }
    this.paddleVy = (this.paddleY - this.prevPaddleY) / Math.max(dt, 0.001)
    this.prevPaddleY = this.paddleY

    // Safety bar patrol
    if (this.safetyHits > 0) {
      this.safetyX += this.safetyDir * 120 * dt
      if (this.safetyX + this.safetyW > this.W) {
        this.safetyX = this.W - this.safetyW
        this.safetyDir = -1
      } else if (this.safetyX < 0) {
        this.safetyX = 0
        this.safetyDir = 1
      }
    }

    // Multiplier decay: -1.0x per second, floor at 1.0
    if (this.multiplier > 1.0) {
      this.multiplier = Math.max(1.0, this.multiplier - dt * 1.0)
    }

    // Freeze upgrade timer — completely stops brick scrolling
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt
      this.bricksDriftSpeed = 0
      if (this.freezeTimer <= 0) {
        this.freezeTimer = 0
        this.bricksDriftSpeed = this.baseDriftSpeed
      }
    }

    // Brick drift upward
    if (this.started) {
      this.bricksScrollY += this.bricksDriftSpeed * dt

      // Spawn more rows if needed
      const lowestBrickY = this.bricks.reduce((max, b) =>
        b.alive ? Math.max(max, b.y - this.bricksScrollY) : max, 0)
      if (lowestBrickY < this.H + 100) {
        this.spawnMoreBricks()
      }

      // Back wall activates once all bricks have scrolled into the play area
      if (!this.backWallActive && this.wordCursor >= this.wordsInParagraph.length && lowestBrickY < this.H - 10) {
        this.backWallActive = true
      }
      if (this.backWallActive && this.backWallReveal < 1) {
        this.backWallReveal = Math.min(1, this.backWallReveal + dt * 2.5)  // ~0.4s reveal
      }

      // Island detection — check every 0.5s for disconnected brick groups
      // Only after a ball has broken at least one brick (prevents false breakoffs from layout gaps)
      this.islandCheckTimer -= dt
      const breakoffsAllowed = !this.tutorial || this.tutorial.breakoffsEnabled
      if (this.islandCheckTimer <= 0 && this.levelState === 'playing' && this.brickHitThisLevel && breakoffsAllowed) {
        this.runIslandDetection()
        this.islandCheckTimer = 0.5
      }

      // Break-off groups — move as unified icebergs, then pop together
      const pops = updateIslandGroups(this.islandGroups, this.bricks, dt, this.bricksScrollY)
      for (const pop of pops) {
        for (const b of pop.bricks) {
          const bonus = Math.round(b.points * pop.bricks.length)
          this.score += bonus
          this.wordsBroken++
          this.multiplier = Math.min(10.0, this.multiplier + 0.3)
          this.levelWords.push({ word: b.word, color: b.color, points: bonus })
          if (this.charge < 1.0) this.charge = Math.min(1.0, this.charge + 0.067)
          for (const ch of b.word.toUpperCase()) {
            if (ch >= 'A' && ch <= 'Z') this.letterCounts[ch] = (this.letterCounts[ch] || 0) + 1
          }
          const bsy = b.y - this.bricksScrollY
          for (let i = 0; i < b.word.length; i++) {
            this.particles.push({
              x: b.x + (i / b.word.length) * b.w + 8, y: bsy + b.h / 2,
              vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300,
              char: b.word[i], life: 1.0, maxLife: 1.2, color: b.color, size: 16,
            })
          }
          // Break visual effects (sparks, corners, etc.)
          if (b.word) this.spawnBreakFx(b, bsy)
          const bTier = colorTier(b.color)
          const goldAmt = bTier <= 0 ? 0 : bTier === 1 ? 2 : bTier === 2 ? 3 : bTier === 3 ? 5 : 8
          if (goldAmt > 0) {
            this.gold += goldAmt
            this.particles.push({
              x: b.x + b.w / 2, y: bsy + b.h / 2,
              vx: (Math.random() - 0.5) * 40, vy: -80 - Math.random() * 30,
              char: `+${goldAmt} ◆`, life: 0.8, maxLife: 0.8, color: '#fbbf24', size: 16,
            })
          }
        }
        this.particles.push({
          x: pop.popX, y: pop.popY, vx: 0, vy: -50,
          char: pop.label, life: 1.5, maxLife: 1.5, color: '#fff', size: 14,
        })
      }

      // Level clear: all words placed and all bricks broken
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInParagraph.length && !this.bricks.some(b => b.alive)) {
        if (this.tutorial) {
          this.handleTutorialLevelClear()
        } else {
          this.startEndSequence()
        }
      }

      // Gray cleanup: all colored bricks broken, only grays remain — auto-pop them
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInParagraph.length) {
        const allAlive = this.bricks.filter(b => b.alive)
        if (allAlive.length > 0 && allAlive.every(b => b.color === TAG_COLORS.stopword || b.color === PUNCTUATION_COLOR || b.word === '')) {
          // Cancel any floating break-off islands — we're cleaning up everything
          this.islandGroups.clear()
          for (const b of allAlive) {
            b.breakOff = 0
            b.breakOffGroupId = 0
          }
          this.grayPopBricks = allAlive
          this.grayPopIdx = 0
          this.grayPopTimer = 0
          this.levelState = 'grayCleanup'
          for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
        }
      }

      // Bricks reached the top wall → end sequence with remaining bricks
      // Tutorial: skip this check (short phases, no pressure needed)
      if (this.levelState === 'playing' && !this.tutorial) {
        for (const b of this.bricks) {
          if (b.alive && b.breakOff <= 0 && b.y - this.bricksScrollY < 5) {
            this.startEndSequence()
            break
          }
        }
      }
    }

    // Balls — physics handled by extracted module
    const physicsState: PhysicsState = {
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleY: this.paddleY,
      paddleH: this.paddleH,
      paddleBaseY: this.paddleBaseY,
      paddleExtentMax: 55,
      W: this.W,
      H: this.H,
      safetyX: this.safetyX,
      safetyW: this.safetyW,
      safetyY: this.safetyY,
      safetyH: this.safetyH,
      safetyHits: this.safetyHits,
      paddleVy: this.paddleVy,
      slamWallTimer: this.slamWallTimer,
      slamActive: this.slamActive,
      ballSpeed: this.ballSpeed,
      bricksScrollY: this.bricksScrollY,
      magnetCharges: this.magnetCharges,
      backWallActive: this.backWallActive,
    }
    // Homing steering — curve in-flight balls toward nearest brick
    this._homingDbg = (this._homingDbg ?? 0) + dt
    for (const ball of this.balls) {
      if (ball.stuck || ball.homingLeft <= 0) continue
      // Cooldown: free movement after a hit before re-engaging
      if (ball.homingCooldown > 0) {
        ball.homingCooldown -= dt
        continue
      }
      const target = this.findHomingTarget(ball)
      if (!target) { if (this._homingDbg > 1) console.log('[HOMING] no target found, bricks:', this.bricks.filter(b=>b.alive).length); continue }
      const bsy = target.y - this.bricksScrollY
      const tx = target.x + target.w / 2
      const ty = bsy + target.h / 2
      const dx = tx - ball.x
      const dy = ty - ball.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1) continue
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
      // Desired direction toward target
      const desiredVx = (dx / dist) * speed
      const desiredVy = (dy / dist) * speed
      // Steer: blend current velocity toward desired (turn rate per second)
      const turnRate = 12.0 * dt  // aggressive arc — must be visibly obvious
      ball.vx += (desiredVx - ball.vx) * Math.min(1, turnRate)
      ball.vy += (desiredVy - ball.vy) * Math.min(1, turnRate)
      // Normalize to preserve speed
      const newSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
      if (newSpeed > 0) {
        ball.vx = (ball.vx / newSpeed) * speed
        ball.vy = (ball.vy / newSpeed) * speed
      }
      if (this._homingDbg > 1) {
        console.log(`[HOMING] steering: charges=${ball.homingLeft} dist=${dist.toFixed(0)} target="${target.word}" speed=${speed.toFixed(0)}`)
        this._homingDbg = 0
      }
    }

    const physicsEvents = updateBalls(this.balls, this.bricks, dt, physicsState)
    for (const ev of physicsEvents) {
      if (ev.type === 'brickHit') {
        this.brickHitThisLevel = true
        this.hitBrick(ev.brick, ev.ball)
        // Homing: consume one charge, brief free-fly before curving to next target
        if (ev.ball.homingLeft > 0) {
          ev.ball.homingLeft--
          if (ev.ball.homingLeft > 0) ev.ball.homingCooldown = 0.25  // 250ms free movement
        }
        if (this.charge < 1.0) {
          this.charge = Math.min(1.0, this.charge + 0.067)
        }
      } else if (ev.type === 'paddleSlam') {
        const label = ev.tier === 3 ? 'PERFECT!' : ev.tier === 2 ? 'GREAT!' : 'GOOD!'
        const color = ev.tier === 3 ? '#fbbf24' : ev.tier === 2 ? '#4ade80' : '#7dd3fc'
        this.particles.push({
          x: ev.ball.x, y: this.paddleY + this.paddleH + 20,
          vx: 0, vy: 40,
          char: label, life: 1.0, maxLife: 1.0,
          color, size: ev.tier === 3 ? 20 : 16,
        })
      } else if (ev.type === 'backWallHit') {
        this.particles.push(ev.particle)
      } else if (ev.type === 'magnetCatch') {
        this.magnetCharges--
      } else if (ev.type === 'safetyHit') {
        this.safetyHits--
        this.measureSafety()
      } else if (ev.type === 'ballLost') {
        // Remove the lost ball
        if (ev.index >= 0) this.balls.splice(ev.index, 1)
        // If no balls remain at all (active or magnet-stuck), lose a life
        const activeBalls = this.balls.filter(b => !b.stuck)
        const stuckBalls = this.balls.filter(b => b.stuck)
        if (activeBalls.length === 0 && stuckBalls.length === 0) {
          this.multiplier = 1.0
          if (!this.tutorial) {
            this.lives--
            this.levelLivesLost++
          }
          if (this.lives <= 0 && !this.tutorial) {
            this.startEndSequence()
          } else {
            // Reset all upgrades back to default on life loss
            this.widenLevel = 0
            this.paddleText = 'BOOK BREAKER'
            this.measurePaddle()
            this.safetyHits = 0
            this.safetyW = 0
            this.freezeTimer = 0
            this.charge = 0
            this.dropBonus = 0
            this.magnetCharges = 0
            // Respawn a single ball stuck to paddle (no upgrades)
            this.ballSizeBonus = 0
            this.balls = [{
              x: this.paddleX + this.paddleW / 2,
              y: this.paddleY + this.paddleH + 9,
              vx: 0, vy: 0, r: this.ballR,
              trail: [], stuck: true,
              backWallHits: 0, slamStacks: 0,
              blastCharge: 0, pierceLeft: 0, magnetSpeed: 0, magnetImmunity: 0, magnetOffsetX: 0, homingLeft: 0, homingCooldown: 0, ghostLeft: 0, ghostPhasedBricks: new Set(),
            }]
          }
        }
      }
    }

    // Extra life every 10,000 points
    while (this.score >= this.nextLifeScore) {
      this.lives++
      this.particles.push({
        x: this.W / 2, y: this.H / 2,
        vx: 0, vy: -60,
        char: '+1 LIFE!', life: 2.0, maxLife: 2.0,
        color: '#4ade80', size: 22,
      })
      this.nextLifeScore += 100000
    }

    // Particles — swap-and-pop for O(1) removal
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 120 * dt  // gravity
      p.life -= dt
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1]
        this.particles.pop()
      }
    }

    // Shrapnel — blast projectiles that bounce off walls, die at bottom or on brick hit
    for (let i = this.shrapnel.length - 1; i >= 0; i--) {
      const s = this.shrapnel[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 350 * dt  // heavy gravity — arcs down into bricks below
      // Bounce off side walls
      if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) }
      if (s.x > this.W) { s.x = this.W; s.vx = -Math.abs(s.vx) }
      // Bounce off top
      if (s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy) }
      // Die when past the bottom
      if (s.y > this.H + 20) {
        this.shrapnel.splice(i, 1)
        continue
      }
      // Check brick collisions
      for (const brick of this.bricks) {
        if (!brick.alive) continue
        const by = brick.y - this.bricksScrollY
        if (s.x > brick.x && s.x < brick.x + brick.w && s.y > by && s.y < by + brick.h) {
          // Use a dummy ball for hitBrick (no pierce/blast)
          const dummyBall: Ball = {
            x: s.x, y: s.y, vx: 0, vy: 0, r: 3,
            trail: [], stuck: false,
            backWallHits: 0, slamStacks: 0,
            blastCharge: 0, pierceLeft: 0, magnetSpeed: 0, magnetImmunity: 0, magnetOffsetX: 0, homingLeft: 0, homingCooldown: 0, ghostLeft: 0, ghostPhasedBricks: new Set(),
          }
          this.hitBrick(brick, dummyBall)
          // Spark on impact
          {
            this.particles.push({
              x: s.x, y: s.y,
              vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100,
              char: '✦', life: 0.3, maxLife: 0.4,
              color: '#ff6040', size: 8,
            })
          }
          this.shrapnel.splice(i, 1)
          break
        }
      }
    }

    // Pickups — float upward, wobble, catch with paddle
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]
      p.y += p.vy * dt
      p.wobblePhase += dt * 5
      p.x += Math.sin(p.wobblePhase) * 30 * dt

      // Caught by paddle?
      if (
        p.y - 10 <= this.paddleY + this.paddleH &&
        p.y + 10 >= this.paddleY &&
        p.x >= this.paddleX &&
        p.x <= this.paddleX + this.paddleW
      ) {
        this.activateUpgrade(p)
        this.pickups.splice(i, 1)
        continue
      }

      // Off screen top — missed
      if (p.y < -30) {
        this.pickups.splice(i, 1)
      }
    }

    // Dot field physics — ball repulsion only (no paddle/safety bar)
    for (const dot of this.dots) {
      const dx = dot.homeX - dot.x
      const dy = dot.homeY - dot.y
      let fx = 0, fy = 0
      for (const ball of this.balls) {
        if (ball.stuck) continue
        const bx = dot.x - ball.x
        const by = dot.y - ball.y
        const distSq = bx * bx + by * by
        // Spread scales with back-wall speed stacks: subtle at base, big when boosted
        const hits = ball.backWallHits
        const radius = 10 + hits * 4       // 10px base → 50px at max stacks
        const baseForce = 150 + hits * 120  // gentle base → strong when fast
        if (distSq < radius * radius && distSq > 1) {
          const dist = Math.sqrt(distSq)
          const force = (1 - dist / radius) * baseForce
          fx += (bx / dist) * force
          fy += (by / dist) * force
        }
      }
      dot.vx = (dot.vx + (dx * 8 + fx) * dt) * 0.95
      dot.vy = (dot.vy + (dy * 8 + fy) * dt) * 0.95
      dot.x += dot.vx * dt
      dot.y += dot.vy * dt
    }

    // Fade dead bricks
    for (const b of this.bricks) {
      if (!b.alive && b.alpha > 0) {
        b.alpha -= dt * 4
        if (b.alpha < 0) b.alpha = 0
      }
    }
    // Purge fully faded bricks periodically
    this.purgeTimer -= dt
    if (this.purgeTimer <= 0) {
      this.bricks = this.bricks.filter(b => b.alive || b.alpha > 0)
      this.purgeTimer = 1
    }

    // Throttle sidebar DOM updates (~10hz, not 60hz)
    this.sidebarTimer -= dt
    if (this.sidebarTimer <= 0) {
      this.updateSidebar()
      this.sidebarTimer = 0.1
    }
  }

  /** Handle tutorial level clear — shared by normal clear and gray cleanup paths */
  private handleTutorialLevelClear() {
    if (!this.tutorial || this.tutorial.isTransitioning) return
    const action = this.tutorial.handleLevelClear(this.pickups.length > 0)
    if (action === 'shop') {
      this.tutorial.advancePhase()
      this.paragraphsCompleted++
      this.openShop()
    } else if (action === 'pause') {
      for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
      this.tutorial.startPause()
    } else if (action === 'endSequence') {
      this.startEndSequence()
    } else if (action === 'wait') {
      for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
    }
  }

  /** Run pickup + paddle physics only (used during tutorial transitions) */
  private tickPickupsOnly(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]
      p.y += p.vy * dt
      p.wobblePhase += dt * 5
      p.x += Math.sin(p.wobblePhase) * 30 * dt
      if (p.y - 10 <= this.paddleY + this.paddleH && p.y + 10 >= this.paddleY &&
          p.x >= this.paddleX && p.x <= this.paddleX + this.paddleW) {
        this.activateUpgrade(p)
        this.pickups.splice(i, 1)
        continue
      }
      if (p.y < -30) this.pickups.splice(i, 1)
    }
    if (this.mouseX >= 0) this.paddleTargetX = this.mouseX - this.paddleW / 2
    this.paddleTargetX = Math.max(0, Math.min(this.W - this.paddleW, this.paddleTargetX))
    this.paddleX += (this.paddleTargetX - this.paddleX) * Math.min(1, dt * 22.5)
  }

  private tickParticlesAndFade(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1]
        this.particles.pop()
      }
    }
    for (const b of this.bricks) {
      if (!b.alive && b.alpha > 0) {
        b.alpha -= dt * 4
        if (b.alpha < 0) b.alpha = 0
      }
    }
  }

  private runIslandDetection() {
    const result = detectIslands(this.bricks, this.bricks.length, this.bricksDriftSpeed, this.nextIslandId)
    this.nextIslandId = result.nextIslandId
    for (const [id, grp] of result.newGroups) {
      this.islandGroups.set(id, grp)
    }
  }

  private startEndSequence() {
    // Collect remaining alive bricks to pop
    this.endPopBricks = this.bricks.filter(b => b.alive)
    this.endPopIdx = 0
    this.endTallyIdx = 0
    this.endTallyScore = 0
    this.endPenaltyTotal = 0
    this.endPenaltyShown = false
    this.endGrade = ''
    this.endTimer = 0
    this.endTotalWords = this.totalWordsInParagraph
    // Broken = words placed as bricks (excluding PARA_BREAK sentinels) minus those still alive
    const paraBreaks = this.wordsInParagraph.slice(0, this.wordCursor).filter(w => w === Game.PARA_BREAK).length
    this.endBrokenWords = (this.wordCursor - paraBreaks) - this.endPopBricks.length
    // Always start with endPopping phase (gives time to see final explosions)
    this.levelState = 'endPopping'
    for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
  }

  private spawnMoreBricks() {
    if (this.wordCursor >= this.wordsInParagraph.length) {
      // Chapter exhausted — wait for all bricks to be cleared
      return
    }
    this.spawnBrickRows(12)
  }

  private restart() {
    clearSave()
    this.gameOver = false
    this.started = false
    this.backWallActive = false
    this.backWallReveal = 0
    this.score = 0
    this.multiplier = 1.0
    this.wordsBroken = 0
    this.lives = 3
    this.nextLifeScore = 100000
    this.levelLivesLost = 0
    this.letterCounts = {}
    this.alphabetCompletions = 0
    this.widenLevel = 0
    this.safetyHits = 0
    this.freezeTimer = 0
    this.charge = 0
    this.gold = 0
    this.dropBonus = 0
    this.ballSizeBonus = 0
    this.magnetCharges = 0
    this.paragraphsCompleted = 0
    this.bricksDriftSpeed = this.baseDriftSpeed
    this.paddleText = 'BOOK BREAKER'
    this.paddleY = this.paddleBaseY
    this.paddleTargetY = this.paddleBaseY
    this.prevPaddleY = this.paddleBaseY
    this.paddleVy = 0
    this.measurePaddle()
    this.pickups = []
    this.particles = []
    this.levelWords = []
    this.levelState = 'playing'
    this.grayPopBricks = []
    this.grayPopIdx = 0
    this.grayPopTimer = 0
    this.loadParagraph(0, 0)
    this.balls = []
    this.spawnBall()
    initLetterGrid()
    clearWordLog()
    this.updateSidebar()
  }

  // ── Shop ──────────────────────────────────────────────────────
  private openShop() {
    this.levelState = 'shop'
    this.shopItems = generateShopItems(this.shopMaxedState(), this.book.difficulty)

    // Responsive grid: 2 cols × 3 rows on mobile, 3 cols × 2 rows on desktop
    const narrow = this.W < 700
    const cols = narrow ? 2 : 3
    const rows = narrow ? 3 : 2
    const gapX = narrow ? 12 : 20
    const gapY = narrow ? 12 : 18
    const itemW = narrow
      ? Math.floor((this.W - gapX * 3) / 2)     // fill width with margins
      : 210
    const itemH = narrow ? 105 : 120
    const gridW = cols * itemW + (cols - 1) * gapX
    const gridX = Math.floor((this.W - gridW) / 2)
    // Clamp gridY so continue button (gridY + rows*(itemH+gapY) + 60) fits in H
    const totalGridH = rows * (itemH + gapY) + 60
    const idealGridY = narrow ? 260 : 370
    const gridY = Math.min(idealGridY, this.H - totalGridH - 40)

    this.shopRects = []
    for (let i = 0; i < 6; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      this.shopRects.push({
        x: gridX + col * (itemW + gapX),
        y: gridY + row * (itemH + gapY),
        w: itemW,
        h: itemH,
      })
    }
    const btnW = narrow ? 180 : 240
    this.shopContinueRect = {
      x: Math.floor(this.W / 2 - btnW / 2),
      y: gridY + rows * (itemH + gapY) + 16,
      w: btnW,
      h: 44,
    }
    if (!this.tutorial) saveToStorage(this.getSaveState())
  }

  private shopMaxedState() {
    return { widenLevel: this.widenLevel, safetyHits: this.safetyHits, ballSizeBonus: this.ballSizeBonus, maxWiden: MAX_WIDEN, maxSafety: MAX_SAFETY }
  }

  private handleShopClick(vx: number, vy: number) {
    // Check shop items
    for (let i = 0; i < this.shopRects.length; i++) {
      const r = this.shopRects[i]
      if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) {
        this.buyShopItem(i)
        return
      }
    }
    // Check continue button
    const r = this.shopContinueRect
    if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) {
      this.closeShopAndAdvance()
    }
  }

  private closeShopAndAdvance() {
    // Snapshot purchased items before advanceLevel resets anything
    const bought = this.shopItems.filter(it => it.bought)
    this.levelState = 'playing'
    this.levelWords = []
    this.advanceLevel()
    // Reapply upgrade purchases that advanceLevel may have wiped (chapter reset)
    // Life purchases already applied and survive advanceLevel
    for (const item of bought) {
      if (item.id === 'life') continue  // already applied
      this.applyShopPurchase(item.id, item.tier)
    }
  }

  /** Apply a shop purchase effect. tier = 1-4 (common-epic), determines strength. */
  private applyShopPurchase(id: string, tier: number) {
    const LIFE_AMOUNTS = [0, 1, 2, 3, 5]
    const WIDEN_AMOUNTS = [0, 1, 2, 3, 4]
    const SAFETY_AMOUNTS = [0, 1, 2, 3, 4]
    const BLAST_TIERS = [0, 1, 2, 3, 4]
    const PIERCE_AMOUNTS = [0, 3, 6, 9, 12]
    const LUCKY_AMOUNTS = [0, 0.01, 0.02, 0.03, 0.05]
    const BIGBALL_AMOUNTS = [0, 0.2, 0.4, 0.6, 0.8]
    const MAGNET_AMOUNTS = [0, 4, 6, 8, 12]
    const HOMING_AMOUNTS = [0, 4, 6, 8, 12]

    if (id === 'life') {
      this.lives += LIFE_AMOUNTS[tier]
    } else if (id === 'widen') {
      this.widenLevel = Math.min(MAX_WIDEN, this.widenLevel + WIDEN_AMOUNTS[tier])
      const equals = '═'.repeat(this.widenLevel)
      this.paddleText = `${equals} BOOK BREAKER ${equals}`
      this.measurePaddle()
    } else if (id === 'multi') {
      while (this.balls.length < 3) {
        this.balls.push({
          x: this.paddleX + this.paddleW / 2 + (this.balls.length % 2 === 0 ? -12 : 12),
          y: this.paddleY + this.paddleH + 9,
          vx: 0, vy: 0, r: this.ballR,
          trail: [], stuck: true,
          backWallHits: 0, slamStacks: 0,
          blastCharge: 0, pierceLeft: 0, magnetSpeed: 0, magnetImmunity: 0, magnetOffsetX: 0, homingLeft: 0, homingCooldown: 0, ghostLeft: 0, ghostPhasedBricks: new Set(),
        })
      }
    } else if (id === 'safety') {
      const wasFresh = this.safetyHits === 0
      this.safetyHits = Math.min(MAX_SAFETY, this.safetyHits + SAFETY_AMOUNTS[tier])
      this.measureSafety()
      if (wasFresh) this.safetyX = this.W / 2 - this.safetyW / 2
    } else if (id === 'blast') {
      for (const ball of this.balls) ball.blastCharge = Math.max(ball.blastCharge, BLAST_TIERS[tier])
    } else if (id === 'pierce') {
      for (const ball of this.balls) ball.pierceLeft = Math.max(ball.pierceLeft, PIERCE_AMOUNTS[tier])
    } else if (id === 'lucky') {
      this.dropBonus += LUCKY_AMOUNTS[tier]
    } else if (id === 'bigball') {
      this.ballSizeBonus = Math.min(1.0, this.ballSizeBonus + BIGBALL_AMOUNTS[tier])
      this.applyBallSize()
    } else if (id === 'magnet') {
      this.magnetCharges += MAGNET_AMOUNTS[tier]
    } else if (id === 'homing') {
      for (const ball of this.balls) ball.homingLeft += HOMING_AMOUNTS[tier]
      console.log(`[HOMING] shop applied: +${HOMING_AMOUNTS[tier]} shots, balls now:`, this.balls.map(b => b.homingLeft))
    } else if (id === 'ghost') {
      const GHOST_AMOUNTS = [0, 2, 3, 4, 5]
      for (const ball of this.balls) ball.ghostLeft += GHOST_AMOUNTS[tier]
    }
  }

  private buyShopItem(idx: number) {
    const item = this.shopItems[idx]
    if (!item || item.bought || item.maxed || this.gold < item.price) return

    item.bought = true
    this.gold -= item.price

    this.applyShopPurchase(item.id, item.tier)

    // Purchase feedback particle
    const rect = this.shopRects[idx]
    if (rect) {
      this.particles.push({
        x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
        vx: 0, vy: -40,
        char: '✓', life: 0.8, maxLife: 0.8,
        color: '#4ade80', size: 24,
      })
    }
    this.updateSidebar()
  }

  private advanceLevel() {
    const chapter = this.book.chapters[this.chapterIdx]
    const nextPara = this.paragraphIdx + this.levelParagraphCount
    const isNewChapter = nextPara >= chapter.paragraphs.length
    if (!isNewChapter) {
      // Next level in same chapter (skip past all paragraphs we just played)
      this.loadParagraph(this.chapterIdx, nextPara)
    } else {
      // Next chapter, first paragraph
      const nextIdx = this.chapterIdx + 1
      if (nextIdx >= this.book.chapters.length) {
        markBookBeaten(this.book.title)
      }
      this.chapterIdx = nextIdx % this.book.chapters.length
      this.loadParagraph(this.chapterIdx, 0)
    }
    // Wait for ball launch before scrolling
    this.started = false
    this.backWallActive = false
    this.backWallReveal = 0
    this.levelLivesLost = 0
    this.freezeTimer = 0
    this.bricksDriftSpeed = this.baseDriftSpeed
    this.paddleY = this.paddleBaseY
    this.paddleTargetY = this.paddleBaseY
    this.prevPaddleY = this.paddleBaseY
    this.paddleVy = 0
    this.pickups = []

    if (isNewChapter) {
      // New chapter — full reset of upgrades
      this.widenLevel = 0
      this.safetyHits = 0
      this.charge = 0
      this.ballSizeBonus = 0
      this.magnetCharges = 0
      this.paddleText = 'BOOK BREAKER'
      this.measurePaddle()
      // Reset to single ball
      this.balls = [{
        x: this.paddleX + this.paddleW / 2,
        y: this.paddleY + this.paddleH + 9,
        vx: 0, vy: 0, r: this.ballR,
        trail: [], stuck: true,
        backWallHits: 0, slamStacks: 0,
        blastCharge: 0, pierceLeft: 0, magnetSpeed: 0, magnetImmunity: 0, magnetOffsetX: 0, homingLeft: 0, homingCooldown: 0, ghostLeft: 0, ghostPhasedBricks: new Set(),
      }]
    } else {
      // Same chapter — carry over charge, multiball, pierce, blast, widen, safety
      // Just re-stick all balls and reset speed stacks
      for (const ball of this.balls) {
        ball.stuck = true
        ball.trail = []
        ball.backWallHits = 0
        ball.slamStacks = 0
      }
    }
    if (!this.tutorial) saveToStorage(this.getSaveState())
  }

  private activateUpgrade(pickup: Pickup) {
    const wasFreshSafety = this.safetyHits === 0
    const uState = this.getUpgradeState()
    const events = runActivateUpgrade(pickup, uState)
    this.applyUpgradeState(uState)
    for (const ev of events) {
      if (ev.type === 'measurePaddle') {
        this.paddleText = ev.paddleText
        this.measurePaddle()
      } else if (ev.type === 'measureSafety') {
        this.measureSafety()
        if (wasFreshSafety) {
          this.safetyX = this.W / 2 - this.safetyW / 2
        }
      } else if (ev.type === 'clampPaddle') {
        this.paddleX = Math.min(this.paddleX, this.W - this.paddleW)
        this.paddleTargetX = Math.min(this.paddleTargetX, this.W - this.paddleW)
      } else if (ev.type === 'applyBallSize') {
        this.applyBallSize()
      }
    }
  }

  private hitBrick(brick: Brick, ball: Ball) {
    const uState = this.getUpgradeState()
    // Tutorial: force upgrade drops during forceDrops phases
    const savedDropBonus = uState.dropBonus
    if (this.tutorial?.forceDrops) uState.dropBonus = 1.0
    // Tutorial: suppress drops when drops aren't enabled yet
    if (this.tutorial && !this.tutorial.dropsEnabled) uState.dropBonus = -1.0
    runHitBrick(brick, ball, uState)
    uState.dropBonus = savedDropBonus
    this.applyUpgradeState(uState)
  }

  private getUpgradeState(): UpgradeState {
    return {
      balls: this.balls,
      bricks: this.bricks,
      particles: this.particles,
      shrapnel: this.shrapnel,
      pickups: this.pickups,
      widenLevel: this.widenLevel,
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleTargetX: this.paddleTargetX,
      W: this.W,
      H: this.H,
      safetyHits: this.safetyHits,
      safetyW: this.safetyW,
      freezeTimer: this.freezeTimer,
      multiplier: this.multiplier,
      score: this.score,
      wordsBroken: this.wordsBroken,
      letterCounts: this.letterCounts,
      alphabetCompletions: this.alphabetCompletions,
      lives: this.lives,
      bricksScrollY: this.bricksScrollY,
      brickPadX: this.brickPadX,
      brickFontSize: this.brickFontSize,
      levelWords: this.levelWords,
      gold: this.gold,
      dropBonus: this.dropBonus,
      ballSizeBonus: this.ballSizeBonus,
      magnetCharges: this.magnetCharges,
      maxWiden: MAX_WIDEN,
      maxSafety: MAX_SAFETY,
    }
  }

  private applyUpgradeState(uState: UpgradeState) {
    this.widenLevel = uState.widenLevel
    this.safetyHits = uState.safetyHits
    this.freezeTimer = uState.freezeTimer
    this.multiplier = uState.multiplier
    this.score = uState.score
    this.wordsBroken = uState.wordsBroken
    this.alphabetCompletions = uState.alphabetCompletions
    this.lives = uState.lives
    this.gold = uState.gold
    this.dropBonus = uState.dropBonus
    this.ballSizeBonus = uState.ballSizeBonus
    this.magnetCharges = uState.magnetCharges
  }

  private updateSidebar() {
    flushWordLog()
    // Sync letter grid from counts (batched, not per-brick)
    for (let i = 0; i < 26; i++) {
      const ch = String.fromCharCode(65 + i)
      const el = document.getElementById(`letter-${ch}`)
      if (el) {
        if (this.letterCounts[ch] > 0) el.classList.add('collected')
        else el.classList.remove('collected')
      }
    }
    const scoreStr = this.score.toLocaleString()
    const livesStr = String(this.lives)
    const comboStr = `x${this.multiplier.toFixed(1)}`
    const wordsStr = String(this.wordsBroken)

    sidebarEls.score.textContent = scoreStr
    sidebarEls.gold.textContent = String(this.gold)
    sidebarEls.lives.textContent = livesStr
    sidebarEls.combo.textContent = comboStr
    sidebarEls.words.textContent = wordsStr
    const chapter = this.book.chapters[this.chapterIdx]
    const lastPara = Math.min(this.paragraphIdx + this.levelParagraphCount, chapter.paragraphs.length)
    sidebarEls.chapterLabel.textContent = `Ch ${this.chapterIdx + 1}  ·  P${this.paragraphIdx + 1}-${lastPara}/${chapter.paragraphs.length}`
    const bricksAlive = this.bricks.filter(b => b.alive).length
    const paraBreaks = this.wordsInParagraph.slice(0, this.wordCursor).filter(w => w === Game.PARA_BREAK).length
    const broken = (this.wordCursor - paraBreaks) - bricksAlive
    const pct = this.totalWordsInParagraph > 0 ? Math.round((broken / this.totalWordsInParagraph) * 100) : 0
    sidebarEls.progressBar.style.width = `${pct}%`
    sidebarEls.progressText.textContent = `${pct}%`

    // Mini stats strip (mobile) — abbreviate large numbers
    const ms = document.getElementById('mini-score')
    if (ms) {
      const abbrev = (n: number) => n >= 100000 ? (n / 1000).toFixed(0) + 'k' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n)
      ms.textContent = abbrev(this.score)
      document.getElementById('mini-lives')!.textContent = livesStr
      document.getElementById('mini-combo')!.textContent = comboStr
      document.getElementById('mini-words')!.textContent = abbrev(this.wordsBroken)
      document.getElementById('mini-gold')!.textContent = String(this.gold)
    }

  }

  // ── Render ──────────────────────────────────────────────────
  render() {
    const ctx = this.ctx
    const W = this.W
    const H = this.H

    // Background
    ctx.fillStyle = '#06080c'
    ctx.fillRect(0, 0, W, H)

    // Main game render pass — extracted to render-game module
    const renderState: RenderState = {
      dots: this.dots,
      bricks: this.bricks,
      brickFont: this.brickFont,
      bricksScrollY: this.bricksScrollY,
      pickups: this.pickups,
      particles: this.particles,
      shrapnel: this.shrapnel,
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleH: this.paddleH,
      paddleY: this.paddleY,
      paddleText: this.paddleText,
      safetyHits: this.safetyHits,
      safetyLabel: this.safetyLabel,
      safetyX: this.safetyX,
      safetyY: this.safetyY,
      safetyW: this.safetyW,
      safetyH: this.safetyH,
      balls: this.balls,
      freezeTimer: this.freezeTimer,
      charge: this.charge,
      started: this.started,
      hasLaunched: this.hasLaunched,
      hasRecalled: this.hasRecalled,
      isMobile: this.isMobile,
      levelState: this.levelState,
      gold: this.gold,
      ballSpeed: this.ballSpeed,
      magnetCharges: this.magnetCharges,
      backWallReveal: this.backWallReveal,
      tutorialPhase: this.tutorial ? this.tutorial.phase : -1,
    }
    renderGame(ctx, W, H, renderState)

    // End-of-chapter in-field UI
    if (this.levelState === 'grayCleanup') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#aaa'
      ctx.font = `bold 16px 'JetBrains Mono', monospace`
      ctx.fillText('CLEARING...', W / 2, H / 2)
    }

    if (this.levelState === 'endPopping' && this.endPopBricks.length > 0) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#f87171'
      ctx.font = `bold 16px 'JetBrains Mono', monospace`
      ctx.fillText(`${this.endPopIdx} / ${this.endPopBricks.length} remaining`, W / 2, H / 2)
    }

    if (this.levelState === 'endTally') {
      // Semi-transparent backdrop so text is readable
      ctx.fillStyle = 'rgba(6, 8, 12, 0.75)'
      ctx.fillRect(0, H * 0.2, W, H * 0.6)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Chapter title
      ctx.fillStyle = '#e8c44a'
      ctx.font = `bold 22px 'JetBrains Mono', monospace`
      const chapter = this.book.chapters[this.chapterIdx]
      const isChapterDone = this.paragraphIdx + this.levelParagraphCount >= chapter.paragraphs.length
      ctx.fillText(isChapterDone ? 'CHAPTER COMPLETE' : 'LEVEL COMPLETE', W / 2, H * 0.28)

      // Scrolling word tally — show last few words rapidly
      ctx.font = `13px 'JetBrains Mono', monospace`
      const showCount = 6
      const startIdx = Math.max(0, this.endTallyIdx - showCount)
      for (let i = startIdx; i < this.endTallyIdx && i < this.levelWords.length; i++) {
        const w = this.levelWords[i]
        const row = i - startIdx
        const y = H * 0.34 + row * 18
        const isNewest = i === this.endTallyIdx - 1
        ctx.globalAlpha = isNewest ? 1.0 : 0.3
        ctx.fillStyle = w.color
        ctx.textAlign = 'right'
        ctx.fillText(w.word, W / 2 - 15, y)
        ctx.fillStyle = '#e8c44a'
        ctx.textAlign = 'left'
        ctx.fillText(`+${w.points}`, W / 2 + 15, y)
      }
      ctx.globalAlpha = 1
      ctx.textAlign = 'center'

      // Running score
      ctx.fillStyle = '#e8c44a'
      ctx.shadowColor = '#e8c44a'
      ctx.shadowBlur = 10
      ctx.font = `bold 28px 'JetBrains Mono', monospace`
      ctx.fillText(this.endTallyScore.toLocaleString(), W / 2, H * 0.56)
      ctx.shadowBlur = 0

      // Penalty deduction (shown after tally finishes)
      if (this.endPenaltyShown && this.endPenaltyTotal > 0) {
        ctx.fillStyle = '#f87171'
        ctx.shadowColor = '#f87171'
        ctx.shadowBlur = 8
        ctx.font = `bold 20px 'JetBrains Mono', monospace`
        const missed = this.endTotalWords - this.endBrokenWords
        ctx.fillText(`-${this.endPenaltyTotal.toLocaleString()}  (${missed} missed)`, W / 2, H * 0.64)
        ctx.shadowBlur = 0
      }

      // Word count
      ctx.fillStyle = '#5a6578'
      ctx.font = `12px 'JetBrains Mono', monospace`
      ctx.fillText(`${this.endBrokenWords} / ${this.endTotalWords} words broken`, W / 2, H * 0.72)
    }

    if (this.levelState === 'endGrade') {
      ctx.fillStyle = 'rgba(6, 8, 12, 0.75)'
      ctx.fillRect(0, H * 0.2, W, H * 0.6)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const isDead = this.lives <= 0

      // Final score
      ctx.fillStyle = '#e8c44a'
      ctx.font = `bold 22px 'JetBrains Mono', monospace`
      ctx.fillText(`SCORE: ${this.score.toLocaleString()}`, W / 2, H * 0.32)

      if (isDead) {
        // No letter grade — just show word count and continue prompt
        ctx.fillStyle = '#5a6578'
        ctx.font = `14px 'JetBrains Mono', monospace`
        ctx.fillText(`${this.endBrokenWords} / ${this.endTotalWords} words broken`, W / 2, H * 0.42)
      } else {
        // Letter grade
        const gradeColors: Record<string, string> = {
          S: '#fbbf24', A: '#4ade80', B: '#7dd3fc', C: '#c084fc', D: '#f97316', F: '#f87171',
        }
        const gradeColor = gradeColors[this.endGrade] ?? '#c8d0dc'
        ctx.fillStyle = gradeColor
        ctx.font = `bold 72px 'JetBrains Mono', monospace`
        ctx.fillText(this.endGrade, W / 2, H * 0.46)

        // "TIER" label — smaller, same color, right underneath
        ctx.fillStyle = gradeColor
        ctx.font = `bold 18px 'JetBrains Mono', monospace`
        ctx.fillText('TIER', W / 2, H * 0.46 + 42)

        ctx.fillStyle = '#5a6578'
        ctx.font = `14px 'JetBrains Mono', monospace`
        ctx.fillText(`${this.endBrokenWords} / ${this.endTotalWords} words`, W / 2, H * 0.58)
      }

      // Prompt
      if (this.endTimer > 1.0) {
        const isFail = isDead || this.endGrade === 'D' || this.endGrade === 'F'
        const isShopNext = !isFail  // shop after every level now
        const action = this.isMobile ? 'TAP' : 'CLICK or SPACE'
        let prompt: string
        if (isDead) prompt = `[ ${action} to continue ]`
        else if (isFail) prompt = `[ ${action} to restart ]`
        else if (isShopNext) prompt = `[ ${action} to enter the shop ]`
        else prompt = `[ ${action} to continue ]`
        ctx.fillStyle = isFail ? '#f87171' : '#7dd3fc'
        ctx.font = `bold 14px 'JetBrains Mono', monospace`
        ctx.fillText(prompt, W / 2, H * 0.68)
      }
    }

    // Shop overlay
    if (this.levelState === 'shop' && this.shopRects.length > 0) {
      renderShop(ctx, W, H, {
        shopItems: this.shopItems,
        shopRects: this.shopRects,
        shopContinueRect: this.shopContinueRect,
        gold: this.gold,
        particles: this.particles,
        isMobile: this.isMobile,
        W: this.W,
      })
    }

    // Game over / tutorial complete overlay
    if (this.gameOver) {
      if (this.tutorial) {
        renderTutorialComplete(ctx, W, H, {
          score: this.score,
          wordsBroken: this.wordsBroken,
          isNewHigh: this.isNewHigh,
          endScores: this.endScores,
          isMobile: this.isMobile,
        })
      } else {
        renderGameOver(ctx, W, H, {
          book: this.book,
          chapterIdx: this.chapterIdx,
          score: this.score,
          wordsBroken: this.wordsBroken,
          isNewHigh: this.isNewHigh,
          endScores: this.endScores,
        })
      }
    }

    // Pause overlay
    if (this.paused) {
      renderPause(ctx, W, H, this.isMobile)
    }

  }

  // ── Save / Restore ───────────────────────────────────────────
  getSaveState(): SaveState {
    return {
      bookIdx: this._bookIdx,
      chapterIdx: this.chapterIdx,
      paragraphIdx: this.paragraphIdx,
      levelParagraphCount: this.levelParagraphCount,
      levelState: this.levelState,
      score: this.score,
      lives: this.lives,
      gold: this.gold,
      paragraphsCompleted: this.paragraphsCompleted,
      wordsBroken: this.wordsBroken,
      letterCounts: { ...this.letterCounts },
      alphabetCompletions: this.alphabetCompletions,
      nextLifeScore: this.nextLifeScore,
      multiplier: this.multiplier,
      charge: this.charge,
      dropBonus: this.dropBonus,
      widenLevel: this.widenLevel,
      safetyHits: this.safetyHits,
      ballSizeBonus: this.ballSizeBonus,
      magnetCharges: this.magnetCharges,
      // Mid-level snapshot
      bricks: this.bricks.filter(b => b.alive).map(snapBrick),
      balls: this.balls.map(snapBall),
      pickups: this.pickups.map(snapPickup),
      bricksScrollY: this.bricksScrollY,
      wordCursor: this.wordCursor,
      totalWordsInParagraph: this.totalWordsInParagraph,
      levelBasePoints: this.levelBasePoints,
      started: this.started,
      hasLaunched: this.hasLaunched,
      hasRecalled: this.hasRecalled,
      backWallActive: this.backWallActive,
      backWallReveal: this.backWallReveal,
      freezeTimer: this.freezeTimer,
      bricksDriftSpeed: this.bricksDriftSpeed,
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleText: this.paddleText,
      safetyX: this.safetyX,
      safetyDir: this.safetyDir,
      levelWords: this.levelWords,
      levelLivesLost: this.levelLivesLost,
      brickHitThisLevel: this.brickHitThisLevel,
    }
  }

  restoreFromSave(save: SaveState) {
    // Book/level position
    this.chapterIdx = save.chapterIdx
    this.paragraphIdx = save.paragraphIdx
    this.levelParagraphCount = save.levelParagraphCount ?? 1

    // Scoring / progression
    this.score = save.score
    this.lives = save.lives
    this.gold = save.gold
    this.paragraphsCompleted = save.paragraphsCompleted
    this.wordsBroken = save.wordsBroken
    this.letterCounts = save.letterCounts
    this.alphabetCompletions = save.alphabetCompletions
    this.nextLifeScore = save.nextLifeScore
    this.multiplier = save.multiplier ?? 1.0
    this.charge = save.charge ?? 0

    // Upgrades
    this.dropBonus = save.dropBonus
    this.widenLevel = save.widenLevel
    this.safetyHits = save.safetyHits
    this.ballSizeBonus = save.ballSizeBonus ?? 0
    this.magnetCharges = save.magnetCharges ?? 0

    // Paddle
    this.paddleText = save.paddleText ?? 'BOOK BREAKER'
    this.measurePaddle()
    this.paddleX = save.paddleX ?? this.W / 2 - this.paddleW / 2
    this.paddleTargetX = this.paddleX

    // Safety bar
    if (this.safetyHits > 0) this.measureSafety()
    this.safetyX = save.safetyX ?? this.W / 2 - this.safetyW / 2
    this.safetyDir = save.safetyDir ?? 1

    // Mid-level snapshot — if present, restore exact state; otherwise fall back to level reload
    if (save.bricks && save.bricks.length > 0) {
      // Rebuild word list (needed for wordCursor tracking, not for bricks)
      const chapter = this.book.chapters[this.chapterIdx]
      const words: string[] = []
      const count = Math.min(this.levelParagraphCount, chapter.paragraphs.length - this.paragraphIdx)
      for (let i = 0; i < count; i++) {
        if (i > 0) words.push(Game.PARA_BREAK)
        const text = chapter.paragraphs[this.paragraphIdx + i]
        for (const token of text.split(/\s+/).filter((w: string) => w.length > 0)) {
          const m = token.match(/^([^a-zA-Z0-9''\u2019]*)(.+?)([^a-zA-Z0-9''\u2019]*)$/)
          if (m) { if (m[1]) words.push(m[1]); words.push(m[2]); if (m[3]) words.push(m[3]) }
          else words.push(token)
        }
      }
      this.wordsInParagraph = words
      this.wordCursor = save.wordCursor ?? words.length
      this.totalWordsInParagraph = save.totalWordsInParagraph ?? words.filter(w => w !== Game.PARA_BREAK).length
      this.levelBasePoints = save.levelBasePoints ?? 0

      // Restore bricks, balls, pickups from snapshot
      this.bricks = save.bricks.map(unsnapBrick)
      this.balls = save.balls ? save.balls.map(unsnapBall) : []
      this.pickups = save.pickups ? save.pickups.map(unsnapPickup) : []
      if (this.balls.length === 0) { this.balls = []; this.spawnBall() }

      this.bricksScrollY = save.bricksScrollY ?? 0
      this.started = save.started ?? false
      this.hasLaunched = save.hasLaunched ?? false
      this.hasRecalled = save.hasRecalled ?? false
      this.backWallActive = save.backWallActive ?? false
      this.backWallReveal = save.backWallReveal ?? 0
      this.freezeTimer = save.freezeTimer ?? 0
      this.bricksDriftSpeed = save.bricksDriftSpeed ?? this.baseDriftSpeed
      this.levelWords = save.levelWords ?? []
      this.levelLivesLost = save.levelLivesLost ?? 0
      this.brickHitThisLevel = save.brickHitThisLevel ?? false
      this.islandGroups.clear()

      // Reset paddle slam state — stale mid-slam state breaks slam detection
      this.paddleY = this.paddleBaseY
      this.paddleTargetY = this.paddleBaseY
      this.prevPaddleY = this.paddleBaseY
      this.paddleVy = 0
      this.paddleVyInternal = 0
      this.slamActive = false
      this.mouseDown = false
      this.slamWallTimer = 0
      this.slamCooldown = 0

      if (save.levelState === 'shop') {
        this.openShop()
      } else {
        this.levelState = save.levelState ?? 'playing'
      }
    } else {
      // Legacy save without snapshot — reload level from scratch
      this.loadParagraph(this.chapterIdx, this.paragraphIdx)
      this.balls = []
      this.spawnBall()
      if (save.levelState === 'shop') {
        this.openShop()
      } else {
        this.levelState = 'playing'
      }
    }

    this.updateSidebar()
    // Always start paused after restore so the player can orient themselves
    this.paused = true
  }

  static loadFromStorage = loadFromStorage
  static clearSave = clearSave

}
