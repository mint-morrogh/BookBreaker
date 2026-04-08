// ── Boss fight — chapter-end boss with orbiting shields, lasers, movement patterns ──

import type { Ball } from './types'

// ── Types ────────────────────────────────────────────────────────

export interface Laser {
  x: number
  y: number
  vy: number        // always negative (moving up toward paddle/backwall)
  trail: { x: number; y: number; alpha: number }[]
  alive: boolean
}

export interface Shield {
  angle: number      // current orbit angle (radians)
  speed: number      // radians/sec (can be negative for reverse)
  radius: number     // orbit distance from boss center
  label: string      // "I" for each numeral
  w: number          // measured width (set at init)
  h: number          // measured height
}

export type MovementPattern = 'sweep' | 'figure8' | 'triangle' | 'circle' | 'drop'

export interface BossState {
  active: boolean
  hp: number
  maxHp: number
  x: number          // center x
  y: number          // center y
  w: number          // measured text width of "CHAPTER"
  h: number          // block height
  chapter: number    // 1-based chapter number (for scaling)

  // Movement
  pattern: MovementPattern
  patternTimer: number       // seconds into current pattern
  patternDuration: number    // how long before switching
  originX: number            // center of movement area
  originY: number            // center of movement area
  transitionTimer: number    // blend timer for smooth pattern transitions
  transitionFromX: number    // position at start of transition
  transitionFromY: number

  // Shields (orbiting Roman numerals)
  shields: Shield[]

  // Lasers
  lasers: Laser[]
  laserTimer: number         // countdown to next laser
  laserCooldown: number      // base seconds between lasers
  burstCount: number         // lasers remaining in current burst (ch3)
  burstCooldown: number      // seconds between burst shots

  // Intro modal
  introActive: boolean
  introTimer: number

  // Death
  dying: boolean
  deathTimer: number

  // Damage flash
  flashTimer: number

  // Fight timer (for score bonus)
  fightTimer: number
}

// ── Constants ────────────────────────────────────────────────────

const BOSS_FONT_SIZE = 29         // ~40% smaller than original 48
const BOSS_FONT = `bold ${BOSS_FONT_SIZE}px 'JetBrains Mono', 'Courier New', monospace`
const SHIELD_FONT_SIZE = 28
const SHIELD_FONT = `bold ${SHIELD_FONT_SIZE}px 'JetBrains Mono', 'Courier New', monospace`
const LASER_SPEED = -220          // px/sec (upward)
const LASER_FONT_SIZE = 20
const BOSS_HP = [0, 10, 20, 30]   // indexed by chapter (1-based)
const BOSS_GOLD = [0, 100, 200, 300]
const PATTERN_DURATION_MIN = 3
const PATTERN_DURATION_MAX = 6
const PATTERNS: MovementPattern[] = ['sweep', 'figure8', 'triangle', 'circle', 'drop']
const SHIELD_ORBIT_RADIUS = 120
const SHIELD_BASE_SPEED = 1.8     // radians/sec

// ── Initialization ───────────────────────────────────────────────

export function createBoss(chapter: number, W: number, H: number, ctx: CanvasRenderingContext2D): BossState {
  const ch = Math.min(chapter, 3)

  // Measure boss block
  ctx.font = BOSS_FONT
  const textMetrics = ctx.measureText('CHAPTER')
  const bossW = textMetrics.width + 40  // padding
  const bossH = BOSS_FONT_SIZE + 24

  // Measure shield "I" width
  ctx.font = SHIELD_FONT
  const shieldMetrics = ctx.measureText('I')
  const shieldW = shieldMetrics.width + 16
  const shieldH = SHIELD_FONT_SIZE + 12

  // Create shields — one per Roman numeral count
  const shields: Shield[] = []
  for (let i = 0; i < ch; i++) {
    const angleSpread = (Math.PI * 2) / ch
    shields.push({
      angle: i * angleSpread,
      speed: SHIELD_BASE_SPEED * (1 + ch * 0.15),  // faster for harder chapters
      radius: SHIELD_ORBIT_RADIUS,
      label: 'I',
      w: shieldW,
      h: shieldH,
    })
  }

  // Laser fire rate: ch1 = every 3s, ch2 = every 1.5s, ch3 = bursts of 3 every 2.5s
  const laserCooldown = ch === 1 ? 3.0 : ch === 2 ? 1.5 : 2.5

  const originX = W / 2
  const originY = H * 0.55  // lower half — boss spawns in the brick area

  return {
    active: false,
    hp: BOSS_HP[ch],
    maxHp: BOSS_HP[ch],
    x: originX,
    y: originY,
    w: bossW,
    h: bossH,
    chapter: ch,
    pattern: 'sweep',
    patternTimer: 0,
    patternDuration: randomPatternDuration(),
    originX,
    originY,
    transitionTimer: 0,
    transitionFromX: originX,
    transitionFromY: originY,
    shields,
    lasers: [],
    laserTimer: 2.0,  // initial delay before first laser
    laserCooldown,
    burstCount: 0,
    burstCooldown: 0.3,  // 300ms between burst shots
    introActive: true,
    introTimer: 0,
    dying: false,
    deathTimer: 0,
    flashTimer: 0,
    fightTimer: 0,
  }
}

