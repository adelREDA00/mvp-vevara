import { layoutNextLine } from '@chenglou/pretext'

/**
 * Advanced Text Flow Engine
 * 
 * Provides real-time calculation of horizontal gaps available for text lines
 * by intersecting world-space obstacles with the local coordinate system
 * of a text container. Supports geometric "Shape-Hugging" logic.
 */

/**
 * Calculates the available horizontal segments (gaps) for a single line of text.
 */
export function calculateAvailableSpansAtY(y, lineHeight, fullWidth, obstacles = []) {
  let spans = [{ x: -fullWidth / 2, width: fullWidth }]

  obstacles.forEach((obs) => {
    // Basic vertical check
    if (obs.localY >= y + lineHeight || obs.localY + obs.localHeight <= y) return

    // [ACCURACY FIX] Triple-Point Sampling
    // We sample the top, middle, and bottom of the line to ensure text 
    // never clips into the curved edges of circles or angled edges of triangles.
    const samples = [y + 2, y + lineHeight / 2, y + lineHeight - 2]
    let minObsX = 1000000
    let maxObsRight = -1000000
    let intersected = false

    samples.forEach(sampleY => {
      let obsX = obs.localX
      let obsW = obs.localWidth

      // Shape-Hugging Math
      if (obs.shapeType === 'circle') {
        const r = obs.localWidth / 2
        const cy = obs.localY + r
        const dy = Math.abs(sampleY - cy)
        if (dy < r) {
          const chord = 2 * Math.sqrt(r * r - dy * dy)
          obsX += (obs.localWidth - chord) / 2
          obsW = chord
          intersected = true
        }
      } else if (obs.localPath && obs.localPath.length >= 3) {
        // [POLYGON WRAP FIX] Exact Geometric Raycasting.
        // Intersects the test line (`sampleY`) with every edge of the shape's local polygon.
        // This solves rotated texts, complex stars, and slanted shapes flawlessly.
        const xIntersects = []
        const pts = obs.localPath
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i]
          const p2 = pts[(i + 1) % pts.length]

          if ((p1.y <= sampleY && p2.y > sampleY) || (p2.y <= sampleY && p1.y > sampleY)) {
            const x = p1.x + (p2.x - p1.x) * (sampleY - p1.y) / (p2.y - p1.y)
            xIntersects.push(x)
          }
        }

        if (xIntersects.length > 0) {
          obsX = Math.min(...xIntersects)
          obsW = Math.max(...xIntersects) - obsX
          intersected = true
        }
      } else if (obs.cornerRadius > 0) {
        const r = Math.min(obs.cornerRadius, obs.localWidth / 2, obs.localHeight / 2)
        const relY = sampleY - obs.localY
        let dy = -1
        if (relY < r) dy = r - relY
        else if (relY > obs.localHeight - r) dy = relY - (obs.localHeight - r)

        if (dy > 0 && dy < r) {
          const dx = r - Math.sqrt(r * r - dy * dy)
          obsX += dx
          obsW -= dx * 2
        }
        intersected = true
      } else {
        // Simple Rect
        intersected = true
      }

      if (intersected) {
        minObsX = Math.min(minObsX, obsX)
        maxObsRight = Math.max(maxObsRight, obsX + obsW)
      }
    })

    if (!intersected) return

    // Final Obstacle Bounds (Union of all samples for this line)
    let finalObsX = minObsX
    let finalObsW = maxObsRight - minObsX

    // [POLISH] Tight Safety Margin
    // Reduced from 10 to 4 for a more premium 'tight-wrap' look.
    const margin = 4
    finalObsX -= margin
    finalObsW += margin * 2

    const nextSpans = []
    spans.forEach(s => {
      const sR = s.x + s.width
      const oR = finalObsX + finalObsW
      if (oR <= s.x || finalObsX >= sR) {
        nextSpans.push(s)
      } else {
        if (finalObsX > s.x) nextSpans.push({ x: s.x, width: finalObsX - s.x })
        if (oR < sR) nextSpans.push({ x: oR, width: sR - oR })
      }
    })
    spans = nextSpans
  })

  const finalSpans = spans.filter(s => s.width > 20)



  return finalSpans
}

