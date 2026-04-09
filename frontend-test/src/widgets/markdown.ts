import { fonts, colors, getLineHeight, spacing } from '../theme'
import { measureText, getTextLines, layoutTextVariableWidth, type MeasuredText } from '../layout-engine'
import { drawText, fillRoundRect } from '../renderer'

/**
 * Parsed markdown block — each line of source text becomes one or more blocks.
 * We keep it simple: headings, list items, blank lines, and paragraph lines
 * that may contain inline bold / code spans.
 */
export type MdBlock =
  | { type: 'heading'; level: number; spans: MdSpan[] }
  | { type: 'list'; indent: number; spans: MdSpan[]; ordered: boolean; num?: string }
  | { type: 'blank' }
  | { type: 'paragraph'; spans: MdSpan[] }

export type MdSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }

// ── Parsing ──

function parseInlineSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = []
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) spans.push({ kind: 'text', text: text.slice(last, match.index) })
    if (match[2]) spans.push({ kind: 'bold', text: match[2] })
    else if (match[3]) spans.push({ kind: 'code', text: match[3] })
    last = match.index + match[0].length
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) })
  if (spans.length === 0) spans.push({ kind: 'text', text })
  return spans
}

export function parseMarkdown(text: string): MdBlock[] {
  if (!text) return []
  const lines = text.split('\n')
  const blocks: MdBlock[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      blocks.push({ type: 'blank' })
      continue
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        spans: parseInlineSpans(headingMatch[2]),
      })
      continue
    }
    const ulMatch = line.match(/^(\s*)-\s+(.+)$/)
    if (ulMatch) {
      const indent = Math.floor((ulMatch[1] || '').length / 2)
      blocks.push({ type: 'list', indent, spans: parseInlineSpans(ulMatch[2]), ordered: false })
      continue
    }
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/)
    if (olMatch) {
      const indent = Math.floor((olMatch[1] || '').length / 2)
      blocks.push({ type: 'list', indent, spans: parseInlineSpans(olMatch[3]), ordered: true, num: olMatch[2] })
      continue
    }
    blocks.push({ type: 'paragraph', spans: parseInlineSpans(line) })
  }
  return blocks
}

// ── Measurement ──

type SpanMeasurement = {
  span: MdSpan
  measured: MeasuredText
  font: string
}

function fontForSpan(span: MdSpan, baseFont: string, boldFont: string, codeFont: string): string {
  if (span.kind === 'bold') return boldFont
  if (span.kind === 'code') return codeFont
  return baseFont
}

function measureSpans(spans: MdSpan[], baseFont: string, boldFont: string, codeFont: string): SpanMeasurement[] {
  return spans.map(span => {
    const font = fontForSpan(span, baseFont, boldFont, codeFont)
    return { span, measured: measureText(span.text, font), font }
  })
}

export type MdLayoutResult = {
  totalHeight: number
  blocks: MdBlockLayout[]
}

export type MdBlockLayout = {
  block: MdBlock
  y: number
  height: number
  spanLayouts?: SpanLayout[]
}

type SpanLayout = {
  span: MdSpan
  font: string
  lines: { text: string; width: number }[]
  measured: MeasuredText
}

/**
 * Lay out parsed markdown blocks within maxWidth.
 * Returns total height and per-block layout info for rendering.
 *
 * For simplicity, each span within a line is laid out sequentially.
 * Multi-line spans wrap independently (Pretext handles the line-breaking).
 * This is a reasonable approximation — true inline reflow across span
 * boundaries would require a custom line-breaker on top of Pretext.
 */
export function layoutMarkdown(blocks: MdBlock[], maxWidth: number): MdLayoutResult {
  const result: MdBlockLayout[] = []
  let y = 0

  for (const block of blocks) {
    if (block.type === 'blank') {
      const h = 6
      result.push({ block, y, height: h })
      y += h
      continue
    }

    let baseFont: string
    let boldFont: string
    const codeFont = fonts.code

    if (block.type === 'heading') {
      const hFonts: Record<number, string> = { 1: fonts.heading1, 2: fonts.heading2, 3: fonts.heading3, 4: fonts.heading4 }
      baseFont = hFonts[block.level] ?? fonts.heading4
      boldFont = baseFont
    } else {
      baseFont = fonts.body
      boldFont = fonts.bodyBold
    }

    const indent = block.type === 'list' ? (14 + block.indent * 16) : 0
    const contentWidth = maxWidth - indent
    const spanMeasurements = measureSpans(block.type === 'heading' ? block.spans : (block as { spans: MdSpan[] }).spans, baseFont, boldFont, codeFont)

    let blockHeight = 0
    const spanLayouts: SpanLayout[] = []

    const spans: MdSpan[] = (block as { spans: MdSpan[] }).spans
    const hasCode = spans.some(s => s.kind === 'code')
    const fullText = spanMeasurements.map(s => s.span.text).join('')
    const fullMeasured = measureText(fullText, baseFont)

    // Code spans render in monospace which is wider than the body font
    // that Pretext measured with. Shrink available width to compensate.
    const codeRatio = hasCode ? 0.82 : 1
    const layoutWidth = Math.floor(contentWidth * codeRatio)

    const fullLines = getTextLines(fullMeasured, layoutWidth)
    const lh = getLineHeight(baseFont)
    blockHeight = fullLines.height

    spanLayouts.push({
      span: { kind: 'text', text: fullText },
      font: baseFont,
      lines: fullLines.lines.map(l => ({ text: l.text, width: l.width })),
      measured: fullMeasured,
    })

    // Add top margin for headings
    if (block.type === 'heading') {
      y += 6
    }

    result.push({ block, y, height: blockHeight, spanLayouts })
    y += blockHeight

    if (block.type === 'heading') {
      y += 3
    }
  }

  return { totalHeight: y, blocks: result }
}

