// ── Letter scoring ──────────────────────────────────────────────
const LETTER_VALUES: Record<string, number> = {}
'AEIOULNSTR'.split('').forEach(c => LETTER_VALUES[c] = 1)
'DG'.split('').forEach(c => LETTER_VALUES[c] = 2)
'BCMP'.split('').forEach(c => LETTER_VALUES[c] = 3)
'FHVWY'.split('').forEach(c => LETTER_VALUES[c] = 4)
'K'.split('').forEach(c => LETTER_VALUES[c] = 5)
'JX'.split('').forEach(c => LETTER_VALUES[c] = 8)
'QZ'.split('').forEach(c => LETTER_VALUES[c] = 10)

export function scoreWord(word: string, isStopword: boolean): number {
  if (isStopword) return word.length  // stopwords just score letter count
  let s = 0
  for (const ch of word.toUpperCase()) s += LETTER_VALUES[ch] ?? 0
  const base = s * word.length
  // Big words (10+ letters) get a 3x multiplier
  return word.length >= 10 ? base * 3 : base
}

// ── High scores (localStorage) ─────────────────────────────────
export function getHighScores(bookTitle: string): number[] {
  try {
    const raw = localStorage.getItem(`bb_scores_${bookTitle}`)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveHighScore(bookTitle: string, score: number): number[] {
  const scores = getHighScores(bookTitle)
  scores.push(score)
  scores.sort((a, b) => b - a)
  const top3 = scores.slice(0, 3)
  localStorage.setItem(`bb_scores_${bookTitle}`, JSON.stringify(top3))
  return top3
}

export function getTopScore(bookTitle: string): number {
  const scores = getHighScores(bookTitle)
  return scores.length > 0 ? scores[0] : 0
}

// ── Best progress (chapter + stage reached) ──────────────────
export interface BookProgress { chapter: number; stage: number; score: number }

export function saveBestProgress(bookTitle: string, chapter: number, stage: number, score: number): void {
  const prev = getBestProgress(bookTitle)
  // Keep if further in the book, or same spot with higher score
  if (!prev || chapter > prev.chapter || (chapter === prev.chapter && stage > prev.stage) ||
      (chapter === prev.chapter && stage === prev.stage && score > prev.score)) {
    localStorage.setItem(`bb_progress_${bookTitle}`, JSON.stringify({ chapter, stage, score }))
  }
}

export function getBestProgress(bookTitle: string): BookProgress | null {
  try {
    const raw = localStorage.getItem(`bb_progress_${bookTitle}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function markBookBeaten(bookTitle: string): void {
  localStorage.setItem(`bb_beaten_${bookTitle}`, '1')
}

export function isBookBeaten(bookTitle: string): boolean {
  return localStorage.getItem(`bb_beaten_${bookTitle}`) === '1'
}

export function clearAllScores(): void {
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('bb_scores_')) toRemove.push(key)
  }
  toRemove.forEach(k => localStorage.removeItem(k))
}
