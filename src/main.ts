import { Game, getTopScore } from './game'
import { BOOKS, makeCustomBook, addCustomBook, removeCustomBook } from './content'
import { tagBook } from './tagger'
import { clearAllScores, isBookBeaten } from './scoring'
import { parseFile, detectFormat, ACCEPTED_EXTENSIONS } from './book-parser'
import { createTutorialBook, isTutorialDone, markTutorialDone, TutorialController } from './tutorial'

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
  if (activeGame && opening) {
    activeGame.paused = true
  }
}
miniStats.addEventListener('click', toggleSidebar)
miniStats.addEventListener('touchstart', (e) => { e.preventDefault(); toggleSidebar() })
sidebarBackdrop.addEventListener('click', toggleSidebar)

// ── Screen management ──────────────────────────────────────────
const mainMenu = document.getElementById('main-menu')!
const confirmForfeit = document.getElementById('confirm-forfeit')!
const bookPicker = document.getElementById('book-picker')!
const importOverlay = document.getElementById('import-overlay')!

function hideAll() {
  mainMenu.style.display = 'none'
  confirmForfeit.style.display = 'none'
  bookPicker.style.display = 'none'
  importOverlay.style.display = 'none'
  document.getElementById('app')!.style.display = 'none'
}

// ── Main menu ──────────────────────────────────────────────────
function showMainMenu() {
  hideAll()
  const save = Game.loadFromStorage()
  const menuBtns = document.getElementById('menu-buttons')!
  const subtitle = document.getElementById('menu-subtitle')!
  menuBtns.innerHTML = ''

  if (save) {
    const book = BOOKS[save.bookIdx]
    const chapter = book?.chapters[save.chapterIdx]
    const chLabel = chapter ? `Ch ${save.chapterIdx + 1}, P${save.paragraphIdx + 1}` : ''
    subtitle.textContent = ''

    const info = document.createElement('div')
    info.className = 'menu-save-info'
    info.innerHTML = `saved run: <strong style="color:#e8c44a">${book?.title ?? 'Unknown'}</strong><br>${chLabel} · ${save.score.toLocaleString()} pts · ${save.lives} lives · ${save.gold} gold`
    menuBtns.appendChild(info)

    const contBtn = document.createElement('button')
    contBtn.className = 'menu-btn'
    contBtn.textContent = 'CONTINUE RUN'
    contBtn.addEventListener('click', () => loadAndStart(save.bookIdx, save))
    menuBtns.appendChild(contBtn)

    const newBtn = document.createElement('button')
    newBtn.className = 'menu-btn'
    newBtn.textContent = 'NEW RUN'
    newBtn.addEventListener('click', () => showForfeitConfirm())
    menuBtns.appendChild(newBtn)

    const importBtn = document.createElement('button')
    importBtn.className = 'menu-btn muted'
    importBtn.textContent = 'IMPORT BOOK'
    importBtn.addEventListener('click', showImportOverlay)
    menuBtns.appendChild(importBtn)
  } else {
    subtitle.textContent = ''
    const newBtn = document.createElement('button')
    newBtn.className = 'menu-btn'
    newBtn.textContent = 'NEW RUN'
    newBtn.addEventListener('click', () => showBookPicker())
    menuBtns.appendChild(newBtn)

    const importBtn = document.createElement('button')
    importBtn.className = 'menu-btn muted'
    importBtn.textContent = 'IMPORT BOOK'
    importBtn.addEventListener('click', showImportOverlay)
    menuBtns.appendChild(importBtn)
  }

  mainMenu.style.display = 'flex'
}

// ── Forfeit confirmation ───────────────────────────────────────
function showForfeitConfirm() {
  hideAll()
  const btns = document.getElementById('forfeit-buttons')!
  btns.innerHTML = ''

  const yesBtn = document.createElement('button')
  yesBtn.className = 'menu-btn danger'
  yesBtn.textContent = 'YES, START OVER'
  yesBtn.addEventListener('click', () => {
    Game.clearSave()
    showBookPicker()
  })
  btns.appendChild(yesBtn)

  const noBtn = document.createElement('button')
  noBtn.className = 'menu-btn muted'
  noBtn.textContent = 'GO BACK'
  noBtn.addEventListener('click', () => showMainMenu())
  btns.appendChild(noBtn)

  confirmForfeit.style.display = 'flex'
}

