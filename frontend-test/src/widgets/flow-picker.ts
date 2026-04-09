import type { FlowOption } from '../api'
import type { HitTestState } from '../hit-test'
import { addRegion } from '../hit-test'
import { colors, fonts, spacing } from '../theme'
import { drawText, fillRoundRect, strokeRoundRect } from '../renderer'
import { measureText, getTextLines } from '../layout-engine'
import { getLineHeight } from '../theme'

const CARD_PAD_H = 14
const CARD_PAD_V = 10
const CARD_GAP = 8
const CARD_R = spacing.cardRadius
const LH = getLineHeight(fonts.body)
const DESC_LH = getLineHeight(fonts.small)

function measureCardHeight(opt: FlowOption, maxWidth: number): number {
  let h = CARD_PAD_V * 2 + LH
  if (opt.description) {
    const descW = maxWidth - CARD_PAD_H * 2
    const measured = measureText(opt.description, fonts.small)
    const lines = getTextLines(measured, descW)
    h += lines.height + 2
  }
  return h
}

export function measureFlowPickerHeight(options: FlowOption[], maxWidth: number): number {
  let total = 0
  for (const opt of options) {
    if (total > 0) total += CARD_GAP
    total += measureCardHeight(opt, maxWidth)
  }
  return total
}

export function renderFlowPicker(
  ctx: CanvasRenderingContext2D,
  options: FlowOption[],
  x: number, startY: number,
  maxWidth: number,
  ht: HitTestState,
  onChoose: (name: string) => void,
  msgIndex: number,
): void {
  let y = startY
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    const cardId = `flow-${msgIndex}-${i}`
    const isHovered = ht.hoveredId === cardId
    const cardH = measureCardHeight(opt, maxWidth)

    fillRoundRect(ctx, x, y, maxWidth, cardH, CARD_R,
      isHovered ? colors.flowCardHover : colors.flowCardBg)
    strokeRoundRect(ctx, x, y, maxWidth, cardH, CARD_R,
      isHovered ? colors.accent : colors.flowCardBorder)

    const label = opt.name.replace(/_/g, ' ')
    drawText(ctx, label, x + CARD_PAD_H, y + CARD_PAD_V, fonts.bodySemibold,
      isHovered ? colors.accentLight : colors.text)

    if (opt.description) {
      const descW = maxWidth - CARD_PAD_H * 2
      const measured = measureText(opt.description, fonts.small)
      const lines = getTextLines(measured, descW)
      let descY = y + CARD_PAD_V + LH + 2
      for (const line of lines.lines) {
        drawText(ctx, line.text, x + CARD_PAD_H, descY, fonts.small, colors.textLabel)
        descY += DESC_LH
      }
    }

    addRegion(ht, {
      id: cardId,
      x, y, w: maxWidth, h: cardH,
      cursor: 'pointer',
      onClick: () => onChoose(opt.name),
    })

    y += cardH + CARD_GAP
  }
}
