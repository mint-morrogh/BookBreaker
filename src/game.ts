import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { BOOKS, type Book } from './content'
import type { WordTag } from './tagger'
import type { Brick, Ball, Particle, Pickup, Dot } from './types'
import { scoreWord, getHighScores, saveHighScore } from './scoring'
export { getTopScore } from './scoring'
import { TAG_COLORS, wordColor, setActiveTagMap } from './colors'
import { sidebarEls, initLetterGrid } from './sidebar'
import { renderGameOver, renderPause } from './renderer'
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
  private safetyH = 20
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

  // end-of-chapter sequence
  private levelWords: { word: string; color: string; points: number }[] = []
  private levelState: 'playing' | 'endPopping' | 'endTally' | 'endGrade' = 'playing'
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
  private islandCheckTimer = 0

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
      } else if (this.levelState === 'endGrade' && this.endTimer > 1.0) {
        if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.levelState = 'playing'
          this.levelWords = []
          this.advanceChapter()
        }
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
    const font = `bold ${this.safetyH - 5}px 'JetBrains Mono', 'Courier New', monospace`
    const prepared = prepareWithSegments(this.safetyLabel, font)
    const result = layoutWithLines(prepared, 9999, this.safetyH)
    const textW = result.lines.length > 0 ? result.lines[0].width : this.safetyLabel.length * 7
    this.safetyW = textW + 28
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
          breakOff: 0,
          breakOffVx: 0,
          breakOffAngle: 0,
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

    // ── End-of-chapter sequence (all in-field, no overlays) ──

    // Phase 1: Pop remaining bricks one by one
    if (this.levelState === 'endPopping') {
      this.endTimer += dt
      const popsPerSec = 8
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
      // When done popping, move to tally
      if (this.endPopIdx >= this.endPopBricks.length && this.endTimer > this.endPopBricks.length / popsPerSec + 0.5) {
        this.levelState = 'endTally'
        this.endTimer = 0
      }
      return
    }

    // Phase 2: Score tally — count up broken words, then deduct missed
    if (this.levelState === 'endTally') {
      this.endTimer += dt
      const tallyPerSec = 16
      const targetIdx = Math.floor(this.endTimer * tallyPerSec)
      while (this.endTallyIdx < this.levelWords.length && this.endTallyIdx < targetIdx) {
        this.endTallyScore += this.levelWords[this.endTallyIdx].points
        this.endTallyIdx++
      }
      // After tally finishes, show penalty deduction then move to grade
      const tallyDone = this.endTallyIdx >= this.levelWords.length
      const tallyEndTime = this.levelWords.length / tallyPerSec + 0.8
      if (tallyDone && !this.endPenaltyShown && this.endTimer > tallyEndTime) {
        // Deduct penalty for missed words
        const missed = this.endTotalWords - this.endBrokenWords
        this.endPenaltyTotal = missed * 50
        this.score = Math.max(0, this.score - this.endPenaltyTotal)
        this.endPenaltyShown = true
      }
      if (tallyDone && this.endPenaltyShown && this.endTimer > tallyEndTime + 1.5) {
        // Calculate grade
        const pct = this.endTotalWords > 0 ? this.endBrokenWords / this.endTotalWords : 0
        if (pct >= 1.0) this.endGrade = 'S'
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
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.levelState = 'playing'
          this.levelWords = []
          this.advanceChapter()
        }
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

      // Island detection — check every 0.5s for disconnected brick groups
      this.islandCheckTimer -= dt
      if (this.islandCheckTimer <= 0 && this.levelState === 'playing') {
        this.detectIslands()
        this.islandCheckTimer = 0.5
      }

      // Break-off bricks — float up slightly, wobble, then explode
      for (const b of this.bricks) {
        if (!b.alive || b.breakOff <= 0) continue
        b.breakOff -= dt
        b.y -= dt * 25  // float up a little faster than normal drift
        b.x += b.breakOffVx * dt
        b.breakOffAngle += dt * 2  // slow spin

        if (b.breakOff <= 0) {
          // Explode — award break-off bonus
          b.alive = false
          const bonus = Math.round(b.points * 1.5)
          this.score += bonus
          this.wordsBroken++
          this.multiplier = Math.min(10.0, this.multiplier + 0.3)
          this.levelWords.push({ word: b.word, color: b.color, points: bonus })

          // Collect letters
          for (const ch of b.word.toUpperCase()) {
            if (ch >= 'A' && ch <= 'Z') {
              this.letterCounts[ch] = (this.letterCounts[ch] || 0) + 1
              const el = document.getElementById(`letter-${ch}`)
              if (el) el.classList.add('collected')
            }
          }

          // Particles
          const bsy = b.y - this.bricksScrollY
          for (let i = 0; i < b.word.length; i++) {
            this.particles.push({
              x: b.x + (i / b.word.length) * b.w + 8,
              y: bsy + b.h / 2,
              vx: (Math.random() - 0.5) * 250,
              vy: (Math.random() - 0.5) * 250,
              char: b.word[i], life: 1.0, maxLife: 1.2,
              color: '#fbbf24', size: 16,
            })
          }
          // Bonus popup
          this.particles.push({
            x: b.x + b.w / 2, y: bsy,
            vx: 0, vy: -50,
            char: `BREAK-OFF +${bonus}`,
            life: 1.5, maxLife: 1.5,
            color: '#fbbf24', size: 14,
          })
        }
      }

      // Level clear: all words placed and all bricks broken
      if (this.levelState === 'playing' && this.wordCursor >= this.wordsInChapter.length && !this.bricks.some(b => b.alive)) {
        this.startEndSequence()
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
            this.startEndSequence()
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

  private tickParticlesAndFade(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt
      if (p.life <= 0) this.particles.splice(i, 1)
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
    if (alive.length < 2) return

    // Adjacency: two bricks are neighbors if close in Y (within row gap) and overlapping in X
    const rowGap = 35  // roughly brickLineH + gapY + tolerance
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

    if (groups.size <= 1) return  // only one group, nothing to break off

    // Find the largest group (main body)
    let mainGroup: Brick[] = []
    for (const g of groups.values()) {
      if (g.length > mainGroup.length) mainGroup = g
    }

    // All other groups are islands — flag them for break-off
    const mainSet = new Set(mainGroup)
    for (const g of groups.values()) {
      if (g === mainGroup) continue
      for (const b of g) {
        if (mainSet.has(b)) continue
        b.breakOff = 0.6 + Math.random() * 0.3  // 0.6–0.9s until pop
        b.breakOffVx = (Math.random() - 0.5) * 60
        b.breakOffAngle = (Math.random() - 0.5) * 0.4
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
    this.endTotalWords = this.totalWordsInChapter
    this.endBrokenWords = this.wordsBroken
    this.levelState = this.endPopBricks.length > 0 ? 'endPopping' : 'endTally'
    for (const ball of this.balls) { ball.stuck = true; ball.trail = [] }
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

    // End-of-chapter in-field UI
    if (this.levelState === 'endPopping') {
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
      ctx.fillText('CHAPTER COMPLETE', W / 2, H * 0.28)

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
        ctx.fillStyle = gradeColors[this.endGrade] ?? '#c8d0dc'
        ctx.font = `bold 72px 'JetBrains Mono', monospace`
        ctx.fillText(this.endGrade, W / 2, H * 0.48)

        ctx.fillStyle = '#5a6578'
        ctx.font = `14px 'JetBrains Mono', monospace`
        ctx.fillText(`${this.endBrokenWords} / ${this.endTotalWords} words`, W / 2, H * 0.58)
      }

      // Prompt
      if (this.endTimer > 1.0) {
        const isFail = isDead || this.endGrade === 'D' || this.endGrade === 'F'
        ctx.fillStyle = isFail ? '#f87171' : '#7dd3fc'
        ctx.font = `bold 14px 'JetBrains Mono', monospace`
        ctx.fillText(
          isDead ? '[ CLICK or SPACE to continue ]' :
          isFail ? '[ CLICK or SPACE to restart ]' :
          '[ CLICK or SPACE for next chapter ]',
          W / 2, H * 0.68,
        )
      }
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
