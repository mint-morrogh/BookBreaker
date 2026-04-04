import type { Ball, Brick, Particle, Pickup, Shrapnel, UpgradeType } from './types'
import { colorTier, dropChance, UPGRADE_LABELS } from './colors'
import { sidebarEls } from './sidebar'

// ── State needed by upgrade/brick-hit logic ────────────────────
export interface UpgradeState {
  balls: Ball[]
  bricks: Brick[]
  particles: Particle[]
  shrapnel: Shrapnel[]
  pickups: Pickup[]
  widenLevel: number
  paddleX: number
  paddleW: number
  paddleTargetX: number
  W: number
  H: number
  safetyHits: number
  safetyW: number
  freezeTimer: number
  multiplier: number
  score: number
  wordsBroken: number
  letterCounts: Record<string, number>
  alphabetCompletions: number
  lives: number
  bricksScrollY: number
  brickPadX: number
  brickFontSize: number
  levelWords: { word: string; color: string; points: number }[]
}

// ── Events returned so game.ts can apply mutations ─────────────
export type UpgradeEvent =
  | { type: 'measurePaddle'; paddleText: string }
  | { type: 'measureSafety' }
  | { type: 'clampPaddle' }

export function activateUpgrade(pickup: Pickup, state: UpgradeState): UpgradeEvent[] {
  const events: UpgradeEvent[] = []

  if (pickup.type === 'widen') {
    const addPerSide = pickup.tier  // tier 1→+1, tier 2→+2, etc.
    state.widenLevel += addPerSide
    const equals = '═'.repeat(state.widenLevel)
    const paddleText = `${equals} BOOK BREAKER ${equals}`
    events.push({ type: 'measurePaddle', paddleText })
    events.push({ type: 'clampPaddle' })
  } else if (pickup.type === 'multiball') {
    // Find a ball to split from — prefer active, fall back to stuck (held on paddle)
    const source = state.balls.find(b => !b.stuck) ?? state.balls.find(b => b.stuck)
    if (source) {
      if (source.stuck) {
        // Ball is held on paddle — spawn extras also stuck, they'll all launch together
        for (let i = 0; i < 2; i++) {
          state.balls.push({
            x: source.x + (i === 0 ? -12 : 12),
            y: source.y,
            vx: 0, vy: 0,
            r: 6,
            trail: [],
            stuck: true,

            backWallHits: 0,
            slamStacks: 0,
            blastCharge: 0,
            pierceLeft: 0,
          })
        }
      } else {
        const speed = Math.sqrt(source.vx * source.vx + source.vy * source.vy)
        const baseAngle = Math.atan2(source.vy, source.vx)
        for (let i = 0; i < 2; i++) {
          const angle = baseAngle + (i === 0 ? -0.5 : 0.5)
          state.balls.push({
            x: source.x,
            y: source.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            r: 6,
            trail: [],
            stuck: false,

            backWallHits: 0,
            slamStacks: 0,
            blastCharge: 0,
            pierceLeft: 0,
          })
        }
      }
    }
  } else if (pickup.type === 'safety') {
    const wasFresh = state.safetyHits === 0
    state.safetyHits = Math.min(9, state.safetyHits + pickup.tier)
    events.push({ type: 'measureSafety' })
    if (wasFresh) {
      // Caller will set safetyX based on the newly measured safetyW
    }
  } else if (pickup.type === 'blast') {
    for (const ball of state.balls) {
      ball.blastCharge = Math.max(ball.blastCharge, pickup.tier)
    }
  } else if (pickup.type === 'freeze') {
    const durations = [0, 4, 6, 9, 13]
    state.freezeTimer += durations[pickup.tier] ?? 4
  } else if (pickup.type === 'piercing') {
    const pierceCounts = [0, 2, 3, 4, 5]
    for (const ball of state.balls) {
      ball.pierceLeft = Math.max(ball.pierceLeft, pierceCounts[pickup.tier] ?? 2)
    }
  }

  return events
}

