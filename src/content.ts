import { TALE_OF_TWO_CITIES } from './books/tale-of-two-cities'
import { MOBY_DICK } from './books/moby-dick'
import { PRIDE_AND_PREJUDICE } from './books/pride-and-prejudice'
import { ALICE_IN_WONDERLAND } from './books/alice-in-wonderland'
import { GREAT_GATSBY } from './books/great-gatsby'
import { WIZARD_OF_OZ } from './books/wizard-of-oz'
import { PETER_PAN } from './books/peter-pan'
import { TOM_SAWYER } from './books/tom-sawyer'
import { FRANKENSTEIN } from './books/frankenstein'
import { DRACULA } from './books/dracula'
import { TREASURE_ISLAND } from './books/treasure-island'
import { DORIAN_GRAY } from './books/dorian-gray'
import { JANE_EYRE } from './books/jane-eyre'
import { WUTHERING_HEIGHTS } from './books/wuthering-heights'
import { CRIME_AND_PUNISHMENT } from './books/crime-and-punishment'
import { LES_MISERABLES } from './books/les-miserables'
import { WAR_AND_PEACE } from './books/war-and-peace'

export interface Chapter {
  title: string
  paragraphs: string[]
}

export type Difficulty = 'Tutorial' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard' | 'Custom'

export interface Book {
  title: string
  author: string
  difficulty: Difficulty
  chapters: Chapter[]
}

export const BUILTIN_BOOKS: Book[] = [
  { ...PRIDE_AND_PREJUDICE, difficulty: 'Easy' },
  { ...ALICE_IN_WONDERLAND, difficulty: 'Easy' },
  { ...WIZARD_OF_OZ, difficulty: 'Easy' },
  { ...PETER_PAN, difficulty: 'Easy' },
  { ...TOM_SAWYER, difficulty: 'Easy' },
  { ...TALE_OF_TWO_CITIES, difficulty: 'Medium' },
  { ...FRANKENSTEIN, difficulty: 'Medium' },
  { ...DRACULA, difficulty: 'Medium' },
  { ...TREASURE_ISLAND, difficulty: 'Medium' },
  { ...DORIAN_GRAY, difficulty: 'Medium' },
  { ...GREAT_GATSBY, difficulty: 'Medium' },
  { ...MOBY_DICK, difficulty: 'Hard' },
  { ...JANE_EYRE, difficulty: 'Hard' },
  { ...WUTHERING_HEIGHTS, difficulty: 'Hard' },
  { ...CRIME_AND_PUNISHMENT, difficulty: 'Hard' },
  { ...LES_MISERABLES, difficulty: 'Very Hard' },
  { ...WAR_AND_PEACE, difficulty: 'Very Hard' },
]

// ── Custom book import ────────────────────────────────────────
const STORAGE_KEY = 'bb_custom_books'

interface StoredBook {
  title: string
  author: string
  chapters: Chapter[]
}

function loadCustomBooks(): StoredBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCustomBooks(books: StoredBook[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books))
}

export function makeCustomBook(title: string, author: string, chapters: Chapter[]): Book {
  return { title, author, difficulty: 'Custom' as Difficulty, chapters }
}

export function addCustomBook(book: Book): number {
  const stored = loadCustomBooks()
  stored.push({ title: book.title, author: book.author, chapters: book.chapters })
  saveCustomBooks(stored)
  // Add to live BOOKS array, return its index
  BOOKS.push(book)
  return BOOKS.length - 1
}

export function removeCustomBook(bookIdx: number) {
  const book = BOOKS[bookIdx]
  if (!book || book.difficulty !== ('Custom' as Difficulty)) return
  BOOKS.splice(bookIdx, 1)
  const stored = loadCustomBooks()
  const filtered = stored.filter(b => b.title !== book.title)
  saveCustomBooks(filtered)
}

export function getCustomBookCount(): number {
  return BOOKS.length - BUILTIN_BOOKS.length
}

// Build the live BOOKS array: builtins + persisted custom books
export const BOOKS: Book[] = [
  ...BUILTIN_BOOKS,
  ...loadCustomBooks().map(b => ({ ...b, difficulty: 'Custom' as Difficulty })),
]
