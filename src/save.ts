// ── Save / Restore — localStorage persistence for game runs ──

export interface SaveState {
  bookIdx: number
  chapterIdx: number
  paragraphIdx: number
  score: number
  lives: number
  gold: number
  paragraphsCompleted: number
  dropBonus: number
  widenLevel: number
  safetyHits: number
  wordsBroken: number
  letterCounts: Record<string, number>
  alphabetCompletions: number
  nextLifeScore: number
  levelState: 'playing' | 'grayCleanup' | 'endPopping' | 'endTally' | 'endGrade' | 'shop'
  ballSizeBonus: number
  magnetCharges: number
}

const SAVE_KEY = 'bb_run_save'

export function saveToStorage(state: SaveState): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state))
}

export function loadFromStorage(): SaveState | null {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY)
  localStorage.removeItem('bb_in_game')
}