// ── Rendering ──

export function renderMarkdownBlocks(
  ctx: CanvasRenderingContext2D,
  layout: MdLayoutResult,
  x: number,
  baseY: number,
  maxWidth: number,
): void {
  for (const bl of layout.blocks) {
    if (bl.block.type === 'blank') continue

    const indent = bl.block.type === 'list' ? (14 + (bl.block as { indent: number }).indent * 16) : 0
    const drawX = x + indent
    const drawY = baseY + bl.y

    // Draw bullet / number for list items
    if (bl.block.type === 'list') {
      const lh = bl.spanLayouts?.[0] ? getLineHeight(bl.spanLayouts[0].font) : 21
      if (bl.block.ordered && bl.block.num) {
        drawText(ctx, `${bl.block.num}.`, x + (bl.block.indent * 16), drawY + 1, fonts.small, colors.textDim)
      } else {
        drawText(ctx, '\u2022', x + (bl.block.indent * 16) + 2, drawY, fonts.body, colors.textDim)
      }
    }

    // Render spans
    if (!bl.spanLayouts?.length) continue

    const sl = bl.spanLayouts[0]!
    const lh = getLineHeight(sl.font)
    const originalSpans = bl.block.type === 'heading' ? (bl.block as { spans: MdSpan[] }).spans : (bl.block as { spans: MdSpan[] }).spans

    // If there's only plain text (no bold/code), render lines directly
    const hasFormatting = originalSpans.some(s => s.kind !== 'text')

    if (!hasFormatting) {
      let lineY = drawY
      for (const line of sl.lines) {
        ctx.font = sl.font
        ctx.fillStyle = colors.text
        ctx.textBaseline = 'top'
        ctx.fillText(line.text, drawX, lineY)
        lineY += lh
      }
    } else {
      // Render with inline formatting by walking through each line
      // and matching spans to the rendered text
      renderFormattedLines(ctx, sl.lines, originalSpans, drawX, drawY, lh, sl.font)
    }
  }
}

/**
 * Render lines that may contain bold/code spans.
 * We walk through the concatenated text line by line, matching back to original spans.
 */
function renderFormattedLines(
  ctx: CanvasRenderingContext2D,
  lines: { text: string; width: number }[],
  spans: MdSpan[],
  x: number, startY: number, lh: number,
  baseFont: string,
): void {
  // Build a character-to-span mapping
  let fullText = ''
  const charSpan: number[] = []
  for (let si = 0; si < spans.length; si++) {
    for (let ci = 0; ci < spans[si].text.length; ci++) {
      charSpan.push(si)
    }
    fullText += spans[si].text
  }

  let charOffset = 0
  let lineY = startY

  for (const line of lines) {
    let curX = x
    let runStart = charOffset
    const lineEnd = charOffset + line.text.length

    while (runStart < lineEnd) {
      const spanIdx = charSpan[runStart]
      if (spanIdx === undefined) break
      const span = spans[spanIdx]

      // Find how far this span goes in the current line
      let runEnd = runStart
      while (runEnd < lineEnd && charSpan[runEnd] === spanIdx) runEnd++

      const runText = fullText.slice(runStart, runEnd)
      const font = span.kind === 'bold' ? fonts.bodyBold : span.kind === 'code' ? fonts.code : baseFont
      const color = span.kind === 'code' ? colors.codeText : colors.text

      if (span.kind === 'code') {
        ctx.font = font
        const tw = ctx.measureText(runText).width
        fillRoundRect(ctx, curX - 2, lineY - 1, tw + 4, lh + 1, 3, colors.codeBg)
        drawText(ctx, runText, curX, lineY, font, color)
        curX += tw
      } else {
        ctx.font = font
        const tw = ctx.measureText(runText).width
        drawText(ctx, runText, curX, lineY, font, color)
        curX += tw
      }

      runStart = runEnd
    }

    charOffset = lineEnd
    lineY += lh
  }
}

