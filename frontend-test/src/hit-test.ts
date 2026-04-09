export type HitRegion = {
  id: string
  x: number
  y: number
  w: number
  h: number
  cursor?: 'pointer' | 'default'
  onClick?: () => void
  onHover?: (hovering: boolean) => void
}

export type HitTestState = {
  regions: HitRegion[]
  hoveredId: string | null
}

export function createHitTestState(): HitTestState {
  return { regions: [], hoveredId: null }
}

export function clearRegions(ht: HitTestState): void {
  ht.regions = []
}

export function addRegion(ht: HitTestState, region: HitRegion): void {
  ht.regions.push(region)
}

/** Returns the topmost region at (x, y), accounting for scroll offset. */
export function hitTest(ht: HitTestState, x: number, y: number, scrollY: number): HitRegion | null {
  for (let i = ht.regions.length - 1; i >= 0; i--) {
    const r = ht.regions[i]!
    const ry = r.y - scrollY
    if (x >= r.x && x <= r.x + r.w && y >= ry && y <= ry + r.h) {
      return r
    }
  }
  return null
}

export function handleMouseMove(
  ht: HitTestState,
  x: number, y: number,
  scrollY: number,
  canvas: HTMLCanvasElement,
): boolean {
  const hit = hitTest(ht, x, y, scrollY)
  const newId = hit?.id ?? null
  if (newId === ht.hoveredId) return false

  if (ht.hoveredId) {
    const prev = ht.regions.find(r => r.id === ht.hoveredId)
    prev?.onHover?.(false)
  }

  ht.hoveredId = newId
  canvas.style.cursor = hit?.cursor ?? 'default'
  hit?.onHover?.(true)
  return true
}

export function handleClick(
  ht: HitTestState,
  x: number, y: number,
  scrollY: number,
): boolean {
  const hit = hitTest(ht, x, y, scrollY)
  if (hit?.onClick) {
    hit.onClick()
    return true
  }
  return false
}
