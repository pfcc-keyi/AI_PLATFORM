import {
  prepareWithSegments,
  layoutWithLines,
  layoutNextLine,
  layout,
  walkLineRanges,
  type PreparedTextWithSegments,
  type LayoutLine,
  type LayoutLinesResult,
  type LayoutCursor,
} from '@chenglou/pretext'
import { getLineHeight } from './theme'

export type { PreparedTextWithSegments, LayoutLine, LayoutLinesResult, LayoutCursor }
export { layoutNextLine }

export type MeasuredText = {
  prepared: PreparedTextWithSegments
  font: string
}

const textCache = new Map<string, MeasuredText>()

function cacheKey(text: string, font: string): string {
  return `${font}\0${text}`
}

export function measureText(text: string, font: string): MeasuredText {
  const key = cacheKey(text, font)
  let cached = textCache.get(key)
  if (cached) return cached
  const prepared = prepareWithSegments(text, font)
  cached = { prepared, font }
  textCache.set(key, cached)
  return cached
}

export function getTextHeight(measured: MeasuredText, maxWidth: number): number {
  const lh = getLineHeight(measured.font)
  const result = layout(measured.prepared, maxWidth, lh)
  return result.height
}

export function getTextLines(measured: MeasuredText, maxWidth: number): LayoutLinesResult {
  const lh = getLineHeight(measured.font)
  return layoutWithLines(measured.prepared, maxWidth, lh)
}

export function getTightWidth(measured: MeasuredText, maxWidth: number): number {
  let maxLineWidth = 0
  walkLineRanges(measured.prepared, maxWidth, (line) => {
    if (line.width > maxLineWidth) maxLineWidth = line.width
  })
  return Math.ceil(maxLineWidth)
}

/**
 * Layout text with per-line variable width using Pretext's layoutNextLine.
 * `getWidthForLine(lineIndex, y)` returns the maxWidth for that line.
 * This is the core Pretext showcase: prepare() once, then layoutNextLine()
 * with different widths every frame — pure arithmetic, no DOM.
 */
export function layoutTextVariableWidth(
  measured: MeasuredText,
  baseMaxWidth: number,
  getWidthForLine: (lineIndex: number, y: number) => number,
  startY: number,
): { lines: LayoutLine[]; totalHeight: number } {
  const lh = getLineHeight(measured.font)
  const lines: LayoutLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineIdx = 0
  let y = startY

  while (true) {
    const lineWidth = getWidthForLine(lineIdx, y)
    const w = Math.max(40, Math.min(lineWidth, baseMaxWidth))
    const line = layoutNextLine(measured.prepared, cursor, w)
    if (line === null) break
    lines.push(line)
    cursor = line.end
    y += lh
    lineIdx++
    if (lineIdx > 500) break
  }

  return { lines, totalHeight: lines.length * lh }
}

export function getTextLineCount(measured: MeasuredText, maxWidth: number): number {
  const lh = getLineHeight(measured.font)
  return layout(measured.prepared, maxWidth, lh).lineCount
}

export function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.font = font
  return ctx.measureText(text).width
}
