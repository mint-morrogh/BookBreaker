import type { Book } from './content'

// ── Shared canvas helpers ──────────────────────────────────────
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Word entry used by animations ──────────────────────────────
export interface WordEntry {
  word: string
  color: string
  points: number
}

// ── Overlay: Game Over ─────────────────────────────────────────
export interface GameOverState {
  book: Book
  chapterIdx: number
  score: number
  wordsBroken: number
  isNewHigh: boolean
  endScores: number[]
}

export function renderGameOver(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameOverState) {
  ctx.fillStyle = 'rgba(6, 8, 12, 0.92)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2
  const panelW = 340
  const panelX = cx - panelW / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ─── Title bar ───
  const titleY = H * 0.18
  ctx.shadowColor = '#f87171'
  ctx.shadowBlur = 30
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#f87171'
  ctx.lineWidth = 1.5
  roundRect(ctx, panelX, titleY - 18, panelW, 36, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#f87171'
  ctx.font = `bold 18px 'JetBrains Mono', monospace`
  ctx.fillText('GAME OVER', cx, titleY)

  // ─── New high score badge ───
  let yOff = titleY + 32
  if (s.isNewHigh) {
    ctx.shadowColor = '#e8c44a'
    ctx.shadowBlur = 20
    ctx.fillStyle = '#e8c44a'
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.fillText('★  NEW HIGH SCORE  ★', cx, yOff)
    ctx.shadowBlur = 0
    yOff += 24
  }

  // ─── Book info ───
  ctx.fillStyle = '#4a5568'
  ctx.font = `12px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.book.title}  ·  Chapter ${s.chapterIdx + 1}`, cx, yOff)
  yOff += 28

  // ─── Score panel ───
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#e8c44a'
  ctx.lineWidth = 2
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 16
  roundRect(ctx, panelX + 40, yOff - 4, panelW - 80, 56, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0

  ctx.fillStyle = '#4a5568'
  ctx.font = `bold 9px 'JetBrains Mono', monospace`
  ctx.letterSpacing = '2px'
  ctx.fillText('FINAL SCORE', cx, yOff + 10)
  ctx.fillStyle = '#e8c44a'
  ctx.font = `bold 26px 'JetBrains Mono', monospace`
  ctx.fillText(s.score.toLocaleString(), cx, yOff + 36)
  yOff += 72

  // ─── Stats row ───
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#1a2030'
  ctx.lineWidth = 1
  roundRect(ctx, panelX, yOff - 4, panelW, 34, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#7a8598'
  ctx.font = `12px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.wordsBroken} words  ·  ${s.chapterIdx} chapters`, cx, yOff + 13)
  yOff += 48

  // ─── Top 3 panel ───
  const hasScores = s.endScores.length > 0
  if (hasScores) {
    ctx.fillStyle = '#0a0e16'
    ctx.strokeStyle = '#1a2030'
    ctx.lineWidth = 1
    const scoresPanelH = 24 + s.endScores.length * 28
    roundRect(ctx, panelX, yOff - 4, panelW, scoresPanelH, 4)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#374151'
    ctx.font = `bold 9px 'JetBrains Mono', monospace`
    ctx.fillText('TOP SCORES', cx, yOff + 8)

    const medals = ['#e8c44a', '#a0aab8', '#cd7f32']
    for (let i = 0; i < Math.min(3, s.endScores.length); i++) {
      const sc = s.endScores[i]
      const y = yOff + 26 + i * 28
      const isCurrent = sc === s.score && i === s.endScores.indexOf(s.score)

      // Medal dot
      ctx.fillStyle = medals[i]
      ctx.beginPath()
      ctx.arc(cx - 60, y, 4, 0, Math.PI * 2)
      ctx.fill()

      // Score
      ctx.fillStyle = isCurrent ? '#e8c44a' : '#c8d0dc'
      ctx.font = `bold 14px 'JetBrains Mono', monospace`
      ctx.textAlign = 'left'
      ctx.fillText(sc.toLocaleString(), cx - 45, y)

      // Current marker
      if (isCurrent) {
        ctx.fillStyle = '#e8c44a'
        ctx.font = `10px 'JetBrains Mono', monospace`
        ctx.textAlign = 'right'
        ctx.fillText('◄ YOU', cx + panelW / 2 - 16, y)
      }
      ctx.textAlign = 'center'
    }
    yOff += scoresPanelH + 20
  }

  // ─── Restart prompt ───
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#7dd3fc'
  ctx.lineWidth = 1
  ctx.shadowColor = '#7dd3fc'
  ctx.shadowBlur = 10
  const promptW = 280
  roundRect(ctx, cx - promptW / 2, yOff - 2, promptW, 28, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#7dd3fc'
  ctx.font = `bold 11px 'JetBrains Mono', monospace`
  ctx.fillText('CLICK or SPACE to restart', cx, yOff + 12)
}

// ── Overlay: Level Complete ────────────────────────────────────
export interface LevelCompleteState {
  levelWords: WordEntry[]
  levelAnimIdx: number
  levelAnimScore: number
  isWaiting: boolean
}

export function renderLevelComplete(ctx: CanvasRenderingContext2D, W: number, H: number, s: LevelCompleteState) {
  ctx.fillStyle = 'rgba(6, 8, 12, 0.88)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2
  const panelW = 340
  const panelX = cx - panelW / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ─── Title bar ───
  const titleY = H * 0.13
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 24
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#e8c44a'
  ctx.lineWidth = 1.5
  roundRect(ctx, panelX, titleY - 16, panelW, 32, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#e8c44a'
  ctx.font = `bold 15px 'JetBrains Mono', monospace`
  ctx.fillText('CHAPTER COMPLETE', cx, titleY)

  // ─── Word list panel ───
  const listTop = titleY + 30
  const lineH = 20
  const maxVisible = Math.floor((H * 0.48) / lineH)
  const firstVisible = Math.max(0, s.levelAnimIdx - maxVisible)
  const listH = maxVisible * lineH + 16

  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#1a2030'
  ctx.lineWidth = 1
  roundRect(ctx, panelX, listTop, panelW, listH, 4)
  ctx.fill()
  ctx.stroke()

  ctx.font = `13px 'JetBrains Mono', monospace`
  for (let i = firstVisible; i < s.levelAnimIdx && i < s.levelWords.length; i++) {
    const w = s.levelWords[i]
    const row = i - firstVisible
    const y = listTop + 14 + row * lineH
    if (row >= maxVisible) break

    const isNewest = i === s.levelAnimIdx - 1
    ctx.globalAlpha = isNewest ? 1.0 : 0.4

    ctx.fillStyle = w.color
    ctx.textAlign = 'right'
    ctx.fillText(w.word, cx - 16, y)

    ctx.fillStyle = '#34d399'
    ctx.textAlign = 'left'
    ctx.fillText(`+${w.points}`, cx + 16, y)
  }
  ctx.globalAlpha = 1

  // ─── Score panel ───
  const scoreY = listTop + listH + 14
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#e8c44a'
  ctx.lineWidth = 1.5
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 12
  roundRect(ctx, panelX + 60, scoreY, panelW - 120, 44, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#4a5568'
  ctx.font = `bold 9px 'JetBrains Mono', monospace`
  ctx.textAlign = 'center'
  ctx.fillText('CHAPTER SCORE', cx, scoreY + 12)
  ctx.fillStyle = '#e8c44a'
  ctx.font = `bold 20px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.levelAnimScore.toLocaleString()}`, cx, scoreY + 32)

  // ─── Progress ───
  ctx.fillStyle = '#374151'
  ctx.font = `10px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.levelAnimIdx} / ${s.levelWords.length} words`, cx, scoreY + 58)

  // ─── Next prompt ───
  if (s.isWaiting) {
    const promptY = scoreY + 76
    ctx.fillStyle = '#0a0e16'
    ctx.strokeStyle = '#7dd3fc'
    ctx.lineWidth = 1
    ctx.shadowColor = '#7dd3fc'
    ctx.shadowBlur = 10
    const pw = 280
    roundRect(ctx, cx - pw / 2, promptY, pw, 28, 4)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#7dd3fc'
    ctx.font = `bold 11px 'JetBrains Mono', monospace`
    ctx.fillText('CLICK or SPACE for next chapter', cx, promptY + 14)
  }
}

// ── Overlay: Penalty ───────────────────────────────────────────
export interface PenaltyState {
  penaltyBricks: WordEntry[]
  penaltyIdx: number
  penaltyTotal: number
  isWaiting: boolean
}

export function renderPenalty(ctx: CanvasRenderingContext2D, W: number, H: number, s: PenaltyState) {
  ctx.fillStyle = 'rgba(6, 8, 20, 0.88)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2
  const panelW = 360
  const panelX = cx - panelW / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ─── Title bar ───
  const titleY = H * 0.13
  ctx.shadowColor = '#60a5fa'
  ctx.shadowBlur = 24
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 1.5
  roundRect(ctx, panelX, titleY - 16, panelW, 32, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#60a5fa'
  ctx.font = `bold 14px 'JetBrains Mono', monospace`
  ctx.fillText('TEXT REACHED THE TOP', cx, titleY)

  // ─── Subtitle ───
  ctx.fillStyle = '#f87171'
  ctx.font = `12px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.penaltyBricks.length} words remaining`, cx, titleY + 28)

  // ─── Word list panel ───
  const listTop = titleY + 46
  const lineH = 20
  const maxVisible = Math.floor((H * 0.42) / lineH)
  const firstVisible = Math.max(0, s.penaltyIdx - maxVisible)
  const listH = maxVisible * lineH + 16

  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#1a2030'
  ctx.lineWidth = 1
  roundRect(ctx, panelX, listTop, panelW, listH, 4)
  ctx.fill()
  ctx.stroke()

  ctx.font = `12px 'JetBrains Mono', monospace`
  for (let i = firstVisible; i < s.penaltyIdx && i < s.penaltyBricks.length; i++) {
    const w = s.penaltyBricks[i]
    const row = i - firstVisible
    const y = listTop + 14 + row * lineH
    if (row >= maxVisible) break

    const isNewest = i === s.penaltyIdx - 1
    ctx.globalAlpha = isNewest ? 1.0 : 0.35

    ctx.fillStyle = w.color
    ctx.textAlign = 'right'
    ctx.fillText(w.word, cx - 16, y)

    ctx.fillStyle = '#f87171'
    ctx.textAlign = 'left'
    ctx.fillText(`-${w.points}`, cx + 16, y)
  }
  ctx.globalAlpha = 1

  // ─── Penalty total panel ───
  const penY = listTop + listH + 14
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#f87171'
  ctx.lineWidth = 1.5
  ctx.shadowColor = '#f87171'
  ctx.shadowBlur = 12
  roundRect(ctx, panelX + 60, penY, panelW - 120, 44, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#4a5568'
  ctx.font = `bold 9px 'JetBrains Mono', monospace`
  ctx.textAlign = 'center'
  ctx.fillText('PENALTY', cx, penY + 12)
  ctx.fillStyle = '#f87171'
  ctx.font = `bold 20px 'JetBrains Mono', monospace`
  ctx.fillText(`-${s.penaltyTotal.toLocaleString()}`, cx, penY + 32)

  // ─── Progress ───
  ctx.fillStyle = '#374151'
  ctx.font = `10px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.penaltyIdx} / ${s.penaltyBricks.length}`, cx, penY + 58)

  // ─── Next prompt ───
  if (s.isWaiting) {
    const promptY = penY + 76
    ctx.fillStyle = '#0a0e16'
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 1
    ctx.shadowColor = '#60a5fa'
    ctx.shadowBlur = 10
    const pw = 280
    roundRect(ctx, cx - pw / 2, promptY, pw, 28, 4)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#60a5fa'
    ctx.font = `bold 11px 'JetBrains Mono', monospace`
    ctx.fillText('CLICK or SPACE for next chapter', cx, promptY + 14)
  }
}

// ── Overlay: Pause ─────────────────────────────────────────────
export function renderPause(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = 'rgba(6, 8, 12, 0.80)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2
  const cy = H * 0.44

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Boxed title
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 20
  ctx.fillStyle = '#0a0e16'
  ctx.strokeStyle = '#e8c44a'
  ctx.lineWidth = 2
  roundRect(ctx, cx - 140, cy - 20, 280, 40, 4)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0

  ctx.fillStyle = '#e8c44a'
  ctx.font = `bold 18px 'JetBrains Mono', monospace`
  ctx.fillText('GAME PAUSED', cx, cy)

  ctx.fillStyle = '#4a5568'
  ctx.font = `11px 'JetBrains Mono', monospace`
  ctx.fillText('click into window to resume', cx, cy + 34)
}
