import { colors, fonts, spacing, getLineHeight } from '../theme'
import { measureText, getTextLines } from '../layout-engine'
import { drawText, fillRoundRect, strokeRoundRect } from '../renderer'

function parseResultJson(message: string): Record<string, unknown> | null {
  const m = message.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (!m) return null
  try { return JSON.parse(m[1].trim()) } catch { return null }
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '\u2014'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

const LH = getLineHeight(fonts.small)
const PAD = spacing.cardPad

export function measureResultHeight(message: string, maxWidth: number, isError: boolean): number {
  const parsed = parseResultJson(message)
  const textBefore = message.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim()
  let h = PAD * 2

  if (textBefore) {
    const measured = measureText(textBefore, fonts.small)
    const lines = getTextLines(measured, maxWidth - PAD * 2)
    h += lines.height + 6
  }

  if (parsed) {
    h += Object.keys(parsed).length * (LH + 4)
  } else if (!textBefore) {
    // Raw message fallback
    const measured = measureText(message, fonts.small)
    const lines = getTextLines(measured, maxWidth - PAD * 2)
    h += lines.height
  }

  return h
}

export function renderResultCard(
  ctx: CanvasRenderingContext2D,
  message: string,
  x: number, startY: number,
  maxWidth: number,
  isError: boolean,
): void {
  const parsed = parseResultJson(message)
  const textBefore = message.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim()
  const isSuccess = parsed?.success === true || message.toLowerCase().includes('successfully')
  const totalH = measureResultHeight(message, maxWidth, isError)

  const bgColor = isError ? colors.redBg : (isSuccess ? colors.greenBg : colors.yellowBg)
  const borderColor = isError ? colors.redBorder : (isSuccess ? colors.greenBorder : colors.yellowBorder)

  fillRoundRect(ctx, x, startY, maxWidth, totalH, 8, bgColor)
  strokeRoundRect(ctx, x, startY, maxWidth, totalH, 8, borderColor)

  let y = startY + PAD

  if (textBefore) {
    const textColor = isError ? colors.redLight : (isSuccess ? colors.greenLight : colors.yellow)
    const measured = measureText(textBefore, fonts.smallSemibold)
    const lines = getTextLines(measured, maxWidth - PAD * 2)
    for (const line of lines.lines) {
      drawText(ctx, line.text, x + PAD, y, fonts.smallSemibold, textColor)
      y += LH
    }
    y += 6
  }

  if (parsed) {
    for (const [k, v] of Object.entries(parsed)) {
      drawText(ctx, k, x + PAD, y, fonts.small, colors.textLabel)
      drawText(ctx, formatScalar(v), x + PAD + spacing.kvLabelWidth + 8, y, fonts.small, colors.text)
      y += LH + 4
    }
  } else if (!textBefore) {
    const measured = measureText(message, fonts.small)
    const lines = getTextLines(measured, maxWidth - PAD * 2)
    for (const line of lines.lines) {
      drawText(ctx, line.text, x + PAD, y, fonts.small, colors.textDim)
      y += LH
    }
  }
}
