import type { WordTag } from './tagger'
import type { UpgradeType } from './types'

// ── Word color by NLP tag ───────────────────────────────────────
export const TAG_COLORS: Record<WordTag, string> = {
  stopword:  '#7a8394',  // gray (lighter — readable words)
  noun:      '#7dd3fc',  // cyan
  adverb:    '#4ade80',  // green
  verb:      '#fbbf24',  // amber
  person:    '#f9a8d4',  // pink
  place:     '#f9a8d4',  // pink (same as person — proper nouns)
  adjective: '#c084fc',  // violet
  big:       '#f87171',  // red — 10+ letter words (epic)
}

// Punctuation brick color — lighter gray, distinct from stopwords
export const PUNCTUATION_COLOR = '#555d6a'

// Active tag map — set when a book is loaded
let activeTagMap: Map<string, WordTag> = new Map()
let activeRareWords: Set<string> = new Set()

export function setActiveTagMap(map: Map<string, WordTag>) {
  activeTagMap = map
}

export function setActiveRareWords(set: Set<string>) {
  activeRareWords = set
}

let activeTitleWords: Set<string> = new Set()

export function setActiveTitleWords(set: Set<string>) {
  activeTitleWords = set
}

export function isTitleWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  return activeTitleWords.has(w)
}

/** Convert hex color to rgba string with given alpha (0-1) */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export function isPalindrome(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length < 4) return false
  const rev = w.split('').reverse().join('')
  return w === rev
}

const TITLE_STOP = new Set([
  'the','a','an','of','in','to','for','and','but','or','on','at','by','with','from','as','is','was',
])

/** Extract meaningful words from a book title, filtering out stopwords */
export function buildTitleWords(title: string): Set<string> {
  const words = new Set<string>()
  for (const token of title.split(/\s+/)) {
    const w = token.toLowerCase().replace(/[^a-z]/g, '')
    if (w.length > 0 && !TITLE_STOP.has(w)) words.add(w)
  }
  return words
}

export function isRareWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  return activeRareWords.has(w)
}

// Rare brick rainbow cycle — smoothly fades through tier colors
const RARE_CYCLE_COLORS = [
  TAG_COLORS.noun,       // cyan  (T1)
  TAG_COLORS.adverb,     // green (T1)
  TAG_COLORS.verb,       // amber (T2)
  TAG_COLORS.person,     // pink  (T2)
  TAG_COLORS.adjective,  // violet (T3)
  TAG_COLORS.big,        // red   (T4)
]
const RARE_CYCLE_PERIOD = 6  // seconds for full cycle

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

// Pre-compute RGB values for the cycle
const RARE_RGB = RARE_CYCLE_COLORS.map(hexToRgb)

/** Get the current smoothly-interpolated rainbow color for a rare brick */
export function rareColor(gameTime: number): string {
  const t = ((gameTime % RARE_CYCLE_PERIOD) + RARE_CYCLE_PERIOD) % RARE_CYCLE_PERIOD
  const fIdx = (t / RARE_CYCLE_PERIOD) * RARE_RGB.length
  const i = Math.floor(fIdx) % RARE_RGB.length
  const j = (i + 1) % RARE_RGB.length
  const frac = fIdx - Math.floor(fIdx)
  const a = RARE_RGB[i], b = RARE_RGB[j]
  return rgbToHex(
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  )
}

/** Get the nearest tier for whatever color the rare brick is currently showing */
export function rareColorTier(gameTime: number): number {
  const t = ((gameTime % RARE_CYCLE_PERIOD) + RARE_CYCLE_PERIOD) % RARE_CYCLE_PERIOD
  const fIdx = (t / RARE_CYCLE_PERIOD) * RARE_CYCLE_COLORS.length
  const nearest = Math.round(fIdx) % RARE_CYCLE_COLORS.length
  return colorTier(RARE_CYCLE_COLORS[nearest])
}

/** True if token has no letters — pure punctuation */
export function isPunctuation(word: string): boolean {
  return !/[a-zA-Z]/.test(word)
}

export function wordColor(word: string): string {
  if (isPunctuation(word)) return PUNCTUATION_COLOR
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  const tag = activeTagMap.get(w) ?? 'noun'
  return TAG_COLORS[tag]
}

// ── Upgrade drop system ────────────────────────────────────────
export function colorTier(color: string): number {
  if (color === TAG_COLORS.noun || color === TAG_COLORS.adverb) return 1
  if (color === TAG_COLORS.verb || color === TAG_COLORS.person) return 2
  if (color === TAG_COLORS.adjective) return 3
  if (color === TAG_COLORS.big) return 4
  return 0  // stopwords — no drops
}

export function dropChance(tier: number): number {
  if (tier === 1) return 0.025  // cyan/green — common, small effect
  if (tier === 2) return 0.035  // amber/pink — uncommon, medium effect
  if (tier === 3) return 0.045  // violet — rare, strong effect
  if (tier === 4) return 0.065  // red — epic, best effect
  return 0
}

export const UPGRADE_LABELS: Record<UpgradeType, string> = {
  widen: 'WIDEN',
  multiball: 'MULTI',
  safety: 'SAFETY',
  blast: 'BLAST',
  freeze: 'FREEZE',
  piercing: 'PIERCE',
  bigball: 'BIG BALL',
  magnet: 'MAGNET',
  homing: 'HOMING',
  ghost: 'GHOST',
}

// Pre-computed dot color ramp (rest → displaced)
export const DOT_COLORS = [
  '#2a2e35', '#2b2f36', '#2c3037', '#2d3138', '#2e3239', '#2f333a',
]

// Ball color ramps based on speed stacks (14 steps, 0-13)
// Gradual yellow → orange → red → white-hot at max
export const BALL_COLORS = [
  '#e8c44a',  // 0  gold yellow
  '#e8b844',  // 1  warm yellow
  '#e8ac3e',  // 2  yellow-gold
  '#e89c36',  // 3  yellow-orange
  '#e88c30',  // 4  light orange
  '#e87828',  // 5  orange
  '#e86420',  // 6  deep orange
  '#e84c1c',  // 7  orange-red
  '#e03818',  // 8  red-orange
  '#d82816',  // 9  medium red
  '#d01c14',  // 10 deep red
  '#c81010',  // 11 bright red
  '#e03030',  // 12 hot red
  '#f05050',  // 13 white-hot red
]

