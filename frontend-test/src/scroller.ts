export type Scroller = {
  scrollY: number
  targetScrollY: number
  contentHeight: number
  viewportHeight: number
  velocity: number
  isDragging: boolean
  dragStartY: number
  dragStartScroll: number
  lastDragY: number
  lastDragTime: number
  autoScrollToBottom: boolean
}

export function createScroller(): Scroller {
  return {
    scrollY: 0,
    targetScrollY: 0,
    contentHeight: 0,
    viewportHeight: 0,
    velocity: 0,
    isDragging: false,
    dragStartY: 0,
    dragStartScroll: 0,
    lastDragY: 0,
    lastDragTime: 0,
    autoScrollToBottom: true,
  }
}

function maxScroll(s: Scroller): number {
  return Math.max(0, s.contentHeight - s.viewportHeight)
}

function clampScroll(s: Scroller, y: number): number {
  return Math.max(0, Math.min(y, maxScroll(s)))
}

export function setContentHeight(s: Scroller, h: number): void {
  s.contentHeight = h
  if (s.autoScrollToBottom) {
    s.targetScrollY = maxScroll(s)
    s.scrollY = s.targetScrollY
  } else {
    s.scrollY = clampScroll(s, s.scrollY)
    s.targetScrollY = s.scrollY
  }
}

export function setViewportHeight(s: Scroller, h: number): void {
  s.viewportHeight = h
  s.scrollY = clampScroll(s, s.scrollY)
  s.targetScrollY = s.scrollY
}

export function scrollToBottom(s: Scroller): void {
  s.targetScrollY = maxScroll(s)
  s.autoScrollToBottom = true
}

export function handleWheel(s: Scroller, deltaY: number): boolean {
  const prev = s.targetScrollY
  s.targetScrollY = clampScroll(s, s.targetScrollY + deltaY)
  s.velocity = 0
  const atBottom = s.targetScrollY >= maxScroll(s) - 1
  s.autoScrollToBottom = atBottom
  return s.targetScrollY !== prev
}

export function handleTouchStart(s: Scroller, y: number): void {
  s.isDragging = true
  s.dragStartY = y
  s.dragStartScroll = s.scrollY
  s.lastDragY = y
  s.lastDragTime = performance.now()
  s.velocity = 0
}

export function handleTouchMove(s: Scroller, y: number): boolean {
  if (!s.isDragging) return false
  const now = performance.now()
  const dt = now - s.lastDragTime
  const dy = s.lastDragY - y
  if (dt > 0) s.velocity = dy / dt * 16
  s.lastDragY = y
  s.lastDragTime = now
  const newScroll = s.dragStartScroll + (s.dragStartY - y)
  s.scrollY = clampScroll(s, newScroll)
  s.targetScrollY = s.scrollY
  s.autoScrollToBottom = s.scrollY >= maxScroll(s) - 1
  return true
}

export function handleTouchEnd(s: Scroller): void {
  s.isDragging = false
}

/** Returns true if scroll position changed (needs re-render). */
export function tickScroll(s: Scroller): boolean {
  if (s.isDragging) return false

  let changed = false

  // Inertia from touch fling
  if (Math.abs(s.velocity) > 0.5) {
    s.targetScrollY = clampScroll(s, s.targetScrollY + s.velocity)
    s.velocity *= 0.92
    changed = true
  } else {
    s.velocity = 0
  }

  // Smooth lerp to target
  const diff = s.targetScrollY - s.scrollY
  if (Math.abs(diff) > 0.5) {
    s.scrollY += diff * 0.25
    changed = true
  } else if (diff !== 0) {
    s.scrollY = s.targetScrollY
    changed = true
  }

  return changed
}
