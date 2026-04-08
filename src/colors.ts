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

export function setActiveTagMap(map: Map<string, WordTag>) {
  activeTagMap = map
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
  if (tier === 1) return 0.035  // cyan/green — common, small effect
  if (tier === 2) return 0.045  // amber/pink — uncommon, medium effect
  if (tier === 3) return 0.055  // violet — rare, strong effect
  if (tier === 4) return 0.08   // red — epic, best effect
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

