import type { WordTag } from './tagger'
import type { UpgradeType } from './types'

// ── Word color by NLP tag ───────────────────────────────────────
export const TAG_COLORS: Record<WordTag, string> = {
  stopword:  '#555d6a',  // gray
  noun:      '#7dd3fc',  // cyan
  adverb:    '#4ade80',  // green
  verb:      '#fbbf24',  // amber
  person:    '#f9a8d4',  // pink
  place:     '#f9a8d4',  // pink (same as person — proper nouns)
  adjective: '#c084fc',  // violet
  big:       '#f87171',  // red — 10+ letter words (epic)
}

// Active tag map — set when a book is loaded
let activeTagMap: Map<string, WordTag> = new Map()

export function setActiveTagMap(map: Map<string, WordTag>) {
  activeTagMap = map
}

export function wordColor(word: string): string {
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
  if (tier === 1) return 0.07   // cyan/green — common, small effect
  if (tier === 2) return 0.08   // amber/pink — uncommon, medium effect
  if (tier === 3) return 0.09   // violet — rare, strong effect
  if (tier === 4) return 0.15   // red — epic, best effect
  return 0
}

export const UPGRADE_LABELS: Record<UpgradeType, string> = {
  widen: 'WIDEN',
  multiball: 'MULTI',
  safety: 'SAFETY',
  blast: 'BLAST',
  freeze: 'FREEZE',
  piercing: 'PIERCE',
}

// Pre-computed dot color ramp (rest → displaced)
export const DOT_COLORS = [
  '#2a2e35', '#2b2f36', '#2c3037', '#2d3138', '#2e3239', '#2f333a',
]

// Ball color ramps based on backWallHits
export const BALL_COLORS = [
  '#e8c44a', '#e8a33a', '#e88030', '#e86028',
  '#f85030', '#f83828', '#f82020', '#ff3050',
  '#ff5070', '#ff80a0', '#ffb0c0',
]

export const TRAIL_COLORS = [
  '#7dd3fc', '#8dc0f0', '#a0a8e0', '#b890d0',
  '#d080b0', '#e07090', '#f06070', '#ff5060',
  '#ff7080', '#ffa0a0', '#ffc8c8',
]