/**
 * Primary layout iterator for "Water Flow" wrapping.
 * Fills all horizontal gaps on a line before proceeding.
 */
export function layoutWaterFlow(prepared, fullWidth, lineHeight, obstacles = [], anchorHeight = 0) {
  let resultLines = []

  // [STABILITY FIX] Use convergence iteration to find stable layout height
  // Since text height dictates layout initialization point, wrap boundaries fluctuate.
  // This loop breaks the cycle by evaluating the new height and trying again until centered or stable.
  let currentStart = Math.round(-anchorHeight / 2)
  let totalH = anchorHeight
  let offset = 0

  for (let iter = 0; iter < 4; iter++) {
    resultLines = []
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    let y = currentStart
    let safety = 0

    while (true) {
      const spans = calculateAvailableSpansAtY(y, lineHeight, fullWidth, obstacles)

      // If no space, skip this line and move down
      if (spans.length === 0) {
        y += lineHeight
        if (safety++ > 2000) break // Break if we are lost in space
        continue
      }

      let paragraphFinished = false

      for (const span of spans) {
        const line = layoutNextLine(prepared, cursor, span.width)

        if (!line) {
          paragraphFinished = true
          break
        }

        resultLines.push({
          text: line.text,
          x: span.x,
          y: y,
          width: line.width,
          spanWidth: span.width,
          end: line.end
        })

        cursor = line.end

        // If we finished the paragraph, exit
        if (line.end === null) {
          paragraphFinished = true
          break
        }
      }

      if (paragraphFinished) break

      y += lineHeight
      if (safety++ > 2000) break
    }

    if (resultLines.length === 0) {
      totalH = 0
      offset = 0
      break
    }

    const minY = resultLines[0].y
    const maxY = resultLines[resultLines.length - 1].y + lineHeight
    totalH = maxY - minY

    const center = minY + totalH / 2

    // Check if the lines are perfectly centered around 0
    if (Math.abs(center) < 1) {
      offset = -center
      break
    }

    // Shift the starting point by the off-center deviation for next try to converge.
    currentStart -= center
    offset = -center
  }

  // Final alignment absorption (clamp to safely prevent shifting into obstacles incorrectly)
  if (resultLines.length > 0) {
    const clampedOffset = Math.max(-lineHeight, Math.min(lineHeight, offset))

    let minX = Infinity
    let maxX = -Infinity

    resultLines.forEach(l => {
      l.y += clampedOffset
      if (l.x < minX) minX = l.x
      if (l.x + l.width > maxX) maxX = l.x + l.width
    })

    return { lines: resultLines, height: totalH, width: maxX - minX }
  }

  return { lines: [], height: 0, width: 0 }
}

export function getLocalObstacles(textContainer, worldObstacles = []) {
  if (!textContainer || textContainer.destroyed) return []


  return worldObstacles.map((obs, index) => {
    if (!obs || obs.id === textContainer.id) return null

    // [COORD FIX] Map obstacles relative to the STABLE center of the text.
    // PIXI's worldTransform maps local (0,0) to world.
    // Inverted worldTransform maps world to local (0,0).
    const inverse = textContainer.worldTransform.clone().invert()

    const transformPoint = (x, y) => {
      // [STABILITY FIX] Use PIXI's robust toLocal to handle all transforms.
      // This correctly accounts for pivot, scale, and rotation automatically.
      return textContainer.toLocal({ x, y })
    }

    const p1 = transformPoint(obs.x, obs.y)
    const p2 = transformPoint(obs.x + obs.width, obs.y)
    const p3 = transformPoint(obs.x + obs.width, obs.y + obs.height)
    const p4 = transformPoint(obs.x, obs.y + obs.height)

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

    // [POLYGON WRAP FIX]
    // Transform custom worldPath polygon directly to local space
    const localPath = obs.worldPath ? obs.worldPath.map(p => transformPoint(p.x, p.y)) : null


    return {
      ...obs,
      localX: minX,
      localY: minY,
      localWidth: maxX - minX,
      localHeight: maxY - minY,
      localPath
    }
  }).filter(Boolean)
}
