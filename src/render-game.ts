import type { Ball, Brick, Particle, Pickup, Dot, Shrapnel } from './types'
import { DOT_COLORS, BALL_COLORS, TRAIL_COLORS } from './colors'
import { roundRect } from './renderer'

// ── State needed for the main game render pass ─────────────────
export interface RenderState {
  dots: Dot[]
  bricks: Brick[]
  brickFont: string
  bricksScrollY: number
  pickups: Pickup[]
  particles: Particle[]
  shrapnel: Shrapnel[]
  paddleX: number
  paddleW: number
  paddleH: number
  paddleY: number
  paddleText: string
  safetyHits: number
  safetyLabel: string
  safetyX: number
  safetyY: number
  safetyW: number
  safetyH: number
  balls: Ball[]
  freezeTimer: number
  charge: number
  started: boolean
  hasLaunched: boolean
  hasRecalled: boolean
  isMobile: boolean
  levelState: string
}

export function renderGame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  state: RenderState,
): void {
  // Dot field background — batch resting dots into single path
  ctx.globalAlpha = 0.45
  ctx.fillStyle = DOT_COLORS[0]
  ctx.beginPath()
  for (const dot of state.dots) {
    const ddx = dot.x - dot.homeX
    const ddy = dot.y - dot.homeY
    if (ddx * ddx + ddy * ddy < 4) {
      ctx.moveTo(dot.x + 1.6, dot.y)
      ctx.arc(dot.x, dot.y, 1.6, 0, Math.PI * 2)
    }
  }
  ctx.fill()
  // Displaced dots — drawn individually (only a few per frame)
  for (const dot of state.dots) {
    const ddx = dot.x - dot.homeX
    const ddy = dot.y - dot.homeY
    const dispSq = ddx * ddx + ddy * ddy
    if (dispSq >= 4) {
      const disp = Math.sqrt(dispSq)
      const t = Math.min(1, disp / 20)
      ctx.globalAlpha = 0.45 + t * 0.03
      ctx.fillStyle = DOT_COLORS[Math.min(5, Math.floor(t * 6))]
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, 1.6 + t * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1

  // Gold charge aura — nearby dots glow gold when charge is full
  if (state.charge >= 1.0) {
    const padCx = state.paddleX + state.paddleW / 2
    const padCy = state.paddleY + state.paddleH / 2
    ctx.fillStyle = '#fbbf24'
    for (const dot of state.dots) {
      const ddx = dot.x - padCx
      const ddy = dot.y - padCy
      const distSq = ddx * ddx + ddy * ddy
      if (distSq < 6400) {
        const t = 1 - Math.sqrt(distSq) / 80
        ctx.globalAlpha = t * 0.6
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  // Bricks — translate context for smooth sub-pixel scrolling
  ctx.font = state.brickFont
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.translate(0, -state.bricksScrollY)
  for (const brick of state.bricks) {
    if (brick.alpha <= 0) continue
    const screenY = brick.y - state.bricksScrollY
    if (screenY > H + 50 || screenY + brick.h < -50) continue

    ctx.globalAlpha = brick.alpha

    // Break-off bricks rotate as rigid body around their center
    const rotating = brick.breakOff > 0 && brick.breakOffAngle !== 0
    if (rotating) {
      ctx.save()
      const bcx = brick.x + brick.w / 2
      const bcy = brick.y + brick.h / 2
      ctx.translate(bcx, bcy)
      ctx.rotate(brick.breakOffAngle)
      ctx.translate(-bcx, -bcy)
    }

    if (brick.boxed) {
      ctx.fillStyle = '#0f1520'
      ctx.strokeStyle = brick.color
      ctx.lineWidth = brick.breakOff > 0 ? 2 : 1
      roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
      ctx.fill()
      ctx.stroke()
    }

    // Word text — drawn at world Y, translate handles the scroll
    ctx.fillStyle = brick.color
    ctx.textAlign = 'center'
    ctx.fillText(brick.word, brick.x + brick.w / 2, brick.y + brick.h / 2 + 1)

    if (rotating) ctx.restore()

    ctx.globalAlpha = 1
  }
  ctx.restore()

  // Pickups — wobbling upgrade labels
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const p of state.pickups) {
    const wobbleX = Math.sin(p.wobblePhase) * 8
    ctx.globalAlpha = 0.95
    ctx.shadowColor = p.color
    ctx.shadowBlur = 14
    ctx.fillStyle = p.color
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.fillText(p.label, p.x + wobbleX, p.y)
    ctx.shadowBlur = 0
  }
  ctx.globalAlpha = 1

  // Particles — skip shadowBlur entirely on mobile (100+ blur passes kills GPU)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const p of state.particles) {
    const lifeRatio = p.life / p.maxLife
    ctx.globalAlpha = lifeRatio
    ctx.fillStyle = p.color
    ctx.font = `bold ${p.size * (0.5 + lifeRatio * 0.5)}px 'JetBrains Mono', monospace`
    if (!state.isMobile) {
      ctx.shadowColor = p.color
      ctx.shadowBlur = 12 * lifeRatio
    }
    ctx.fillText(p.char, p.x, p.y)
    if (!state.isMobile) ctx.shadowBlur = 0
  }
  ctx.globalAlpha = 1

  // Shrapnel — small bright projectiles
  for (const s of state.shrapnel) {
    ctx.fillStyle = '#ff6040'
    ctx.shadowColor = '#ff6040'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // Paddle
  {
    const x = state.paddleX
    const y = state.paddleY
    const w = state.paddleW
    const h = state.paddleH
    const charged = state.charge >= 1.0

    // Paddle glow — brighter when fully charged
    ctx.shadowColor = charged ? '#fbbf24' : '#e8c44a'
    ctx.shadowBlur = charged ? 35 : 20

    // Paddle body — clean box
    ctx.fillStyle = '#1a1810'
    ctx.strokeStyle = charged ? '#fbbf24' : '#e8c44a'
    ctx.lineWidth = 2
    roundRect(ctx, x, y, w, h, 3)
    ctx.fill()
    ctx.stroke()

    // Charge fill overlay
    if (state.charge > 0) {
      ctx.save()
      roundRect(ctx, x, y, w, h, 3)
      ctx.clip()
      const fillW = w * state.charge
      ctx.fillStyle = charged ? '#fbbf24' : `rgba(232, 196, 74, ${0.15 + state.charge * 0.35})`
      ctx.fillRect(x, y, fillW, h)
      ctx.restore()
    }

    ctx.shadowBlur = 0

    // Paddle text — title centered in box (dark when fully charged for contrast)
    ctx.fillStyle = charged ? '#1a1810' : '#e8c44a'
    ctx.font = `bold ${h - 5}px 'JetBrains Mono', 'Courier New', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.paddleText, x + w / 2, y + h / 2 + 1)
  }

  // Safety bar — equals scale with hits, box around it
  if (state.safetyHits > 0 && state.safetyLabel) {
    const sx = state.safetyX
    const sy = state.safetyY
    const sw = state.safetyW
    const sh = state.safetyH

    // Box
    ctx.fillStyle = '#1a0f0f'
    ctx.strokeStyle = '#f87171'
    ctx.lineWidth = 1.5
    ctx.shadowColor = '#f87171'
    ctx.shadowBlur = 10
    roundRect(ctx, sx, sy, sw, sh, 3)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    // Label
    ctx.fillStyle = '#f87171'
    ctx.font = `bold ${sh - 5}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.safetyLabel, sx + sw / 2, sy + sh / 2 + 1)
  }

  // Top wall glow (blue — penalty line)
  const topGrad = ctx.createLinearGradient(0, 0, 0, 8)
  topGrad.addColorStop(0, 'rgba(96, 165, 250, 0.3)')
  topGrad.addColorStop(1, 'rgba(96, 165, 250, 0)')
  ctx.fillStyle = topGrad
  ctx.fillRect(0, 0, W, 8)

  // Back wall glow (bottom edge — red)
  const wallGrad = ctx.createLinearGradient(0, H - 8, 0, H)
  wallGrad.addColorStop(0, 'rgba(248, 113, 113, 0)')
  wallGrad.addColorStop(1, 'rgba(248, 113, 113, 0.3)')
  ctx.fillStyle = wallGrad
  ctx.fillRect(0, H - 8, W, 8)

  for (const ball of state.balls) {
    // Combined speed intensity from backwall hits + slam stacks
    const intensity = Math.min(ball.backWallHits + ball.slamStacks, 10)
    const ballColor = BALL_COLORS[intensity]
    const trailColor = TRAIL_COLORS[intensity]

    // Trail — gets brighter with speed stacks
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i]
      const a = (1 - i / ball.trail.length) * (0.4 + intensity * 0.03)
      ctx.globalAlpha = a
      ctx.fillStyle = trailColor
      ctx.beginPath()
      ctx.arc(t.x, t.y, ball.r * (0.3 + 0.7 * (i / ball.trail.length)), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // Ball body
    ctx.fillStyle = ballColor
    ctx.shadowColor = ballColor
    ctx.shadowBlur = 15 + intensity * 3
    ctx.font = `bold ${ball.r * 2.5}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('●', ball.x, ball.y)
    ctx.shadowBlur = 0

    // Blast charge indicator — pulsing orange ring
    if (ball.blastCharge > 0) {
      ctx.strokeStyle = '#ff6040'
      ctx.lineWidth = 2
      ctx.shadowColor = '#ff6040'
      ctx.shadowBlur = 10
      const pulseR = ball.r + 4 + Math.sin(Date.now() / 100) * 2
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, pulseR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // Piercing indicator — color shifts green → orange → red as pierce stacks
    if (ball.pierceLeft > 0) {
      const p = ball.pierceLeft
      const pierceColor = p >= 5 ? '#f87171' : p >= 4 ? '#f97316' : p >= 3 ? '#fbbf24' : p >= 2 ? '#a3e635' : '#4ade80'
      ctx.fillStyle = pierceColor
      ctx.shadowColor = pierceColor
      ctx.shadowBlur = 6
      ctx.font = `bold 10px 'JetBrains Mono', monospace`
      ctx.fillText(`▶${ball.pierceLeft}`, ball.x + ball.r + 6, ball.y)
      ctx.shadowBlur = 0
    }
  }

  // Active upgrade status indicators (top-left)
  {
    let statusY = H - 20
    ctx.font = `bold 11px 'JetBrains Mono', monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    if (state.freezeTimer > 0) {
      ctx.fillStyle = '#7dd3fc'
      ctx.shadowColor = '#7dd3fc'
      ctx.shadowBlur = 6
      ctx.fillText(`FREEZE ${state.freezeTimer.toFixed(1)}s`, 10, statusY)
      ctx.shadowBlur = 0
      statusY -= 16
    }
  }

  // Launch hint — only shown until first launch
  if (!state.started && !state.hasLaunched && state.levelState === 'playing') {
    ctx.fillStyle = '#4a5568'
    ctx.font = `14px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.isMobile ? '[ HOLD to move · TAP to launch ]' : '[ CLICK or SPACE to launch ]', W / 2, state.paddleY + 60)
  }

  // Charge recall hint — only shown until first recall
  if (state.charge >= 1.0 && state.started && !state.hasRecalled && state.levelState === 'playing') {
    ctx.fillStyle = '#fbbf24'
    ctx.shadowColor = '#fbbf24'
    ctx.shadowBlur = 8
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.isMobile ? '[ TAP RECALL button ]' : '[ RIGHT CLICK to recall ball ]', W / 2, state.paddleY + 60)
    ctx.shadowBlur = 0
  }
}
