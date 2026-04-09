/**
 * Majestic dragon — Night Fury inspired.
 * Sleek dark silhouette, large sweeping wings, glowing eyes.
 * Sits in bottom-right corner, auto-fires. Click-drag to move, release to return.
 */

type Particle = {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number
  hue: number
}

export type Dragon = {
  x: number; y: number
  targetX: number; targetY: number
  homeX: number; homeY: number
  scale: number
  breathPhase: number
  blinkTimer: number
  isBlinking: boolean
  tailPhase: number
  wingPhase: number
  particles: Particle[]
  isFiring: boolean
  fireTimer: number
  fireAngle: number
  autoFireTimer: number
  grabbed: boolean
  hoverGlow: number
  facingLeft: boolean
}

export function createDragon(): Dragon {
  return {
    x: 0, y: 0,
    targetX: 0, targetY: 0,
    homeX: 0, homeY: 0,
    scale: 1.0,
    breathPhase: 0,
    blinkTimer: 3 + Math.random() * 4,
    isBlinking: false,
    tailPhase: 0,
    wingPhase: 0,
    particles: [],
    isFiring: false,
    fireTimer: 0,
    fireAngle: -Math.PI * 0.7,
    autoFireTimer: 4 + Math.random() * 3,
    grabbed: false,
    hoverGlow: 0,
    facingLeft: true,
  }
}

export function positionDragon(d: Dragon, canvasW: number, canvasH: number): void {
  d.homeX = canvasW - 75
  d.homeY = canvasH - 40
  if (!d.grabbed) {
    d.targetX = d.homeX
    d.targetY = d.homeY
  }
  if (d.x === 0 && d.y === 0) {
    d.x = d.homeX
    d.y = d.homeY
  }
}

export function grabDragon(d: Dragon, mx: number, my: number): void {
  d.grabbed = true
  d.targetX = mx
  d.targetY = my
}

export function dragDragon(d: Dragon, mx: number, my: number): void {
  if (!d.grabbed) return
  d.targetX = mx
  d.targetY = my
}

export function releaseDragon(d: Dragon): void {
  d.grabbed = false
  d.targetX = d.homeX
  d.targetY = d.homeY
}

export function tickDragon(d: Dragon, dt: number): boolean {
  let dirty = false
  d.breathPhase += dt * 1.4
  d.tailPhase += dt * 1.8
  d.wingPhase += dt * (d.grabbed ? 5.0 : 2.0)

  const speed = d.grabbed ? 0.14 : 0.05
  const dx = d.targetX - d.x
  const dy = d.targetY - d.y
  if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
    d.x += dx * speed
    d.y += dy * speed
    dirty = true
  }

  if (d.grabbed && Math.abs(dx) > 3) d.facingLeft = dx < 0
  else if (!d.grabbed) d.facingLeft = true

  d.blinkTimer -= dt
  if (d.blinkTimer <= 0) {
    d.isBlinking = !d.isBlinking
    d.blinkTimer = d.isBlinking ? 0.1 : 3 + Math.random() * 5
  }

  d.hoverGlow += ((d.grabbed ? 1 : 0) - d.hoverGlow) * 0.1
  if (Math.abs(d.hoverGlow) > 0.01) dirty = true

  if (!d.grabbed) {
    d.autoFireTimer -= dt
    if (d.autoFireTimer <= 0) {
      d.isFiring = true
      d.fireTimer = 0.7
      d.fireAngle = -Math.PI * (0.5 + Math.random() * 0.4)
      d.autoFireTimer = 5 + Math.random() * 7
    }
  }

  if (d.isFiring) {
    d.fireTimer -= dt
    if (d.fireTimer <= 0) {
      d.isFiring = false
    } else {
      emitFire(d)
      dirty = true
    }
  }

  for (let i = d.particles.length - 1; i >= 0; i--) {
    const p = d.particles[i]
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += 18 * dt
    p.vx *= 0.98
    p.life -= dt
    p.size *= 0.992
    if (p.life <= 0 || p.size < 0.2) d.particles.splice(i, 1)
    dirty = true
  }
  if (d.particles.length > 0) dirty = true
  return dirty
}

