import { colors } from './theme'

export type RenderContext = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dpr: number
  width: number
  height: number
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const ctx = canvas.getContext('2d', { alpha: false })!
  return { canvas, ctx, dpr: 1, width: 0, height: 0 }
}

export function resizeCanvas(rc: RenderContext): void {
  const dpr = window.devicePixelRatio || 1
  const rect = rc.canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  if (rc.width === w && rc.height === h && rc.dpr === dpr) return
  rc.dpr = dpr
  rc.width = w
  rc.height = h
  rc.canvas.width = Math.round(w * dpr)
  rc.canvas.height = Math.round(h * dpr)
  rc.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export function clearCanvas(rc: RenderContext): void {
  const { ctx, width: w, height: h } = rc
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, colors.bgGradTop)
  grad.addColorStop(1, colors.bgGradBot)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number },
): void {
  const radii = typeof r === 'number'
    ? { tl: r, tr: r, br: r, bl: r }
    : r
  ctx.beginPath()
  ctx.moveTo(x + radii.tl, y)
  ctx.lineTo(x + w - radii.tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr)
  ctx.lineTo(x + w, y + h - radii.br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h)
  ctx.lineTo(x + radii.bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl)
  ctx.lineTo(x, y + radii.tl)
  ctx.quadraticCurveTo(x, y, x + radii.tl, y)
  ctx.closePath()
}

export function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number },
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill
  drawRoundRect(ctx, x, y, w, h, r)
  ctx.fill()
}

export function strokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number },
  stroke: string,
  lineWidth = 1,
): void {
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  drawRoundRect(ctx, x, y, w, h, r)
  ctx.stroke()
}

export function fillGradientRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number },
  colorTop: string, colorBot: string,
): void {
  const grad = ctx.createLinearGradient(x, y, x, y + h)
  grad.addColorStop(0, colorTop)
  grad.addColorStop(1, colorBot)
  fillRoundRect(ctx, x, y, w, h, r, grad)
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  font: string,
  color: string,
): void {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.fillText(text, x, y)
}

export function drawGlowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  font: string,
  color: string,
  glowColor: string,
  blur: number,
): void {
  ctx.save()
  ctx.shadowColor = glowColor
  ctx.shadowBlur = blur
  drawText(ctx, text, x, y, font, color)
  ctx.restore()
}

export function withClip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  fn: () => void,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  fn()
  ctx.restore()
}

export function drawSoftShadow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number,
  shadowColor: string,
  blur: number,
  offsetY: number,
): void {
  ctx.save()
  ctx.shadowColor = shadowColor
  ctx.shadowBlur = blur
  ctx.shadowOffsetY = offsetY
  ctx.fillStyle = 'rgba(0,0,0,0)'
  drawRoundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
}
