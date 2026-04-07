import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { BOOKS, type Book } from './content'
import type { WordTag } from './tagger'
import type { Brick, Ball, Particle, Pickup, Dot, Shrapnel, ShopItem, ShopRarity } from './types'
import { scoreWord, getHighScores, saveHighScore } from './scoring'
export { getTopScore } from './scoring'
import { TAG_COLORS, wordColor, setActiveTagMap, colorTier } from './colors'
import { sidebarEls, initLetterGrid, clearWordLog, flushWordLog } from './sidebar'
import { renderGameOver, renderPause, roundRect } from './renderer'
import { updateBalls, type PhysicsState } from './physics'
import { activateUpgrade as runActivateUpgrade, hitBrick as runHitBrick, type UpgradeState } from './upgrades'
import { renderGame, type RenderState } from './render-game'

// ── Shop rarity system ─────────────────────────────────────────
const RARITY_COLORS: Record<ShopRarity, string> = {
  common: '#6b7280',     // gray
  uncommon: '#4ade80',   // green
  rare: '#7dd3fc',       // cyan
  epic: '#c084fc',       // purple
}
const RARITY_LABELS: Record<ShopRarity, string> = {
  common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC',
}
// Roll rarity with weighted odds: common 45%, uncommon 30%, rare 18%, epic 7%
function rollRarity(): ShopRarity {
  const r = Math.random()
  if (r < 0.45) return 'common'
  if (r < 0.75) return 'uncommon'
  if (r < 0.93) return 'rare'
  return 'epic'
}
// Price multiplier per rarity
const RARITY_PRICE: Record<ShopRarity, number> = {
  common: 0.8, uncommon: 1.0, rare: 1.3, epic: 1.7,
}

// ── Shop item pool ─────────────────────────────────────────────
// base price is scaled by rarity multiplier on generation
interface ShopPoolEntry {
  id: string; name: string; desc: string; basePrice: number
  isLife?: boolean // guaranteed slot
}
const SHOP_POOL: ShopPoolEntry[] = [
  { id: 'life1', name: '+1 LIFE', desc: 'Extra life', basePrice: 75, isLife: true },
  { id: 'life3', name: '+3 LIVES', desc: 'Three extra lives', basePrice: 180, isLife: true },
  { id: 'widen1', name: 'WIDEN', desc: 'Expand paddle', basePrice: 60 },
  { id: 'widen2', name: 'WIDEN x2', desc: 'Double expand', basePrice: 110 },
  { id: 'multi', name: 'MULTIBALL', desc: 'Start with 3 balls', basePrice: 70 },
  { id: 'safety2', name: 'SAFETY +2', desc: 'Safety bar +2 hits', basePrice: 60 },
  { id: 'safety4', name: 'SAFETY +4', desc: 'Safety bar +4 hits', basePrice: 110 },
  { id: 'blast', name: 'BLAST', desc: 'Explosive ball charge', basePrice: 80 },
  { id: 'pierce', name: 'PIERCE +3', desc: 'Punch through bricks', basePrice: 70 },
  { id: 'lucky', name: 'LUCKY DROPS', desc: 'Upgrade drop chance +2%', basePrice: 65 },
]