// ── Book picker ────────────────────────────────────────────────
function showBookPicker() {
  hideAll()
  renderBookList()
  bookPicker.style.display = 'flex'
}

const bookList = document.getElementById('book-list')!
const diffColors: Record<string, string> = { Easy: '#4ade80', Medium: '#fbbf24', Hard: '#f97316', 'Very Hard': '#f87171', Custom: '#c084fc' }

function renderBookList() {
  bookList.innerHTML = ''

  // ── Tutorial section (above all difficulty tiers) ──
  const tutDone = isTutorialDone()
  const tutColor = tutDone ? '#e8c44a' : '#7dd3fc'
  const tutHeader = document.createElement('div')
  tutHeader.className = 'tier-header'
  tutHeader.innerHTML = `<span class="tier-line"></span><span style="color:${tutColor}">TUTORIAL</span><span class="tier-line"></span>`
  bookList.appendChild(tutHeader)

  const tutEl = document.createElement('div')
  tutEl.className = 'book-option' + (tutDone ? ' tutorial-done' : '')
  const tutScore = getTopScore('Tutorial')
  tutEl.innerHTML = `
    ${tutDone ? '<span class="book-opt-star">★</span>' : ''}
    <div class="book-opt-title" style="${tutDone ? 'color:#e8c44a;' : ''}">Tutorial</div>
    <div class="book-opt-author">Learn the basics</div>
    <div class="book-opt-meta">
      <span>${tutDone ? 'COMPLETED' : 'START HERE'}</span>
      ${tutScore > 0 ? `<span class="book-opt-score${tutDone ? ' beaten' : ''}">${tutScore.toLocaleString()}</span>` : ''}
      <span style="color:${tutColor}">Tutorial</span>
    </div>
  `
  tutEl.addEventListener('click', () => launchTutorial())
  bookList.appendChild(tutEl)

  let lastDiff = ''
  BOOKS.forEach((book, idx) => {
    const diffColor = diffColors[book.difficulty] ?? '#c8d0dc'
    const unlocked = book.difficulty === 'Custom' || isTierUnlocked(book.difficulty)

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
    const beaten = unlocked && isBookBeaten(book.title)
    const el = document.createElement('div')
    el.className = 'book-option' + (unlocked ? '' : ' locked') + (beaten ? ' played' : '')

    if (unlocked) {
      const isCustom = book.difficulty === 'Custom'
      el.innerHTML = `
        ${beaten ? '<span class="book-opt-star">★</span>' : ''}
        <div class="book-opt-title">${book.title}</div>
        <div class="book-opt-author">${book.author || 'Unknown'}</div>
        <div class="book-opt-meta">
          <span>${book.chapters.length} chapters</span>
          ${top > 0 ? `<span class="book-opt-score${beaten ? ' beaten' : ''}">${top.toLocaleString()}</span>` : ''}
          <span style="color:${diffColor}">${book.difficulty}</span>
          ${isCustom ? '<span class="book-opt-delete">✕</span>' : ''}
        </div>
      `
      el.addEventListener('click', (e) => {
        if (isCustom && (e.target as HTMLElement).classList.contains('book-opt-delete')) {
          removeCustomBook(idx)
          renderBookList()
          return
        }
        loadAndStart(idx)
      })
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

  // Import button at the bottom
  const importBtn = document.createElement('button')
  importBtn.className = 'menu-btn'
  importBtn.style.marginTop = '16px'
  importBtn.style.width = '100%'
  importBtn.textContent = '+ IMPORT YOUR OWN BOOK'
  importBtn.addEventListener('click', showImportOverlay)
  bookList.appendChild(importBtn)
}

// ── Import overlay ────────────────────────────────────────────
const importTitle = document.getElementById('import-title') as HTMLInputElement
const importAuthor = document.getElementById('import-author') as HTMLInputElement
const importText = document.getElementById('import-text') as HTMLTextAreaElement
const importFile = document.getElementById('import-file') as HTMLInputElement
const importDropZone = document.getElementById('import-drop-zone')!
const importInfo = document.getElementById('import-info')!
const importSubmit = document.getElementById('import-submit') as HTMLButtonElement
const importCancel = document.getElementById('import-cancel')!
const dropLabel = document.getElementById('drop-label')!

// Track the pending parsed file (for EPUB/DOCX which can't show in textarea)
let pendingParsed: Awaited<ReturnType<typeof parseFile>> | null = null

// Update accepted file types
importFile.setAttribute('accept', ACCEPTED_EXTENSIONS)

function showImportOverlay() {
  hideAll()
  importTitle.value = ''
  importAuthor.value = ''
  importText.value = ''
  importFile.value = ''
  importInfo.textContent = ''
  importSubmit.disabled = true
  pendingParsed = null
  importText.style.display = ''
  dropLabel.textContent = 'drop a file here or click to browse'
  importOverlay.style.display = 'flex'
}

function updateImportState() {
  const hasTitle = importTitle.value.trim().length > 0
  if (pendingParsed) {
    // File-based import (EPUB/DOCX/HTML) — title required, content already parsed
    importSubmit.disabled = !hasTitle
  } else {
    // Text-based import — need enough text + title
    const hasText = importText.value.trim().length > 50
    importSubmit.disabled = !(hasText && hasTitle)
    if (hasText) {
      const wordCount = importText.value.trim().split(/\s+/).length
      importInfo.textContent = `${wordCount.toLocaleString()} words detected`
    } else if (!importInfo.textContent.includes('chapters')) {
      importInfo.textContent = ''
    }
  }
}

importTitle.addEventListener('input', updateImportState)
importText.addEventListener('input', () => {
  // If user edits the textarea, clear any pending file parse
  if (pendingParsed) {
    pendingParsed = null
    importText.style.display = ''
  }
  updateImportState()
})

// File upload
importDropZone.addEventListener('click', () => importFile.click())
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0]
  if (file) handleFileImport(file)
})

