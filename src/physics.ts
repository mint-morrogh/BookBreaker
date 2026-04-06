import type { Ball, Brick, Particle } from './types'

// ── Physics state needed from the game ─────────────────────────
export interface PhysicsState {
  paddleX: number
  paddleW: number
  paddleY: number
  paddleH: number
  paddleBaseY: number
  paddleExtentMax: number  // how far paddle can extend below base (55)
  W: number
  H: number
  safetyX: number
  safetyW: number
  safetyY: number
  safetyH: number
  safetyHits: number
  paddleVy: number
  slamWallTimer: number  // how long paddle has been sitting at max extension
  ballSpeed: number
  bricksScrollY: number
}

// ── Events emitted by physics ──────────────────────────────────
export type PhysicsEvent =
  | { type: 'brickHit'; brick: Brick; ball: Ball }
  | { type: 'ballLost'; ball: Ball; index: number }
  | { type: 'backWallHit'; ball: Ball; hitCount: number; particle: Particle }
  | { type: 'safetyHit' }
  | { type: 'paddleSlam'; ball: Ball; tier: number }

export function updateBalls(
  balls: Ball[],
  bricks: Brick[],
  dt: number,
  state: PhysicsState,
): PhysicsEvent[] {
  const events: PhysicsEvent[] = []

  for (const ball of balls) {
    if (ball.stuck) {
      ball.x = state.paddleX + state.paddleW / 2
      ball.y = state.paddleY + state.paddleH + ball.r + 2
      continue
    }

    // Trail — record by distance so it stays tight at any speed
    const lastT = ball.trail.length > 0 ? ball.trail[ball.trail.length - 1] : null
    if (!lastT || (ball.x - lastT.x) ** 2 + (ball.y - lastT.y) ** 2 > 36) {
      ball.trail.push({ x: ball.x, y: ball.y, age: 0 })
    }
    if (ball.trail.length > 16) ball.trail.shift()
    for (const t of ball.trail) t.age += dt

    ball.x += ball.vx * dt
    ball.y += ball.vy * dt

    // Wall bounce
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) }
    if (ball.x + ball.r > state.W) { ball.x = state.W - ball.r; ball.vx = -Math.abs(ball.vx) }

    // Bounce off bottom (back wall) — speed boost!
    if (ball.y + ball.r > state.H) {
      ball.y = state.H - ball.r
      ball.vy = -Math.abs(ball.vy)
      if (ball.backWallHits < 10) {
        ball.backWallHits++
        // 1.1x speed boost per hit
        ball.vx *= 1.1
        ball.vy *= 1.1
        // Popup text
        const msgs = ['BACK WALL!', 'SPEED UP!', 'DANGER ZONE!', 'RISKY!', 'BLAZING!',
          'ON FIRE!', 'UNSTOPPABLE!', 'LUDICROUS!', 'MAXIMUM!', 'OVERDRIVE!']
        events.push({
          type: 'backWallHit',
          ball,
          hitCount: ball.backWallHits,
          particle: {
            x: ball.x, y: state.H - 20,
            vx: 0, vy: -80,
            char: msgs[ball.backWallHits - 1],
            life: 1.5, maxLife: 1.5,
            color: '#f87171',
            size: 16,
          },
        })
      }
    }

    // Safety bar collision (above paddle)
    if (
      state.safetyHits > 0 &&
      ball.vy < 0 &&
      ball.y - ball.r <= state.safetyY + state.safetyH &&
      ball.y + ball.r >= state.safetyY &&
      ball.x >= state.safetyX &&
      ball.x <= state.safetyX + state.safetyW
    ) {
      ball.y = state.safetyY + state.safetyH + ball.r
      ball.vy = Math.abs(ball.vy)
      events.push({ type: 'safetyHit' })
    }

    // Ball lost off top
    if (ball.y + ball.r < 0) {
      const idx = balls.indexOf(ball)
      events.push({ type: 'ballLost', ball, index: idx })
      continue  // skip further collision checks for this ball
    }

    // Paddle collision (paddle is near top)
    if (
      ball.vy < 0 &&
      ball.y - ball.r <= state.paddleY + state.paddleH &&
      ball.y + ball.r >= state.paddleY &&
      ball.x >= state.paddleX &&
      ball.x <= state.paddleX + state.paddleW
    ) {
      ball.y = state.paddleY + state.paddleH + ball.r
      // Shed one back-wall speed stack on each paddle hit
      if (ball.backWallHits > 0) {
        ball.backWallHits--
        ball.vx /= 1.1
        ball.vy /= 1.1
      }
      // Angle based on where it hit the paddle
      const hitPos = (ball.x - state.paddleX) / state.paddleW // 0..1
      const angle = Math.PI * 0.15 + hitPos * Math.PI * 0.7 // spread downward
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
      ball.vx = Math.cos(angle) * speed
      ball.vy = Math.sin(angle) * speed  // positive = downward

      // Slam detection — timing-based: rewards pressing right as ball arrives.
      // If paddle is mid-travel, use distance from max extension.
      // If paddle is at the wall, degrade quality based on how long it's been sitting there.
      const maxY = state.paddleBaseY + state.paddleExtentMax
      const distFromMax = maxY - state.paddleY  // 0 = fully extended, 55 = at rest

      if (distFromMax < 18) {
        let slamTier: number
        if (distFromMax >= 2) {
          // Paddle is still in transit — use positional tiers (already requires good timing)
          if (distFromMax < 4) {
            slamTier = 3  // PERFECT — about to hit the wall
          } else if (distFromMax < 10) {
            slamTier = 2  // GREAT — close
          } else {
            slamTier = 1  // GOOD — decent
          }
        } else {
          // Paddle is AT the wall — use time-at-wall to determine quality.
          // Just arrived = rewarded, camping = no bonus.
          const t = state.slamWallTimer
          if (t < 0.06) {
            slamTier = 3  // PERFECT — ball hit within 60ms of arriving at wall
          } else if (t < 0.15) {
            slamTier = 2  // GREAT — within 150ms
          } else if (t < 0.30) {
            slamTier = 1  // GOOD — within 300ms
          } else {
            slamTier = 0  // Camping — no slam bonus
          }
        }

        if (slamTier > 0) {
          ball.pierceLeft = slamTier

          // Slam speed boost — 1.1x per tier, symmetrical with decay
          const newStacks = Math.min(10, ball.slamStacks + slamTier)
          const stacksAdded = newStacks - ball.slamStacks
          ball.slamStacks = newStacks
          for (let s = 0; s < stacksAdded; s++) {
            ball.vx *= 1.1
            ball.vy *= 1.1
          }
          events.push({ type: 'paddleSlam', ball, tier: slamTier })
        } else {
          // Camping at wall — treat like a normal paddle hit, shed a stack
          if (ball.slamStacks > 0) {
            ball.slamStacks--
            ball.vx /= 1.1
            ball.vy /= 1.1
          }
        }
      } else {
        // Non-slam paddle hit: shed one slam speed stack (decays like backwall)
        if (ball.slamStacks > 0) {
          ball.slamStacks--
          ball.vx /= 1.1
          ball.vy /= 1.1
        }
      }
      // Normal hit without slam: keep existing pierce charges (don't reset)
    }

    // Brick collision
    let bounced = false
    for (const brick of bricks) {
      if (!brick.alive) continue
      const by = brick.y - state.bricksScrollY
      if (
        ball.x + ball.r > brick.x &&
        ball.x - ball.r < brick.x + brick.w &&
        ball.y + ball.r > by &&
        ball.y - ball.r < by + brick.h
      ) {
        events.push({ type: 'brickHit', brick, ball })

        if (ball.pierceLeft > 0) {
          ball.pierceLeft--
          continue  // pierce through, check more bricks
        }

        if (!bounced) {
          const overlapLeft = (ball.x + ball.r) - brick.x
          const overlapRight = (brick.x + brick.w) - (ball.x - ball.r)
          const overlapTop = (ball.y + ball.r) - by
          const overlapBottom = (by + brick.h) - (ball.y - ball.r)
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom)
          if (minOverlap === overlapTop || minOverlap === overlapBottom) {
            ball.vy = -ball.vy
          } else {
            ball.vx = -ball.vx
          }
          bounced = true
        }
        break
      }
    }
  }

  return events
}
