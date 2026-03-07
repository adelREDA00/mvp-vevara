import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  Plus,
  Move,
  RotateCw,
  Maximize2,
  Eye,
  Pause,
  X,
  GripVertical,
  Trash2,
  Copy,
  Play,
  ChevronUp,
  ChevronDown,
  Crop,
  Zap,
} from 'lucide-react'

// Redux imports for scene-based motion system
import {
  selectSceneMotionFlow,
  addSceneMotionStep,
  deleteSceneMotionStep,
  addSceneMotionAction,
  updateSceneMotionAction,
  deleteSceneMotionAction,
  duplicateSceneMotionStep,
  initializeSceneMotionFlow,
  selectCurrentSceneId,
  selectLayers,
  selectProjectTimelineInfo,
} from '../../../store/slices/projectSlice'

// Stable default motion flow reference to prevent unnecessary rerenders
const DEFAULT_MOTION_FLOW = { steps: [], pageDuration: 5000 }

const actionTypes = [
  { id: 'move', label: 'Move', icon: Move, color: 'bg-blue-600' },
  { id: 'rotate', label: 'Rotate', icon: RotateCw, color: 'bg-green-600' },
  { id: 'scale', label: 'Scale', icon: Maximize2, color: 'bg-purple-600' },
  { id: 'crop', label: 'Crop', icon: Crop, color: 'bg-indigo-600' },
  { id: 'fade', label: 'Fade', icon: Eye, color: 'bg-yellow-600' },
  { id: 'hold', label: 'Hold', icon: Pause, color: 'bg-gray-600' },
]


/**
 * MotionPanel Component - Core UI for Motion Flow Management
 *
 * This component provides the interface for creating and managing motion flows
 * for layers in the editor. It connects directly to the Redux store for state
 * management and provides full CRUD operations for motion steps and actions.
 *
 * Features:
 * - Visual step-based motion flow editor
 * - Action types: move, rotate, scale, fade, hold
 * - Real-time canvas editing state management
 * - Redux-integrated state persistence
 *
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the panel is visible
 * @param {function} props.onClose - Callback to close the panel
 * @param {number} props.topToolbarHeight - Height of top toolbar for positioning
 */