function randomPatternDuration(): number {
  return PATTERN_DURATION_MIN + Math.random() * (PATTERN_DURATION_MAX - PATTERN_DURATION_MIN)
}

// ── Update ───────────────────────────────────────────────────────

export type BossEvent =
  | { type: 'laserBlocked'; x: number; y: number }
  | { type: 'laserPassedPaddle'; x: number }
  | { type: 'bossHit'; damage: number; x: number; y: number }
  | { type: 'bossExplode'; x: number; y: number }
  | { type: 'bossDead' }
  | { type: 'shieldHit'; shield: Shield; x: number; y: number }
  | { type: 'safetyHit'; x: number; y: number }

export function updateBoss(
  boss: BossState,
  dt: number,
  balls: Ball[],
  paddleX: number,
  paddleW: number,
  paddleY: number,
  paddleH: number,
  safetyX: number,
  safetyW: number,
  safetyY: number,
  safetyH: number,
  safetyHits: number,
  W: number,
  H: number,
): BossEvent[] {
  if (!boss.active) return []
  const events: BossEvent[] = []

  // Damage flash decay
  if (boss.flashTimer > 0) boss.flashTimer -= dt

  // Fight timer
  boss.fightTimer += dt

  // Death animation
  if (boss.dying) {
    const prevTime = boss.deathTimer
    boss.deathTimer += dt
    // Emit explosion event at 0.5s mark (once)
    if (prevTime < 0.5 && boss.deathTimer >= 0.5) {
      events.push({ type: 'bossExplode', x: boss.x, y: boss.y })
    }
    if (boss.deathTimer > 1.5) {
      events.push({ type: 'bossDead' })
    }
    return events
  }

  // ── Movement ──
  const TRANSITION_DUR = 0.6  // seconds to blend between patterns
  boss.patternTimer += dt
  if (boss.patternTimer >= boss.patternDuration) {
    // Save current position as blend source
    boss.transitionFromX = boss.x
    boss.transitionFromY = boss.y
    boss.transitionTimer = TRANSITION_DUR
    // Switch pattern
    boss.patternTimer = 0
    boss.patternDuration = randomPatternDuration()
    const available = PATTERNS.filter(p => p !== boss.pattern)
    boss.pattern = available[Math.floor(Math.random() * available.length)]
  }

  if (boss.transitionTimer > 0) boss.transitionTimer -= dt

  const t = boss.patternTimer
  const speedMult = 1 + boss.chapter * 0.2  // faster movement per chapter
  applyMovement(boss, t, speedMult, W, H)

  // Smooth blend from old position to new pattern position
  if (boss.transitionTimer > 0) {
    const blend = boss.transitionTimer / TRANSITION_DUR  // 1→0
    const ease = blend * blend  // ease-out (fast start, slow end)
    boss.x = boss.x + (boss.transitionFromX - boss.x) * ease
    boss.y = boss.y + (boss.transitionFromY - boss.y) * ease
  }

  // Clamp to bounds
  const margin = boss.w / 2 + 20
  boss.x = Math.max(margin, Math.min(W - margin, boss.x))
  boss.y = Math.max(H * 0.3, Math.min(H * 0.75, boss.y))

  // ── Shield orbits ──
  for (const shield of boss.shields) {
    shield.angle += shield.speed * dt
  }

  // ── Laser firing ──
  boss.laserTimer -= dt
  if (boss.chapter >= 3 && boss.burstCount > 0) {
    // Burst mode (ch3)
    boss.burstCooldown -= dt
    if (boss.burstCooldown <= 0) {
      spawnLaser(boss)
      boss.burstCount--
      boss.burstCooldown = 0.3
      if (boss.burstCount <= 0) {
        boss.laserTimer = boss.laserCooldown
      }
    }
  } else if (boss.laserTimer <= 0) {
    if (boss.chapter >= 3) {
      // Start burst of 3
      boss.burstCount = 3
      boss.burstCooldown = 0
    } else {
      spawnLaser(boss)
      boss.laserTimer = boss.laserCooldown
    }
  }

  // ── Update lasers ──
  for (const laser of boss.lasers) {
    if (!laser.alive) continue

    // Trail
    laser.trail.push({ x: laser.x, y: laser.y, alpha: 1.0 })
    if (laser.trail.length > 8) laser.trail.shift()
    for (const t of laser.trail) t.alpha *= 0.85

    laser.y += laser.vy * dt

    // Paddle collision — pure defense, laser pops
    if (
      laser.y - 10 <= paddleY + paddleH &&
      laser.y + 10 >= paddleY &&
      laser.x >= paddleX &&
      laser.x <= paddleX + paddleW
    ) {
      laser.alive = false
      events.push({ type: 'laserBlocked', x: laser.x, y: paddleY })
      continue
    }

    // Safety bar collision
    if (
      safetyHits > 0 &&
      laser.y - 10 <= safetyY + safetyH &&
      laser.y + 10 >= safetyY &&
      laser.x >= safetyX &&
      laser.x <= safetyX + safetyW
    ) {
      laser.alive = false
      events.push({ type: 'safetyHit', x: laser.x, y: safetyY })
      continue
    }

    // Passed paddle — hit backwall (off top of screen)
    if (laser.y < -20) {
      laser.alive = false
      events.push({ type: 'laserPassedPaddle', x: laser.x })
    }
  }

  // Remove dead lasers
  boss.lasers = boss.lasers.filter(l => l.alive)

  // ── Ball-boss collision ──
  for (const ball of balls) {
    if (ball.stuck) continue
    if (ball.bossImmunity > 0) { ball.bossImmunity -= dt; continue }

    // Check shield collision first
    let shieldBlocked = false
    for (const shield of boss.shields) {
      const sx = boss.x + Math.cos(shield.angle) * shield.radius
      const sy = boss.y + Math.sin(shield.angle) * shield.radius
      if (
        ball.x + ball.r > sx - shield.w / 2 &&
        ball.x - ball.r < sx + shield.w / 2 &&
        ball.y + ball.r > sy - shield.h / 2 &&
        ball.y - ball.r < sy + shield.h / 2
      ) {
        // Ghost phases through shields
        if (ball.ghostLeft > 0) {
          ball.ghostLeft--
          if (ball.ghostLeft <= 0) ball.ghostPhasedBricks.clear()
          continue
        }
        // Pierce goes through shields
        if (ball.pierceLeft > 0) {
          ball.pierceLeft--
          events.push({ type: 'shieldHit', shield, x: sx, y: sy })
          continue  // pierced through — keep checking boss
        }
        // Normal bounce off shield
        shieldBlocked = true
        events.push({ type: 'shieldHit', shield, x: sx, y: sy })
        // Bounce ball away from shield center
        const dx = ball.x - sx
        const dy = ball.y - sy
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
        ball.vx = (dx / dist) * speed
        ball.vy = (dy / dist) * speed
        // Push ball out of shield
        ball.x = sx + (dx / dist) * (shield.w / 2 + ball.r + 1)
        ball.y = sy + (dy / dist) * (shield.h / 2 + ball.r + 1)
        break
      }
    }
    if (shieldBlocked) continue

    // Check boss body collision
    const bx = boss.x - boss.w / 2
    const by = boss.y - boss.h / 2
    if (
      ball.x + ball.r > bx &&
      ball.x - ball.r < bx + boss.w &&
      ball.y + ball.r > by &&
      ball.y - ball.r < by + boss.h
    ) {
      // Calculate damage: 1 base + 1 if pierce + 1 if blast, scaled by ball size
      let damage = 1
      if (ball.pierceLeft > 0) {
        damage += 1
        ball.pierceLeft = 0  // consumed on boss hit
      }
      if (ball.blastCharge > 0) {
        damage += 1
        ball.blastCharge = 0  // consumed on boss hit
      }
      // Big ball bonus: scale damage by ball size (base radius 5.6 = 1x)
      const sizeMult = Math.max(1, ball.r / 5.6)
      damage = Math.round(damage * sizeMult)

      boss.hp = Math.max(0, boss.hp - damage)
      boss.flashTimer = 0.15
      ball.bossImmunity = 0.15  // prevent multi-hit from same ball
      events.push({ type: 'bossHit', damage, x: ball.x, y: ball.y })

      // Consume homing charge on boss hit
      if (ball.homingLeft > 0) {
        ball.homingLeft--
        if (ball.homingLeft > 0) ball.homingCooldown = 0.25
      }

      // Bounce ball off boss and push it outside the hitbox to prevent multi-hit
      const overlapLeft = (ball.x + ball.r) - bx
      const overlapRight = (bx + boss.w) - (ball.x - ball.r)
      const overlapTop = (ball.y + ball.r) - by
      const overlapBottom = (by + boss.h) - (ball.y - ball.r)
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom)
      if (minOverlap === overlapTop || minOverlap === overlapBottom) {
        ball.vy = -ball.vy
        if (minOverlap === overlapTop) ball.y = by - ball.r
        else ball.y = by + boss.h + ball.r
      } else {
        ball.vx = -ball.vx
        if (minOverlap === overlapLeft) ball.x = bx - ball.r
        else ball.x = bx + boss.w + ball.r
      }

      if (boss.hp <= 0) {
        boss.dying = true
        boss.deathTimer = 0
      }
    }
  }

  return events
}

