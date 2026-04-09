import type { TableData } from '../api'
import { colors, fonts, spacing, getLineHeight } from '../theme'
import { measureText, getTextLines, measureTextWidth } from '../layout-engine'
import { drawText } from '../renderer'

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '\u2014'
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

type SingleTable = { name?: string; columns: string[]; rows: unknown[][] }

function normalizeTables(data: TableData): SingleTable[] {
  if (data.tables) return data.tables
  if (data.columns && data.rows) return [{ columns: data.columns, rows: data.rows }]
  return []
}

const COL_PAD = spacing.tableCellPadH
const ROW_PAD = spacing.tableCellPadV
const HEADER_BORDER = 2
const ROW_BORDER = 1

function measureSingleTable(table: SingleTable, maxWidth: number, ctx?: CanvasRenderingContext2D): number {
  const colCount = table.columns.length
  if (colCount === 0) return 0
  const lh = getLineHeight(fonts.small)
  let h = 0

  // Table name
  if (table.name) h += lh + 4

  // Header row
  h += lh + ROW_PAD * 2 + HEADER_BORDER

  // Data rows — single line each (truncated)
  h += table.rows.length * (lh + ROW_PAD * 2 + ROW_BORDER)

  return h
}

export function measureTableHeight(data: TableData, maxWidth: number): number {
  const tables = normalizeTables(data)
  let total = 0
  for (const t of tables) {
    if (total > 0) total += 8
    total += measureSingleTable(t, maxWidth)
  }
  return total
}

export function renderTable(
  ctx: CanvasRenderingContext2D,
  data: TableData,
  x: number, startY: number,
  maxWidth: number,
): void {
  const tables = normalizeTables(data)
  let y = startY
  for (const table of tables) {
    if (y > startY) y += 8
    y = renderSingleTable(ctx, table, x, y, maxWidth)
  }
}

function renderSingleTable(
  ctx: CanvasRenderingContext2D,
  table: SingleTable,
  x: number, startY: number,
  maxWidth: number,
): number {
  const colCount = table.columns.length
  if (colCount === 0) return startY
  const lh = getLineHeight(fonts.small)
  let y = startY

  // Table name
  if (table.name) {
    drawText(ctx, table.name, x, y, fonts.smallSemibold, colors.accentLight)
    y += lh + 4
  }

  // Compute column widths — distribute evenly, cap at maxWidth
  const colWidth = Math.floor(Math.min(maxWidth / colCount, 200))
  const tableWidth = Math.min(colWidth * colCount, maxWidth)

  // Header
  const headerY = y
  ctx.fillStyle = colors.accentLight
  for (let ci = 0; ci < colCount; ci++) {
    const cx = x + ci * colWidth + COL_PAD
    drawText(ctx, truncateText(ctx, table.columns[ci], fonts.smallSemibold, colWidth - COL_PAD * 2),
      cx, headerY + ROW_PAD, fonts.smallSemibold, colors.accentLight)
  }
  y += lh + ROW_PAD * 2

  // Header border
  ctx.strokeStyle = '#444'
  ctx.lineWidth = HEADER_BORDER
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + tableWidth, y)
  ctx.stroke()
  y += HEADER_BORDER

  // Data rows
  for (const row of table.rows) {
    for (let ci = 0; ci < colCount; ci++) {
      const cellText = formatCell(ci < row.length ? row[ci] : null)
      const cx = x + ci * colWidth + COL_PAD
      drawText(ctx, truncateText(ctx, cellText, fonts.small, colWidth - COL_PAD * 2),
        cx, y + ROW_PAD, fonts.small, colors.textDim)
    }
    y += lh + ROW_PAD * 2

    // Row border
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = ROW_BORDER
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + tableWidth, y)
    ctx.stroke()
    y += ROW_BORDER
  }

  return y
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, font: string, maxW: number): string {
  ctx.font = font
  if (ctx.measureText(text).width <= maxW) return text
  let truncated = text
  while (truncated.length > 0 && ctx.measureText(truncated + '\u2026').width > maxW) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + '\u2026'
}
