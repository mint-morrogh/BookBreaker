import { Game, getTopScore } from './game'
import { BOOKS } from './content'
import { tagBook } from './tagger'
import { clearAllScores } from './scoring'

// One-time migration: clear old scores for unlock system
if (!localStorage.getItem('bb_unlock_v1')) {
  clearAllScores()
  localStorage.setItem('bb_unlock_v1', '1')
}

// Unlock system — each tier requires a score on any book from the previous tier
const UNLOCK_REQ: Record<string, string | null> = {
  'Easy': null,
  'Medium': 'Easy',
  'Hard': 'Medium',
  'Very Hard': 'Hard',
}

function isTierUnlocked(difficulty: string): boolean {
  const req = UNLOCK_REQ[difficulty]
  if (!req) return true
  return BOOKS.filter(b => b.difficulty === req).some(b => getTopScore(b.title) > 0)
}

// Sidebar toggle (mobile) — pauses game when open
const sidebar = document.getElementById('sidebar')!
const sidebarBackdrop = document.getElementById('sidebar-backdrop')!
const miniStats = document.getElementById('mini-stats')!
let activeGame: Game | null = null

function toggleSidebar() {
  const opening = !sidebar.classList.contains('open')
  sidebar.classList.toggle('open')
  sidebarBackdrop.classList.toggle('open')
  // Always pause when interacting with nav — game's tap-to-unpause handles resume
  if (activeGame && opening) {
    activeGame.paused = true
  }
}
// Entire top nav bar is tappable
miniStats.addEventListener('click', toggleSidebar)
miniStats.addEventListener('touchstart', (e) => { e.preventDefault(); toggleSidebar() })
sidebarBackdrop.addEventListener('click', toggleSidebar)

// Populate book picker
const bookList = document.getElementById('book-list')!
const diffColors: Record<string, string> = { Easy: '#4ade80', Medium: '#fbbf24', Hard: '#f97316', 'Very Hard': '#f87171' }

let lastDiff = ''
BOOKS.forEach((book, idx) => {
  const diffColor = diffColors[book.difficulty] ?? '#c8d0dc'
  const unlocked = isTierUnlocked(book.difficulty)

  // Tier header when difficulty changes
  if (book.difficulty !== lastDiff) {
    lastDiff = book.difficulty
    const header = document.createElement('div')
    header.className = 'tier-header'
    header.innerHTML = `<span class="tier-line"></span><span style="color:${diffColor}">${book.difficulty.toUpperCase()}</span><span class="tier-line"></span>`
    bookList.appendChild(header)

    if (!unlocked) {
      const hint = document.createElement('div')
      hint.className = 'tier-hint'
      hint.textContent = `set a score on any ${UNLOCK_REQ[book.difficulty]} book to unlock`
      bookList.appendChild(hint)
    }
  }

  const top = unlocked ? getTopScore(book.title) : 0
  const el = document.createElement('div')
  el.className = 'book-option' + (unlocked ? '' : ' locked')

  if (unlocked) {
    el.innerHTML = `
      <div class="book-opt-title">${book.title}</div>
      <div class="book-opt-author">${book.author}</div>
      <div class="book-opt-meta">
        <span>${book.chapters.length} chapters</span>
        <span style="color:${diffColor}">${book.difficulty}</span>
        ${top > 0 ? `<span class="book-opt-score">★ ${top.toLocaleString()}</span>` : ''}
      </div>
    `
    el.addEventListener('click', () => loadAndStart(idx))
  } else {
    el.innerHTML = `
      <div class="book-opt-title locked-title">???</div>
      <div class="book-opt-author">???</div>
      <div class="book-opt-meta">
        <span>? chapters</span>
        <span style="color:${diffColor}">${book.difficulty}</span>
      </div>
    `
  }

  bookList.appendChild(el)
})

async function loadAndStart(bookIdx: number) {
  const book = BOOKS[bookIdx]
  const overlay = document.getElementById('loading-overlay')!
  const bar = document.getElementById('loading-bar')!
  const status = document.getElementById('loading-status')!
  const bookLabel = document.getElementById('loading-book')!

  // Show loading, hide picker
  document.getElementById('book-picker')!.style.display = 'none'
  overlay.classList.add('active')
  bookLabel.textContent = book.title
  bar.style.width = '0%'
  status.textContent = 'analyzing parts of speech...'

  // Async NLP — processes chapter-by-chapter, yields between each
  const tagMap = await tagBook(book.chapters, (ratio) => {
    // NLP is ~90% of the work, map 0–1 to 5%–90%
    const pct = Math.round(5 + ratio * 85)
    bar.style.width = `${pct}%`
    const done = Math.round(ratio * book.chapters.length)
    status.textContent = `analyzing chapter ${done} / ${book.chapters.length}...`
  })

  bar.style.width = '95%'
  status.textContent = `tagged ${tagMap.size} unique words`
  await new Promise(r => setTimeout(r, 200))

  bar.style.width = '100%'
  status.textContent = 'ready'
  await new Promise(r => setTimeout(r, 400))

  overlay.classList.remove('active')
  document.getElementById('app')!.style.display = 'flex'

  const canvas = document.getElementById('game') as HTMLCanvasElement
  const game = new Game(canvas, bookIdx, tagMap)
  activeGame = game

  let last = 0
  function loop(time: number) {
    const dt = Math.min((time - last) / 1000, 0.05)
    last = time
    game.update(dt)
    game.render()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame((time) => {
    last = time
    requestAnimationFrame(loop)
  })
}