// ── Movement patterns ────────────────────────────────────────────

function applyMovement(boss: BossState, t: number, speedMult: number, W: number, H: number) {
  const cx = boss.originX
  const cy = boss.originY
  const ampX = W * 0.3
  const ampY = H * 0.1

  switch (boss.pattern) {
    case 'sweep':
      // Horizontal sweep
      boss.x = cx + Math.sin(t * 0.8 * speedMult) * ampX
      boss.y = cy + Math.sin(t * 0.3 * speedMult) * ampY * 0.3
      break
    case 'figure8':
      // Lemniscate (figure-eight)
      boss.x = cx + Math.sin(t * 0.6 * speedMult) * ampX
      boss.y = cy + Math.sin(t * 1.2 * speedMult) * ampY
      break
    case 'triangle': {
      // Triangle path — three vertices, linear interpolation
      const period = 4 / speedMult
      const phase = (t % period) / period
      const v0 = { x: cx, y: cy - ampY }
      const v1 = { x: cx - ampX * 0.6, y: cy + ampY }
      const v2 = { x: cx + ampX * 0.6, y: cy + ampY }
      if (phase < 1 / 3) {
        const p = phase * 3
        boss.x = v0.x + (v1.x - v0.x) * p
        boss.y = v0.y + (v1.y - v0.y) * p
      } else if (phase < 2 / 3) {
        const p = (phase - 1 / 3) * 3
        boss.x = v1.x + (v2.x - v1.x) * p
        boss.y = v1.y + (v2.y - v1.y) * p
      } else {
        const p = (phase - 2 / 3) * 3
        boss.x = v2.x + (v0.x - v2.x) * p
        boss.y = v2.y + (v0.y - v2.y) * p
      }
      break
    }
    case 'circle':
      boss.x = cx + Math.cos(t * 0.7 * speedMult) * ampX * 0.7
      boss.y = cy + Math.sin(t * 0.7 * speedMult) * ampY
      break
    case 'drop':
      // Quick drop then float back up
      boss.x = cx + Math.sin(t * 0.5 * speedMult) * ampX * 0.4
      boss.y = cy + Math.abs(Math.sin(t * 0.4 * speedMult)) * ampY * 1.5
      break
  }
}

