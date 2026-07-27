/**
 * Timeline Snapping Assistant
 * Provides lightweight snapping assistance during timeline interactions (dragging and trimming).
 */

/**
 * Snaps proposed motion block timing to other sibling motion blocks within the same step.
 * Uses millisecond calculations.
 */
export function snapMotionBlock({
  type, // 'move', 'resize-left', 'resize-right'
  proposedStart, // ms relative to scene start
  proposedDuration, // ms
  step,
  layerId,
  actionId,
  pageDuration, // ms
  sceneWidthPx,
  thresholdPx = 5,
}) {
  if (!step || sceneWidthPx <= 0 || pageDuration <= 0) {
    return { start: proposedStart, duration: proposedDuration }
  }

  const thresholdMs = thresholdPx * (pageDuration / sceneWidthPx)
  const stepStart = step.startTime || 0
  const siblings = []

  // Gather siblings' edges relative to scene start
  if (step.layerActions) {
    Object.entries(step.layerActions).forEach(([lid, actions]) => {
      if (!Array.isArray(actions)) return
      actions.forEach(act => {
        if (lid === layerId && act.id === actionId) return
        const sStart = stepStart + (act.actionStartOffset ?? 0)
        const sEnd = sStart + (act.actionDuration ?? (step.duration || 1000))
        siblings.push(sStart, sEnd)
      })
    })
  }
  if (step.layerPresets) {
    Object.entries(step.layerPresets).forEach(([lid, preset]) => {
      if (!preset) return
      const pid = `preset_${preset.id}_${step.id}`
      if (lid === layerId && pid === actionId) return
      const sStart = stepStart + (preset.actionStartOffset ?? 0)
      const sEnd = sStart + (preset.actionDuration ?? (step.duration || 1000))
      siblings.push(sStart, sEnd)
    })
  }

  if (siblings.length === 0) {
    return { start: proposedStart, duration: proposedDuration }
  }

  let bestSnapDiff = Infinity
  let snappedValue = null
  let snapType = null

  if (type === 'resize-left') {
    siblings.forEach(target => {
      const diff = Math.abs(proposedStart - target)
      if (diff <= thresholdMs && diff < bestSnapDiff) {
        bestSnapDiff = diff
        snappedValue = target
      }
    })
    if (snappedValue !== null) {
      const finalStart = snappedValue
      const finalDuration = Math.max(50, (proposedStart + proposedDuration) - finalStart)
      return { start: finalStart, duration: finalDuration }
    }
  } else if (type === 'resize-right') {
    const proposedEnd = proposedStart + proposedDuration
    siblings.forEach(target => {
      const diff = Math.abs(proposedEnd - target)
      if (diff <= thresholdMs && diff < bestSnapDiff) {
        bestSnapDiff = diff
        snappedValue = target
      }
    })
    if (snappedValue !== null) {
      const finalDuration = Math.max(50, snappedValue - proposedStart)
      return { start: proposedStart, duration: finalDuration }
    }
  } else if (type === 'move') {
    const proposedEnd = proposedStart + proposedDuration
    siblings.forEach(target => {
      // Check start edge
      const diffStart = Math.abs(proposedStart - target)
      if (diffStart <= thresholdMs && diffStart < bestSnapDiff) {
        bestSnapDiff = diffStart
        snappedValue = target
        snapType = 'start'
      }
      // Check end edge
      const diffEnd = Math.abs(proposedEnd - target)
      if (diffEnd <= thresholdMs && diffEnd < bestSnapDiff) {
        bestSnapDiff = diffEnd
        snappedValue = target
        snapType = 'end'
      }
    })

    if (snappedValue !== null) {
      if (snapType === 'start') {
        return { start: snappedValue, duration: proposedDuration }
      } else {
        return { start: snappedValue - proposedDuration, duration: proposedDuration }
      }
    }
  }

  return { start: proposedStart, duration: proposedDuration }
}

/**
 * Snaps proposed audio block timing to other audio blocks and scene boundaries.
 * Uses second calculations.
 */
export function snapAudioBlock({
  type, // 'move', 'resize-left', 'resize-right'
  proposedStart, // in seconds
  proposedDuration, // in seconds
  audioTracks,
  currentTrackId,
  sceneBoundaries = [],
  pixelsPerSecond,
  playheadTime,
  thresholdPx = 5,
}) {
  if (!pixelsPerSecond || pixelsPerSecond <= 0) {
    return { start: proposedStart, duration: proposedDuration }
  }

  const thresholdSec = thresholdPx / pixelsPerSecond
  const targets = new Set()

  if (typeof playheadTime === 'number') {
    targets.add(playheadTime)
  }

  // Add other audio track boundaries
  audioTracks.forEach(track => {
    if (track.id === currentTrackId || track.isUploading) return
    targets.add(track.startOffset)
    targets.add(track.startOffset + track.duration)
  })

  // Add scene boundaries
  sceneBoundaries.forEach(bound => {
    targets.add(bound)
  })

  if (targets.size === 0) {
    return { start: proposedStart, duration: proposedDuration }
  }

  let bestSnapDiff = Infinity
  let snappedValue = null
  let snapType = null

  if (type === 'resize-left') {
    targets.forEach(target => {
      const diff = Math.abs(proposedStart - target)
      if (diff <= thresholdSec && diff < bestSnapDiff) {
        bestSnapDiff = diff
        snappedValue = target
      }
    })
    if (snappedValue !== null) {
      const finalStart = snappedValue
      const finalDuration = Math.max(0.3, (proposedStart + proposedDuration) - finalStart)
      return { start: finalStart, duration: finalDuration }
    }
  } else if (type === 'resize-right') {
    const proposedEnd = proposedStart + proposedDuration
    targets.forEach(target => {
      const diff = Math.abs(proposedEnd - target)
      if (diff <= thresholdSec && diff < bestSnapDiff) {
        bestSnapDiff = diff
        snappedValue = target
      }
    })
    if (snappedValue !== null) {
      const finalDuration = Math.max(0.3, snappedValue - proposedStart)
      return { start: proposedStart, duration: finalDuration }
    }
  } else if (type === 'move') {
    const proposedEnd = proposedStart + proposedDuration
    targets.forEach(target => {
      // Check start edge
      const diffStart = Math.abs(proposedStart - target)
      if (diffStart <= thresholdSec && diffStart < bestSnapDiff) {
        bestSnapDiff = diffStart
        snappedValue = target
        snapType = 'start'
      }
      // Check end edge
      const diffEnd = Math.abs(proposedEnd - target)
      if (diffEnd <= thresholdSec && diffEnd < bestSnapDiff) {
        diffEnd = diffEnd
        bestSnapDiff = diffEnd
        snappedValue = target
        snapType = 'end'
      }
    })

    if (snappedValue !== null) {
      if (snapType === 'start') {
        const finalStart = Math.max(0, snappedValue)
        return { start: finalStart, duration: proposedDuration }
      } else {
        const finalStart = Math.max(0, snappedValue - proposedDuration)
        return { start: finalStart, duration: proposedDuration }
      }
    }
  }

  return { start: proposedStart, duration: proposedDuration }
}
