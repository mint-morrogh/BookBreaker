// ── Island detection and break-off group management ──

import type { Brick } from './types'

export interface IslandGroup {
  cx0: number; cy0: number
  vx: number; vy: number
  rotSpeed: number
  angle: number
  timer: number
  initTimer: number
}

export interface IslandDetectResult {
  newGroups: Map<number, IslandGroup>
  nextIslandId: number
}

export function detectIslands(
  bricks: Brick[],
  totalBrickCount: number,
  bricksDriftSpeed: number,
  nextIslandId: number,
): IslandDetectResult {
  const result: IslandDetectResult = { newGroups: new Map(), nextIslandId }
  const alive = bricks.filter(b => b.alive && b.breakOff === 0)
  if (alive.length === 0) return result

  const rowGap = 45
  const xTolerance = 4

  // Union-find
  const parent = new Map<Brick, Brick>()
  const find = (b: Brick): Brick => {
    let r = b
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = b
    while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n }
    return r
  }
  const union = (a: Brick, b: Brick) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const b of alive) parent.set(b, b)

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j]
      const dy = Math.abs(a.y - b.y)
      if (dy > rowGap) continue
      if (a.x + a.w + xTolerance >= b.x && b.x + b.w + xTolerance >= a.x) {
        union(a, b)
      }
    }
  }

  // Group by root
  const groups = new Map<Brick, Brick[]>()
  for (const b of alive) {
    const root = find(b)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(b)
  }

  const totalAliveIncBreakOff = bricks.filter(b => b.alive).length
  if (groups.size <= 1 && totalAliveIncBreakOff === totalBrickCount) return result

  // Find largest group
  let mainGroup: Brick[] | null = null
  let maxLen = 0
  let secondMaxLen = 0
  for (const g of groups.values()) {
    if (g.length > maxLen) {
      secondMaxLen = maxLen
      maxLen = g.length
      mainGroup = g
    } else if (g.length > secondMaxLen) {
      secondMaxLen = g.length
    }
  }
  if (maxLen === secondMaxLen) mainGroup = null

  // Flag islands for break-off
  const mainSet = mainGroup ? new Set(mainGroup) : new Set<Brick>()
  for (const g of groups.values()) {
    if (g === mainGroup) continue
    if (g.length > 3) continue

    let cx = 0, cy = 0
    for (const b of g) { cx += b.x + b.w / 2; cy += b.y + b.h / 2 }
    cx /= g.length; cy /= g.length

    const groupId = result.nextIslandId++
    const timer = 1.2 + Math.random() * 0.4
    const vx = (Math.random() - 0.5) * 10
    const vy = -(bricksDriftSpeed * 0.4 + Math.random() * 4)
    const rotSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.12)

    result.newGroups.set(groupId, {
      cx0: cx, cy0: cy, vx, vy, rotSpeed, angle: 0, timer, initTimer: timer,
    })

    for (const b of g) {
      if (mainSet.has(b)) continue
      b.breakOff = timer
      b.breakOffVx = 0
      b.breakOffAngle = 0
      b.breakOffGroupId = groupId
      b.breakOffOrigX = b.x
      b.breakOffOrigY = b.y
    }
  }

  return result
}

// ── Per-frame island group update ─────────────────────────────

export interface IslandPopResult {
  groupId: number
  bricks: Brick[]
  totalBonus: number
  label: string
  popX: number
  popY: number
}

/** Move island groups and return any that popped this frame */
export function updateIslandGroups(
  islandGroups: Map<number, IslandGroup>,
  bricks: Brick[],
  dt: number,
  bricksScrollY: number,
): IslandPopResult[] {
  const pops: IslandPopResult[] = []

  for (const [groupId, grp] of islandGroups) {
    grp.timer -= dt
    const bricksInGroup = bricks.filter(b => b.alive && b.breakOffGroupId === groupId)
    if (bricksInGroup.length === 0) { islandGroups.delete(groupId); continue }

    const elapsed = grp.initTimer - grp.timer
    grp.angle += grp.rotSpeed * dt
    const cx = grp.cx0 + grp.vx * elapsed
    const cy = grp.cy0 + grp.vy * elapsed
    const cosA = Math.cos(grp.angle)
    const sinA = Math.sin(grp.angle)
    for (const b of bricksInGroup) {
      const dx = (b.breakOffOrigX + b.w / 2) - grp.cx0
      const dy = (b.breakOffOrigY + b.h / 2) - grp.cy0
      b.x = cx + dx * cosA - dy * sinA - b.w / 2
      b.y = cy + dx * sinA + dy * cosA - b.h / 2
      b.breakOff = grp.timer
      b.breakOffAngle = grp.angle
    }

    if (grp.timer <= 0) {
      const groupSize = bricksInGroup.length
      let totalBonus = 0
      for (const b of bricksInGroup) {
        b.alive = false
        totalBonus += Math.round(b.points * groupSize)
      }
      const label = groupSize > 1
        ? `BREAK OFF BONUS x${groupSize} +${totalBonus}`
        : `BREAK OFF BONUS +${totalBonus}`
      const fullElapsed = grp.initTimer
      const popX = grp.cx0 + grp.vx * fullElapsed
      const popY = grp.cy0 + grp.vy * fullElapsed - bricksScrollY

      pops.push({ groupId, bricks: bricksInGroup, totalBonus, label, popX, popY })
      islandGroups.delete(groupId)
    }
  }

  return pops
}