function spawnLaser(boss: BossState) {
  boss.lasers.push({
    x: boss.x,
    y: boss.y - boss.h / 2 - 5,
    vy: LASER_SPEED,
    trail: [],
    alive: true,
  })
}

// ── Rendering ────────────────────────────────────────────────────

export interface BossRenderState {
  boss: BossState
  isMobile: boolean
  W: number
  H: number
}

export function renderBoss(ctx: CanvasRenderingContext2D, state: BossRenderState) {
  const { boss, isMobile } = state
  const blur = isMobile ? 0.35 : 1

  if (boss.introActive) {
    renderBossIntro(ctx, boss, state.W, state.H, isMobile)
    return
  }

  if (!boss.active && !boss.dying) return

  // Death animation — boss swells then pops at 0.5s, body disappears after
  if (boss.dying) {
    if (boss.deathTimer < 0.5) {
      // Swell phase — block inflates and shakes before breaking
      const t = boss.deathTimer / 0.5  // 0→1 over 0.5s
      const scale = 1 + t * 0.4  // grows to 1.4x
      const shake = Math.sin(boss.deathTimer * 60) * t * 3
      ctx.globalAlpha = 1
      ctx.save()
      ctx.translate(boss.x + shake, boss.y)
      ctx.scale(scale, scale)
      ctx.translate(-boss.x, -boss.y)
      renderBossBody(ctx, boss, blur)
      ctx.restore()
      ctx.globalAlpha = 1
    }
    // After 0.5s: body is gone, only particles remain (spawned by game.ts)
    return
  }

  // ── Lasers (draw behind boss) — pointed projectiles ──
  for (const laser of boss.lasers) {
    if (!laser.alive) continue
    const lx = laser.x
    const ly = laser.y
    const tipW = 4   // half-width at the pointed tip
    const bodyW = 3  // half-width of the body
    const tipLen = 14 // length of the arrowhead
    const bodyLen = 22 // length of the tapered body

    // Trail — fading copies behind
    for (const tp of laser.trail) {
      ctx.globalAlpha = tp.alpha * 0.3
      ctx.fillStyle = '#f87171'
      ctx.beginPath()
      ctx.moveTo(tp.x, tp.y - tipLen)       // tip
      ctx.lineTo(tp.x - tipW, tp.y)         // left shoulder
      ctx.lineTo(tp.x - bodyW, tp.y + bodyLen) // left tail
      ctx.lineTo(tp.x + bodyW, tp.y + bodyLen) // right tail
      ctx.lineTo(tp.x + tipW, tp.y)         // right shoulder
      ctx.closePath()
      ctx.fill()
    }

    // Outer glow
    ctx.globalAlpha = 0.4
    ctx.fillStyle = '#ff6666'
    ctx.shadowColor = '#ff4444'
    ctx.shadowBlur = 24 * blur
    ctx.beginPath()
    ctx.moveTo(lx, ly - tipLen - 2)
    ctx.lineTo(lx - tipW - 2, ly)
    ctx.lineTo(lx - bodyW - 1, ly + bodyLen + 2)
    ctx.lineTo(lx + bodyW + 1, ly + bodyLen + 2)
    ctx.lineTo(lx + tipW + 2, ly)
    ctx.closePath()
    ctx.fill()

    // Bright core
    ctx.globalAlpha = 1
    ctx.fillStyle = '#ff4444'
    ctx.shadowBlur = 14 * blur
    ctx.beginPath()
    ctx.moveTo(lx, ly - tipLen)          // sharp tip
    ctx.lineTo(lx - tipW, ly)            // left shoulder
    ctx.lineTo(lx - bodyW, ly + bodyLen) // left tail (tapers in)
    ctx.lineTo(lx + bodyW, ly + bodyLen) // right tail
    ctx.lineTo(lx + tipW, ly)            // right shoulder
    ctx.closePath()
    ctx.fill()

    // White-hot center line
    ctx.globalAlpha = 0.6
    ctx.strokeStyle = '#ffaaaa'
    ctx.lineWidth = 1.5
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.moveTo(lx, ly - tipLen + 2)
    ctx.lineTo(lx, ly + bodyLen - 4)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  }
  ctx.globalAlpha = 1

  // ── Shields (orbiting Roman numerals) ──
  for (const shield of boss.shields) {
    const sx = boss.x + Math.cos(shield.angle) * shield.radius
    const sy = boss.y + Math.sin(shield.angle) * shield.radius

    // Shield body
    ctx.fillStyle = '#1a1520'
    ctx.strokeStyle = '#c084fc'
    ctx.lineWidth = 2
    ctx.shadowColor = '#c084fc'
    ctx.shadowBlur = 10 * blur
    roundRectBoss(ctx, sx - shield.w / 2, sy - shield.h / 2, shield.w, shield.h, 4)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    // Shield text
    ctx.fillStyle = '#c084fc'
    ctx.font = SHIELD_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(shield.label, sx, sy + 1)
  }

  // ── Boss body ──
  renderBossBody(ctx, boss, blur)
}

