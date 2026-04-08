export interface Brick {
  word: string
  x: number
  y: number
  w: number
  h: number
  alive: boolean
  alpha: number      // for fade-out
  color: string
  points: number
  boxed: boolean     // false for stopwords — just text, no box
  breakOff: number      // 0 = normal, >0 = seconds until explosion
  breakOffVx: number    // drift velocity when breaking off (shared per group)
  breakOffAngle: number // rotation when breaking off
  breakOffGroupId: number // island group id (0 = none)
  breakOffOrigX: number   // original x at time of break-off
  breakOffOrigY: number   // original y at time of break-off
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  trail: { x: number; y: number; age: number }[]
  stuck: boolean     // stuck to paddle until launched
  backWallHits: number  // speed stacks from hitting back wall (max 10)
  slamStacks: number    // speed stacks from paddle slams (decays on non-slam paddle hits)
  blastCharge: number   // 0 = none, else tier (1-4) = blast radius on next hit
  pierceLeft: number    // 0 = normal bounce, else bricks remaining to pierce through
  magnetSpeed: number   // if > 0, launch at this speed instead of default (preserved from catch)
  magnetImmunity: number // seconds of immunity to magnet re-catch after launching from magnet
  magnetOffsetX: number  // x offset from paddle center when caught by magnet (0 = centered/normal)
  homingLeft: number    // remaining homing shots (0 = normal, >0 = arc toward highest-value brick)
  homingCooldown: number // seconds of free movement after a homing hit before re-engaging
  ghostLeft: number     // remaining ghost phases (0 = normal, >0 = phase through bricks without bouncing)
  ghostPhasedBricks: Set<Brick>  // bricks already phased through (each brick only costs 1 charge)
  bossImmunity: number  // seconds of immunity to boss damage after hitting boss (prevents multi-hit)
}

export interface Particle {
  x: number; y: number
  vx: number; vy: number
  char: string
  life: number; maxLife: number
  color: string
  size: number
}

export type UpgradeType = 'widen' | 'multiball' | 'safety' | 'blast' | 'freeze' | 'piercing' | 'bigball' | 'magnet' | 'homing' | 'ghost'

export interface Pickup {
  label: string
  x: number
  y: number
  vy: number
  wobblePhase: number
  type: UpgradeType
  tier: number       // 1-4
  color: string
  alive: boolean
}

export interface Shrapnel {
  x: number; y: number
  vx: number; vy: number
  life: number  // seconds remaining
}

export interface Dot {
  homeX: number
  homeY: number
  x: number
  y: number
  vx: number
  vy: number
}

export type ShopRarity = 'common' | 'uncommon' | 'rare' | 'epic'

export interface ShopItem {
  id: string
  name: string
  desc: string
  price: number
  rarity: ShopRarity
  tier: number       // 1-4, derived from rarity — determines effect strength
  bought: boolean
  maxed?: boolean
}
