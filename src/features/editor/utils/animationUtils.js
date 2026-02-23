/**
 * Utility to calculate the start time of a layer's first animation action in a scene.
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
    const stepDurationMs = pageDuration / steps.length

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (step.layerActions && step.layerActions[layerId] && step.layerActions[layerId].length > 0) {
            // Step durations are uniform, so we can calculate start time based on step index
            return (i * stepDurationMs) / 1000
        }
    }

    return Infinity
}