// Drag & drop
importDropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  importDropZone.classList.add('dragover')
})
importDropZone.addEventListener('dragleave', () => {
  importDropZone.classList.remove('dragover')
})
importDropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  importDropZone.classList.remove('dragover')
  const file = e.dataTransfer?.files[0]
  if (file) handleFileImport(file)
})

async function handleFileImport(file: File) {
  const fmt = detectFormat(file.name)
  dropLabel.textContent = file.name

  if (!fmt) {
    importInfo.textContent = 'unsupported format'
    importInfo.style.color = '#f87171'
    setTimeout(() => { importInfo.style.color = '' }, 2000)
    return
  }

  const formatLabel = fmt.toUpperCase()

  if (fmt === 'txt') {
    // Plain text — read into textarea for editing
    pendingParsed = null
    importText.style.display = ''
    const text = await file.text()
    importText.value = text
    if (!importTitle.value.trim()) {
      importTitle.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    }
    updateImportState()
    return
  }

  // Binary/structured formats — parse directly
  importInfo.textContent = `parsing ${formatLabel}...`
  importSubmit.disabled = true

  try {
    const parsed = await parseFile(file)
    pendingParsed = parsed

    // Auto-fill title and author from file metadata
    if (!importTitle.value.trim() && parsed.title) {
      importTitle.value = parsed.title
    }
    if (!importAuthor.value.trim() && parsed.author) {
      importAuthor.value = parsed.author
    }

    // Show preview in textarea (read-only summary)
    const totalWords = parsed.chapters.reduce(
      (sum, ch) => sum + ch.paragraphs.reduce((s, p) => s + p.split(/\s+/).length, 0), 0
    )
    const totalParagraphs = parsed.chapters.reduce((sum, ch) => sum + ch.paragraphs.length, 0)

    // Show a preview of the parsed content
    const preview = parsed.chapters.map(ch => {
      const firstP = ch.paragraphs[0] ?? ''
      const snippet = firstP.length > 80 ? firstP.slice(0, 80) + '...' : firstP
      return `[${ch.title}] (${ch.paragraphs.length} paragraphs)\n  ${snippet}`
    }).join('\n\n')
    importText.value = preview
    importText.style.display = ''

    importInfo.textContent = `${formatLabel}: ${parsed.chapters.length} chapters, ${totalParagraphs.toLocaleString()} paragraphs, ${totalWords.toLocaleString()} words`
    updateImportState()
  } catch (err) {
    pendingParsed = null
    importInfo.textContent = `failed to parse ${formatLabel}: ${(err as Error).message}`
    importInfo.style.color = '#f87171'
    setTimeout(() => { importInfo.style.color = '' }, 3000)
  }
}

