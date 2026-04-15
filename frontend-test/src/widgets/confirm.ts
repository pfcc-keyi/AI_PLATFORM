import type { ConfirmData, OpsResponse } from '../api'
import type { HitTestState } from '../hit-test'
import { addRegion } from '../hit-test'
import { colors, fonts, spacing, getLineHeight } from '../theme'
import { measureText, getTextLines } from '../layout-engine'
import { drawText, fillRoundRect, strokeRoundRect } from '../renderer'

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '\u2014'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

type KVEntry = { label: string; value: string }

function flattenDetails(details: Record<string, unknown>): KVEntry[] {
  const entries: KVEntry[] = []
  const priority = ['table_name', 'action_name', 'handler_name', 'pk']
  for (const k of priority) {
    if (details[k] !== undefined && details[k] !== null) {
      entries.push({ label: k.replace(/_/g, ' '), value: formatScalar(details[k]) })
    }
  }
  if (details.payload && isObj(details.payload)) {
    if ((details.payload as Record<string, unknown>).pk && !details.pk) {
      entries.push({ label: 'pk', value: formatScalar((details.payload as Record<string, unknown>).pk) })
    }
    entries.push({ label: 'payload', value: JSON.stringify(details.payload, null, 2) })
  }
  for (const [k, v] of Object.entries(details)) {
    if ([...priority, 'payload'].includes(k)) continue
    entries.push({ label: k.replace(/_/g, ' '), value: formatScalar(v) })
  }
  return entries
}

function parseResultJson(message?: string): Record<string, unknown> | null {
  if (!message) return null
  const m = message.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (!m) return null
  try { return JSON.parse(m[1].trim()) } catch { return null }
}

const KV_LH = getLineHeight(fonts.small)
const CARD_PAD = spacing.cardPad
const BTN_H = 32
const BTN_GAP = spacing.buttonGap

export function measureConfirmHeight(
  data: ConfirmData,
  executionResult: OpsResponse | undefined,
  maxWidth: number,
): number {
  const d = data.details || {}
  const entries = flattenDetails(d)
  let h = CARD_PAD * 2

  // Title line
  h += KV_LH + 8

  // KV entries
  for (const entry of entries) {
    const valueLines = entry.value.split('\n').length
    h += Math.max(1, valueLines) * KV_LH + 4
  }

  // Buttons or execution result
  if (executionResult) {
    h += 8 + 1 + 8 // border + padding
    h += KV_LH // "Execution Result" label
    const parsed = parseResultJson(executionResult.message)
    const textBefore = executionResult.message?.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim() || ''
    if (textBefore) h += KV_LH + 4
    if (parsed) {
      h += Object.keys(parsed).length * (KV_LH + 4)
    } else if (executionResult.message) {
      const lines = executionResult.message.split('\n').length
      h += lines * KV_LH
    }
  } else {
    h += 12 + BTN_H
  }

  return h
}

