import { Game, getTopScore } from './game'
import { BOOKS } from './content'
import { tagBook } from './tagger'

// Populate book picker
const bookList = document.getElementById('book-list')!
BOOKS.forEach((book, idx) => {
  const top = getTopScore(book.title)
  const el = document.createElement('div')
  el.className = 'book-option'
  el.innerHTML = `
    <div class="book-opt-title">${book.title}</div>
    <div class="book-opt-author">${book.author}</div>
    <div class="book-opt-meta">
      <span>${book.chapters.length} chapters</span>
      ${top > 0 ? `<span class="book-opt-score">★ ${top.toLocaleString()}</span>` : ''}
    </div>
  `
  el.addEventListener('click', () => loadAndStart(idx))
  bookList.appendChild(el)
})

function loadAndStart(bookIdx: number) {
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
  status.textContent = 'classifying words...'

  // Use setTimeout to let the UI paint the loading screen before blocking on NLP
  setTimeout(() => {
    bar.style.width = '40%'
    status.textContent = 'analyzing parts of speech...'

    setTimeout(() => {
      const tagMap = tagBook(book.chapters)
      bar.style.width = '80%'
      status.textContent = `tagged ${tagMap.size} unique words`

      setTimeout(() => {
        bar.style.width = '100%'
        status.textContent = 'ready'

        setTimeout(() => {
          overlay.classList.remove('active')
          document.getElementById('app')!.style.display = 'flex'

          const canvas = document.getElementById('game') as HTMLCanvasElement
          const game = new Game(canvas, bookIdx, tagMap)

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
        }, 400)
      }, 200)
    }, 50)
  }, 50)
}
