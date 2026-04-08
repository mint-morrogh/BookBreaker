// ── Shop system — item generation, purchase logic, rendering ──

import type { ShopItem, ShopRarity, Particle } from './types'
import { roundRect } from './renderer'

// ── Rarity system ─────────────────────────────────────────────
export const RARITY_COLORS: Record<ShopRarity, string> = {
  common: '#6b7280',
  uncommon: '#4ade80',
  rare: '#7dd3fc',
  epic: '#c084fc',
}
const RARITY_LABELS: Record<ShopRarity, string> = {
  common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC',
}
function rollRarity(postBoss = false): ShopRarity {
  const r = Math.random()
  if (postBoss) {
    // Post-boss shop: much higher rare/epic rates
    if (r < 0.15) return 'common'
    if (r < 0.40) return 'uncommon'
    if (r < 0.75) return 'rare'
    return 'epic'
  }
  if (r < 0.45) return 'common'
  if (r < 0.75) return 'uncommon'
  if (r < 0.93) return 'rare'
  return 'epic'
}
const RARITY_PRICE: Record<ShopRarity, number> = {
  common: 0.8, uncommon: 1.0, rare: 1.3, epic: 1.7,
}

// ── Item pool ─────────────────────────────────────────────────
// Each item is one concept. Rarity determines tier (effect strength) AND price.
// tierNames/tierDescs define the display per rarity tier (common=1, uncommon=2, rare=3, epic=4).
interface ShopPoolEntry {
  id: string
  basePrice: number            // price at common; scales up with rarity
  isLife?: boolean
  tierNames: [string, string, string, string]   // [common, uncommon, rare, epic]
  tierDescs: [string, string, string, string]
}
export const SHOP_POOL: ShopPoolEntry[] = [
  { id: 'life', basePrice: 300, isLife: true,
    tierNames: ['+1 LIFE', '+2 LIVES', '+3 LIVES', '+5 LIVES'],
    tierDescs: ['Extra life', 'Two extra lives', 'Three extra lives', 'Five extra lives'] },
  { id: 'widen', basePrice: 80,
    tierNames: ['WIDEN +1', 'WIDEN +2', 'WIDEN +3', 'WIDEN +4'],
    tierDescs: ['Expand paddle +1', 'Expand paddle +2', 'Expand paddle +3', 'Expand paddle +4'] },
  { id: 'multi', basePrice: 100,
    tierNames: ['MULTIBALL', 'MULTIBALL', 'MULTIBALL', 'MULTIBALL'],
    tierDescs: ['Start with 3 balls', 'Start with 3 balls', 'Start with 3 balls', 'Start with 3 balls'] },
  { id: 'safety', basePrice: 80,
    tierNames: ['SAFETY +1', 'SAFETY +2', 'SAFETY +3', 'SAFETY +4'],
    tierDescs: ['+1 safety bar hit', '+2 safety bar hits', '+3 safety bar hits', '+4 safety bar hits'] },
  { id: 'blast', basePrice: 100,
    tierNames: ['BLAST', 'BLAST +', 'BLAST ++', 'BLAST +++'],
    tierDescs: ['Explosive charge', 'Stronger charge', 'Powerful charge', 'Maximum charge'] },
  { id: 'pierce', basePrice: 90,
    tierNames: ['PIERCE +3', 'PIERCE +6', 'PIERCE +9', 'PIERCE +12'],
    tierDescs: ['Punch through 3', 'Punch through 6', 'Punch through 9', 'Punch through 12'] },
  { id: 'lucky', basePrice: 90,
    tierNames: ['LUCKY +1%', 'LUCKY +2%', 'LUCKY +3%', 'LUCKY +5%'],
    tierDescs: ['Drop chance +1%', 'Drop chance +2%', 'Drop chance +3%', 'Drop chance +5%'] },
  { id: 'bigball', basePrice: 100,
    tierNames: ['BIG BALL', 'BIG BALL +', 'BIG BALL ++', 'BIG BALL +++'],
    tierDescs: ['Ball size +40%', 'Ball size +80%', 'Ball size +120%', 'Ball size +160%'] },
  { id: 'magnet', basePrice: 80,
    tierNames: ['MAGNET x4', 'MAGNET x6', 'MAGNET x8', 'MAGNET x12'],
    tierDescs: ['4 magnetic catches', '6 magnetic catches', '8 magnetic catches', '12 magnetic catches'] },
  { id: 'homing', basePrice: 90,
    tierNames: ['HOMING x4', 'HOMING x6', 'HOMING x8', 'HOMING x12'],
    tierDescs: ['4 guided shots', '6 guided shots', '8 guided shots', '12 guided shots'] },
  { id: 'ghost', basePrice: 100,
    tierNames: ['GHOST x2', 'GHOST x3', 'GHOST x4', 'GHOST x5'],
    tierDescs: ['Phase through 2 bricks', 'Phase through 3 bricks', 'Phase through 4 bricks', 'Phase through 5 bricks'] },
]

