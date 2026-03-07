/**
 * Utility to calculate the start time of a layer's first animation action in a scene.
 * Uses each step's actual startTime when available (supports custom durations and gaps).
 * 
 * @param {string} layerId - The ID of the layer
 * @param {Object} sceneMotionFlow - The motion flow for the current scene
 * @returns {number} The start time of the first action in seconds, or Infinity if no actions exist
 */
export function getLayerFirstActionTime(layerId, sceneMotionFlow) {
    if (!sceneMotionFlow || !sceneMotionFlow.steps || sceneMotionFlow.steps.length === 0) {
        return Infinity
    }

    const { steps, pageDuration = 6000 } = sceneMotionFlow
    const defaultStepDurationMs = pageDuration / steps.length

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (step.layerActions && step.layerActions[layerId] && step.layerActions[layerId].length > 0) {
            const stepStartMs = step.startTime != null ? step.startTime : (i * defaultStepDurationMs)
            return stepStartMs / 1000
        }
    }

    return Infinity
}
