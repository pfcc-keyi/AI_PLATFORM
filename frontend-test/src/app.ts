import { opsApi, type OpsResponse } from './api'
import {
  type AppState, type ChatMessage, type AssistantMessage,
  createState, markDirty,
} from './state'
import {
  type RenderContext, createRenderContext, resizeCanvas, clearCanvas, withClip,
  fillRoundRect, drawText, fillGradientRoundRect, strokeRoundRect,
} from './renderer'
import { colors, fonts, spacing, getLineHeight } from './theme'
import { measureText, getTextLines } from './layout-engine'
import {
  type Scroller, createScroller,
  setContentHeight, setViewportHeight, scrollToBottom,
  handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd,
  tickScroll,
} from './scroller'
import {
  type HitTestState, createHitTestState, clearRegions,
  handleMouseMove as htMouseMove, handleClick as htClick,
  addRegion,
} from './hit-test'
import { measureBubble, renderBubble, type BubbleLayout } from './widgets/bubble'
import {
  type Dragon, createDragon, positionDragon, tickDragon,
  renderDragon, triggerFire, getDragonHitBox, renderMiniDragon,
  grabDragon, dragDragon, releaseDragon,
} from './widgets/dragon'
import {
  type TextFxState, createTextFxState, tickTextFx,
  checkFireCollisions, renderTextFx, hasActiveEffects,
  getFireSqueezeAtY,
} from './widgets/text-fx'

export type App = {
  state: AppState
  rc: RenderContext
  scroller: Scroller
  ht: HitTestState
  dom: DomRefs
  bubbleLayouts: BubbleLayout[]
  rafId: number | null
  dragon: Dragon
  textFx: TextFxState
  lastTime: number
}

type DomRefs = {
  canvas: HTMLCanvasElement
  input: HTMLInputElement
  sendBtn: HTMLButtonElement
  clearBtn: HTMLButtonElement
  flowBadge: HTMLElement
}

const FLOW_GREETINGS: Record<string, string> = {
  general_enquiry: 'I have a question about the data platform',
  handler_execution: 'I want to execute a business handler',
  data_query: 'I want to query some data',
  upsert: 'I want to insert or update some records',
}

export function createApp(): App {
  const dom: DomRefs = {
    canvas: document.getElementById('chat-canvas') as HTMLCanvasElement,
    input: document.getElementById('msg-input') as HTMLInputElement,
    sendBtn: document.getElementById('send-btn') as HTMLButtonElement,
    clearBtn: document.getElementById('clear-btn') as HTMLButtonElement,
    flowBadge: document.getElementById('flow-badge') as HTMLElement,
  }

  const app: App = {
    state: createState(),
    rc: createRenderContext(dom.canvas),
    scroller: createScroller(),
    ht: createHitTestState(),
    dom,
    bubbleLayouts: [],
    rafId: null,
    dragon: createDragon(),
    textFx: createTextFxState(),
    lastTime: performance.now(),
  }

  bindEvents(app)
  return app
}

function getChatLayout(app: App) {
  const chatWidth = Math.min(app.rc.width - spacing.chatPadH * 2, spacing.chatMaxWidth)
  const offsetX = Math.max(0, (app.rc.width - chatWidth) / 2)
  return { chatWidth, offsetX }
}

function bindEvents(app: App): void {
  const { dom, scroller } = app

  dom.sendBtn.addEventListener('click', () => sendMessage(app))
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(app)
    }
  })
  dom.input.addEventListener('input', () => {
    dom.sendBtn.disabled = app.state.loading || !dom.input.value.trim()
  })

  dom.clearBtn.addEventListener('click', () => clearChat(app))

  dom.canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (handleWheel(scroller, e.deltaY)) markDirty(app.state)
  }, { passive: false })

  dom.canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0]
    if (t) handleTouchStart(scroller, t.clientY)
  }, { passive: true })
  dom.canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0]
    if (t && handleTouchMove(scroller, t.clientY)) {
      markDirty(app.state)
    }
  }, { passive: true })
  dom.canvas.addEventListener('touchend', () => {
    handleTouchEnd(scroller)
  })

  dom.canvas.addEventListener('mousemove', (e) => {
    const rect = dom.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (app.dragon.grabbed) {
      dragDragon(app.dragon, x, y)
      markDirty(app.state)
    }

    // Hit-test hover for buttons/cards
    const hb = getDragonHitBox(app.dragon)
    const overDragon = x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h
    dom.canvas.style.cursor = app.dragon.grabbed ? 'grabbing' : overDragon ? 'grab' : 'default'

    if (htMouseMove(app.ht, x, y, app.scroller.scrollY, dom.canvas)) {
      markDirty(app.state)
    }
  })

  dom.canvas.addEventListener('mousedown', (e) => {
    const rect = dom.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hb = getDragonHitBox(app.dragon)
    if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) {
      grabDragon(app.dragon, x, y)
      dom.canvas.style.cursor = 'grabbing'
      markDirty(app.state)
    }
  })

  dom.canvas.addEventListener('mouseup', () => {
    if (app.dragon.grabbed) {
      releaseDragon(app.dragon)
      dom.canvas.style.cursor = 'default'
      markDirty(app.state)
    }
  })

  dom.canvas.addEventListener('mouseleave', () => {
    if (app.dragon.grabbed) {
      releaseDragon(app.dragon)
      markDirty(app.state)
    }
  })

  dom.canvas.addEventListener('click', (e) => {
    const rect = dom.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    htClick(app.ht, x, y, app.scroller.scrollY)
  })

  const ro = new ResizeObserver(() => {
    resizeCanvas(app.rc)
    setViewportHeight(app.scroller, app.rc.height)
    positionDragon(app.dragon, app.rc.width, app.rc.height)
    syncInputWidth(app)
    relayout(app)
    markDirty(app.state)
  })
  ro.observe(dom.canvas)
}