// Submit
importSubmit.addEventListener('click', () => {
  const title = importTitle.value.trim()
  const author = importAuthor.value.trim() || 'Unknown'

  if (pendingParsed) {
    // File-based import — use pre-parsed chapters
    if (!title) return
    const book = makeCustomBook(title, author, pendingParsed.chapters)
    const idx = addCustomBook(book)
    pendingParsed = null
    loadAndStart(idx)
  } else {
    // Text-based import — parse the textarea content
    const text = importText.value.trim()
    if (!title || text.length < 50) return
    // Use parseFile with a synthetic text file
    const blob = new File([text], 'import.txt', { type: 'text/plain' })
    parseFile(blob).then(parsed => {
      const book = makeCustomBook(title, author, parsed.chapters)
      const idx = addCustomBook(book)
      loadAndStart(idx)
    })
  }
})

importCancel.addEventListener('click', showBookPicker)

// ── Tutorial launcher ──────────────────────────────────────────
async function launchTutorial() {
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const book = createTutorialBook(isMobile)
  // Temporarily add tutorial book to BOOKS so Game can reference it by index
  let idx = BOOKS.findIndex(b => b.title === 'Tutorial' && (b.difficulty as string) === 'Tutorial')
  if (idx === -1) {
    idx = BOOKS.length
    BOOKS.push(book)
  } else {
    BOOKS[idx] = book
  }
  const tutorial = new TutorialController()
  loadAndStart(idx, null, tutorial)
}

// ── Load and start game ────────────────────────────────────────
async function loadAndStart(bookIdx: number, save?: ReturnType<Game['getSaveState']> | null, tutorial?: TutorialController) {
  const overlay = document.getElementById('loading-overlay')!
  const bar = document.getElementById('loading-bar')!
  const status = document.getElementById('loading-status')!
  const bookLabel = document.getElementById('loading-book')!

  hideAll()
  overlay.classList.add('active')

  try {
  const book = BOOKS[bookIdx]

  if (!book) {
    // Stale save pointing at a removed book — clear save and bail
    console.error(`[loadAndStart] bookIdx ${bookIdx} out of range (${BOOKS.length} books)`)
    overlay.classList.remove('active')
    if (save) Game.clearSave()
    showMainMenu()
    return
  }

  bookLabel.textContent = book.title
  bar.style.width = '0%'
  status.textContent = 'analyzing parts of speech...'

  const tagMap = await tagBook(book.chapters, (ratio) => {
    const pct = Math.round(5 + ratio * 85)
    bar.style.width = `${pct}%`
    const done = Math.round(ratio * book.chapters.length)
    status.textContent = `analyzing chapter ${done} / ${book.chapters.length}...`
  }, book.title)

  bar.style.width = '100%'
  status.textContent = 'ready'
  await new Promise(r => setTimeout(r, 150))

  overlay.classList.remove('active')
  document.getElementById('app')!.style.display = 'flex'

  const canvas = document.getElementById('game') as HTMLCanvasElement
  let running = true
  const game = new Game(canvas, bookIdx, tagMap, tutorial)
  activeGame = game

  // Tutorial: return to book picker when game ends
  if (tutorial) {
    game.onGameEnd = () => {
      running = false
      activeGame = null
      hideAll()
      showBookPicker()
    }
  }

  // Restore saved run state if provided
  if (save) {
    game.restoreFromSave(save)
  }

  let last = 0
  function loop(time: number) {
    if (!running) return
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

  } catch (err) {
    console.error('[loadAndStart] fatal error:', err)
    overlay.classList.remove('active')
    if (save) Game.clearSave()
    showMainMenu()
  }
}

// ── Entry point — always show menu so user can choose continue or new run ──
showMainMenu()