const RARITY_TIER: Record<ShopRarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4 }

// ── Shop state needed for maxed checks ────────────────────────
export interface ShopMaxedState {
  widenLevel: number
  safetyHits: number
  ballSizeBonus: number
  maxWiden: number
  maxSafety: number
}

export function isShopItemMaxed(id: string, state: ShopMaxedState): boolean {
  if (id === 'widen') return state.widenLevel >= state.maxWiden
  if (id === 'safety') return state.safetyHits >= state.maxSafety
  if (id === 'bigball') return state.ballSizeBonus >= 2.0
  return false
}

// Difficulty price multiplier — harder books earn more gold, so upgrades cost more
const DIFFICULTY_PRICE: Record<string, number> = {
  'Tutorial': 1.0, 'Easy': 1.0, 'Medium': 1.4, 'Hard': 1.9, 'Very Hard': 2.5, 'Custom': 1.2,
}

const REROLL_BASE_COST = 150

export function getRerollCost(difficulty?: string): number {
  return Math.round(REROLL_BASE_COST * (DIFFICULTY_PRICE[difficulty ?? 'Easy'] ?? 1.0))
}

export function generateShopItems(state: ShopMaxedState, difficulty?: string, postBoss = false): ShopItem[] {
  const diffMult = DIFFICULTY_PRICE[difficulty ?? 'Easy'] ?? 1.0
  const lifeOpts = SHOP_POOL.filter(s => s.isLife)
  const others = SHOP_POOL.filter(s => !s.isLife && !isShopItemMaxed(s.id, state))
  const picked: ShopItem[] = []

  const toShopItem = (entry: ShopPoolEntry, maxed = false): ShopItem => {
    const rarity = rollRarity(postBoss)
    const tier = RARITY_TIER[rarity]  // 1-4
    const ti = tier - 1               // 0-3 index
    return {
      id: entry.id,
      name: entry.tierNames[ti],
      desc: entry.tierDescs[ti],
      price: Math.round(entry.basePrice * RARITY_PRICE[rarity] * diffMult),
      rarity,
      tier,
      bought: maxed,
      maxed,
    }
  }

  picked.push(toShopItem(lifeOpts[Math.floor(Math.random() * lifeOpts.length)]))
  const shuffled = others.slice().sort(() => Math.random() - 0.5)
  for (let i = 0; i < 5 && i < shuffled.length; i++) {
    picked.push(toShopItem(shuffled[i]))
  }
  return picked.sort(() => Math.random() - 0.5)
}

// ── Shop rendering ────────────────────────────────────────────
export interface ShopRenderState {
  shopItems: ShopItem[]
  shopRects: { x: number; y: number; w: number; h: number }[]
  shopContinueRect: { x: number; y: number; w: number; h: number }
  shopRerollRect: { x: number; y: number; w: number; h: number }
  rerollCost: number
  gold: number
  particles: Particle[]
  isMobile: boolean
  W: number
}