function MotionPanel({
  isOpen = false,
  onClose,
  topToolbarHeight = 0,
  onStepEdit, // Use centralized step editing handler
  motionControls = null,
  isMotionCaptureActive,
  editingStepId,
}) {
  // ============================================================================
  // REDUX STATE MANAGEMENT
  // ============================================================================

  const dispatch = useDispatch()

  // Get current scene ID from project store
  const currentSceneId = useSelector(selectCurrentSceneId)

  // Get all layers in the project (for multi-layer tracking)
  const layers = useSelector(selectLayers)

  // Get motion flow data for the current scene (not per-layer anymore)
  const motionFlowData = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : DEFAULT_MOTION_FLOW
  )

  // Get project timeline info to find the current scene's start time offset
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const currentSceneTimelineInfo = useMemo(() => {
    if (!timelineInfo || !currentSceneId) return null
    return timelineInfo.find(s => s.id === currentSceneId)
  }, [timelineInfo, currentSceneId])

  const startTimeOffset = currentSceneTimelineInfo?.startTime || 0

  // Extract steps array for easier access
  const motionFlow = motionFlowData.steps || []

  // ============================================================================
  // COMPONENT STATE MANAGEMENT
  // ============================================================================

  // Canvas editing state - now managed by EditorPage via props

  // Panel width state for resizable functionality
  const [panelWidth, setPanelWidth] = useState(360)

  // Expanded steps state - tracks which steps are expanded to show details
  const [expandedSteps, setExpandedSteps] = useState(new Set())

  // [PERFORMANCE FIX] Use stable ref for high-frequency coordinate tracking
  // Decouples coordinate updates from React render cycle
  const motionCaptureRef = useRef(null)

  // UI state for capture mode visibility and stats
  // No internal motion capture state required anymore - handled by EditorPage

  // Early return if panel should not be shown
  // Now only requires isOpen and a scene (not a selected layer)
  if (!isOpen || !currentSceneId) return null

  // ============================================================================
  // MOTION FLOW CRUD OPERATIONS - Redux Integrated (Scene-Based)
  // ============================================================================

  /**
   * Initialize motion flow for the current scene if it doesn't exist
   */
  const ensureMotionFlowExists = () => {
    if (!currentSceneId) return

    // Check if motion flow already exists, if not initialize it
    if (!motionFlowData || motionFlow.length === 0) {
      dispatch(initializeSceneMotionFlow({
        sceneId: currentSceneId,
      }))
    }
  }








  /**
   * Delete a motion step from the current scene's motion flow
   * @param {string} stepId - ID of the step to delete
   */
  const handleDeleteStep = (stepId) => {
    if (!currentSceneId) return

    dispatch(deleteSceneMotionStep({
      sceneId: currentSceneId,
      stepId
    }))

    // If the step being edited is deleted, the parent (EditorPage) 
    // will naturally handle the state update as it manages editingStepId.
  }

  /**
   * Duplicate a motion step with all its layer actions
   * @param {string} stepId - ID of the step to duplicate
   */
  const handleDuplicateStep = (stepId) => {
    if (!currentSceneId) return

    dispatch(duplicateSceneMotionStep({
      sceneId: currentSceneId,
      stepId
    }))
  }

  /**
   * Delete an action from a specific layer within a motion step
   * @param {string} stepId - ID of the step containing the action
   * @param {string} layerId - ID of the layer this action belongs to
   * @param {string} actionId - ID of the action to delete
   */
  const handleDeleteAction = (stepId, layerId, actionId) => {
    if (!currentSceneId) return

    dispatch(deleteSceneMotionAction({
      sceneId: currentSceneId,
      stepId,
      layerId,
      actionId
    }))
  }

  // ============================================================================
  // CANVAS EDITING STATE MANAGEMENT
  // ============================================================================

  /**
   * Set the currently editing step for canvas interaction
   * This starts motion capture mode for the specified step (scene-based, multi-layer)
   * @param {string} stepId - ID of the step being edited
   */
  /**
   * Set the currently editing step for canvas interaction
   * This starts motion capture mode for the specified step (scene-based, multi-layer)
   * @param {string} stepId - ID of the step being edited
   */
  const handleEditStep = (stepId) => {
    if (onStepEdit) onStepEdit(stepId)
  }

  /**
   * Toggle expanded state of a step
   * @param {string} stepId - ID of the step to toggle
   */
  const handleToggleStepCollapse = (stepId) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }


  const renderActionIcon = (actionType) => {
    const action = actionTypes.find(a => a.id === actionType)
    if (!action) return null
    const Icon = action.icon
    return <Icon className="h-4 w-4" />
  }

  const renderActionLabel = (action) => {
    switch (action.type) {
      case 'move':
        return `Move`
      case 'rotate':
        return `Rotate`
      case 'scale':
        return `Scale`
      case 'fade':
        return `Fade`
      case 'hold':
        return `Hold`
      case 'crop':
        return `Crop`
      default:
        return action.type
    }
  }

  // ============================================================================
  // RENDER COMPONENT UI
  // ============================================================================
  return (
    <div
      className="fixed inset-y-0 right-0 lg:right-0 z-40 flex flex-col backdrop-blur-md transition-all duration-300 shadow-2xl"
      style={{
        top: `${topToolbarHeight}px`,
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100vw' : `${panelWidth}px`,
        backgroundColor: '#0f1015',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 flex-shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-400" />
          Animation
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-zinc-700/50 transition-colors"
        style={{
          borderLeft: '0.5px solid rgba(255, 255, 255, 0.15)',
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()

          const dragStartX = e.clientX
          const dragStartWidth = panelWidth

          const handleMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - dragStartX
            // For left border drag: dragging left increases width, dragging right decreases width
            // So we invert the deltaX by subtracting it instead of adding
            const newWidth = Math.min(600, Math.max(280, dragStartWidth - deltaX))
            setPanelWidth(newWidth)
          }

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
          }

          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
          document.body.style.cursor = 'ew-resize'
          document.body.style.userSelect = 'none'
        }}
        title="Drag to resize panel width"
      />
      <div className="text-xs text-gray-400 px-4 pb-3 border-b border-zinc-800/50 flex-shrink-0">
        <div className="text-xs text-gray-400">
          {motionFlow.length === 0 ? 'No animation steps yet' : `${motionFlow.length} step${motionFlow.length > 1 ? 's' : ''} of animation`}
          {isMotionCaptureActive && editingStepId && (
            <span className="block text-purple-400 mt-1">
              Animation Editing: Step {motionFlow.findIndex(s => s.id === editingStepId) + 1}
              <span className="block text-yellow-400 mt-0.5">
                Drag layers to capture animation...
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Add Step button removed - steps are now added via the Motion button in CanvasControls */}

      {/* =======================================================================
          STEPS LIST - Main scrollable area showing all motion steps
          Each step contains multiple actions and can be edited individually
          ======================================================================= */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {motionFlow.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm mb-2">Start building animation</p>
            <p className="text-xs">Add your first step to begin</p>
          </div>
        ) : (
          motionFlow.map((step, stepIndex) => (
            <div
              key={step.id}
              className={`bg-zinc-900/50 border rounded-lg p-3 transition-colors ${editingStepId === step.id
                ? 'border-purple-500/50 bg-purple-900/10'
                : 'border-zinc-800'
                }`}
            >
              {/* ===============================================================
                  STEP HEADER - Shows step number, drag handle, and action buttons
                  =============================================================== */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-gray-600 cursor-move" />
                  <span className="text-sm font-medium text-white">Step {stepIndex + 1}</span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Collapse/Expand Button - toggles step content visibility */}
                  <button
                    onClick={() => handleToggleStepCollapse(step.id)}
                    className="p-1 text-gray-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                    title={expandedSteps.has(step.id) ? "Collapse step" : "Expand step"}
                  >
                    {expandedSteps.has(step.id) ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {/* Canvas Edit Button - allows editing step on canvas */}
                  {isMotionCaptureActive && editingStepId === step.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={handleApplyMotion}
                        className="p-1 text-green-400 hover:text-green-300 hover:bg-green-900/50 rounded transition-colors"
                        title="Apply captured animation"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={handleCancelMotion}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/50 rounded transition-colors"
                        title="Discard and snap back"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEditStep(step.id)}
                      className="p-1 text-gray-400 hover:text-purple-400 hover:bg-zinc-800 rounded transition-colors"
                      title="Edit on canvas"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDuplicateStep(step.id)}
                    className="p-1 text-gray-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                    title="Duplicate step"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteStep(step.id)}
                    className="p-1 text-gray-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                    title="Delete step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* ===============================================================
                  LAYER ACTIONS LIST - Shows actions grouped by layer (only when expanded)
                  Each layer can have multiple motion actions
                  Keep automatically expanded if it's the current editing step
                  =============================================================== */}
              {(expandedSteps.has(step.id) || editingStepId === step.id) && (
                <div className="space-y-2 mb-3">
                  {step.layerActions && Object.keys(step.layerActions).length > 0 ? (
                    Object.entries(step.layerActions).map(([layerId, layerActionsList]) => {
                      const layer = layers[layerId]
                      if (!layer) return null
                      return (
                        <div key={layerId} className="bg-zinc-800/30 rounded-lg p-2">
                          {/* Layer name header */}
                          <div className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                            <span className="font-medium text-gray-300">{layer.name || 'Unnamed Layer'}</span>
                            <span className="text-gray-500">•</span>
                            <span>{layerActionsList.length} action{layerActionsList.length > 1 ? 's' : ''}</span>
                          </div>
                          {/* Actions for this layer */}
                          <div className="space-y-1">
                            {layerActionsList.map((action) => (
                              <div
                                key={action.id}
                                className="flex items-center gap-2 p-1.5 bg-zinc-800/50 rounded text-sm"
                              >
                                {renderActionIcon(action.type)}
                                <span className="text-gray-300 flex-1">
                                  {renderActionLabel(action)}
                                </span>
                                <button
                                  onClick={() => handleDeleteAction(step.id, layerId, action.id)}
                                  className="p-0.5 text-gray-400 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
                                  title="Remove action"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="text-center text-gray-500 py-4 text-xs">
                      No layer actions in this step.
                      <br />
                      <span className="text-gray-600">Edit on canvas to capture animation.</span>
                    </div>
                  )}
                </div>
              )}

              {/* ===============================================================
                  STEP INFO - Show hint about canvas editing (only when expanded)
                  =============================================================== */}
              {(expandedSteps.has(step.id) || editingStepId === step.id) && (
                <div className="border-t border-zinc-800/50 pt-3">
                  <div className="text-xs text-gray-500 text-center">
                    Click the <Play className="inline h-3 w-3 text-purple-400" /> button to edit on canvas
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* =======================================================================
          FOOTER - Shows timing information and motion flow statistics
          ======================================================================= */}
      {motionFlow.length > 0 && (
        <div className="flex-shrink-0 p-4 border-t border-zinc-800/50">
          <div className="text-xs text-gray-400 text-center">
            Page duration ({motionFlowData.pageDuration}ms) will be divided evenly across {motionFlow.length} step{motionFlow.length > 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

export default MotionPanel