function renderBossBody(ctx: CanvasRenderingContext2D, boss: BossState, blur: number) {
  const bx = boss.x - boss.w / 2
  const by = boss.y - boss.h / 2

  // Damage flash
  const isFlashing = boss.flashTimer > 0

  // Boss block background
  ctx.fillStyle = '#0f0808'
  ctx.strokeStyle = isFlashing ? '#ffffff' : '#f87171'
  ctx.lineWidth = 2.5
  ctx.shadowColor = '#f87171'
  ctx.shadowBlur = 20 * blur
  roundRectBoss(ctx, bx, by, boss.w, boss.h, 6)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0

  // Health fill — red bar that drains from right to left
  if (boss.hp > 0) {
    ctx.save()
    roundRectBoss(ctx, bx, by, boss.w, boss.h, 6)
    ctx.clip()
    const fillPct = boss.hp / boss.maxHp
    ctx.fillStyle = isFlashing ? 'rgba(255, 255, 255, 0.4)' : 'rgba(248, 113, 113, 0.35)'
    ctx.fillRect(bx, by, boss.w * fillPct, boss.h)
    ctx.restore()
  }

  // Boss text
  ctx.fillStyle = isFlashing ? '#ffffff' : '#f87171'
  ctx.font = BOSS_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('CHAPTER', boss.x, boss.y + 2)

  // HP counter
  ctx.fillStyle = '#5a6578'
  ctx.font = `bold 14px 'JetBrains Mono', monospace`
  ctx.fillText(`${boss.hp} / ${boss.maxHp}`, boss.x, boss.y + boss.h / 2 + 16)
}