export function renderShop(ctx: CanvasRenderingContext2D, W: number, H: number, state: ShopRenderState): void {
  const blur = state.isMobile ? 0.35 : 1
  const narrow = state.W < 700

  // Dark backdrop
  ctx.fillStyle = 'rgba(6, 8, 12, 0.92)'
  ctx.fillRect(0, 0, W, H)

  // Bordered panel
  const firstR = state.shopRects[0]
  const lastR = state.shopRects[state.shopRects.length - 1]
  const panelPad = narrow ? 16 : 24
  const panelX = firstR.x - panelPad
  const panelY = firstR.y - (narrow ? 100 : 120)
  const panelRight = lastR.x + lastR.w + panelPad
  const panelBottom = state.shopContinueRect.y + state.shopContinueRect.h + panelPad
  const panelW = panelRight - panelX
  const panelH = panelBottom - panelY

  ctx.fillStyle = '#0a0e14'
  ctx.strokeStyle = '#1a2030'
  ctx.lineWidth = 2
  roundRect(ctx, panelX, panelY, panelW, panelH, 8)
  ctx.fill()
  ctx.stroke()

  // Gold accent line
  ctx.strokeStyle = '#e8c44a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(panelX + 8, panelY)
  ctx.lineTo(panelRight - 8, panelY)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Title
  const titleY = firstR.y - (narrow ? 78 : 96)
  ctx.fillStyle = '#e8c44a'
  ctx.shadowColor = '#e8c44a'
  ctx.shadowBlur = 18 * blur
  ctx.font = `bold ${narrow ? 22 : 28}px 'JetBrains Mono', monospace`
  ctx.fillText('◆  SHOP  ◆', W / 2, titleY)
  ctx.shadowBlur = 0

  // Gold display
  const goldY = firstR.y - (narrow ? 48 : 58)
  ctx.fillStyle = '#fbbf24'
  ctx.shadowColor = '#fbbf24'
  ctx.shadowBlur = 6 * blur
  ctx.font = `bold ${narrow ? 16 : 20}px 'JetBrains Mono', monospace`
  ctx.fillText(`◆ ${state.gold}`, W / 2, goldY)
  ctx.shadowBlur = 0

  // Reroll button
  const rr = state.shopRerollRect
  const canReroll = state.gold >= state.rerollCost
  ctx.fillStyle = canReroll ? '#0c1018' : '#080a10'
  ctx.strokeStyle = canReroll ? '#4a5568' : '#1a2030'
  ctx.lineWidth = 1
  roundRect(ctx, rr.x, rr.y, rr.w, rr.h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.font = `bold ${narrow ? 10 : 12}px 'JetBrains Mono', monospace`
  ctx.fillStyle = canReroll ? '#6b7280' : '#2a3040'
  ctx.fillText(`REROLL  ◆${state.rerollCost}`, rr.x + rr.w / 2, rr.y + rr.h / 2)

  // Hint
  const hintY = firstR.y - (narrow ? 12 : 16)
  ctx.fillStyle = '#374151'
  ctx.font = `${narrow ? 9 : 11}px 'JetBrains Mono', monospace`
  ctx.fillText(narrow ? 'tap to buy · tap CONTINUE to skip' : 'click to purchase  ·  SPACE to continue', W / 2, hintY)

  // Item cards
  for (let i = 0; i < state.shopItems.length && i < state.shopRects.length; i++) {
    const item = state.shopItems[i]
    const r = state.shopRects[i]
    const canAfford = state.gold >= item.price
    const dimmed = item.bought || item.maxed || !canAfford
    const rarityColor = RARITY_COLORS[item.rarity]

    ctx.fillStyle = item.bought ? '#080a10' : '#0c1018'
    roundRect(ctx, r.x, r.y, r.w, r.h, 5)
    ctx.fill()

    if (!item.bought && canAfford) {
      ctx.shadowColor = rarityColor
      ctx.shadowBlur = 8 * blur
    }
    ctx.strokeStyle = item.bought ? '#1a2030' : (canAfford ? rarityColor : '#1f1215')
    ctx.lineWidth = item.bought ? 1 : 1.5
    roundRect(ctx, r.x, r.y, r.w, r.h, 5)
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.globalAlpha = dimmed ? 0.25 : 1.0

    ctx.fillStyle = rarityColor
    ctx.font = `bold ${narrow ? 8 : 9}px 'JetBrains Mono', monospace`
    ctx.fillText(RARITY_LABELS[item.rarity], r.x + r.w / 2, r.y + r.h * 0.14)

    ctx.strokeStyle = rarityColor
    ctx.globalAlpha = dimmed ? 0.1 : 0.35
    ctx.lineWidth = 1
    ctx.beginPath()
    const lineInset = narrow ? 16 : 24
    ctx.moveTo(r.x + lineInset, r.y + r.h * 0.22)
    ctx.lineTo(r.x + r.w - lineInset, r.y + r.h * 0.22)
    ctx.stroke()
    ctx.globalAlpha = dimmed ? 0.25 : 1.0

    ctx.fillStyle = '#e0e4ea'
    ctx.font = `bold ${narrow ? 12 : 14}px 'JetBrains Mono', monospace`
    ctx.fillText(item.name, r.x + r.w / 2, r.y + r.h * 0.42)

    ctx.fillStyle = '#5a6578'
    ctx.font = `${narrow ? 8 : 10}px 'JetBrains Mono', monospace`
    ctx.fillText(item.desc, r.x + r.w / 2, r.y + r.h * 0.60)

    if (item.maxed) {
      ctx.fillStyle = '#5a6578'
      ctx.font = `bold ${narrow ? 10 : 11}px 'JetBrains Mono', monospace`
      ctx.fillText('── MAXED ──', r.x + r.w / 2, r.y + r.h * 0.82)
    } else if (item.bought) {
      ctx.fillStyle = '#374151'
      ctx.font = `bold ${narrow ? 10 : 11}px 'JetBrains Mono', monospace`
      ctx.fillText('── SOLD ──', r.x + r.w / 2, r.y + r.h * 0.82)
    } else {
      ctx.fillStyle = canAfford ? '#fbbf24' : '#f87171'
      ctx.font = `bold ${narrow ? 12 : 14}px 'JetBrains Mono', monospace`
      ctx.fillText(`◆ ${item.price}`, r.x + r.w / 2, r.y + r.h * 0.82)
    }

    ctx.globalAlpha = 1.0
  }

  // Divider
  const divY = state.shopContinueRect.y - 10
  ctx.strokeStyle = '#1a2030'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(firstR.x, divY)
  ctx.lineTo(lastR.x + lastR.w, divY)
  ctx.stroke()

  // Continue button
  const cr = state.shopContinueRect
  ctx.fillStyle = '#0c1018'
  ctx.strokeStyle = '#5a6578'
  ctx.lineWidth = 1.5
  roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 5)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#7dd3fc'
  ctx.shadowColor = '#7dd3fc'
  ctx.shadowBlur = 6 * blur
  ctx.font = `bold ${narrow ? 13 : 16}px 'JetBrains Mono', monospace`
  ctx.fillText('CONTINUE  ▶', W / 2, cr.y + cr.h / 2)
  ctx.shadowBlur = 0

  // Particles (purchase feedback)
  for (const p of state.particles) {
    const lifeRatio = p.life / p.maxLife
    ctx.globalAlpha = lifeRatio
    ctx.fillStyle = p.color
    const fontSize = Math.round(p.size * (0.5 + lifeRatio * 0.5))
    ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.char, p.x, p.y)
  }
  ctx.globalAlpha = 1.0
}
