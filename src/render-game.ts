import type { Ball, Brick, Particle, Pickup, Dot, Shrapnel } from './types'
import { DOT_COLORS, BALL_COLORS } from './colors'
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
  gold: number
  ballSpeed: number  // base ball speed for color intensity calc
  magnetCharges: number
  backWallReveal: number  // 0→1 animation for back wall line appearance
  tutorialPhase: number   // -1 if not in tutorial, else current phase index
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

  // Gold charge aura — nearby dots glow gold when charge is full, scales with paddle width
  if (state.charge >= 1.0) {
    const padCx = state.paddleX + state.paddleW / 2
    const padCy = state.paddleY + state.paddleH / 2
    const auraR = Math.max(80, state.paddleW * 0.6)
    const auraRSq = auraR * auraR
    ctx.fillStyle = '#fbbf24'
    for (const dot of state.dots) {
      const ddx = dot.x - padCx
      const ddy = dot.y - padCy
      const distSq = ddx * ddx + ddy * ddy
      if (distSq < auraRSq) {
        const t = 1 - Math.sqrt(distSq) / auraR
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
      ctx.lineWidth = 1
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

  // Pickups — glowing upgrade capsules
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const p of state.pickups) {
    const wobbleX = Math.sin(p.wobblePhase) * 8
    const pulse = 0.7 + Math.sin(p.wobblePhase * 1.8) * 0.3
    const px = p.x + wobbleX
    const py = p.y

    // Measure label width for capsule
    ctx.font = `bold 12px 'JetBrains Mono', monospace`
    const tw = ctx.measureText(`✦ ${p.label} ✦`).width
    const capW = tw + 20
    const capH = 22

    // Outer glow
    ctx.shadowColor = p.color
    ctx.shadowBlur = 18 * pulse

    // Dark capsule background
    ctx.fillStyle = 'rgba(6, 8, 12, 0.85)'
    ctx.strokeStyle = p.color
    ctx.lineWidth = 1.5
    roundRect(ctx, px - capW / 2, py - capH / 2, capW, capH, capH / 2)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    // Label text with decorative stars
    ctx.globalAlpha = 0.95
    ctx.fillStyle = p.color
    ctx.shadowColor = p.color
    ctx.shadowBlur = 8
    ctx.fillText(`✦ ${p.label} ✦`, px, py + 1)
    ctx.shadowBlur = 0
  }
  ctx.globalAlpha = 1

  // Particles — two-pass rendering for cross-browser glow + fade:
  // Pass 1: larger, dimmer text = glow halo (works everywhere, no shadowBlur needed)
  // Pass 2: sharp text on top
  // Both fade with lifeRatio so the fade-out is smooth on all devices.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold 16px 'JetBrains Mono', monospace`
  const pxBase = ctx.getTransform()
  for (const p of state.particles) {
    const lifeRatio = p.life / p.maxLife
    const s = p.size * (0.5 + lifeRatio * 0.5) / 16
    const tx = pxBase.e + p.x * pxBase.a
    const ty = pxBase.f + p.y * pxBase.d
    ctx.fillStyle = p.color
    // Glow pass — tighter for multi-char labels so they don't look bloated
    const isLabel = p.char.length > 1
    const glowScale = isLabel ? 1.08 : 1.4
    const glowAlpha = isLabel ? 0.25 : 0.35
    const gs = s * glowScale
    ctx.globalAlpha = lifeRatio * glowAlpha
    ctx.setTransform(pxBase.a * gs, pxBase.b * gs, pxBase.c * gs, pxBase.d * gs, tx, ty)
    ctx.fillText(p.char, 0, 0)
    // Sharp text pass
    ctx.globalAlpha = lifeRatio
    ctx.setTransform(pxBase.a * s, pxBase.b * s, pxBase.c * s, pxBase.d * s, tx, ty)
    ctx.fillText(p.char, 0, 0)
  }
  ctx.setTransform(pxBase)
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
    ctx.shadowBlur = (charged ? 35 : 20)
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

    // Magnet indicator — blue glow on front edge + charge counter
    if (state.magnetCharges > 0) {
      // Blue glow along the bottom (front) edge of the paddle
      ctx.save()
      ctx.shadowColor = '#7dd3fc'
      ctx.shadowBlur = state.isMobile ? 6 : 14
      ctx.strokeStyle = '#7dd3fc'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(x + 3, y + h)
      ctx.lineTo(x + w - 3, y + h)
      ctx.stroke()
      ctx.restore()

      // Charge counter beside paddle
      ctx.fillStyle = '#7dd3fc'
      ctx.font = `bold 10px 'JetBrains Mono', monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.globalAlpha = 0.8
      ctx.fillText(`×${state.magnetCharges}`, x + w + 6, y + h / 2)
      ctx.globalAlpha = 1
    }
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

  // Back wall glow (bottom edge — red) — draws itself from center outward
  if (state.backWallReveal > 0) {
    const r = state.backWallReveal
    const halfW = (W / 2) * r
    const cx = W / 2
    const wallGrad = ctx.createLinearGradient(0, H - 8, 0, H)
    wallGrad.addColorStop(0, 'rgba(248, 113, 113, 0)')
    wallGrad.addColorStop(1, `rgba(248, 113, 113, ${0.3 * r})`)
    ctx.fillStyle = wallGrad
    ctx.fillRect(cx - halfW, H - 8, halfW * 2, 8)
    // Bright tip at the expanding edge during reveal
    if (r < 1) {
      ctx.fillStyle = `rgba(248, 113, 113, ${0.7 * (1 - r)})`
      ctx.fillRect(cx - halfW - 2, H - 4, 4, 4)
      ctx.fillRect(cx + halfW - 2, H - 4, 4, 4)
    }
  }

  for (const ball of state.balls) {
    // Color intensity from actual velocity — 11 steps (0-10)
    // Shifted so first ~5 speed-ups stay yellow/gold, then ramps through orange to red
    // Magnet-caught balls: derive intensity from stored speed so color is preserved
    const speed = ball.stuck && ball.magnetSpeed > 0
      ? ball.magnetSpeed
      : Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
    const speedRatio = state.ballSpeed > 0 ? speed / state.ballSpeed : 0
    // Linear 0-10 from speed hits (log scale matches 1.1x compounding)
    const rawStep = (ball.stuck && ball.magnetSpeed <= 0) ? 0 : Math.log(Math.max(1, speedRatio)) / Math.log(1.05)
    // Power curve: stays low early, ramps late (5 hits ≈ index 3 orange, 10 hits = 10 red)
    const intensity = Math.min(10, Math.max(0, Math.round((rawStep / 10) ** 1.6 * 10)))
    const ballColor = BALL_COLORS[intensity]
    // Trail — off-white tapered ribbon, grows wider/longer with speed
    if (ball.trail.length >= 2) {
      const len = ball.trail.length
      const maxAge = 0.15 + intensity * 0.012  // longer trail at higher speeds
      const baseAlpha = 0.3 + intensity * 0.04
      ctx.strokeStyle = '#d8dce4'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const step = len > 30 ? 2 : 1
      for (let i = 0; i < len - step; i += step) {
        const t0 = ball.trail[i]
        const t1 = ball.trail[Math.min(i + step, len - 1)]
        const pct = 1 - t0.age / maxAge  // 1 at head, 0 at tail
        if (pct <= 0) continue
        ctx.globalAlpha = pct * pct * baseAlpha
        ctx.lineWidth = ball.r * 2 * pct
        ctx.beginPath()
        ctx.moveTo(t0.x, t0.y)
        // Smooth curve through midpoint to next point
        if (i + step * 2 < len) {
          const t2 = ball.trail[Math.min(i + step * 2, len - 1)]
          ctx.quadraticCurveTo(t1.x, t1.y, (t1.x + t2.x) / 2, (t1.y + t2.y) / 2)
        } else {
          ctx.lineTo(t1.x, t1.y)
        }
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    // Ball body — triangle when homing, circle otherwise
    // Ghost: outline only (no fill), works with all shapes
    const isGhost = ball.ghostLeft > 0
    ctx.shadowColor = ballColor
    ctx.shadowBlur = 15 + intensity * 3
    if (isGhost) {
      ctx.strokeStyle = ballColor
      ctx.lineWidth = 2
    } else {
      ctx.fillStyle = ballColor
    }
    if (ball.homingLeft > 0) {
      // Triangle pointing in velocity direction (or up if stuck)
      const angle = ball.stuck ? -Math.PI / 2 : Math.atan2(ball.vy, ball.vx)
      const r = ball.r * 1.3
      ctx.beginPath()
      ctx.moveTo(ball.x + Math.cos(angle) * r, ball.y + Math.sin(angle) * r)
      ctx.lineTo(ball.x + Math.cos(angle + 2.4) * r, ball.y + Math.sin(angle + 2.4) * r)
      ctx.lineTo(ball.x + Math.cos(angle - 2.4) * r, ball.y + Math.sin(angle - 2.4) * r)
      ctx.closePath()
      if (isGhost) ctx.stroke(); else ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
      if (isGhost) ctx.stroke(); else ctx.fill()
    }
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

    // Upgrade indicators — uniform gap from ball edge, scales with ball size
    const indGap = ball.r + 6

    // Homing indicator — left side of ball
    if (ball.homingLeft > 0) {
      ctx.fillStyle = '#c084fc'
      ctx.shadowColor = '#c084fc'
      ctx.shadowBlur = 6
      ctx.font = `bold 10px 'JetBrains Mono', monospace`
      ctx.textAlign = 'right'
      ctx.fillText(`x${ball.homingLeft}<`, ball.x - indGap, ball.y + 4)
      ctx.shadowBlur = 0
      ctx.textAlign = 'center'
    }

    // Ghost indicator — above ball
    if (ball.ghostLeft > 0) {
      ctx.fillStyle = '#94a3b8'
      ctx.shadowColor = '#94a3b8'
      ctx.shadowBlur = 6
      ctx.font = `bold 10px 'JetBrains Mono', monospace`
      ctx.textAlign = 'center'
      ctx.fillText(`x${ball.ghostLeft}`, ball.x, ball.y - indGap)
      ctx.shadowBlur = 0
    }

    // Piercing indicator — right side of ball
    if (ball.pierceLeft > 0) {
      const p = ball.pierceLeft
      const pierceColor = p >= 5 ? '#f87171' : p >= 4 ? '#f97316' : p >= 3 ? '#fbbf24' : p >= 2 ? '#a3e635' : '#4ade80'
      ctx.fillStyle = pierceColor
      ctx.shadowColor = pierceColor
      ctx.shadowBlur = 6
      ctx.font = `bold 10px 'JetBrains Mono', monospace`
      ctx.textAlign = 'left'
      ctx.fillText(`>${ball.pierceLeft}`, ball.x + indGap, ball.y + 4)
      ctx.shadowBlur = 0
      ctx.textAlign = 'center'
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
    ctx.fillText(state.isMobile ? '[ HOLD to move · 2nd finger to launch ]' : '[ CLICK to slam-launch · SPACE also works ]', W / 2, state.paddleY + 60)
  }

  // Slam hint — only during tutorial slam phase (phase 2)
  if (state.tutorialPhase === 2 && state.started && state.levelState === 'playing') {
    ctx.fillStyle = '#fbbf24'
    ctx.shadowColor = '#fbbf24'
    ctx.shadowBlur = 8
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.isMobile ? '[ TAP with other finger to slam ]' : '[ CLICK to slam the paddle forward ]', W / 2, state.paddleY + 60)
    ctx.shadowBlur = 0
  }

  // Charge recall hint — only shown until first recall
  if (state.charge >= 1.0 && state.started && !state.hasRecalled && state.levelState === 'playing') {
    ctx.fillStyle = '#fbbf24'
    ctx.shadowColor = '#fbbf24'
    ctx.shadowBlur = 8
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(state.isMobile ? '[ SWIPE UP to recall ball ]' : '[ RIGHT CLICK to recall ball ]', W / 2, state.paddleY + 60)
    ctx.shadowBlur = 0
  }
}