function emitFire(d: Dragon): void {
  const s = d.scale
  const mouthX = d.x + (d.facingLeft ? -30 : 30) * s
  const mouthY = d.y - 35 * s
  for (let i = 0; i < 5; i++) {
    const spread = (Math.random() - 0.5) * 0.7
    const spd = 150 + Math.random() * 200
    d.particles.push({
      x: mouthX, y: mouthY,
      vx: Math.cos(d.fireAngle + spread) * spd,
      vy: Math.sin(d.fireAngle + spread) * spd,
      life: 0.5 + Math.random() * 0.5,
      maxLife: 0.5 + Math.random() * 0.5,
      size: 4 + Math.random() * 7,
      hue: 10 + Math.random() * 35,
    })
  }
}

export function triggerFire(d: Dragon, tx: number, ty: number): void {
  d.isFiring = true
  d.fireTimer = 0.8
  const s = d.scale
  const mx = d.x + (d.facingLeft ? -30 : 30) * s
  const my = d.y - 35 * s
  d.fireAngle = Math.atan2(ty - my, tx - mx)
}

export function getDragonHitBox(d: Dragon): { x: number; y: number; w: number; h: number } {
  const s = d.scale
  return { x: d.x - 45 * s, y: d.y - 60 * s, w: 90 * s, h: 80 * s }
}

// ── Rendering ──

const BODY = '#1a1e2e'
const BODY_LIGHT = '#252a3e'
const BODY_EDGE = '#0e1018'
const WING_FILL = '#141828'
const WING_EDGE = '#1e2440'
const WING_MEMBRANE = '#1a1e3508'
const EYE_GREEN = '#4ade80'
const EYE_GLOW = '#22c55e'
const HORN = '#3a3f5a'
const CLAW = '#2a2e42'
const BELLY = '#222840'
const SPINE = '#2a3050'