// ── Upgrade caps ──────────────────────────────────────────────
export const MAX_WIDEN = 8
export const MAX_SAFETY = 8

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

  // charge mechanic
  private charge = 0              // 0-1, fills as bricks break, click to recall ball

  // shop bonuses (persist across levels, reset on restart)
  private dropBonus = 0           // flat % added to upgrade drop chance (Lucky Drops)

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
  private recallBtn: HTMLElement | null = null

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
  private islandGroups = new Map<number, {
    cx0: number; cy0: number      // initial centroid
    vx: number; vy: number        // shared velocity
    rotSpeed: number              // rotation speed (rad/s)
    angle: number                 // accumulated angle
    timer: number                 // countdown to pop
    initTimer: number             // initial timer value (for elapsed calc)
  }>()
  private nextIslandId = 1

  constructor(canvas: HTMLCanvasElement, bookIdx: number, tagMap: Map<string, WordTag>) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.book = this.mergeShortParagraphs(BOOKS[bookIdx])
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
        this.restart()
      } else if (this.paused) {
        this.paused = false
      } else if (this.levelState === 'shop') {
        const rect = this.canvas.getBoundingClientRect()
        const vx = (e.clientX - rect.left) / rect.width * this.W
        const vy = (e.clientY - rect.top) / rect.height * this.H
        this.handleShopClick(vx, vy)
      } else if (this.levelState === 'endGrade' && this.endTimer > 1.0) {
        if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          Game.clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          if (this.paragraphsCompleted % 3 === 0) {
            this.openShop()
          } else {
            this.levelState = 'playing'
            this.levelWords = []
            this.advanceLevel()
          }
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

    // ── Touch controls (mobile) — multi-touch ───────────────────
    this.recallBtn = document.getElementById('recall-btn')

    // Recall button (works on both mobile and desktop)
    if (this.recallBtn) {
      const doRecall = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.charge >= 1.0 && this.balls.some(b => !b.stuck)) {
          this.recallBall()
        }
      }
      this.recallBtn.addEventListener('touchstart', doRecall)
      this.recallBtn.addEventListener('click', doRecall)
    }

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()

      // State transitions — any touch
      if (this.gameOver) { this.restart(); return }
      if (this.paused) { this.paused = false; return }
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
        if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          Game.clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          if (this.paragraphsCompleted % 3 === 0) {
            this.openShop()
          } else {
            this.levelState = 'playing'
            this.levelWords = []
            this.advanceLevel()
          }
        }
        return
      }

      // Multi-touch: first finger moves paddle, second finger slams
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const rect = this.canvas.getBoundingClientRect()
        const vx = (touch.clientX - rect.left) / rect.width * this.W

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

    // Pause on focus loss
    window.addEventListener('blur', () => {
      if (this.started && !this.gameOver) this.paused = true
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.started && !this.gameOver) this.paused = true
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
    this.baseDriftSpeed = 6.4 * (this.H / VIRTUAL_H)
    if (this.freezeTimer <= 0) this.bricksDriftSpeed = this.baseDriftSpeed

    // Heavy reinitialization only when not actively playing
    // (avoids GC pressure from iOS Safari URL bar resize events)
    if (!this.started || this.gameOver) {
      this.paddleBaseY = 50
      this.paddleY = this.paddleBaseY
      this.paddleTargetY = this.paddleBaseY
      this.prevPaddleY = this.paddleBaseY
      this.measurePaddle()
      this.brickFontSize = 15
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
  private loadParagraph(chapterIdx: number, paragraphIdx: number) {
    this.chapterIdx = chapterIdx % this.book.chapters.length
    const chapter = this.book.chapters[this.chapterIdx]
    this.paragraphIdx = paragraphIdx % chapter.paragraphs.length
    const text = chapter.paragraphs[this.paragraphIdx]
    this.wordsInParagraph = text.split(/\s+/).filter(w => w.length > 0)
    this.totalWordsInParagraph = this.wordsInParagraph.length
    this.wordCursor = 0
    this.bricks = []
    this.bricksScrollY = 0
    this.brickHitThisLevel = false
    this.islandGroups.clear()
    this.nextIslandId = 1
    this.spawnBrickRows(8, this.H * 0.85)
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
      let curX = margin
      let rowH = this.brickLineH + this.brickPadY * 2
      const rowBricks: Brick[] = []

      while (curX < areaW + margin && this.wordCursor < this.wordsInParagraph.length) {
        const word = this.wordsInParagraph[this.wordCursor]
        // Use pretext to measure word width
        const prepared = prepareWithSegments(word, this.brickFont)
        const result = layoutWithLines(prepared, 9999, this.brickLineH)
        const textW = result.lines.length > 0 ? result.lines[0].width : word.length * this.brickFontSize * 0.6
        const bw = textW + this.brickPadX * 2

        if (curX + bw > areaW + margin && rowBricks.length > 0) break

        const color = wordColor(word)
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
          points: scoreWord(word, isStop),
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
        curX += bw + gapX
        this.wordCursor++
      }

      // ── Justify row: distribute extra space so bricks fill edge-to-edge ──
      // Skip justification for the last row of the paragraph (ragged is fine)
      const isLastRow = this.wordCursor >= this.wordsInParagraph.length
      if (rowBricks.length > 1 && !isLastRow) {
        const usedW = rowBricks.reduce((sum, b) => sum + b.w, 0)
        const totalGapSpace = areaW - usedW
        const gapCount = rowBricks.length - 1
        const justifiedGap = totalGapSpace / gapCount

        let jx = margin
        for (const b of rowBricks) {
          b.x = jx
          jx += b.w + justifiedGap
        }
      }

      curY += rowH + gapY
    }
  }

  // ── Ball ────────────────────────────────────────────────────
  private spawnBall() {
    this.balls.push({
      x: this.paddleX + this.paddleW / 2,
      y: this.paddleY + this.paddleH + 10,
      vx: 0,
      vy: 0,
      r: 7,
      trail: [],
      stuck: true,
      backWallHits: 0,
      slamStacks: 0,
      blastCharge: 0,
      pierceLeft: 0,
    })
  }

  private launchBalls() {
    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.stuck = false
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6
        ball.vx = Math.cos(angle) * this.ballSpeed
        ball.vy = Math.sin(angle) * this.ballSpeed
        this.started = true
        this.hasLaunched = true
      }
    }
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
        this.restart()
      }
      return
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
        this.startEndSequence()
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
        if (pct >= 1.0 && this.levelLivesLost === 0) this.endGrade = 'S'
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
        if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          Game.clearSave()
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.paragraphsCompleted++
          if (this.paragraphsCompleted % 3 === 0) {
            this.openShop()
          } else {
            this.levelState = 'playing'
            this.levelWords = []
            this.advanceLevel()
          }
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

      // Island detection — check every 0.5s for disconnected brick groups
      // Only after a ball has broken at least one brick (prevents false breakoffs from layout gaps)
      this.islandCheckTimer -= dt
      if (this.islandCheckTimer <= 0 && this.levelState === 'playing' && this.brickHitThisLevel) {
        this.detectIslands()
        this.islandCheckTimer = 0.5
      }

      // Break-off groups — move as unified icebergs, then pop together
      for (const [groupId, grp] of this.islandGroups) {
        grp.timer -= dt

        // Compute elapsed translation
        const bricksInGroup = this.bricks.filter(b => b.alive && b.breakOffGroupId === groupId)
        if (bricksInGroup.length === 0) { this.islandGroups.delete(groupId); continue }

        // Move each brick: translate + rotate as rigid body around group centroid
        const elapsed = grp.initTimer - grp.timer
        grp.angle += grp.rotSpeed * dt
        const cx = grp.cx0 + grp.vx * elapsed
        const cy = grp.cy0 + grp.vy * elapsed
        const cosA = Math.cos(grp.angle)
        const sinA = Math.sin(grp.angle)
        for (const b of bricksInGroup) {
          // Offset from original centroid to brick center
          const dx = (b.breakOffOrigX + b.w / 2) - grp.cx0
          const dy = (b.breakOffOrigY + b.h / 2) - grp.cy0
          // Rotate offset, then translate to new centroid
          b.x = cx + dx * cosA - dy * sinA - b.w / 2
          b.y = cy + dx * sinA + dy * cosA - b.h / 2
          b.breakOff = grp.timer
          b.breakOffAngle = grp.angle
        }

        if (grp.timer <= 0) {
          // Pop all bricks in this group simultaneously
          const groupSize = bricksInGroup.length
          let totalBonus = 0
          for (const b of bricksInGroup) {
            b.alive = false
            const bonus = Math.round(b.points * groupSize)
            totalBonus += bonus
            this.score += bonus
            this.wordsBroken++
            this.multiplier = Math.min(10.0, this.multiplier + 0.3)
            this.levelWords.push({ word: b.word, color: b.color, points: bonus })

            // Fill charge bar for each brick in the group
            if (this.charge < 1.0) {
              this.charge = Math.min(1.0, this.charge + 0.067)
            }

            // Collect letters
            for (const ch of b.word.toUpperCase()) {
              if (ch >= 'A' && ch <= 'Z') {
                this.letterCounts[ch] = (this.letterCounts[ch] || 0) + 1
              }
            }

            // Rainbow particles — keep each brick's original color
            {
              const bsy = b.y - this.bricksScrollY
              for (let i = 0; i < b.word.length; i++) {
                this.particles.push({
                  x: b.x + (i / b.word.length) * b.w + 8,
                  y: bsy + b.h / 2,
                  vx: (Math.random() - 0.5) * 300,
                  vy: (Math.random() - 0.5) * 300,
                  char: b.word[i], life: 1.0, maxLife: 1.2,
                  color: b.color, size: 16,
                })
              }
              // Gold coin for break-off bonus (stopwords give nothing)
              const bTier = colorTier(b.color)
              const goldAmt = bTier <= 0 ? 0 : bTier === 1 ? 1 : bTier === 2 ? 2 : bTier === 3 ? 3 : 5
              if (goldAmt > 0) {
                this.gold += goldAmt
                this.particles.push({
                  x: b.x + b.w / 2, y: bsy + b.h / 2,
                  vx: (Math.random() - 0.5) * 40,
                  vy: -80 - Math.random() * 30,
                  char: `+${goldAmt} ◆`, life: 0.8, maxLife: 0.8,
                  color: '#fbbf24', size: 16,
                })
              }
            }
          }
          // Popup label: "BREAK-OFF" for 1, "BREAK-OFF x3" etc. for multiples
          const label = groupSize > 1
            ? `BREAK-OFF x${groupSize} +${totalBonus}`
            : `BREAK-OFF +${totalBonus}`
          const fullElapsed = grp.initTimer
          const popCy = grp.cy0 + grp.vy * fullElapsed - this.bricksScrollY
          this.particles.push({
            x: grp.cx0 + grp.vx * fullElapsed, y: popCy,
            vx: 0, vy: -50,
            char: label,
            life: 1.5, maxLife: 1.5,
            color: '#fff', size: 14,
          })
          this.islandGroups.delete(groupId)
        }
      }

      // Level clear: all words placed and all bricks broken
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInParagraph.length && !this.bricks.some(b => b.alive)) {
        this.startEndSequence()
      }

      // Gray cleanup: all colored bricks broken, only grays remain — auto-pop them
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInParagraph.length) {
        const allAlive = this.bricks.filter(b => b.alive)
        if (allAlive.length > 0 && allAlive.every(b => b.color === TAG_COLORS.stopword)) {
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
      if (this.levelState === 'playing') {
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
      ballSpeed: this.ballSpeed,
      bricksScrollY: this.bricksScrollY,
    }
    const physicsEvents = updateBalls(this.balls, this.bricks, dt, physicsState)
    for (const ev of physicsEvents) {
      if (ev.type === 'brickHit') {
        this.brickHitThisLevel = true
        this.hitBrick(ev.brick, ev.ball)
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
      } else if (ev.type === 'safetyHit') {
        this.safetyHits--
        this.measureSafety()
      } else if (ev.type === 'ballLost') {
        // Remove the lost ball
        if (ev.index >= 0) this.balls.splice(ev.index, 1)
        // If no active balls remain, lose a life and respawn one
        const activeBalls = this.balls.filter(b => !b.stuck)
        if (activeBalls.length === 0) {
          this.multiplier = 1.0
          this.lives--
          this.levelLivesLost++
          if (this.lives <= 0) {
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
            // Respawn a single ball stuck to paddle (no upgrades)
            this.balls = [{
              x: this.paddleX + this.paddleW / 2,
              y: this.paddleY + this.paddleH + 9,
              vx: 0, vy: 0, r: 7,
              trail: [], stuck: true,
              backWallHits: 0, slamStacks: 0,
              blastCharge: 0, pierceLeft: 0,
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

    // Shrapnel — blast projectiles that fly until hitting a brick or leaving screen
    for (let i = this.shrapnel.length - 1; i >= 0; i--) {
      const s = this.shrapnel[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 350 * dt  // heavy gravity — arcs down into bricks below
      // Only die when off-screen (all 4 edges)
      if (s.x < -20 || s.x > this.W + 20 || s.y < -20 || s.y > this.H + 20) {
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
            blastCharge: 0, pierceLeft: 0,
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

  private detectIslands() {
    const alive = this.bricks.filter(b => b.alive && b.breakOff === 0)
    if (alive.length === 0) return

    // Adjacency: two bricks are neighbors if close in Y (within row gap) and overlapping in X
    const rowGap = 45  // must exceed rowH + gapY (29 + 6 = 35) with margin for float rounding
    const xTolerance = 4

    // Union-find
    const parent = new Map<Brick, Brick>()
    const find = (b: Brick): Brick => {
      let r = b
      while (parent.get(r) !== r) r = parent.get(r)!
      let c = b
      while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n }
      return r
    }
    const union = (a: Brick, b: Brick) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }

    for (const b of alive) parent.set(b, b)

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j]
        const dy = Math.abs(a.y - b.y)
        if (dy > rowGap) continue
        // X overlap check
        if (a.x + a.w + xTolerance >= b.x && b.x + b.w + xTolerance >= a.x) {
          union(a, b)
        }
      }
    }

    // Group by root
    const groups = new Map<Brick, Brick[]>()
    for (const b of alive) {
      const root = find(b)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(b)
    }

    // If there's only 1 group, it's only an island if bricks have been broken
    // (i.e. it's a remnant, not the full intact paragraph)
    const totalPlaced = this.bricks.length
    const totalAliveIncBreakOff = this.bricks.filter(b => b.alive).length
    if (groups.size <= 1 && totalAliveIncBreakOff === totalPlaced) return  // full intact paragraph

    // Find the largest group (main body) — but only treat it as "main" if it's
    // strictly larger than the others. If all groups are the same size, they all break off.
    let mainGroup: Brick[] | null = null
    let maxLen = 0
    let secondMaxLen = 0
    for (const g of groups.values()) {
      if (g.length > maxLen) {
        secondMaxLen = maxLen
        maxLen = g.length
        mainGroup = g
      } else if (g.length > secondMaxLen) {
        secondMaxLen = g.length
      }
    }
    // If the "largest" is the same size as the runner-up, there's no main body — all break off
    if (maxLen === secondMaxLen) mainGroup = null

    // All other groups are islands — flag them for break-off as unified icebergs
    // Cap at 4 bricks: larger chunks just keep floating, no free break-off bonus
    const mainSet = mainGroup ? new Set(mainGroup) : new Set<Brick>()
    for (const g of groups.values()) {
      if (g === mainGroup) continue
      if (g.length > 3) continue  // too big — stays as normal bricks

      // Compute group centroid
      let cx = 0, cy = 0
      for (const b of g) { cx += b.x + b.w / 2; cy += b.y + b.h / 2 }
      cx /= g.length; cy /= g.length

      // Shared group properties — drift upward a touch faster than normal scroll,
      // gentle rotation matched to drift speed so it looks natural
      const groupId = this.nextIslandId++
      const timer = 1.2 + Math.random() * 0.4  // 1.2–1.6s until pop (longer for drama)
      const vx = (Math.random() - 0.5) * 10     // very slight lateral drift
      const vy = -(this.bricksDriftSpeed * 0.4 + Math.random() * 4)  // just a bit faster than normal scroll
      const rotSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.12)  // subtle rotation ~0.08–0.2 rad/s

      this.islandGroups.set(groupId, {
        cx0: cx, cy0: cy, vx, vy, rotSpeed, angle: 0, timer, initTimer: timer,
      })

      for (const b of g) {
        if (mainSet.has(b)) continue
        b.breakOff = timer
        b.breakOffVx = 0  // unused now, group handles movement
        b.breakOffAngle = 0
        b.breakOffGroupId = groupId
        b.breakOffOrigX = b.x
        b.breakOffOrigY = b.y
      }
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
    // Broken = words placed as bricks minus those still alive
    this.endBrokenWords = this.wordCursor - this.endPopBricks.length
    // Always start with endPopping phase (gives time to see final explosions)
    this.levelState = 'endPopping'
    for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
  }

  private spawnMoreBricks() {
    if (this.wordCursor >= this.wordsInParagraph.length) {
      // Chapter exhausted — wait for all bricks to be cleared
      return
    }
    this.spawnBrickRows(4)
  }

  private restart() {
    Game.clearSave()
    this.gameOver = false
    this.started = false
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
    this.shopItems = this.generateShopItems()

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
    Game.saveToStorage(this)
  }

  private isShopItemMaxed(id: string): boolean {
    if (id === 'widen1' || id === 'widen2') return this.widenLevel >= MAX_WIDEN
    if (id === 'safety2' || id === 'safety4') return this.safetyHits >= MAX_SAFETY
    return false
  }

  private generateShopItems(): ShopItem[] {
    const lifeOpts = SHOP_POOL.filter(s => s.isLife)
    const others = SHOP_POOL.filter(s => !s.isLife && !this.isShopItemMaxed(s.id))
    const picked: ShopItem[] = []

    const toShopItem = (entry: ShopPoolEntry, maxed = false): ShopItem => {
      const rarity = rollRarity()
      return {
        id: entry.id,
        name: entry.name,
        desc: entry.desc,
        price: Math.round(entry.basePrice * RARITY_PRICE[rarity]),
        rarity,
        bought: maxed,
        maxed,
      }
    }

    // 1 guaranteed life option
    picked.push(toShopItem(lifeOpts[Math.floor(Math.random() * lifeOpts.length)]))
    // 5 from the rest (shuffled, excluding maxed items)
    const shuffled = others.slice().sort(() => Math.random() - 0.5)
    for (let i = 0; i < 5 && i < shuffled.length; i++) {
      picked.push(toShopItem(shuffled[i]))
    }
    return picked.sort(() => Math.random() - 0.5)
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
    // Snapshot what was purchased before advanceLevel resets anything
    const boughtItems = this.shopItems.filter(it => it.bought).map(it => it.id)
    this.levelState = 'playing'
    this.levelWords = []
    this.advanceLevel()
    // Reapply upgrade purchases that advanceLevel may have wiped (chapter reset)
    for (const id of boughtItems) {
      if (id === 'widen1') {
        this.widenLevel = Math.max(this.widenLevel, 1)
        const equals = '═'.repeat(this.widenLevel)
        this.paddleText = `${equals} BOOK BREAKER ${equals}`
        this.measurePaddle()
      } else if (id === 'widen2') {
        this.widenLevel = Math.max(this.widenLevel, 2)
        const equals = '═'.repeat(this.widenLevel)
        this.paddleText = `${equals} BOOK BREAKER ${equals}`
        this.measurePaddle()
      } else if (id === 'multi' && this.balls.length < 3) {
        while (this.balls.length < 3) {
          this.balls.push({
            x: this.paddleX + this.paddleW / 2 + (this.balls.length % 2 === 0 ? -12 : 12),
            y: this.paddleY + this.paddleH + 9,
            vx: 0, vy: 0, r: 7,
            trail: [], stuck: true,
            backWallHits: 0, slamStacks: 0,
            blastCharge: 0, pierceLeft: 0,
          })
        }
      } else if (id === 'safety2') {
        if (this.safetyHits < 2) {
          const wasFresh = this.safetyHits === 0
          this.safetyHits = Math.max(this.safetyHits, 2)
          this.measureSafety()
          if (wasFresh) this.safetyX = this.W / 2 - this.safetyW / 2
        }
      } else if (id === 'safety4') {
        if (this.safetyHits < 4) {
          const wasFresh = this.safetyHits === 0
          this.safetyHits = Math.max(this.safetyHits, 4)
          this.measureSafety()
          if (wasFresh) this.safetyX = this.W / 2 - this.safetyW / 2
        }
      } else if (id === 'blast') {
        for (const ball of this.balls) ball.blastCharge = Math.max(ball.blastCharge, 2)
      } else if (id === 'pierce') {
        for (const ball of this.balls) ball.pierceLeft = Math.max(ball.pierceLeft, 3)
      }
      // life1, life3, score: already applied and survive advanceLevel
    }
  }

  private buyShopItem(idx: number) {
    const item = this.shopItems[idx]
    if (!item || item.bought || item.maxed || this.gold < item.price) return

    item.bought = true
    this.gold -= item.price

    if (item.id === 'life1') {
      this.lives += 1
    } else if (item.id === 'life3') {
      this.lives += 3
    } else if (item.id === 'widen1') {
      this.widenLevel = Math.min(MAX_WIDEN, this.widenLevel + 1)
      const equals = '═'.repeat(this.widenLevel)
      this.paddleText = `${equals} BOOK BREAKER ${equals}`
      this.measurePaddle()
    } else if (item.id === 'widen2') {
      this.widenLevel = Math.min(MAX_WIDEN, this.widenLevel + 2)
      const equals = '═'.repeat(this.widenLevel)
      this.paddleText = `${equals} BOOK BREAKER ${equals}`
      this.measurePaddle()
    } else if (item.id === 'multi') {
      for (let i = 0; i < 2; i++) {
        this.balls.push({
          x: this.paddleX + this.paddleW / 2 + (i === 0 ? -12 : 12),
          y: this.paddleY + this.paddleH + 9,
          vx: 0, vy: 0, r: 7,
          trail: [], stuck: true,
          backWallHits: 0, slamStacks: 0,
          blastCharge: 0, pierceLeft: 0,
        })
      }
    } else if (item.id === 'safety2') {
      const wasFresh = this.safetyHits === 0
      this.safetyHits = Math.min(MAX_SAFETY, this.safetyHits + 2)
      this.measureSafety()
      if (wasFresh) this.safetyX = this.W / 2 - this.safetyW / 2
    } else if (item.id === 'safety4') {
      const wasFresh = this.safetyHits === 0
      this.safetyHits = Math.min(MAX_SAFETY, this.safetyHits + 4)
      this.measureSafety()
      if (wasFresh) this.safetyX = this.W / 2 - this.safetyW / 2
    } else if (item.id === 'blast') {
      for (const ball of this.balls) {
        ball.blastCharge = Math.max(ball.blastCharge, 2)
      }
    } else if (item.id === 'pierce') {
      for (const ball of this.balls) {
        ball.pierceLeft = Math.max(ball.pierceLeft, 3)
      }
    } else if (item.id === 'lucky') {
      this.dropBonus += 0.02  // +2% flat, stacks permanently
    }

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
    const isNewChapter = this.paragraphIdx + 1 >= chapter.paragraphs.length
    if (!isNewChapter) {
      // Next paragraph in same chapter
      this.loadParagraph(this.chapterIdx, this.paragraphIdx + 1)
    } else {
      // Next chapter, first paragraph
      this.chapterIdx = (this.chapterIdx + 1) % this.book.chapters.length
      this.loadParagraph(this.chapterIdx, 0)
    }
    // Wait for ball launch before scrolling
    this.started = false
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
      this.paddleText = 'BOOK BREAKER'
      this.measurePaddle()
      // Reset to single ball
      this.balls = [{
        x: this.paddleX + this.paddleW / 2,
        y: this.paddleY + this.paddleH + 9,
        vx: 0, vy: 0, r: 7,
        trail: [], stuck: true,
        backWallHits: 0, slamStacks: 0,
        blastCharge: 0, pierceLeft: 0,
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
    Game.saveToStorage(this)
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
      }
    }
  }

  private hitBrick(brick: Brick, ball: Ball) {
    const uState = this.getUpgradeState()
    runHitBrick(brick, ball, uState)
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
    sidebarEls.chapterLabel.textContent = `Ch ${this.chapterIdx + 1}  ·  ${this.paragraphIdx + 1}/${chapter.paragraphs.length}`
    const bricksAlive = this.bricks.filter(b => b.alive).length
    const wordsPlaced = this.wordCursor
    const broken = wordsPlaced - bricksAlive
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

    // Recall button visibility
    if (this.recallBtn) {
      const showRecall = this.charge >= 1.0 && this.balls.some(b => !b.stuck) && this.levelState === 'playing'
      this.recallBtn.style.display = showRecall ? 'block' : 'none'
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
      const isChapterDone = this.paragraphIdx + 1 >= chapter.paragraphs.length
      ctx.fillText(isChapterDone ? 'CHAPTER COMPLETE' : 'PARAGRAPH COMPLETE', W / 2, H * 0.28)

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
        const isShopNext = !isFail && (this.paragraphsCompleted + 1) % 3 === 0
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
      const blur = this.isMobile ? 0.35 : 1
      const narrow = this.W < 700

      // Dark backdrop
      ctx.fillStyle = 'rgba(6, 8, 12, 0.92)'
      ctx.fillRect(0, 0, W, H)

      // ── Bordered panel around entire shop ──
      const firstR = this.shopRects[0]
      const lastR = this.shopRects[this.shopRects.length - 1]
      const panelPad = narrow ? 16 : 24
      const panelX = firstR.x - panelPad
      const panelY = firstR.y - (narrow ? 100 : 120)
      const panelRight = lastR.x + lastR.w + panelPad
      const panelBottom = this.shopContinueRect.y + this.shopContinueRect.h + panelPad
      const panelW = panelRight - panelX
      const panelH = panelBottom - panelY

      ctx.fillStyle = '#0a0e14'
      ctx.strokeStyle = '#1a2030'
      ctx.lineWidth = 2
      roundRect(ctx, panelX, panelY, panelW, panelH, 8)
      ctx.fill()
      ctx.stroke()

      // Gold accent line at top of panel
      ctx.strokeStyle = '#e8c44a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(panelX + 8, panelY)
      ctx.lineTo(panelRight - 8, panelY)
      ctx.stroke()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // ── Title ──
      const titleY = firstR.y - (narrow ? 78 : 96)
      ctx.fillStyle = '#e8c44a'
      ctx.shadowColor = '#e8c44a'
      ctx.shadowBlur = 18 * blur
      ctx.font = `bold ${narrow ? 22 : 28}px 'JetBrains Mono', monospace`
      ctx.fillText('◆  SHOP  ◆', W / 2, titleY)
      ctx.shadowBlur = 0

      // ── Gold display ──
      const goldY = firstR.y - (narrow ? 48 : 58)
      ctx.fillStyle = '#fbbf24'
      ctx.shadowColor = '#fbbf24'
      ctx.shadowBlur = 6 * blur
      ctx.font = `bold ${narrow ? 16 : 20}px 'JetBrains Mono', monospace`
      ctx.fillText(`◆ ${this.gold}`, W / 2, goldY)
      ctx.shadowBlur = 0

      // ── Hint ──
      const hintY = firstR.y - (narrow ? 22 : 28)
      ctx.fillStyle = '#374151'
      ctx.font = `${narrow ? 9 : 11}px 'JetBrains Mono', monospace`
      ctx.fillText(narrow ? 'tap to buy · tap CONTINUE to skip' : 'click to purchase  ·  SPACE to continue', W / 2, hintY)

      // ── Item cards (text-only, rarity-colored) ──
      for (let i = 0; i < this.shopItems.length && i < this.shopRects.length; i++) {
        const item = this.shopItems[i]
        const r = this.shopRects[i]
        const canAfford = this.gold >= item.price
        const dimmed = item.bought || item.maxed || !canAfford
        const rarityColor = RARITY_COLORS[item.rarity]

        // Card background
        ctx.fillStyle = item.bought ? '#080a10' : '#0c1018'
        roundRect(ctx, r.x, r.y, r.w, r.h, 5)
        ctx.fill()

        // Border — color from rarity, glow when affordable
        if (!item.bought && canAfford) {
          ctx.shadowColor = rarityColor
          ctx.shadowBlur = 8 * blur
        }
        ctx.strokeStyle = item.bought ? '#1a2030' : (canAfford ? rarityColor : '#1f1215')
        ctx.lineWidth = item.bought ? 1 : 1.5
        roundRect(ctx, r.x, r.y, r.w, r.h, 5)
        ctx.stroke()
        ctx.shadowBlur = 0

        ctx.globalAlpha = dimmed ? 0.25 : 1.0

        // Rarity label (top of card)
        ctx.fillStyle = rarityColor
        ctx.font = `bold ${narrow ? 8 : 9}px 'JetBrains Mono', monospace`
        ctx.fillText(RARITY_LABELS[item.rarity], r.x + r.w / 2, r.y + r.h * 0.14)

        // Thin rarity accent line under label
        ctx.strokeStyle = rarityColor
        ctx.globalAlpha = dimmed ? 0.1 : 0.35
        ctx.lineWidth = 1
        ctx.beginPath()
        const lineInset = narrow ? 16 : 24
        ctx.moveTo(r.x + lineInset, r.y + r.h * 0.22)
        ctx.lineTo(r.x + r.w - lineInset, r.y + r.h * 0.22)
        ctx.stroke()
        ctx.globalAlpha = dimmed ? 0.25 : 1.0

        // Name (main text, prominent)
        ctx.fillStyle = '#e0e4ea'
        ctx.font = `bold ${narrow ? 12 : 14}px 'JetBrains Mono', monospace`
        ctx.fillText(item.name, r.x + r.w / 2, r.y + r.h * 0.42)

        // Description
        ctx.fillStyle = '#5a6578'
        ctx.font = `${narrow ? 8 : 10}px 'JetBrains Mono', monospace`
        ctx.fillText(item.desc, r.x + r.w / 2, r.y + r.h * 0.60)

        // Price or SOLD/MAXED
        if (item.maxed) {
          ctx.fillStyle = '#5a6578'
          ctx.font = `bold ${narrow ? 10 : 11}px 'JetBrains Mono', monospace`
          ctx.fillText('── MAXED ──', r.x + r.w / 2, r.y + r.h * 0.82)
        } else if (item.bought) {
          ctx.fillStyle = '#374151'
          ctx.font = `bold ${narrow ? 10 : 11}px 'JetBrains Mono', monospace`
          ctx.fillText('── SOLD ──', r.x + r.w / 2, r.y + r.h * 0.82)
        } else {
          ctx.fillStyle = canAfford ? '#fbbf24' : '#f87171'
          ctx.font = `bold ${narrow ? 12 : 14}px 'JetBrains Mono', monospace`
          ctx.fillText(`◆ ${item.price}`, r.x + r.w / 2, r.y + r.h * 0.82)
        }

        ctx.globalAlpha = 1.0
      }

      // ── Divider before continue ──
      const divY = this.shopContinueRect.y - 10
      ctx.strokeStyle = '#1a2030'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(firstR.x, divY)
      ctx.lineTo(lastR.x + lastR.w, divY)
      ctx.stroke()

      // ── Continue button ──
      const cr = this.shopContinueRect
      ctx.fillStyle = '#0c1018'
      ctx.strokeStyle = '#5a6578'
      ctx.lineWidth = 1.5
      roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 5)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#7dd3fc'
      ctx.shadowColor = '#7dd3fc'
      ctx.shadowBlur = 6 * blur
      ctx.font = `bold ${narrow ? 13 : 16}px 'JetBrains Mono', monospace`
      ctx.fillText('CONTINUE  ▶', W / 2, cr.y + cr.h / 2)
      ctx.shadowBlur = 0

      // ── Particles (purchase feedback) on top ──
      for (const p of this.particles) {
        const lifeRatio = p.life / p.maxLife
        ctx.globalAlpha = lifeRatio
        ctx.fillStyle = p.color
        const fontSize = Math.round(p.size * (0.5 + lifeRatio * 0.5))
        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.char, p.x, p.y)
      }
      ctx.globalAlpha = 1.0
    }

    // Game over overlay
    if (this.gameOver) {
      renderGameOver(ctx, W, H, {
        book: this.book,
        chapterIdx: this.chapterIdx,
        score: this.score,
        wordsBroken: this.wordsBroken,
        isNewHigh: this.isNewHigh,
        endScores: this.endScores,
      })
    }

    // Pause overlay
    if (this.paused) {
      renderPause(ctx, W, H)
    }

  }

  // ── Save / Restore ───────────────────────────────────────────
  getSaveState() {
    return {
      bookIdx: BOOKS.indexOf(this.book),
      chapterIdx: this.chapterIdx,
      paragraphIdx: this.paragraphIdx,
      score: this.score,
      lives: this.lives,
      gold: this.gold,
      paragraphsCompleted: this.paragraphsCompleted,
      dropBonus: this.dropBonus,
      widenLevel: this.widenLevel,
      safetyHits: this.safetyHits,
      wordsBroken: this.wordsBroken,
      letterCounts: this.letterCounts,
      alphabetCompletions: this.alphabetCompletions,
      nextLifeScore: this.nextLifeScore,
      levelState: this.levelState,
    }
  }

  restoreFromSave(save: ReturnType<Game['getSaveState']>) {
    this.chapterIdx = save.chapterIdx
    this.paragraphIdx = save.paragraphIdx
    this.score = save.score
    this.lives = save.lives
    this.gold = save.gold
    this.paragraphsCompleted = save.paragraphsCompleted
    this.dropBonus = save.dropBonus
    this.widenLevel = save.widenLevel
    this.safetyHits = save.safetyHits
    this.wordsBroken = save.wordsBroken
    this.letterCounts = save.letterCounts
    this.alphabetCompletions = save.alphabetCompletions
    this.nextLifeScore = save.nextLifeScore
    // Restore paddle width
    if (this.widenLevel > 0) {
      const equals = '═'.repeat(this.widenLevel)
      this.paddleText = `${equals} BOOK BREAKER ${equals}`
      this.measurePaddle()
    }
    // Restore safety bar
    if (this.safetyHits > 0) this.measureSafety()
    // Load the correct paragraph
    this.loadParagraph(this.chapterIdx, this.paragraphIdx)
    this.balls = []
    this.spawnBall()
    // If save was at shop, reopen it
    if (save.levelState === 'shop') {
      this.openShop()
    } else {
      this.levelState = 'playing'
    }
    this.updateSidebar()
  }

  static saveToStorage(game: Game) {
    const save = game.getSaveState()
    localStorage.setItem('bb_run_save', JSON.stringify(save))
  }

  static loadFromStorage(): ReturnType<Game['getSaveState']> | null {
    const raw = localStorage.getItem('bb_run_save')
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  static clearSave() {
    localStorage.removeItem('bb_run_save')
  }

}
