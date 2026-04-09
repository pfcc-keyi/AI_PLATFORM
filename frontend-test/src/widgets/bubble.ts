import { colors, fonts, spacing, getLineHeight } from '../theme'
import {
  measureText, getTextLines, getTightWidth,
  layoutTextVariableWidth, type LayoutLine,
} from '../layout-engine'
import { fillRoundRect, fillGradientRoundRect, drawText, strokeRoundRect } from '../renderer'
import {
  parseMarkdown, layoutMarkdown, renderMarkdownBlocks,
  renderMarkdownBlocksWithReflow,
  type MdLayoutResult,
} from './markdown'
import type { ChatMessage, AssistantMessage } from '../state'
import type { HitTestState } from '../hit-test'
import { renderTable, measureTableHeight } from './table'
import { renderConfirmCard, measureConfirmHeight } from './confirm'
import { renderFlowPicker, measureFlowPickerHeight } from './flow-picker'
import { renderResultCard, measureResultHeight } from './result'
import type { Dragon } from './dragon'

export type BubbleLayout = {
  message: ChatMessage
  x: number
  y: number
  width: number
  height: number
  contentWidth: number
  mdLayout?: MdLayoutResult
  /** raw display text for variable-width reflow */
  displayText?: string
}

const AVATAR_SIZE = 6

export function measureBubble(
  msg: ChatMessage,
  chatWidth: number,
  y: number,
): BubbleLayout {
  const padH = spacing.bubblePadH
  const padV = spacing.bubblePadV

  if (msg.role === 'user') {
    const maxBubbleW = Math.floor(chatWidth * spacing.bubbleMaxRatio)
    const contentMaxW = maxBubbleW - padH * 2
    const measured = measureText(msg.content, fonts.body)
    const lines = getTextLines(measured, contentMaxW)
    const tightW = getTightWidth(measured, contentMaxW)
    const contentW = Math.min(tightW, contentMaxW)
    const bubbleW = contentW + padH * 2
    const bubbleH = lines.height + padV * 2
    const x = chatWidth - bubbleW
    return { message: msg, x, y, width: bubbleW, height: bubbleH, contentWidth: contentW }
  }

  const maxBubbleW = Math.floor(chatWidth * 0.92)
  const contentMaxW = maxBubbleW - padH * 2
  const am = msg as AssistantMessage

  let contentHeight = 0
  let mdLayout: MdLayoutResult | undefined
  const displayMessage = getDisplayMessage(am)

  if (displayMessage) {
    const blocks = parseMarkdown(displayMessage)
    mdLayout = layoutMarkdown(blocks, contentMaxW)
    contentHeight += mdLayout.totalHeight
  }

  if (am.response_type === 'table' && am.table_data) {
    if (contentHeight > 0) contentHeight += spacing.sectionGap
    contentHeight += measureTableHeight(am.table_data, contentMaxW)
  }
  if (am.response_type === 'confirm' && am.confirm_data) {
    if (contentHeight > 0) contentHeight += spacing.sectionGap
    contentHeight += measureConfirmHeight(am.confirm_data, am._executionResult, contentMaxW)
  }
  if (am.response_type === 'choose_flow' && am.flow_options) {
    if (contentHeight > 0) contentHeight += spacing.sectionGap
    contentHeight += measureFlowPickerHeight(am.flow_options, contentMaxW)
  }
  if (am.response_type === 'result' && am.message) {
    if (contentHeight > 0) contentHeight += spacing.sectionGap
    contentHeight += measureResultHeight(am.message, contentMaxW, false)
  }
  if (am.response_type === 'error' && am.message) {
    if (contentHeight > 0) contentHeight += spacing.sectionGap
    contentHeight += measureResultHeight(am.message, contentMaxW, true)
  }

  if (contentHeight === 0) contentHeight = getLineHeight(fonts.body)

  // Extra breathing room — layoutNextLine reflow may produce slightly more lines
  contentHeight += 4

  const bubbleW = maxBubbleW
  const bubbleH = contentHeight + padV * 2
  return {
    message: msg, x: 0, y, width: bubbleW, height: bubbleH,
    contentWidth: contentMaxW, mdLayout, displayText: displayMessage || undefined,
  }
}

/**
 * How much the dragon squeezes a line at screenY.
 * Returns pixels to subtract from width, and whether dragon is on the left side.
 */
function dragonSqueeze(
  dragon: Dragon | null,
  bubbleX: number, bubbleW: number,
  lineScreenY: number, lh: number,
): { squeeze: number; fromLeft: boolean } {
  if (!dragon) return { squeeze: 0, fromLeft: false }
  const dx = dragon.x
  const dy = dragon.y
  if (dx < bubbleX - 70 || dx > bubbleX + bubbleW + 70) return { squeeze: 0, fromLeft: false }
  const lineMid = lineScreenY + lh / 2
  const vertDist = Math.abs(dy - lineMid)
  const radius = 60
  if (vertDist > radius) return { squeeze: 0, fromLeft: false }
  const t = 1 - vertDist / radius
  return { squeeze: t * t * 100, fromLeft: dx < bubbleX + bubbleW / 2 }
}