export function renderDragon(ctx: CanvasRenderingContext2D, d: Dragon): void {
  renderParticles(ctx, d)

  ctx.save()
  ctx.translate(d.x, d.y)
  const s = d.scale
  const fx = d.facingLeft ? 1 : -1
  ctx.scale(s * fx, s)

  const br = Math.sin(d.breathPhase) * 1.5
  const tail = Math.sin(d.tailPhase) * 12
  const wing = Math.sin(d.wingPhase) * (d.grabbed ? 0.4 : 0.2)

  // Glow when grabbed
  if (d.hoverGlow > 0.02) {
    ctx.save()
    ctx.globalAlpha = d.hoverGlow * 0.15
    const g = ctx.createRadialGradient(0, -15, 5, 0, -15, 60)
    g.addColorStop(0, '#4ade8044')
    g.addColorStop(1, '#4ade8000')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(0, -15, 60, 45, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── Tail (long, sinuous) ──
  ctx.strokeStyle = BODY
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(22, 0)
  ctx.bezierCurveTo(38, -4 + tail * 0.2, 52 + tail * 0.4, -10 + tail * 0.5, 65 + tail, -18)
  ctx.stroke()
  // Tail fin
  ctx.fillStyle = BODY_LIGHT
  ctx.beginPath()
  ctx.moveTo(63 + tail, -16)
  ctx.lineTo(72 + tail, -26)
  ctx.lineTo(68 + tail, -14)
  ctx.lineTo(72 + tail, -10)
  ctx.lineTo(62 + tail, -18)
  ctx.fill()

  // ── Wings (large, sweeping) ──
  // Left wing
  ctx.fillStyle = WING_FILL
  ctx.strokeStyle = WING_EDGE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-8, -22 + br)
  ctx.bezierCurveTo(-30, -58 - wing * 55 + br, -65, -72 - wing * 45 + br, -58, -78 - wing * 40 + br)
  ctx.bezierCurveTo(-48, -70 - wing * 25 + br, -30, -55 + br, -12, -30 + br)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Wing bone lines
  ctx.strokeStyle = '#2a305044'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-10, -24 + br)
  ctx.bezierCurveTo(-25, -50 - wing * 35 + br, -45, -65 - wing * 30 + br, -52, -72 - wing * 35 + br)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-9, -26 + br)
  ctx.bezierCurveTo(-22, -45 - wing * 28 + br, -38, -58 - wing * 22 + br, -46, -66 - wing * 28 + br)
  ctx.stroke()

  // Right wing
  ctx.fillStyle = WING_FILL
  ctx.strokeStyle = WING_EDGE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(14, -22 + br)
  ctx.bezierCurveTo(34, -55 - wing * 50 + br, 62, -68 - wing * 40 + br, 56, -74 - wing * 35 + br)
  ctx.bezierCurveTo(48, -66 - wing * 22 + br, 32, -52 + br, 18, -30 + br)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#2a305044'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(16, -24 + br)
  ctx.bezierCurveTo(30, -48 - wing * 32 + br, 48, -60 - wing * 28 + br, 52, -68 - wing * 30 + br)
  ctx.stroke()

  // ── Body (sleek, dark) ──
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.ellipse(3, -8 + br * 0.4, 22, 16, -0.05, 0, Math.PI * 2)
  ctx.fill()

  // Belly highlight
  ctx.fillStyle = BELLY
  ctx.beginPath()
  ctx.ellipse(3, -3 + br * 0.4, 14, 9, 0, 0, Math.PI * 2)
  ctx.fill()

  // ── Hind legs ──
  ctx.fillStyle = BODY_EDGE
  ctx.beginPath()
  ctx.ellipse(-12, 7, 8, 5.5, -0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(16, 7, 8, 5.5, 0.15, 0, Math.PI * 2)
  ctx.fill()
  // Claws
  ctx.fillStyle = CLAW
  for (const cx of [-17, -12, -7]) {
    ctx.beginPath()
    ctx.ellipse(cx, 12, 1.5, 3, -0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const cx of [11, 16, 21]) {
    ctx.beginPath()
    ctx.ellipse(cx, 12, 1.5, 3, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Neck + Head ──
  // Neck
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.moveTo(-10, -20 + br)
  ctx.quadraticCurveTo(-18, -32 + br, -22, -38 + br)
  ctx.quadraticCurveTo(-16, -36 + br, -8, -24 + br)
  ctx.fill()

  // Head (angular, sleek)
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.ellipse(-22, -40 + br, 15, 11, -0.1, 0, Math.PI * 2)
  ctx.fill()

  // Snout (pointed)
  ctx.fillStyle = BODY_LIGHT
  ctx.beginPath()
  ctx.moveTo(-32, -38 + br)
  ctx.quadraticCurveTo(-42, -40 + br, -40, -44 + br)
  ctx.quadraticCurveTo(-36, -46 + br, -30, -44 + br)
  ctx.lineTo(-28, -40 + br)
  ctx.fill()

  // Jaw line
  ctx.fillStyle = BODY_EDGE
  ctx.beginPath()
  ctx.moveTo(-32, -38 + br)
  ctx.quadraticCurveTo(-40, -36 + br, -38, -34 + br)
  ctx.quadraticCurveTo(-32, -36 + br, -28, -38 + br)
  ctx.fill()

  // Nostrils
  if (d.isFiring) {
    ctx.fillStyle = '#f97316'
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(-39, -42 + br, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(-38, -38 + br, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ── Eyes (piercing green glow) ──
  if (d.isBlinking) {
    ctx.strokeStyle = EYE_GREEN
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-27, -44 + br)
    ctx.lineTo(-21, -44 + br)
    ctx.stroke()
  } else {
    // Eye glow
    ctx.save()
    ctx.shadowColor = EYE_GLOW
    ctx.shadowBlur = d.isFiring ? 12 : 6
    ctx.fillStyle = EYE_GREEN
    ctx.beginPath()
    ctx.ellipse(-24, -44 + br, 4, 3, 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // Slit pupil
    ctx.fillStyle = '#0a0e14'
    ctx.beginPath()
    ctx.ellipse(-24, -44 + br, 1.5, 2.8, 0, 0, Math.PI * 2)
    ctx.fill()
    // Highlight
    ctx.fillStyle = '#fff'
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(-22.5, -45.5 + br, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ── Ear plates / horns ──
  ctx.fillStyle = HORN
  ctx.beginPath()
  ctx.moveTo(-14, -48 + br)
  ctx.lineTo(-10, -58 + br)
  ctx.lineTo(-8, -48 + br)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-20, -48 + br)
  ctx.lineTo(-20, -57 + br)
  ctx.lineTo(-16, -47 + br)
  ctx.fill()
  // Small ear nubs
  ctx.beginPath()
  ctx.moveTo(-26, -46 + br)
  ctx.lineTo(-28, -54 + br)
  ctx.lineTo(-24, -46 + br)
  ctx.fill()

  // ── Spines along back ──
  ctx.fillStyle = SPINE
  for (let i = 0; i < 6; i++) {
    const sx = -6 + i * 7
    const sy = -22 + br * 0.4 + Math.sin(d.tailPhase + i * 0.4) * 0.6
    const h = 6 - i * 0.4
    ctx.beginPath()
    ctx.moveTo(sx - 2, sy)
    ctx.lineTo(sx, sy - h)
    ctx.lineTo(sx + 2, sy)
    ctx.fill()
  }

  ctx.restore()
}

function renderParticles(ctx: CanvasRenderingContext2D, d: Dragon): void {
  for (const p of d.particles) {
    const t = p.life / p.maxLife
    const a = t * 0.85
    ctx.globalAlpha = a
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
    g.addColorStop(0, `hsla(${p.hue + 20}, 100%, 82%, ${a})`)
    g.addColorStop(0.35, `hsla(${p.hue}, 100%, 58%, ${a * 0.7})`)
    g.addColorStop(1, `hsla(${p.hue - 10}, 100%, 32%, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = a * 0.2
    ctx.fillStyle = `hsla(${p.hue + 10}, 100%, 70%, 0.15)`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Sleeping mini dragon for empty state */
export function renderMiniDragon(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, t: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  const bob = Math.sin(t * 1.2) * 2.5
  const wf = Math.sin(t * 2) * 0.15

  // Shadow
  ctx.globalAlpha = 0.1
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(0, 22, 28, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Wings (folded, resting)
  ctx.fillStyle = WING_FILL
  ctx.strokeStyle = WING_EDGE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-6, -14 + bob)
  ctx.bezierCurveTo(-22, -40 - wf * 25 + bob, -48, -50 - wf * 18 + bob, -42, -54 - wf * 15 + bob)
  ctx.bezierCurveTo(-34, -46 + bob, -18, -34 + bob, -8, -20 + bob)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(10, -14 + bob)
  ctx.bezierCurveTo(26, -38 - wf * 22 + bob, 48, -46 - wf * 16 + bob, 44, -52 - wf * 14 + bob)
  ctx.bezierCurveTo(38, -44 + bob, 22, -32 + bob, 12, -20 + bob)
  ctx.fill()
  ctx.stroke()

  // Body
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.ellipse(0, bob, 20, 15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = BELLY
  ctx.beginPath()
  ctx.ellipse(0, 4 + bob, 13, 8, 0, 0, Math.PI * 2)
  ctx.fill()

  // Head (resting, eyes closed)
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.ellipse(-18, -16 + bob, 14, 10, -0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = BODY_LIGHT
  ctx.beginPath()
  ctx.moveTo(-28, -14 + bob)
  ctx.quadraticCurveTo(-36, -16 + bob, -34, -20 + bob)
  ctx.quadraticCurveTo(-30, -22 + bob, -24, -20 + bob)
  ctx.fill()

  // Closed eyes
  ctx.strokeStyle = EYE_GREEN
  ctx.lineWidth = 1.5
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.moveTo(-23, -20 + bob)
  ctx.lineTo(-17, -20 + bob)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Horns
  ctx.fillStyle = HORN
  ctx.beginPath()
  ctx.moveTo(-12, -24 + bob); ctx.lineTo(-10, -32 + bob); ctx.lineTo(-8, -24 + bob)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-18, -23 + bob); ctx.lineTo(-18, -31 + bob); ctx.lineTo(-15, -23 + bob)
  ctx.fill()

  // Tail
  const ts = Math.sin(t * 1.6) * 10
  ctx.strokeStyle = BODY
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(18, bob)
  ctx.bezierCurveTo(30, -4 + ts * 0.2 + bob, 44 + ts * 0.4, -8 + bob, 52 + ts, -14 + bob)
  ctx.stroke()

  // Legs
  ctx.fillStyle = BODY_EDGE
  ctx.beginPath()
  ctx.ellipse(-10, 14 + bob * 0.3, 7, 5, -0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(12, 14 + bob * 0.3, 7, 5, 0.15, 0, Math.PI * 2)
  ctx.fill()

  // Z's
  ctx.globalAlpha = 0.35 + Math.sin(t * 1.8) * 0.15
  ctx.font = 'bold 11px Inter, sans-serif'
  ctx.fillStyle = EYE_GREEN
  ctx.textBaseline = 'middle'
  const zo = Math.sin(t * 1.1) * 3
  ctx.fillText('z', -32, -30 + bob + zo)
  ctx.font = 'bold 8px Inter, sans-serif'
  ctx.fillText('z', -38, -36 + bob + zo * 0.7)
  ctx.globalAlpha = 1

  ctx.restore()
}
