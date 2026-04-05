// ── Sidebar bridge ──────────────────────────────────────────────
export const sidebarEls = {
  score: document.getElementById('score-display')!,
  lives: document.getElementById('lives-display')!,
  combo: document.getElementById('combo-display')!,
  words: document.getElementById('words-display')!,
  bookName: document.getElementById('book-name')!,
  chapterLabel: document.getElementById('chapter-label')!,
  progressBar: document.getElementById('progress-bar')!,
  progressText: document.getElementById('progress-text')!,
  letterGrid: document.getElementById('letter-grid')!,
  wordLog: document.getElementById('word-log')!,
}

export function initLetterGrid() {
  sidebarEls.letterGrid.innerHTML = ''
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('div')
    el.className = 'letter-cell'
    el.textContent = String.fromCharCode(65 + i)
    el.id = `letter-${String.fromCharCode(65 + i)}`
    sidebarEls.letterGrid.appendChild(el)
  }
}

// ── Word log — aggregated, sorted by total points ───────────────
const wordMap = new Map<string, { count: number; totalPoints: number; el: HTMLDivElement }>()

export function logWord(word: string, points: number) {
  const key = word.toLowerCase()
  const existing = wordMap.get(key)

  if (existing) {
    existing.count++
    existing.totalPoints += points
    // Update display
    const countStr = existing.count > 1 ? ` x${existing.count}` : ''
    existing.el.innerHTML = `<span class="word">${word}${countStr}</span><span class="points">+${existing.totalPoints}</span>`
  } else {
    const el = document.createElement('div')
    el.className = 'word-entry'
    el.innerHTML = `<span class="word">${word}</span><span class="points">+${points}</span>`
    wordMap.set(key, { count: 1, totalPoints: points, el })
    sidebarEls.wordLog.appendChild(el)
  }

  // Re-sort: highest total points first
  const sorted = [...wordMap.values()].sort((a, b) => b.totalPoints - a.totalPoints)
  for (const entry of sorted) {
    sidebarEls.wordLog.appendChild(entry.el) // moves existing element to end
  }
}

export function clearWordLog() {
  wordMap.clear()
  sidebarEls.wordLog.innerHTML = ''
}