// ── Input bar alignment ──

function syncInputWidth(app: App): void {
  const { chatWidth, offsetX } = getChatLayout(app)
  const bar = document.getElementById('input-bar')!
  bar.style.paddingLeft = `${offsetX}px`
  bar.style.paddingRight = `${app.rc.width - offsetX - chatWidth}px`
}

// ── Message handling ──

async function sendMessage(app: App): Promise<void> {
  const text = app.dom.input.value.trim()
  if (!text || app.state.loading) return

  app.dom.input.value = ''
  app.state.messages.push({ role: 'user', content: text })
  app.state.loading = true
  updateUI(app)
  relayout(app)
  scrollToBottom(app.scroller)
  markDirty(app.state)

  try {
    const res = await opsApi.chat(app.state.sessionId, text)
    if (res.session_id) app.state.sessionId = res.session_id
    if (res.current_flow) app.state.currentFlow = res.current_flow
    app.state.messages.push({ role: 'assistant', ...res } as AssistantMessage)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    app.state.messages.push({
      role: 'assistant',
      response_type: 'error',
      message: msg,
    })
  }

  app.state.loading = false
  updateUI(app)
  relayout(app)
  scrollToBottom(app.scroller)
  markDirty(app.state)
}

async function handleConfirm(app: App, confirmed: boolean): Promise<void> {
  if (app.state.loading) return
  app.state.loading = true
  updateUI(app)
  markDirty(app.state)

  try {
    const res = await opsApi.confirm(app.state.sessionId, confirmed)
    if (res.current_flow) app.state.currentFlow = res.current_flow
    const isExecResult = res.response_type === 'result' || res.response_type === 'error'

    if (isExecResult) {
      for (let i = app.state.messages.length - 1; i >= 0; i--) {
        const m = app.state.messages[i]
        if (m.role === 'assistant' && (m as AssistantMessage).response_type === 'confirm') {
          ;(m as AssistantMessage)._executionResult = res
          break
        }
      }
    } else {
      app.state.messages.push({ role: 'assistant', ...res } as AssistantMessage)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    app.state.messages.push({
      role: 'assistant',
      response_type: 'error',
      message: msg,
    })
  }

  app.state.loading = false
  updateUI(app)
  relayout(app)
  scrollToBottom(app.scroller)
  markDirty(app.state)
}

function handleChooseFlow(app: App, flowName: string): void {
  const greeting = FLOW_GREETINGS[flowName] || `I want to use ${flowName.replace(/_/g, ' ')}`
  app.dom.input.value = greeting
  sendMessage(app)
}

function clearChat(app: App): void {
  app.state.sessionId = ''
  app.state.messages = []
  app.state.currentFlow = ''
  app.state.loading = false
  app.bubbleLayouts = []
  updateUI(app)
  setContentHeight(app.scroller, 0)
  scrollToBottom(app.scroller)
  markDirty(app.state)
}

// ── Layout ──

function relayout(app: App): void {
  const { chatWidth, offsetX } = getChatLayout(app)
  let y = spacing.messageGap

  app.bubbleLayouts = []
  for (const msg of app.state.messages) {
    const bl = measureBubble(msg, chatWidth, y)
    bl.x += offsetX
    app.bubbleLayouts.push(bl)
    y += bl.height + spacing.messageGap
  }

  y += 24
  setContentHeight(app.scroller, y)
}

// ── DOM state sync ──

function updateUI(app: App): void {
  const { state, dom } = app
  dom.sendBtn.disabled = state.loading || !dom.input.value.trim()
  dom.sendBtn.textContent = state.loading ? '...' : 'Send'
  dom.clearBtn.style.display = state.messages.length > 0 ? 'block' : 'none'
  dom.flowBadge.style.display = state.currentFlow ? 'inline-block' : 'none'
  dom.flowBadge.textContent = state.currentFlow.replace(/_/g, ' ')
  dom.input.disabled = state.loading
}

// ── Render loop ──

export function startRenderLoop(app: App): void {
  resizeCanvas(app.rc)
  setViewportHeight(app.scroller, app.rc.height)
  positionDragon(app.dragon, app.rc.width, app.rc.height)
  syncInputWidth(app)
  updateUI(app)

  function frame(): void {
    app.rafId = requestAnimationFrame(frame)
    const now = performance.now()
    const dt = Math.min((now - app.lastTime) / 1000, 0.05)
    app.lastTime = now

    const scrollChanged = tickScroll(app.scroller)
    if (scrollChanged) markDirty(app.state)

    const dragonDirty = tickDragon(app.dragon, dt)
    if (dragonDirty) markDirty(app.state)

    const fxDirty = tickTextFx(app.textFx, dt)
    if (fxDirty) markDirty(app.state)

    if (app.dragon.particles.length > 0) {
      checkFireCollisions(app.textFx, app.dragon, app.bubbleLayouts, app.scroller.scrollY)
    }

    if (app.state.loading) markDirty(app.state)

    if (!app.state.dirty) return
    app.state.dirty = false
    render(app)
  }

  app.rafId = requestAnimationFrame(frame)
}

function render(app: App): void {
  const { rc, scroller, ht, state } = app
  clearCanvas(rc)
  clearRegions(ht)

  const { ctx } = rc
  const scrollY = scroller.scrollY

  withClip(ctx, 0, 0, rc.width, rc.height, () => {
    if (state.messages.length === 0) {
      renderEmptyState(ctx, rc.width, rc.height, app)
    } else {
      for (let i = 0; i < app.bubbleLayouts.length; i++) {
        const bl = app.bubbleLayouts[i]
        const screenY = bl.y - scrollY
        if (screenY + bl.height < -50 || screenY > rc.height + 50) continue

        renderBubble(
          ctx, bl, scrollY, ht,
          (confirmed) => handleConfirm(app, confirmed),
          (name) => handleChooseFlow(app, name),
          i,
          app.dragon,
        )
      }

      if (state.loading) {
        renderTypingIndicator(ctx, app)
      }
    }

    // Fire glow overlay
    if (hasActiveEffects(app.textFx)) {
      renderTextFx(ctx, app.textFx)
    }

    // Dragon always on top
    renderDragon(ctx, app.dragon)
  })
}

// ── Empty state ──

function renderEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number, app: App): void {
  const t = performance.now() / 1000

  renderMiniDragon(ctx, w / 2, h / 2 - 50, 1.6, t)

  const title = 'What can I help you with?'
  ctx.font = fonts.heading2
  const titleW = ctx.measureText(title).width
  drawText(ctx, title, (w - titleW) / 2, h / 2 + 20, fonts.heading2, colors.text)

  const sub = 'Query data, create parties, insert records, or ask anything.'
  const subMeasured = measureText(sub, fonts.body)
  const subLines = getTextLines(subMeasured, Math.min(w - 60, 460))
  const lh = getLineHeight(fonts.body)
  let subY = h / 2 + 50
  for (const line of subLines.lines) {
    ctx.font = fonts.body
    const lineW = ctx.measureText(line.text).width
    drawText(ctx, line.text, (w - lineW) / 2, subY, fonts.body, colors.textMuted)
    subY += lh
  }

  ctx.globalAlpha = 0.3 + Math.sin(t * 1.5) * 0.1
  const hint = 'click the dragon to breathe fire'
  ctx.font = fonts.tiny
  const hintW = ctx.measureText(hint).width
  drawText(ctx, hint, (w - hintW) / 2, h / 2 + 95, fonts.tiny, colors.textFaint)
  ctx.globalAlpha = 1

  markDirty(app.state)
}