export function renderConfirmCard(
  ctx: CanvasRenderingContext2D,
  data: ConfirmData,
  executionResult: OpsResponse | undefined,
  x: number, startY: number,
  maxWidth: number,
  ht: HitTestState,
  onConfirm: (confirmed: boolean) => void,
  msgIndex: number,
): void {
  const totalH = measureConfirmHeight(data, executionResult, maxWidth)
  const d = data.details || {}
  const entries = flattenDetails(d)
  const isDone = !!executionResult

  // Card background
  fillRoundRect(ctx, x, startY, maxWidth, totalH, spacing.cardRadius, colors.confirmBg)
  strokeRoundRect(ctx, x, startY, maxWidth, totalH, spacing.cardRadius, colors.confirmBorder)

  let y = startY + CARD_PAD

  // Title
  const parsed = executionResult ? parseResultJson(executionResult.message) : null
  const isSuccess = parsed?.success === true || executionResult?.message?.toLowerCase().includes('successfully')
  const titleColor = isDone ? (isSuccess ? colors.greenLight : colors.yellow) : colors.accentLight
  const titleText = isDone ? (isSuccess ? 'Executed' : 'Failed') : (data.action_type === 'handler' ? 'Handler Confirm' : 'Confirm Action')
  drawText(ctx, titleText, x + CARD_PAD, y, fonts.smallSemibold, titleColor)

  if (isDone) {
    const badgeText = isSuccess ? 'success' : 'error'
    const badgeColor = isSuccess ? colors.greenLight : colors.redLight
    const badgeBg = isSuccess ? '#16a34a22' : '#f8717122'
    ctx.font = fonts.tiny
    const titleW = ctx.measureText(titleText).width
    const badgeX = x + CARD_PAD + titleW + 8
    fillRoundRect(ctx, badgeX, y, ctx.measureText(badgeText).width + 10, KV_LH - 2, 3, badgeBg)
    drawText(ctx, badgeText, badgeX + 5, y + 1, fonts.tiny, badgeColor)
  }
  y += KV_LH + 8

  // KV entries
  for (const entry of entries) {
    drawText(ctx, entry.label, x + CARD_PAD, y, fonts.small, colors.textLabel)
    const valueX = x + CARD_PAD + spacing.kvLabelWidth + 8
    const valueMaxW = maxWidth - CARD_PAD * 2 - spacing.kvLabelWidth - 8
    const valueLines = entry.value.split('\n')
    for (const vl of valueLines) {
      const measured = measureText(vl, fonts.small)
      const lines = getTextLines(measured, valueMaxW)
      for (const line of lines.lines) {
        drawText(ctx, line.text, valueX, y, fonts.small, colors.text)
        y += KV_LH
      }
      if (lines.lines.length === 0) y += KV_LH
    }
    y += 4
  }

  if (!isDone) {
    // Confirm / Cancel buttons
    y += 4
    const confirmBtnW = 90
    const cancelBtnW = 80

    // Confirm button
    fillRoundRect(ctx, x + CARD_PAD, y, confirmBtnW, BTN_H, spacing.buttonRadius, colors.green)
    drawText(ctx, 'Confirm', x + CARD_PAD + 16, y + 8, fonts.smallSemibold, colors.white)
    addRegion(ht, {
      id: `confirm-yes-${msgIndex}`,
      x: x + CARD_PAD,
      y: y,
      w: confirmBtnW,
      h: BTN_H,
      cursor: 'pointer',
      onClick: () => onConfirm(true),
    })

    // Cancel button
    const cancelX = x + CARD_PAD + confirmBtnW + BTN_GAP
    fillRoundRect(ctx, cancelX, y, cancelBtnW, BTN_H, spacing.buttonRadius, '#333')
    drawText(ctx, 'Cancel', cancelX + 16, y + 8, fonts.smallSemibold, colors.textDim)
    addRegion(ht, {
      id: `confirm-no-${msgIndex}`,
      x: cancelX,
      y: y,
      w: cancelBtnW,
      h: BTN_H,
      cursor: 'pointer',
      onClick: () => onConfirm(false),
    })
  } else {
    // Execution result
    y += 8
    ctx.strokeStyle = colors.borderAccent
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + CARD_PAD, y)
    ctx.lineTo(x + maxWidth - CARD_PAD, y)
    ctx.stroke()
    y += 8

    drawText(ctx, '\u25BE Execution Result', x + CARD_PAD, y, fonts.smallSemibold, colors.accentLight)
    y += KV_LH

    const textBefore = executionResult.message?.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim() || ''
    if (textBefore) {
      drawText(ctx, textBefore, x + CARD_PAD, y, fonts.small, isSuccess ? colors.greenLight : colors.yellow)
      y += KV_LH + 4
    }

    if (parsed) {
      for (const [k, v] of Object.entries(parsed)) {
        drawText(ctx, k, x + CARD_PAD, y, fonts.small, colors.textLabel)
        drawText(ctx, formatScalar(v), x + CARD_PAD + spacing.kvLabelWidth + 8, y, fonts.small, colors.text)
        y += KV_LH + 4
      }
    }
  }
}
