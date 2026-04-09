export const colors = {
  bg: '#08090c',
  bgGradTop: '#0c0d14',
  bgGradBot: '#08090c',
  surface: '#12141c',
  surfaceLight: '#181a24',
  surfaceHover: '#1e2030',
  border: '#1e2030',
  borderDim: '#161822',
  borderAccent: '#2a3a5a',
  borderSubtle: '#1a1c28',

  text: '#e8eaf0',
  textDim: '#8890a4',
  textMuted: '#555c72',
  textFaint: '#3a3f52',
  textLabel: '#6b7394',

  accent: '#2563eb',
  accentHover: '#3b82f6',
  accentLight: '#93c5fd',
  accentDark: '#1e3a5f',
  accentGlow: '#2563eb33',

  green: '#22c55e',
  greenLight: '#4ade80',
  greenBg: '#0a1a10',
  greenBorder: '#1a3a2a',

  red: '#ef4444',
  redLight: '#f87171',
  redBg: '#1a0c0c',
  redBorder: '#3a1a1a',

  yellow: '#fbbf24',
  yellowBg: '#1a1808',
  yellowBorder: '#3a3018',

  white: '#fff',

  userBubble: '#2563eb',
  userBubbleGrad: '#1d4ed8',
  assistantBubble: '#12141e',
  assistantBorder: '#1e2038',

  confirmBg: '#10122a',
  confirmBorder: '#1e2048',

  codeBg: '#1a1c2a',
  codeText: '#a5d6ff',

  flowCardBg: '#12141e',
  flowCardBorder: '#1e2038',
  flowCardHover: '#1a1e30',

  dragonGreen: '#5a8a50',
  fireOrange: '#f97316',
} as const

export const fonts = {
  body: '14px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  bodyBold: 'bold 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  bodySemibold: '600 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  small: '13px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  smallBold: 'bold 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  smallSemibold: '600 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  tiny: '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  tinyBold: 'bold 12px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  heading1: 'bold 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  heading2: 'bold 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  heading3: '600 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  heading4: '600 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  code: '13px "JetBrains Mono", Menlo, monospace',
  codeBold: 'bold 13px "JetBrains Mono", Menlo, monospace',
} as const

const lineHeightsMap = new Map<string, number>()
lineHeightsMap.set(fonts.body, 21)
lineHeightsMap.set(fonts.bodyBold, 21)
lineHeightsMap.set(fonts.bodySemibold, 21)
lineHeightsMap.set(fonts.small, 19)
lineHeightsMap.set(fonts.smallBold, 19)
lineHeightsMap.set(fonts.smallSemibold, 19)
lineHeightsMap.set(fonts.tiny, 17)
lineHeightsMap.set(fonts.tinyBold, 17)
lineHeightsMap.set(fonts.heading1, 26)
lineHeightsMap.set(fonts.heading2, 23)
lineHeightsMap.set(fonts.heading3, 22)
lineHeightsMap.set(fonts.heading4, 21)
lineHeightsMap.set(fonts.code, 19)
lineHeightsMap.set(fonts.codeBold, 19)

export function getLineHeight(font: string): number {
  return lineHeightsMap.get(font) ?? 21
}

export const spacing = {
  bubblePadH: 16,
  bubblePadV: 12,
  bubbleRadius: 16,
  bubbleGap: 10,
  bubbleMaxRatio: 0.78,
  chatMaxWidth: 960,
  chatPadH: 24,
  messageGap: 14,
  tableCellPadH: 10,
  tableCellPadV: 6,
  cardPad: 14,
  cardRadius: 12,
  buttonPadH: 18,
  buttonPadV: 8,
  buttonRadius: 8,
  buttonGap: 8,
  kvLabelWidth: 70,
  sectionGap: 10,
} as const