// ── Dragon-aware reflow rendering ──

type SqueezeFn = (screenLineY: number, lh: number) => { squeeze: number; fromLeft: boolean }

/**
 * Render markdown blocks with dragon-aware per-line variable-width reflow.
 * Uses Pretext's layoutNextLine to re-break text every frame with different
 * widths per line, while preserving **bold** and `code` inline formatting.
 */
export function renderMarkdownBlocksWithReflow(
  ctx: CanvasRenderingContext2D,
  mdLayout: MdLayoutResult,
  x: number,
  baseY: number,
  maxWidth: number,
  squeezeFn: SqueezeFn,
): void {
  for (const bl of mdLayout.blocks) {
    if (bl.block.type === 'blank') continue
    if (!bl.spanLayouts?.length) continue

    const indent = bl.block.type === 'list' ? (14 + (bl.block as { indent: number }).indent * 16) : 0
    const drawX = x + indent
    const drawY = baseY + bl.y
    const contentWidth = maxWidth - indent

    if (bl.block.type === 'list') {
      if ((bl.block as { ordered: boolean }).ordered && (bl.block as { num?: string }).num) {
        drawText(ctx, `${(bl.block as { num: string }).num}.`, x + ((bl.block as { indent: number }).indent * 16), drawY + 1, fonts.small, colors.textDim)
      } else {
        drawText(ctx, '\u2022', x + ((bl.block as { indent: number }).indent * 16) + 2, drawY, fonts.body, colors.textDim)
      }
    }

    const sl = bl.spanLayouts[0]!
    const lh = getLineHeight(sl.font)
    const originalSpans: MdSpan[] = (bl.block as { spans?: MdSpan[] }).spans ?? []
    const hasFormatting = originalSpans.some(s => s.kind !== 'text')
    const hasCode = originalSpans.some(s => s.kind === 'code')
    const codeRatio = hasCode ? 0.82 : 1

    const { lines } = layoutTextVariableWidth(
      sl.measured, Math.floor(contentWidth * codeRatio),
      (_li, localY) => {
        const screenY = drawY + localY
        const { squeeze } = squeezeFn(screenY, lh)
        return Math.floor(contentWidth * codeRatio) - squeeze
      },
      0,
    )

    if (!hasFormatting) {
      let lineY = drawY
      for (const line of lines) {
        const { squeeze, fromLeft } = squeezeFn(lineY, lh)
        const lineIndent = fromLeft ? squeeze : 0
        ctx.font = sl.font
        ctx.fillStyle = colors.text
        ctx.textBaseline = 'top'
        ctx.fillText(line.text, drawX + lineIndent, lineY)
        lineY += lh
      }
    } else {
      renderFormattedLinesWithReflow(ctx, lines, originalSpans, drawX, drawY, lh, sl.font, squeezeFn)
    }
  }
}

/**
 * Render formatted lines (bold/code) with per-line indent from dragon squeeze.
 */
function renderFormattedLinesWithReflow(
  ctx: CanvasRenderingContext2D,
  lines: { text: string; width: number }[],
  spans: MdSpan[],
  x: number, startY: number, lh: number,
  baseFont: string,
  squeezeFn: SqueezeFn,
): void {
  let fullText = ''
  const charSpan: number[] = []
  for (let si = 0; si < spans.length; si++) {
    for (let ci = 0; ci < spans[si].text.length; ci++) {
      charSpan.push(si)
    }
    fullText += spans[si].text
  }

  let charOffset = 0
  let lineY = startY

  for (const line of lines) {
    const { squeeze, fromLeft } = squeezeFn(lineY, lh)
    const lineIndent = fromLeft ? squeeze : 0
    let curX = x + lineIndent
    let runStart = charOffset
    const lineEnd = charOffset + line.text.length

    while (runStart < lineEnd) {
      const spanIdx = charSpan[runStart]
      if (spanIdx === undefined) break
      const span = spans[spanIdx]

      let runEnd = runStart
      while (runEnd < lineEnd && charSpan[runEnd] === spanIdx) runEnd++

      const runText = fullText.slice(runStart, runEnd)
      const font = span.kind === 'bold' ? fonts.bodyBold : span.kind === 'code' ? fonts.code : baseFont
      const color = span.kind === 'code' ? colors.codeText : colors.text

      if (span.kind === 'code') {
        ctx.font = font
        const tw = ctx.measureText(runText).width
        fillRoundRect(ctx, curX - 2, lineY - 1, tw + 4, lh + 1, 3, colors.codeBg)
        drawText(ctx, runText, curX, lineY, font, color)
        curX += tw
      } else {
        ctx.font = font
        const tw = ctx.measureText(runText).width
        drawText(ctx, runText, curX, lineY, font, color)
        curX += tw
      }

      runStart = runEnd
    }

    charOffset = lineEnd
    lineY += lh
  }
}
