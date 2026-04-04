import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { BOOKS, type Book } from './content'
import type { WordTag } from './tagger'
import type { Brick, Ball, Particle, Pickup, Dot } from './types'
import { scoreWord, getHighScores, saveHighScore } from './scoring'
export { getTopScore } from './scoring'
import { TAG_COLORS, wordColor, setActiveTagMap } from './colors'
import { sidebarEls, initLetterGrid } from './sidebar'
import { renderGameOver, renderLevelComplete, renderPenalty, renderPause } from './renderer'
import { updateBalls, type PhysicsState } from './physics'
import { activateUpgrade as runActivateUpgrade, hitBrick as runHitBrick, type UpgradeState } from './upgrades'
import { renderGame, type RenderState } from './render-game'

// ── Game ────────────────────────────────────────────────────────
// Fixed virtual resolution — all game logic runs in this coordinate space
const VIRTUAL_W = 900
const VIRTUAL_H = 950

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

  // book / chapter
  private book!: Book
  private chapterIdx = 0
  private wordsInChapter: string[] = []
  private wordCursor = 0
  private totalWordsInChapter = 0

  // particles
  private particles: Particle[] = []

  // pickups (falling upgrades)
  private pickups: Pickup[] = []
  private widenLevel = 0   // how many widen upgrades collected this level

  // safety bar
  private safetyHits = 0       // stacked hits remaining
  private safetyX = 0          // current X position
  private safetyDir = 1        // 1 = right, -1 = left
  private safetyW = 80
  private safetyH = 10
  private safetyY = 20         // above the main paddle

  // slow upgrade
  private slowTimer = 0           // seconds remaining of slow effect
  private baseDriftSpeed = 6.4    // normal drift speed

  // magnet upgrade
  private magnetStrength = 0      // pull strength toward paddle (0 = off)

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

  // level complete animation
  private levelWords: { word: string; color: string; points: number }[] = []
  private levelState: 'playing' | 'animating' | 'waiting' | 'penalty' | 'penaltyWait' = 'playing'
  private levelAnimTimer = 0
  private levelAnimIdx = 0
  private levelAnimScore = 0
  private penaltyBricks: { word: string; color: string; points: number }[] = []
  private penaltyTimer = 0
  private penaltyIdx = 0
  private penaltyTotal = 0

  // high scores (set on game over)
  private endScores: number[] = []
  private isNewHigh = false

  // input
  private mouseX = -1
  private keysDown = new Set<string>()

  // state
  private started = false
  private gameOver = false
  private paused = false
  private sidebarTimer = 0
  private purgeTimer = 0

  constructor(canvas: HTMLCanvasElement, bookIdx: number, tagMap: Map<string, WordTag>) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.book = BOOKS[bookIdx]
    setActiveTagMap(tagMap)
    this.resize()
    this.loadChapter(0)
    this.spawnBall()
    initLetterGrid()
    sidebarEls.bookName.textContent = this.book.title
    this.updateSidebar()

    window.addEventListener('resize', () => this.resize())
    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = (e.clientX - rect.left) / rect.width * VIRTUAL_W
    })
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.key)
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        this.launchBalls()
      }
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key))
    this.canvas.addEventListener('click', () => {
      if (this.gameOver) {
        this.restart()
      } else if (this.levelState === 'waiting' || this.levelState === 'penaltyWait') {
        this.levelState = 'playing'
        this.levelWords = []
        this.penaltyBricks = []
        this.advanceChapter()
      } else if (this.paused) {
        this.paused = false
      } else {
        this.launchBalls()
      }
    })

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

    // Scale virtual resolution to fit container, maintaining aspect ratio
    this.scale = Math.min(rect.width / VIRTUAL_W, rect.height / VIRTUAL_H)
    const physW = Math.round(VIRTUAL_W * this.scale)
    const physH = Math.round(VIRTUAL_H * this.scale)

    // Render at CSS pixel size (1:1 mapping) — no DPR scaling
    // This eliminates text shimmer from DPR resampling
    this.canvas.width = physW
    this.canvas.height = physH
    this.canvas.style.width = physW + 'px'
    this.canvas.style.height = physH + 'px'
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)

    // Game logic always uses fixed virtual dimensions
    this.W = VIRTUAL_W
    this.H = VIRTUAL_H

    this.paddleY = 50
    this.measurePaddle()
    this.brickFontSize = 15
    this.brickLineH = this.brickFontSize + 6
    this.brickFont = `${this.brickFontSize}px 'JetBrains Mono', 'Courier New', monospace`
    this.initDots()
  }

  private initDots() {
    this.dots = []
    const cols = Math.ceil(this.W / this.dotSpacing) + 1
    const rows = Math.ceil(this.H / this.dotSpacing) + 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * this.dotSpacing
        const y = r * this.dotSpacing
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
    const font = `bold 11px 'JetBrains Mono', 'Courier New', monospace`
    const prepared = prepareWithSegments(this.safetyLabel, font)
    const result = layoutWithLines(prepared, 9999, this.safetyH)
    const textW = result.lines.length > 0 ? result.lines[0].width : this.safetyLabel.length * 7
    this.safetyW = textW + 16
  }

  // ── Chapter / Brick loading ─────────────────────────────────
  private loadChapter(idx: number) {
    this.chapterIdx = idx % this.book.chapters.length
    const text = this.book.chapters[this.chapterIdx]
    this.wordsInChapter = text.split(/\s+/).filter(w => w.length > 0)
    this.totalWordsInChapter = this.wordsInChapter.length
    this.wordCursor = 0
    this.bricks = []
    this.bricksScrollY = 0
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

      while (curX < areaW + margin && this.wordCursor < this.wordsInChapter.length) {
        const word = this.wordsInChapter[this.wordCursor]
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
        }
        rowBricks.push(brick)
        this.bricks.push(brick)
        curX += bw + gapX
        this.wordCursor++
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
      primary: true,
      backWallHits: 0,
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
      }
    }
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

    // Level complete animation
    if (this.levelState === 'animating') {
      this.levelAnimTimer += dt
      // Show one word every 0.06s for fast count-up
      const wordsPerSec = 16
      const targetIdx = Math.floor(this.levelAnimTimer * wordsPerSec)
      while (this.levelAnimIdx < this.levelWords.length && this.levelAnimIdx < targetIdx) {
        this.levelAnimScore += this.levelWords[this.levelAnimIdx].points
        this.levelAnimIdx++
      }
      // When all words shown, pause then move to waiting
      if (this.levelAnimIdx >= this.levelWords.length && this.levelAnimTimer > this.levelWords.length / wordsPerSec + 1.5) {
        this.levelState = 'waiting'
      }
      return
    }
    if (this.levelState === 'waiting') {
      if (this.keysDown.has(' ') || this.keysDown.has('Enter')) {
        this.levelState = 'playing'
        this.levelWords = []
        this.advanceChapter()
      }
      return
    }
    // Penalty animation — bricks break one by one, score drains
    if (this.levelState === 'penalty') {
      this.penaltyTimer += dt
      const wordsPerSec = 12
      const targetIdx = Math.floor(this.penaltyTimer * wordsPerSec)
      while (this.penaltyIdx < this.penaltyBricks.length && this.penaltyIdx < targetIdx) {
        this.penaltyTotal += this.penaltyBricks[this.penaltyIdx].points
        this.penaltyIdx++
      }
      if (this.penaltyIdx >= this.penaltyBricks.length && this.penaltyTimer > this.penaltyBricks.length / wordsPerSec + 1.0) {
        // Deduct from score (floor at 0)
        this.score = Math.max(0, this.score - this.penaltyTotal)
        this.levelState = 'penaltyWait'
      }
      return
    }
    if (this.levelState === 'penaltyWait') {
      if (this.keysDown.has(' ') || this.keysDown.has('Enter')) {
        this.levelState = 'playing'
        this.penaltyBricks = []
        this.advanceChapter()
      }
      return
    }

    // Paddle movement
    if (this.mouseX >= 0) {
      this.paddleTargetX = this.mouseX - this.paddleW / 2
    }
    if (this.keysDown.has('ArrowLeft') || this.keysDown.has('a')) {
      this.paddleTargetX -= 600 * dt
    }
    if (this.keysDown.has('ArrowRight') || this.keysDown.has('d')) {
      this.paddleTargetX += 600 * dt
    }
    this.paddleTargetX = Math.max(0, Math.min(this.W - this.paddleW, this.paddleTargetX))
    this.paddleX += (this.paddleTargetX - this.paddleX) * Math.min(1, dt * 18)

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

    // Slow upgrade timer
    if (this.slowTimer > 0) {
      this.slowTimer -= dt
      this.bricksDriftSpeed = this.baseDriftSpeed * 0.3
      if (this.slowTimer <= 0) {
        this.slowTimer = 0
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

      // Level clear: all words placed and all bricks broken → start animation
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInChapter.length && !this.bricks.some(b => b.alive)) {
        this.levelState = 'animating'
        this.levelAnimTimer = 0
        this.levelAnimIdx = 0
        this.levelAnimScore = 0
        // Stick the ball
        for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
      }

      // Check if bricks reached the top wall (blue line) → penalty
      for (const b of this.bricks) {
        if (b.alive && b.y - this.bricksScrollY < 5) {
          // Collect all remaining alive bricks for penalty
          this.penaltyBricks = []
          for (const brick of this.bricks) {
            if (brick.alive) {
              this.penaltyBricks.push({ word: brick.word, color: brick.color, points: brick.points })
              brick.alive = false
            }
          }
          this.penaltyTimer = 0
          this.penaltyIdx = 0
          this.penaltyTotal = 0
          this.levelState = 'penalty'
          // Stick ball
          for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
          break
        }
      }
    }

    // Balls — physics handled by extracted module
    const physicsState: PhysicsState = {
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleY: this.paddleY,
      paddleH: this.paddleH,
      W: this.W,
      H: this.H,
      safetyX: this.safetyX,
      safetyW: this.safetyW,
      safetyY: this.safetyY,
      safetyH: this.safetyH,
      safetyHits: this.safetyHits,
      magnetStrength: this.magnetStrength,
      ballSpeed: this.ballSpeed,
      bricksScrollY: this.bricksScrollY,
    }
    const physicsEvents = updateBalls(this.balls, this.bricks, dt, physicsState)
    for (const ev of physicsEvents) {
      if (ev.type === 'brickHit') {
        this.hitBrick(ev.brick, ev.ball)
      } else if (ev.type === 'backWallHit') {
        this.particles.push(ev.particle)
      } else if (ev.type === 'safetyHit') {
        this.safetyHits--
        this.measureSafety()
      } else if (ev.type === 'ballLost') {
        if (ev.ball.primary) {
          ev.ball.stuck = true
          ev.ball.trail = []
          ev.ball.backWallHits = 0
          this.multiplier = 1.0
          this.lives--
          if (this.lives <= 0) {
            this.gameOver = true
            const prevTop = getHighScores(this.book.title)[0] ?? 0
            this.endScores = saveHighScore(this.book.title, this.score)
            this.isNewHigh = this.score > 0 && this.score >= prevTop
          }
        } else {
          if (ev.index >= 0) this.balls.splice(ev.index, 1)
        }
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 120 * dt  // gravity
      p.life -= dt
      if (p.life <= 0) this.particles.splice(i, 1)
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
    // Purge fully faded bricks periodically (avoid alloc every frame)
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

  private spawnMoreBricks() {
    if (this.wordCursor >= this.wordsInChapter.length) {
      // Chapter exhausted — wait for all bricks to be cleared
      return
    }
    this.spawnBrickRows(4)
  }

  private restart() {
    this.gameOver = false
    this.started = false
    this.score = 0
    this.multiplier = 1.0
    this.wordsBroken = 0
    this.lives = 3
    this.letterCounts = {}
    this.alphabetCompletions = 0
    this.widenLevel = 0
    this.safetyHits = 0
    this.slowTimer = 0
    this.magnetStrength = 0
    this.bricksDriftSpeed = this.baseDriftSpeed
    this.paddleText = 'BOOK BREAKER'
    this.measurePaddle()
    this.pickups = []
    this.particles = []
    this.levelWords = []
    this.levelState = 'playing'
    this.loadChapter(0)
    this.balls = []
    this.spawnBall()
    initLetterGrid()
    this.updateSidebar()
  }

  private advanceChapter() {
    this.chapterIdx = (this.chapterIdx + 1) % this.book.chapters.length
    this.loadChapter(this.chapterIdx)
    // Reset upgrades for new level
    this.widenLevel = 0
    this.safetyHits = 0
    this.slowTimer = 0
    this.magnetStrength = 0
    this.bricksDriftSpeed = this.baseDriftSpeed
    this.paddleText = 'BOOK BREAKER'
    this.measurePaddle()
    this.pickups = []
    // Re-stick ball for new level
    for (const ball of this.balls) {
      ball.stuck = true
      ball.trail = []
      ball.blastCharge = 0
      ball.pierceLeft = 0
    }
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
      pickups: this.pickups,
      widenLevel: this.widenLevel,
      paddleX: this.paddleX,
      paddleW: this.paddleW,
      paddleTargetX: this.paddleTargetX,
      W: this.W,
      H: this.H,
      safetyHits: this.safetyHits,
      safetyW: this.safetyW,
      slowTimer: this.slowTimer,
      magnetStrength: this.magnetStrength,
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
    }
  }

  private applyUpgradeState(uState: UpgradeState) {
    this.widenLevel = uState.widenLevel
    this.safetyHits = uState.safetyHits
    this.slowTimer = uState.slowTimer
    this.magnetStrength = uState.magnetStrength
    this.multiplier = uState.multiplier
    this.score = uState.score
    this.wordsBroken = uState.wordsBroken
    this.alphabetCompletions = uState.alphabetCompletions
    this.lives = uState.lives
  }

  private updateSidebar() {
    sidebarEls.score.textContent = this.score.toLocaleString()
    sidebarEls.lives.textContent = String(this.lives)
    sidebarEls.combo.textContent = `x${this.multiplier.toFixed(1)}`
    sidebarEls.words.textContent = String(this.wordsBroken)
    sidebarEls.chapterLabel.textContent = `Chapter ${this.chapterIdx + 1} of ${this.book.chapters.length}`
    // Progress = words broken in this chapter / total words
    const bricksAlive = this.bricks.filter(b => b.alive).length
    const wordsPlaced = this.wordCursor
    const broken = wordsPlaced - bricksAlive
    const pct = this.totalWordsInChapter > 0 ? Math.round((broken / this.totalWordsInChapter) * 100) : 0
    sidebarEls.progressBar.style.width = `${pct}%`
    sidebarEls.progressText.textContent = `${pct}%`
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
      slowTimer: this.slowTimer,
      magnetStrength: this.magnetStrength,
      started: this.started,
      levelState: this.levelState,
    }
    renderGame(ctx, W, H, renderState)

    // Level complete animation overlay
    if (this.levelState === 'animating' || this.levelState === 'waiting') {
      renderLevelComplete(ctx, W, H, {
        levelWords: this.levelWords,
        levelAnimIdx: this.levelAnimIdx,
        levelAnimScore: this.levelAnimScore,
        isWaiting: this.levelState === 'waiting',
      })
    }

    // Penalty overlay — bricks reached the top
    if (this.levelState === 'penalty' || this.levelState === 'penaltyWait') {
      renderPenalty(ctx, W, H, {
        penaltyBricks: this.penaltyBricks,
        penaltyIdx: this.penaltyIdx,
        penaltyTotal: this.penaltyTotal,
        isWaiting: this.levelState === 'penaltyWait',
      })
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

}