// ── Typing indicator ──

function renderTypingIndicator(ctx: CanvasRenderingContext2D, app: App): void {
  const lastBubble = app.bubbleLayouts[app.bubbleLayouts.length - 1]
  if (!lastBubble) return

  const y = lastBubble.y + lastBubble.height + spacing.messageGap - app.scroller.scrollY
  const { offsetX } = getChatLayout(app)
  const x = offsetX

  const bubbleW = 72
  const bubbleH = 36
  const r = spacing.bubbleRadius

  ctx.save()
  ctx.shadowColor = '#00000022'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  fillRoundRect(ctx, x, y, bubbleW, bubbleH,
    { tl: r, tr: r, br: r, bl: 4 }, colors.assistantBubble)
  ctx.restore()
  strokeRoundRect(ctx, x, y, bubbleW, bubbleH,
    { tl: r, tr: r, br: r, bl: 4 }, colors.assistantBorder)

  // Avatar dot
  ctx.fillStyle = colors.dragonGreen
  ctx.beginPath()
  ctx.arc(x - 10, y + 10, 6, 0, Math.PI * 2)
  ctx.fill()

  // Bouncing dots
  const t = performance.now() / 500
  for (let i = 0; i < 3; i++) {
    const phase = t + i * 0.7
    const bounce = Math.sin(phase) * 3
    const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(phase))
    ctx.globalAlpha = alpha
    ctx.fillStyle = colors.textDim
    ctx.beginPath()
    ctx.arc(x + 20 + i * 12, y + bubbleH / 2 + bounce, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
