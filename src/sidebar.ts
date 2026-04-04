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
