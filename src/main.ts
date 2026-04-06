import { Game, getTopScore } from './game'
import { BOOKS } from './content'
import { tagBook } from './tagger'

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
BOOKS.forEach((book, idx) => {
  const top = getTopScore(book.title)
  const el = document.createElement('div')
  el.className = 'book-option'
  const diffColors: Record<string, string> = { Easy: '#4ade80', Medium: '#fbbf24', Hard: '#f97316', 'Very Hard': '#f87171' }
  const diffColor = diffColors[book.difficulty] ?? '#c8d0dc'
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
