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
  ctx.fillStyle = 'rgba(6, 8, 12, 0.94)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ─── Stats line (top) ───
  ctx.fillStyle = '#4a5568'
  ctx.font = `12px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.wordsBroken} words broken  ·  Chapter ${s.chapterIdx + 1} of ${s.book.title}`, cx, H * 0.14)

  // ─── GAME OVER (centered) ───
  ctx.fillStyle = '#f87171'
  ctx.font = `bold 36px 'JetBrains Mono', monospace`
  ctx.fillText('GAME OVER', cx, H * 0.30)

  // ─── New high score ───
  if (s.isNewHigh) {
    ctx.fillStyle = '#e8c44a'
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.fillText('NEW HIGH SCORE', cx, H * 0.37)
  }

  // ─── Final score ───
  ctx.fillStyle = '#5a6578'
  ctx.font = `bold 10px 'JetBrains Mono', monospace`
  ctx.fillText('FINAL SCORE', cx, H * 0.44)

  ctx.fillStyle = '#e8c44a'
  ctx.font = `bold 32px 'JetBrains Mono', monospace`
  ctx.fillText(s.score.toLocaleString(), cx, H * 0.50)

  // ─── High score ───
  const topScore = s.endScores.length > 0 ? s.endScores[0] : 0
  ctx.fillStyle = '#5a6578'
  ctx.font = `bold 10px 'JetBrains Mono', monospace`
  ctx.fillText('HIGH SCORE', cx, H * 0.58)

  ctx.fillStyle = '#c8d0dc'
  ctx.font = `bold 20px 'JetBrains Mono', monospace`
  ctx.fillText(topScore.toLocaleString(), cx, H * 0.63)

  // ─── Top scores (bottom) ───
  if (s.endScores.length > 1) {
    ctx.fillStyle = '#374151'
    ctx.font = `bold 10px 'JetBrains Mono', monospace`
    ctx.fillText('TOP SCORES', cx, H * 0.73)

    const medals = ['#e8c44a', '#a0aab8', '#cd7f32']
    for (let i = 0; i < Math.min(3, s.endScores.length); i++) {
      const sc = s.endScores[i]
      const y = H * 0.78 + i * 24
      const isCurrent = sc === s.score && i === s.endScores.indexOf(s.score)

      ctx.fillStyle = medals[i] ?? '#5a6578'
      ctx.font = `bold 13px 'JetBrains Mono', monospace`
      ctx.textAlign = 'center'
      ctx.fillText(`${i + 1}.  ${sc.toLocaleString()}${isCurrent ? '  ◄' : ''}`, cx, y)
    }
  }

  // ─── Restart prompt ───
  ctx.textAlign = 'center'
  ctx.fillStyle = '#7dd3fc'
  ctx.font = `bold 13px 'JetBrains Mono', monospace`
  ctx.fillText('[ CLICK or SPACE to restart ]', cx, H * 0.92)
}

// ── Overlay: Tutorial Complete ─────────────────────────────────
export interface TutorialCompleteState {
  score: number
  wordsBroken: number
  isNewHigh: boolean
  endScores: number[]
  isMobile: boolean
}

export function renderTutorialComplete(ctx: CanvasRenderingContext2D, W: number, H: number, s: TutorialCompleteState) {
  ctx.fillStyle = 'rgba(6, 8, 12, 0.94)'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ─── Title ───
  ctx.fillStyle = '#e8c44a'
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 30
  ctx.font = `bold 28px 'JetBrains Mono', monospace`
  ctx.fillText('TUTORIAL COMPLETE', cx, H * 0.22)
  ctx.shadowBlur = 0

  // ─── Subtitle ───
  ctx.fillStyle = '#4ade80'
  ctx.font = `bold 14px 'JetBrains Mono', monospace`
  ctx.fillText('Congratulations!', cx, H * 0.30)

  ctx.fillStyle = '#5a6578'
  ctx.font = `12px 'JetBrains Mono', monospace`
  ctx.fillText(`${s.wordsBroken} words broken`, cx, H * 0.36)

  // ─── Final score ───
  ctx.fillStyle = '#5a6578'
  ctx.font = `bold 10px 'JetBrains Mono', monospace`
  ctx.fillText('SCORE', cx, H * 0.44)

  ctx.fillStyle = '#e8c44a'
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 12
  ctx.font = `bold 32px 'JetBrains Mono', monospace`
  ctx.fillText(s.score.toLocaleString(), cx, H * 0.50)
  ctx.shadowBlur = 0

  // ─── New high score ───
  if (s.isNewHigh) {
    ctx.fillStyle = '#e8c44a'
    ctx.font = `bold 13px 'JetBrains Mono', monospace`
    ctx.fillText('★ NEW HIGH SCORE ★', cx, H * 0.57)
  }

  // ─── High score ───
  const topScore = s.endScores.length > 0 ? s.endScores[0] : 0
  if (topScore > 0) {
    ctx.fillStyle = '#5a6578'
    ctx.font = `bold 10px 'JetBrains Mono', monospace`
    ctx.fillText('HIGH SCORE', cx, H * 0.64)

    ctx.fillStyle = '#c8d0dc'
    ctx.font = `bold 20px 'JetBrains Mono', monospace`
    ctx.fillText(topScore.toLocaleString(), cx, H * 0.69)
  }

  // ─── Call to action ───
  ctx.fillStyle = '#4ade80'
  ctx.font = `14px 'JetBrains Mono', monospace`
  ctx.fillText("You're ready for the real thing.", cx, H * 0.80)

  // ─── Continue prompt ───
  const action = s.isMobile ? 'TAP' : 'CLICK or SPACE'
  ctx.fillStyle = '#7dd3fc'
  ctx.font = `bold 13px 'JetBrains Mono', monospace`
  ctx.fillText(`[ ${action} to choose a book ]`, cx, H * 0.92)
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
export function renderPause(ctx: CanvasRenderingContext2D, W: number, H: number, isMobile: boolean) {
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
  if (isMobile) {
    ctx.fillText('tap to resume', cx, cy + 34)
    ctx.fillText('hold to move · 2nd finger to slam', cx, cy + 52)
    ctx.fillText('swipe up to recall ball', cx, cy + 70)
  } else {
    ctx.fillText('click to resume', cx, cy + 34)
    ctx.fillText('click to slam · right click to recall', cx, cy + 52)
  }
}