export function renderBubble(
  ctx: CanvasRenderingContext2D,
  bl: BubbleLayout,
  scrollY: number,
  ht: HitTestState,
  onConfirm: (confirmed: boolean) => void,
  onChooseFlow: (name: string) => void,
  msgIndex: number,
  dragon: Dragon | null,
): void {
  const msg = bl.message
  const padH = spacing.bubblePadH
  const padV = spacing.bubblePadV
  const drawY = bl.y - scrollY
  const r = spacing.bubbleRadius

  if (msg.role === 'user') {
    fillGradientRoundRect(ctx, bl.x, drawY, bl.width, bl.height,
      { tl: r, tr: r, br: 4, bl: r }, colors.userBubble, colors.userBubbleGrad)

    // User text with variable-width reflow around dragon
    const measured = measureText(msg.content, fonts.body)
    const lh = getLineHeight(fonts.body)
    const contentX = bl.x + padH
    const baseY = drawY + padV

    const { lines } = layoutTextVariableWidth(
      measured, bl.contentWidth,
      (_li, localY) => {
        const { squeeze } = dragonSqueeze(dragon, bl.x, bl.width, baseY + localY, lh)
        return bl.contentWidth - squeeze
      },
      0,
    )

    let lineY = baseY
    for (const line of lines) {
      const { squeeze, fromLeft } = dragonSqueeze(dragon, bl.x, bl.width, lineY, lh)
      const indent = fromLeft ? squeeze : 0
      drawText(ctx, line.text, contentX + indent, lineY, fonts.body, colors.white)
      lineY += lh
    }

    ctx.fillStyle = '#60a5fa'
    ctx.beginPath()
    ctx.arc(bl.x + bl.width + 10, drawY + 10, AVATAR_SIZE, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  // ── Assistant bubble ──
  const am = msg as AssistantMessage

  ctx.save()
  ctx.shadowColor = '#00000033'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 4
  fillRoundRect(ctx, bl.x, drawY, bl.width, bl.height,
    { tl: r, tr: r, br: r, bl: 4 }, colors.assistantBubble)
  ctx.restore()
  strokeRoundRect(ctx, bl.x, drawY, bl.width, bl.height,
    { tl: r, tr: r, br: r, bl: 4 }, colors.assistantBorder)

  ctx.fillStyle = colors.dragonGreen
  ctx.beginPath()
  ctx.arc(bl.x - 10, drawY + 10, AVATAR_SIZE, 0, Math.PI * 2)
  ctx.fill()

  // Clip content to bubble bounds
  ctx.save()
  ctx.beginPath()
  ctx.rect(bl.x, drawY, bl.width, bl.height)
  ctx.clip()

  let contentY = drawY + padV
  const contentX = bl.x + padH

  if (bl.displayText && bl.mdLayout) {
    const squeezeFn = (screenLineY: number, lh: number) =>
      dragonSqueeze(dragon, bl.x, bl.width, screenLineY, lh)
    renderMarkdownBlocksWithReflow(ctx, bl.mdLayout, contentX, contentY, bl.contentWidth, squeezeFn)
    contentY += bl.mdLayout.totalHeight
  }

  if (am.response_type === 'table' && am.table_data) {
    if (bl.displayText) contentY += spacing.sectionGap
    renderTable(ctx, am.table_data, contentX, contentY, bl.contentWidth)
    contentY += measureTableHeight(am.table_data, bl.contentWidth)
  }
  if (am.response_type === 'confirm' && am.confirm_data) {
    contentY += spacing.sectionGap
    renderConfirmCard(ctx, am.confirm_data, am._executionResult, contentX, contentY, bl.contentWidth, ht, onConfirm, msgIndex)
    contentY += measureConfirmHeight(am.confirm_data, am._executionResult, bl.contentWidth)
  }
  if (am.response_type === 'choose_flow' && am.flow_options) {
    contentY += spacing.sectionGap
    renderFlowPicker(ctx, am.flow_options, contentX, contentY, bl.contentWidth, ht, onChooseFlow, msgIndex)
  }
  if (am.response_type === 'result' && am.message) {
    contentY += spacing.sectionGap
    renderResultCard(ctx, am.message, contentX, contentY, bl.contentWidth, false)
  }
  if (am.response_type === 'error' && am.message) {
    contentY += spacing.sectionGap
    renderResultCard(ctx, am.message, contentX, contentY, bl.contentWidth, true)
  }

  ctx.restore()
}

function getDisplayMessage(am: AssistantMessage): string {
  if (!am.message) return ''
  if (am.response_type === 'confirm' || am.response_type === 'table') return stripJsonFromText(am.message)
  if (am.response_type === 'result' || am.response_type === 'error') return ''
  return am.message
}

function stripJsonFromText(text: string): string {
  if (!text) return ''
  let cleaned = text
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, '')
    .replace(/\{[\s\S]*?"confirm_action"[\s\S]*?\}/g, '')
    .replace(/\{[\s\S]*?"confirm_payload"[\s\S]*?\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned && (cleaned.startsWith('{') || cleaned.startsWith('['))) {
    try {
      const parsed = JSON.parse(cleaned)
      if (parsed && typeof parsed === 'object') return ''
    } catch { /* keep */ }
  }
  return cleaned
}