function renderBossIntro(ctx: CanvasRenderingContext2D, boss: BossState, W: number, H: number, isMobile: boolean) {
  const blur = isMobile ? 0.35 : 1

  // Dark backdrop
  ctx.fillStyle = 'rgba(6, 8, 12, 0.88)'
  ctx.fillRect(0, 0, W, H)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Chapter complete text
  ctx.fillStyle = '#e8c44a'
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 18 * blur
  ctx.font = `bold 28px 'JetBrains Mono', monospace`
  ctx.fillText(`CHAPTER ${toRoman(boss.chapter)} COMPLETE`, W / 2, H * 0.38)
  ctx.shadowBlur = 0

  // Boss fight imminent
  ctx.fillStyle = '#f87171'
  ctx.shadowColor = '#f87171'
  ctx.shadowBlur = 12 * blur
  ctx.font = `bold 22px 'JetBrains Mono', monospace`
  ctx.fillText('BOSS FIGHT IMMINENT', W / 2, H * 0.48)
  ctx.shadowBlur = 0

  // Boss HP preview
  ctx.fillStyle = '#5a6578'
  ctx.font = `14px 'JetBrains Mono', monospace`
  ctx.fillText(`HP: ${boss.maxHp}  ·  SHIELDS: ${boss.shields.length}`, W / 2, H * 0.55)

  // Prompt
  const action = isMobile ? 'TAP' : 'CLICK or SPACE'
  ctx.fillStyle = '#7dd3fc'
  ctx.font = `bold 14px 'JetBrains Mono', monospace`
  ctx.fillText(`[ ${action} to begin ]`, W / 2, H * 0.65)
}

// ── Helpers ──────────────────────────────────────────────────────

function toRoman(n: number): string {
  if (n === 1) return 'I'
  if (n === 2) return 'II'
  if (n === 3) return 'III'
  if (n === 4) return 'IV'
  if (n === 5) return 'V'
  return String(n)
}

function roundRectBoss(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Gold reward for beating a chapter boss */
export function bossGoldReward(chapter: number): number {
  return BOSS_GOLD[Math.min(chapter, 3)]
}

/** Time-based score bonus — fast kills get massive points, slow kills floor at 1000 */
export function bossScoreBonus(fightTime: number): number {
  const MAX_BONUS = 50000
  const MIN_BONUS = 1000
  // Exponential decay: full bonus at ≤10s, halves every ~7s, floors at 1000
  if (fightTime <= 10) return MAX_BONUS
  const decay = Math.exp(-(fightTime - 10) / 7)
  return Math.max(MIN_BONUS, Math.round(MAX_BONUS * decay))
}
