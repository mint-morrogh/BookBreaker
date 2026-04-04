import type { Ball, Brick, Particle } from './types'

// ── Physics state needed from the game ─────────────────────────
export interface PhysicsState {
  paddleX: number
  paddleW: number
  paddleY: number
  paddleH: number
  W: number
  H: number
  safetyX: number
  safetyW: number
  safetyY: number
  safetyH: number
  safetyHits: number
  magnetStrength: number
  ballSpeed: number
  bricksScrollY: number
}

// ── Events emitted by physics ──────────────────────────────────
export type PhysicsEvent =
  | { type: 'brickHit'; brick: Brick; ball: Ball }
  | { type: 'ballLost'; ball: Ball; index: number }
  | { type: 'backWallHit'; ball: Ball; hitCount: number; particle: Particle }
  | { type: 'safetyHit' }

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

    // Magnet: pull ball toward paddle — only when within range
    if (state.magnetStrength > 0) {
      const magnetRange = 200  // only activates within this distance of paddle
      const padCx = state.paddleX + state.paddleW / 2
      const padCy = state.paddleY + state.paddleH / 2
      const mdx = padCx - ball.x
      const mdy = padCy - ball.y
      const mDist = Math.sqrt(mdx * mdx + mdy * mdy)
      if (mDist > 1 && mDist < magnetRange) {
        const falloff = 1 - mDist / magnetRange  // stronger when closer
        ball.vx += (mdx / mDist) * state.magnetStrength * falloff * dt
        ball.vy += (mdy / mDist) * state.magnetStrength * falloff * dt
      }
    }

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
      if (ball.primary) {
        events.push({ type: 'ballLost', ball, index: -1 })
      } else {
        // Secondary ball — just remove it
        const idx = balls.indexOf(ball)
        events.push({ type: 'ballLost', ball, index: idx })
      }
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
