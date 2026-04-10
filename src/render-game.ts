import type { Ball, Brick, Particle, Pickup, Dot, Shrapnel } from './types'
import { DOT_COLORS, BALL_COLORS, rareColor, hexToRgba } from './colors'
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
  gameTime: number        // total elapsed time for animations
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

  // Ball aura — nearby dots tinted with ball color, small radius scales with ball size
  for (const ball of state.balls) {
    if (ball.stuck) continue
    const speed = ball.magnetSpeed > 0
      ? ball.magnetSpeed
      : Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
    const speedRatio = state.ballSpeed > 0 ? speed / state.ballSpeed : 0
    const rawStep = Math.log(Math.max(1, speedRatio)) / Math.log(1.05)
    const intensity = Math.min(13, Math.max(0, Math.round((rawStep / 13) ** 1.6 * 13)))
    const col = BALL_COLORS[intensity]
    // Base radius 26, grows with ball size (default r ~5.6)
    const extra = Math.max(0, ball.r - 5.6)
    const auraR = 26 + extra * 5
    const auraRSq = auraR * auraR
    // Alpha ramps up with size: 0.35 at default, up to 0.55 at max
    const peakAlpha = 0.35 + Math.min(0.20, extra * 0.018)
    ctx.fillStyle = col
    for (const dot of state.dots) {
      const ddx = dot.x - ball.x
      const ddy = dot.y - ball.y
      const distSq = ddx * ddx + ddy * ddy
      if (distSq < auraRSq) {
        const t = 1 - Math.sqrt(distSq) / auraR
        ctx.globalAlpha = t * peakAlpha
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, 2.0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

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
      // Rare bricks use a slowly cycling rainbow color
      const brickCol = brick.rare ? rareColor(state.gameTime) : brick.color

      // Rare word glow — strong pulsing outer glow in current rainbow color
      if (brick.rare) {
        const pulse = 0.7 + 0.3 * Math.sin(state.gameTime * 3)
        ctx.shadowColor = brickCol
        ctx.shadowBlur = (state.isMobile ? 10 : 22) * pulse
      }
      // Title bricks get a subtle warm glow
      if (brick.title) {
        ctx.shadowColor = '#e8c44a'
        ctx.shadowBlur = state.isMobile ? 4 : 8
      }
      // Palindrome bricks get a silver/chrome glow
      if (brick.palindrome) {
        ctx.shadowColor = '#c0c8d8'
        ctx.shadowBlur = state.isMobile ? 5 : 10
      }
      // All-vowels bricks get a pulsing outer glow in their own color
      if (brick.allVowels) {
        const pulse = 0.6 + 0.4 * Math.sin(state.gameTime * 2.5)
        ctx.shadowColor = brickCol
        ctx.shadowBlur = (state.isMobile ? 6 : 16) * pulse
      }
      ctx.fillStyle = brick.palindrome ? '#111824' : '#0f1520'
      ctx.strokeStyle = brickCol
      ctx.lineWidth = brick.rare ? 1.5 : (brick.title || brick.palindrome || brick.allVowels) ? 1.5 : 1
      roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
      ctx.fill()
      if (!brick.palindrome) ctx.stroke()  // palindromes draw their own gradient border later
      if (brick.title || brick.palindrome || brick.allVowels) ctx.shadowBlur = 0
      // Second glow pass for rare — doubles the glow intensity
      if (brick.rare) {
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // Title brick shimmer — white highlight sweeps across periodically
      if (brick.title) {
        // Shimmer every ~3 seconds, sweep takes 0.4s
        const cycle = 3.0
        const sweepDur = 0.4
        const t = ((state.gameTime + brick.x * 0.01) % cycle)  // offset by x so they don't all sync
        if (t < sweepDur) {
          const progress = t / sweepDur  // 0→1 across the brick
          const shimmerX = brick.x + progress * brick.w
          ctx.save()
          ctx.beginPath()
          roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
          ctx.clip()
          // White gradient band sweeping left to right
          const bandW = brick.w * 0.35
          const grad = ctx.createLinearGradient(shimmerX - bandW, 0, shimmerX + bandW, 0)
          grad.addColorStop(0, 'rgba(255,255,255,0)')
          grad.addColorStop(0.5, 'rgba(255,255,255,0.25)')
          grad.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = grad
          ctx.fillRect(brick.x, brick.y, brick.w, brick.h)
          ctx.restore()
        }
      }

      // Palindrome brick — inner tint + metallic gradient border on top
      if (brick.palindrome) {
        // Inner fill tint first
        ctx.fillStyle = hexToRgba(brick.color, 0.12)
        roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
        ctx.fill()
        // Gradient border on top — bright spot rocks left-to-right
        const phase = Math.sin(state.gameTime * 1.2 + brick.x * 0.02) * 0.5 + 0.5
        const grad = ctx.createLinearGradient(brick.x, 0, brick.x + brick.w, 0)
        const spotPos = Math.max(0.05, Math.min(0.95, phase))
        const bright = hexToRgba(brick.color, 0.7)
        const dim = hexToRgba(brick.color, 0.25)
        grad.addColorStop(0, dim)
        grad.addColorStop(Math.max(0, spotPos - 0.2), dim)
        grad.addColorStop(spotPos, bright)
        grad.addColorStop(Math.min(1, spotPos + 0.2), dim)
        grad.addColorStop(1, dim)
        ctx.strokeStyle = grad
        ctx.lineWidth = 3
        roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
        ctx.stroke()
      }

      // All-vowels brick — subtle background tint + border in brick's own color
      if (brick.allVowels) {
        ctx.fillStyle = hexToRgba(brickCol, 0.10)
        roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
        ctx.fill()
        ctx.strokeStyle = hexToRgba(brickCol, 0.45)
        ctx.lineWidth = 1.5
        roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 3)
        ctx.stroke()
      }

      // Rare word tron runner — dot fading between rainbow color and white
      if (brick.rare) {
        const perim = 2 * (brick.w + brick.h)
        const speed = 180 // px/sec
        const pos = ((state.gameTime * speed) % perim + perim) % perim

        const perimXY = (p: number): [number, number] => {
          if (p < brick.w) return [brick.x + p, brick.y]
          if (p < brick.w + brick.h) return [brick.x + brick.w, brick.y + (p - brick.w)]
          if (p < 2 * brick.w + brick.h) return [brick.x + brick.w - (p - brick.w - brick.h), brick.y + brick.h]
          return [brick.x, brick.y + brick.h - (p - 2 * brick.w - brick.h)]
        }

        // Lead dot — fades between white and current rainbow color
        const colorPhase = 0.5 + 0.5 * Math.sin(state.gameTime * 5)
        const [rx, ry] = perimXY(pos)
        ctx.shadowColor = brickCol
        ctx.shadowBlur = state.isMobile ? 6 : 14
        ctx.fillStyle = colorPhase > 0.5 ? '#ffffff' : brickCol
        ctx.globalAlpha = brick.alpha
        ctx.beginPath()
        ctx.arc(rx, ry, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0

        // Trailing glow — 6 segments fading out
        const trailSpacing = 5
        for (let t = 1; t <= 6; t++) {
          const tp = ((pos - t * trailSpacing) % perim + perim) % perim
          const [tx, ty] = perimXY(tp)
          const fade = 1 - t / 7
          ctx.globalAlpha = brick.alpha * fade * 0.6
          ctx.fillStyle = t <= 3 ? '#ffffff' : brickCol
          ctx.beginPath()
          ctx.arc(tx, ty, 2 - t * 0.2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = brick.alpha
      }
    }

    // Word text — drawn at world Y, translate handles the scroll
    ctx.fillStyle = brick.rare ? rareColor(state.gameTime) : brick.color
    ctx.textAlign = 'center'

    if (brick.palindrome) {
      // Flip animation — horizontally flips every ~4 seconds over 0.6s
      const flipCycle = 4.0
      const flipDur = 0.6
      const ft = ((state.gameTime + brick.x * 0.007) % flipCycle)
      const cx = brick.x + brick.w / 2
      const cy = brick.y + brick.h / 2
      if (ft < flipDur) {
        // scaleX goes 1 → 0 → -1 → 0 → 1 using cosine
        const scaleX = Math.cos((ft / flipDur) * Math.PI * 2)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(scaleX, 1)
        ctx.translate(-cx, -cy)
        ctx.fillText(brick.word, cx, cy + 1)
        ctx.restore()
      } else {
        ctx.fillText(brick.word, cx, brick.y + brick.h / 2 + 1)
      }
    } else if (brick.allVowels) {
      // Per-character rendering — vowels pulse between brick color and white
      const vowels = new Set(['a','e','i','o','u'])
      const word = brick.word
      const bc = parseInt(brick.color.slice(1), 16)
      const bR = (bc >> 16) & 255, bG = (bc >> 8) & 255, bB = bc & 255
      ctx.textAlign = 'left'
      const totalW = ctx.measureText(word).width
      let charX = brick.x + (brick.w - totalW) / 2
      const charY = brick.y + brick.h / 2 + 1
      for (let ci = 0; ci < word.length; ci++) {
        const ch = word[ci]
        const isVowel = vowels.has(ch.toLowerCase())
        if (isVowel) {
          const phase = state.gameTime * 3 + ci * 1.2
          const glow = 0.5 + 0.5 * Math.sin(phase)
          ctx.shadowColor = brick.color
          ctx.shadowBlur = Math.round((state.isMobile ? 3 : 8) * glow)
          // Interpolate brick color → white
          const r = bR + Math.round((255 - bR) * glow)
          const g = bG + Math.round((255 - bG) * glow)
          const b = bB + Math.round((255 - bB) * glow)
          ctx.fillStyle = `rgb(${r},${g},${b})`
        } else {
          ctx.shadowBlur = 0
          ctx.fillStyle = brick.color
        }
        ctx.fillText(ch, charX, charY)
        charX += ctx.measureText(ch).width
      }
      ctx.shadowBlur = 0
      ctx.textAlign = 'center'
    } else {
      ctx.fillText(brick.word, brick.x + brick.w / 2, brick.y + brick.h / 2 + 1)
    }

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
    // Color intensity from actual velocity — 14 steps (0-13)
    // Shifted so first ~5 speed-ups stay yellow/gold, then ramps through orange to red
    // Magnet-caught balls: derive intensity from stored speed so color is preserved
    const speed = ball.stuck && ball.magnetSpeed > 0
      ? ball.magnetSpeed
      : Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
    const speedRatio = state.ballSpeed > 0 ? speed / state.ballSpeed : 0
    // Linear 0-10 from speed hits (log scale matches 1.1x compounding)
    const rawStep = (ball.stuck && ball.magnetSpeed <= 0) ? 0 : Math.log(Math.max(1, speedRatio)) / Math.log(1.05)
    // Power curve: stays low early, ramps late
    const intensity = Math.min(13, Math.max(0, Math.round((rawStep / 13) ** 1.6 * 13)))
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