export function hitBrick(brick: Brick, ball: Ball, state: UpgradeState): void {
  brick.alive = false
  const points = Math.round(brick.points * state.multiplier)
  state.score += points
  state.wordsBroken++
  state.multiplier = Math.min(10.0, state.multiplier + 0.5)
  // Track for level-end animation
  state.levelWords.push({ word: brick.word, color: brick.color, points })

  // Collect letters
  for (const ch of brick.word.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z') {
      state.letterCounts[ch] = (state.letterCounts[ch] || 0) + 1
      const el = document.getElementById(`letter-${ch}`)
      if (el) el.classList.add('collected')
    }
  }

  // Check alphabet completion (all 26 letters collected)
  checkAlphabetBonus(state)

  // Log word
  const entry = document.createElement('div')
  entry.className = 'word-entry'
  entry.innerHTML = `<span class="word">${brick.word}</span><span class="points">+${points}</span>`
  sidebarEls.wordLog.prepend(entry)
  // Keep log short
  while (sidebarEls.wordLog.children.length > 30) {
    sidebarEls.wordLog.lastElementChild?.remove()
  }

  // Spawn letter particles
  for (let i = 0; i < brick.word.length; i++) {
    const ch = brick.word[i]
    const brickScreenY = brick.y - state.bricksScrollY
    state.particles.push({
      x: brick.x + (i / brick.word.length) * brick.w + state.brickPadX,
      y: brickScreenY + brick.h / 2,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.8) * 180,
      char: ch,
      life: 1.2 + Math.random() * 0.5,
      maxLife: 1.7,
      color: brick.color,
      size: state.brickFontSize + 4,
    })
  }

  // Blast: spawn shrapnel projectiles that fly out and break bricks on contact
  if (ball.blastCharge > 0) {
    const bx = brick.x + brick.w / 2
    const bsy = brick.y - state.bricksScrollY + brick.h / 2
    const count = ball.blastCharge + 2  // tier 1→3, 2→4, 3→5, 4→6
    ball.blastCharge = 0
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
      const speed = 250 + Math.random() * 100
      state.shrapnel.push({
        x: bx, y: bsy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.5,
      })
      // Spark particle for visual feedback
      state.particles.push({
        x: bx, y: bsy,
        vx: Math.cos(angle) * speed * 0.5, vy: Math.sin(angle) * speed * 0.5,
        char: '✦', life: 0.4, maxLife: 0.6,
        color: '#ff6040', size: 10 + Math.random() * 6,
      })
    }
  }

  // Roll for upgrade drop
  const tier = colorTier(brick.color)
  if (tier > 0 && Math.random() < dropChance(tier)) {
    const brickScreenY = brick.y - state.bricksScrollY
    const roll = Math.random()
    let type: UpgradeType
    if (roll < 0.22) type = 'widen'
    else if (roll < 0.40) type = 'multiball'
    else if (roll < 0.55) type = 'safety'
    else if (roll < 0.70) type = 'blast'
    else if (roll < 0.85) type = 'freeze'
    else type = 'piercing'
    state.pickups.push({
      label: UPGRADE_LABELS[type],
      x: brick.x + brick.w / 2,
      y: brickScreenY,
      vy: -60,  // float upward toward paddle
      wobblePhase: Math.random() * Math.PI * 2,
      type,
      tier,
      color: brick.color,
      alive: true,
    })
  }
}

export function checkAlphabetBonus(state: UpgradeState): void {
  let complete = true
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i)
    if (!state.letterCounts[ch]) { complete = false; break }
  }
  if (!complete) return

  state.alphabetCompletions++
  state.lives++
  state.score += 5000

  // Clear letter counts and animate the grid
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i)
    state.letterCounts[ch] = 0
    const el = document.getElementById(`letter-${ch}`)
    if (el) {
      el.classList.remove('collected')
      el.classList.add('alphabet-clear')
      setTimeout(() => el.classList.remove('alphabet-clear'), 800)
    }
  }

  // Flash particles from center screen as celebration
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i)
    const angle = (i / 26) * Math.PI * 2
    state.particles.push({
      x: state.W / 2,
      y: state.H / 2,
      vx: Math.cos(angle) * 250,
      vy: Math.sin(angle) * 250,
      char: ch,
      life: 1.5,
      maxLife: 1.5,
      color: '#fbbf24',
      size: 24,
    })
  }
}
