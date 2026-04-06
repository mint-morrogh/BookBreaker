import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { BOOKS, type Book } from './content'
import type { WordTag } from './tagger'
import type { Brick, Ball, Particle, Pickup, Dot, Shrapnel } from './types'
import { scoreWord, getHighScores, saveHighScore } from './scoring'
export { getTopScore } from './scoring'
import { TAG_COLORS, wordColor, setActiveTagMap } from './colors'
import { sidebarEls, initLetterGrid, clearWordLog } from './sidebar'
import { renderGameOver, renderPause } from './renderer'
import { updateBalls, type PhysicsState } from './physics'
import { activateUpgrade as runActivateUpgrade, hitBrick as runHitBrick, type UpgradeState } from './upgrades'
import { renderGame, type RenderState } from './render-game'

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
  private nextLifeScore = 10000  // award +1 life every 10k points

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

    window.addEventListener('resize', () => this.resize())
    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      this.mouseX = (e.clientX - rect.left) / rect.width * this.W
    })
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.key)
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        this.launchBalls()
      }
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key))

    // Left click: hold to push paddle forward, release to snap back
    // First click when ball is stuck just launches (no paddle push)
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
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
          this.advanceLevel()
        }
      } else if (this.paused) {
        this.paused = false
      } else if (this.balls.some(b => b.stuck)) {
        // Ball is stuck — launch it, don't push paddle
        this.launchBalls()
      } else {
        // Ball is in play — hold to push paddle forward (if not on cooldown)
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
      if (this.levelState === 'endGrade' && this.endTimer > 1.0) {
        if (this.lives <= 0 || this.endGrade === 'D' || this.endGrade === 'F') {
          this.gameOver = true
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.levelState = 'playing'
          this.levelWords = []
          this.advanceLevel()
        }
        return
      }
      if (this.paused) { this.paused = false; return }

      // Multi-touch: first finger moves paddle, second finger slams
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const rect = this.canvas.getBoundingClientRect()
        const vx = (touch.clientX - rect.left) / rect.width * this.W

        if (this.moveTouchId === null) {
          // First finger — paddle movement
          this.moveTouchId = touch.identifier
          this.mouseX = vx
          if (this.balls.some(b => b.stuck)) this.launchBalls()
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

    if (this.isMobile) {
      // Mobile: CSS handles 100% fill — read actual rendered size
      const cw = this.canvas.clientWidth || Math.round(rect.width)
      const ch = this.canvas.clientHeight || Math.round(rect.height)
      this.canvas.width = cw
      this.canvas.height = ch
      this.scale = cw / this.W
      this.H = Math.round(ch / this.scale)
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
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)

    // Scale drift speed proportional to field height so timing stays consistent
    this.baseDriftSpeed = 6.4 * (this.H / VIRTUAL_H)
    if (this.freezeTimer <= 0) this.bricksDriftSpeed = this.baseDriftSpeed

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
    const ball = this.balls.find(b => !b.stuck)
    if (!ball) return
    this.hasRecalled = true

    // Check if path to paddle is clear — raycast for bricks in the way
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
      // Path isn't clear — redirect ball toward paddle, let physics handle the rest
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
      const angle = Math.atan2(dy, dx)
      ball.vx = Math.cos(angle) * speed
      ball.vy = Math.sin(angle) * speed
      // Gold flash to show recall was triggered
      this.particles.push({
        x: ball.x, y: ball.y,
        vx: 0, vy: -30,
        char: '↑ RECALL', life: 0.6, maxLife: 0.6,
        color: '#fbbf24', size: 12,
      })
      this.charge = 0
    } else {
      // Clear path — teleport ball home
      // Gold streak particles along path
      for (let i = 0; i < 20; i++) {
        const t = i / 20
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
      this.charge = 0
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
      const tallyPerSec = 32
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
          const prevTop = getHighScores(this.book.title)[0] ?? 0
          this.endScores = saveHighScore(this.book.title, this.score)
          this.isNewHigh = this.score > 0 && this.score >= prevTop
        } else {
          this.levelState = 'playing'
          this.levelWords = []
          this.advanceLevel()
        }
      }
      return
    }

    // Paddle movement — horizontal
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
    this.paddleX += (this.paddleTargetX - this.paddleX) * Math.min(1, dt * 22.5)

    // Paddle movement — vertical: click fires paddle to wall, release eases back
    if (this.slamCooldown > 0) this.slamCooldown -= dt
    const maxY = this.paddleBaseY + 55

    // Activate slam on mousedown
    if (this.mouseDown && !this.slamActive) this.slamActive = true

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
      this.islandCheckTimer -= dt
      if (this.islandCheckTimer <= 0 && this.levelState === 'playing') {
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
                const el = document.getElementById(`letter-${ch}`)
                if (el) el.classList.add('collected')
              }
            }

            // Rainbow particles — keep each brick's original color
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
            // Respawn a single ball stuck to paddle
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
      this.nextLifeScore += 10000
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

    // Shrapnel — blast projectiles that break bricks on contact
    for (let i = this.shrapnel.length - 1; i >= 0; i--) {
      const s = this.shrapnel[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 200 * dt  // gravity — arcs out then falls back down
      s.life -= dt
      if (s.life <= 0 || s.x < 0 || s.x > this.W || s.y < 0 || s.y > this.H) {
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
          this.particles.push({
            x: s.x, y: s.y,
            vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100,
            char: '✦', life: 0.3, maxLife: 0.4,
            color: '#ff6040', size: 8,
          })
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
      if (g.length > 4) continue  // too big — stays as normal bricks

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
    this.endBrokenWords = this.wordsBroken
    this.levelState = this.endPopBricks.length > 0 ? 'endPopping' : 'endTally'
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
    this.gameOver = false
    this.started = false
    this.score = 0
    this.multiplier = 1.0
    this.wordsBroken = 0
    this.lives = 3
    this.nextLifeScore = 10000
    this.levelLivesLost = 0
    this.letterCounts = {}
    this.alphabetCompletions = 0
    this.widenLevel = 0
    this.safetyHits = 0
    this.freezeTimer = 0
    this.charge = 0
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
    this.loadParagraph(0, 0)
    this.balls = []
    this.spawnBall()
    initLetterGrid()
    clearWordLog()
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
  }

  private updateSidebar() {
    const scoreStr = this.score.toLocaleString()
    const livesStr = String(this.lives)
    const comboStr = `x${this.multiplier.toFixed(1)}`
    const wordsStr = String(this.wordsBroken)

    sidebarEls.score.textContent = scoreStr
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
        ctx.fillStyle = isFail ? '#f87171' : '#7dd3fc'
        ctx.font = `bold 14px 'JetBrains Mono', monospace`
        ctx.fillText(
          isDead ? '[ CLICK or SPACE to continue ]' :
          isFail ? '[ CLICK or SPACE to restart ]' :
          '[ CLICK or SPACE to continue ]',
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
