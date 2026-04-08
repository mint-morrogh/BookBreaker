// ── Save / Restore — localStorage persistence for game runs ──

import type { Ball, Brick, Pickup } from './types'

export interface SaveState {
  // Book/level position
  bookIdx: number
  chapterIdx: number
  paragraphIdx: number
  levelParagraphCount: number
  levelState: 'playing' | 'grayCleanup' | 'endPopping' | 'endTally' | 'endGrade' | 'shop'

  // Scoring / progression
  score: number
  lives: number
  gold: number
  paragraphsCompleted: number
  wordsBroken: number
  letterCounts: Record<string, number>
  alphabetCompletions: number
  nextLifeScore: number
  multiplier: number
  charge: number

  // Upgrades
  dropBonus: number
  widenLevel: number
  safetyHits: number
  ballSizeBonus: number
  magnetCharges: number

  // Mid-level snapshot
  bricks: BrickSnap[]
  balls: BallSnap[]
  pickups: PickupSnap[]
  bricksScrollY: number
  wordCursor: number
  totalWordsInParagraph: number
  levelBasePoints: number
  started: boolean
  hasLaunched: boolean
  hasRecalled: boolean
  backWallActive: boolean
  backWallReveal: number
  freezeTimer: number
  bricksDriftSpeed: number
  paddleX: number
  paddleW: number
  paddleText: string
  safetyX: number
  safetyDir: number
  levelWords: { word: string; color: string; points: number }[]
  levelLivesLost: number
  brickHitThisLevel: boolean
}

// Compact brick snapshot (skip dead bricks entirely)
interface BrickSnap {
  w: string  // word
  x: number
  y: number
  bw: number // width
  h: number
  c: string  // color
  p: number  // points
  bx: boolean // boxed
  bo: number  // breakOff
  bg: number  // breakOffGroupId
}

// Compact ball snapshot
interface BallSnap {
  x: number; y: number
  vx: number; vy: number
  r: number
  stuck: boolean
  bwh: number  // backWallHits
  ss: number   // slamStacks
  bc: number   // blastCharge
  pl: number   // pierceLeft
  ms: number   // magnetSpeed
  mi: number   // magnetImmunity
  mo: number   // magnetOffsetX
  hl: number   // homingLeft
  hc: number   // homingCooldown
  gl: number   // ghostLeft
}

interface PickupSnap {
  label: string
  x: number; y: number
  vy: number
  wp: number  // wobblePhase
  type: string
  tier: number
  color: string
}

const SAVE_KEY = 'bb_run_save'

export function saveToStorage(state: SaveState): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state))
}

export function loadFromStorage(): SaveState | null {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY)
}

// ── Snapshot helpers for game.ts to use ──

export function snapBrick(b: Brick): BrickSnap {
  return {
    w: b.word, x: b.x, y: b.y, bw: b.w, h: b.h,
    c: b.color, p: b.points, bx: b.boxed,
    bo: b.breakOff, bg: b.breakOffGroupId,
  }
}

export function unsnapBrick(s: BrickSnap): Brick {
  return {
    word: s.w, x: s.x, y: s.y, w: s.bw, h: s.h,
    alive: true, alpha: 1, color: s.c, points: s.p, boxed: s.bx,
    breakOff: s.bo, breakOffVx: 0, breakOffAngle: 0,
    breakOffGroupId: s.bg, breakOffOrigX: s.x, breakOffOrigY: s.y,
  }
}

export function snapBall(b: Ball): BallSnap {
  return {
    x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r,
    stuck: b.stuck, bwh: b.backWallHits, ss: b.slamStacks,
    bc: b.blastCharge, pl: b.pierceLeft,
    ms: b.magnetSpeed, mi: b.magnetImmunity, mo: b.magnetOffsetX,
    hl: b.homingLeft, hc: b.homingCooldown, gl: b.ghostLeft,
  }
}

export function unsnapBall(s: BallSnap): Ball {
  return {
    x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: s.r,
    trail: [], stuck: s.stuck,
    backWallHits: s.bwh, slamStacks: s.ss,
    blastCharge: s.bc, pierceLeft: s.pl,
    magnetSpeed: s.ms, magnetImmunity: s.mi, magnetOffsetX: s.mo,
    homingLeft: s.hl, homingCooldown: s.hc, ghostLeft: s.gl ?? 0,
    ghostPhasedBricks: new Set(),
  }
}

export function snapPickup(p: Pickup): PickupSnap {
  return {
    label: p.label, x: p.x, y: p.y, vy: p.vy,
    wp: p.wobblePhase, type: p.type, tier: p.tier, color: p.color,
  }
}

export function unsnapPickup(s: PickupSnap): Pickup {
  return {
    label: s.label, x: s.x, y: s.y, vy: s.vy,
    wobblePhase: s.wp, type: s.type as any, tier: s.tier,
    color: s.color, alive: true,
  }
}
