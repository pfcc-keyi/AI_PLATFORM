/**
 * Fire-text interaction: when dragon fire particles hit chat bubbles,
 * text characters scatter and glow, then reassemble. This demonstrates
 * Pretext's per-line layout capability — we re-layout text at different
 * widths to create a "pushed aside" effect around the fire impact.
 */

import type { Dragon } from './dragon'
import type { BubbleLayout } from './bubble'

export type FireImpact = {
  x: number; y: number
  radius: number
  intensity: number
  life: number
  maxLife: number
}

export type TextFxState = {
  impacts: FireImpact[]
}

export function createTextFxState(): TextFxState {
  return { impacts: [] }
}

export function tickTextFx(fx: TextFxState, dt: number): boolean {
  let dirty = false
  for (let i = fx.impacts.length - 1; i >= 0; i--) {
    const imp = fx.impacts[i]
    imp.life -= dt
    imp.intensity *= 0.96
    imp.radius *= 0.98
    if (imp.life <= 0) {
      fx.impacts.splice(i, 1)
    }
    dirty = true
  }
  return dirty
}

export function checkFireCollisions(
  fx: TextFxState,
  dragon: Dragon,
  bubbles: BubbleLayout[],
  scrollY: number,
): void {
  for (const p of dragon.particles) {
    const t = p.life / p.maxLife
    if (t < 0.15) continue

    for (const bl of bubbles) {
      const screenY = bl.y - scrollY
      if (p.x >= bl.x - 10 && p.x <= bl.x + bl.width + 10 &&
          p.y >= screenY - 10 && p.y <= screenY + bl.height + 10) {
        // Only spawn if no existing impact is very close
        const tooClose = fx.impacts.some(imp =>
          Math.abs(imp.x - p.x) < 30 && Math.abs(imp.y - p.y) < 30 && imp.life > 0.3
        )
        if (!tooClose) {
          fx.impacts.push({
            x: p.x,
            y: p.y,
            radius: 30 + Math.random() * 20,
            intensity: 0.8 + Math.random() * 0.2,
            life: 1.2 + Math.random() * 0.6,
            maxLife: 1.2 + Math.random() * 0.6,
          })
        }
      }
    }
  }

  if (fx.impacts.length > 30) {
    fx.impacts.splice(0, fx.impacts.length - 30)
  }
}

/**
 * Render fire impact effects — glowing embers and heat distortion
 * at points where fire hit the text.
 */
export function renderTextFx(ctx: CanvasRenderingContext2D, fx: TextFxState): void {
  for (const imp of fx.impacts) {
    const t = Math.max(0, imp.life / imp.maxLife)
    const alpha = t * imp.intensity

    // Heat shimmer / glow
    ctx.save()
    ctx.globalAlpha = alpha * 0.4
    const grad = ctx.createRadialGradient(imp.x, imp.y, 0, imp.x, imp.y, imp.radius)
    grad.addColorStop(0, `hsla(30, 100%, 70%, ${alpha * 0.5})`)
    grad.addColorStop(0.4, `hsla(20, 100%, 50%, ${alpha * 0.2})`)
    grad.addColorStop(1, 'hsla(15, 100%, 30%, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(imp.x, imp.y, imp.radius, 0, Math.PI * 2)
    ctx.fill()

    // Ember sparks
    ctx.globalAlpha = alpha * 0.7
    const sparkCount = Math.floor(t * 5)
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2 + imp.life * 3
      const dist = imp.radius * 0.3 * (0.5 + Math.sin(imp.life * 5 + i) * 0.5)
      const sx = imp.x + Math.cos(angle) * dist
      const sy = imp.y + Math.sin(angle) * dist
      const sparkSize = 1.5 + t * 2
      const sparkGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sparkSize)
      sparkGrad.addColorStop(0, `hsla(40, 100%, 85%, ${alpha})`)
      sparkGrad.addColorStop(1, 'hsla(20, 100%, 50%, 0)')
      ctx.fillStyle = sparkGrad
      ctx.beginPath()
      ctx.arc(sx, sy, sparkSize, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }
}

/**
 * Get the "squeeze" factor for a bubble at a given Y position.
 * Returns 0..1 where 0 = no effect, 1 = maximum squeeze.
 * This is used by the bubble renderer to narrow the Pretext layout
 * width near fire impacts, causing text to reflow.
 */
export function getFireSqueezeAtY(
  fx: TextFxState,
  bubbleX: number, bubbleY: number,
  bubbleW: number, bubbleH: number,
  lineY: number,
): number {
  let maxSqueeze = 0
  for (const imp of fx.impacts) {
    const dy = Math.abs(imp.y - lineY)
    if (dy > imp.radius * 1.5) continue
    const dx = imp.x - (bubbleX + bubbleW / 2)
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > imp.radius * 2) continue
    const t = imp.life / imp.maxLife
    const squeeze = Math.max(0, 1 - dist / (imp.radius * 1.5)) * t * imp.intensity
    if (squeeze > maxSqueeze) maxSqueeze = squeeze
  }
  return Math.min(maxSqueeze, 0.5)
}

export function hasActiveEffects(fx: TextFxState): boolean {
  return fx.impacts.length > 0
}
