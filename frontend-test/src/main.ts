import { createApp, startRenderLoop } from './app'

async function init(): Promise<void> {
  // Wait for fonts to load so Pretext measurements are accurate
  await document.fonts.ready

  const app = createApp()
  startRenderLoop(app)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init())
} else {
  init()
}
