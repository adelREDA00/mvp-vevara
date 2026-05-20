import { useState, useRef, useEffect, useContext } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import {
  Plus,
  Move,
  RotateCw,
  Maximize2,
  Eye,
  X,
  Trash2,
  Play,
  Crop,
  Zap,
  FlipHorizontal2,
  Check,
  ChevronDown,
  Droplets,
  Palette,
  Film,
  Type,
  Pencil,
  Rotate3d,
} from 'lucide-react'

// Custom Corner Radius Icon representing a rounded corner path
const CornerRadiusIcon = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 4H11C7.13401 4 4 7.13401 4 11V21" />
  </svg>
)

import { LAYER_TYPES } from '../../../store/models'

import {
  selectSceneMotionFlow,
  deleteSceneMotionStep,
  deleteSceneMotionAction,
  selectCurrentSceneId,
  selectLayers,
} from '../../../store/slices/projectSlice'
import { setSelectedLayer } from '../../../store/slices/selectionSlice'

// Stable default motion flow reference to prevent unnecessary rerenders
const DEFAULT_MOTION_FLOW = { steps: [], pageDuration: 5000 }

// Action type metadata for UI display
const actionTypes = [
  { id: 'move', label: 'Move', icon: Move, color: 'bg-blue-500/80' },
  { id: 'rotate', label: 'Rotate', icon: RotateCw, color: 'bg-green-500/80' },
  { id: 'scale', label: 'Scale', icon: Maximize2, color: 'bg-purple-500/80' },
  { id: 'crop', label: 'Crop', icon: Crop, color: 'bg-indigo-500/80' },
  { id: 'fade', label: 'Fade', icon: Eye, color: 'bg-yellow-500/80' },
  { id: 'flip', label: 'Flip', icon: FlipHorizontal2, color: 'bg-teal-500/80' },
  { id: 'colorChange', label: 'Color', icon: Palette, color: 'bg-pink-500/80' },
  { id: 'blur', label: 'Blur', icon: Droplets, color: 'bg-cyan-500/80' },
  { id: 'cornerRadius', label: 'Radius', icon: CornerRadiusIcon, color: 'bg-orange-500/80' },
  { id: 'typewriter', label: 'Typewriter', icon: Type, color: 'bg-emerald-500/80' },
  { id: 'tilt', label: '3D Tilt', icon: Rotate3d, color: 'bg-rose-500/80' },
]

// Which actions are available per layer type (HOLD excluded entirely)
const ACTION_AVAILABILITY = {
  [LAYER_TYPES.SHAPE]: ['move', 'rotate', 'scale', 'fade', 'blur', 'colorChange', 'cornerRadius', 'tilt'],
  [LAYER_TYPES.TEXT]: ['move', 'rotate', 'scale', 'fade', 'blur', 'colorChange', 'typewriter', 'tilt'],
  [LAYER_TYPES.IMAGE]: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  [LAYER_TYPES.VIDEO]: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  [LAYER_TYPES.GROUP]: ['move', 'rotate', 'scale', 'fade', 'blur', 'tilt'],
  frame_normal: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'tilt'],
  frame_card: ['move', 'rotate', 'scale', 'fade', 'blur', 'crop', 'flip', 'tilt'],
  [LAYER_TYPES.BACKGROUND]: ['colorChange'],
}

function getLayerDisplayName(layer) {
  if (!layer) return 'Unknown Element'
  switch (layer.type) {
    case LAYER_TYPES.IMAGE: return 'Image Element'
    case LAYER_TYPES.VIDEO: return 'Video Element'
    case LAYER_TYPES.SHAPE: return 'Shape Element'
    case LAYER_TYPES.TEXT: return 'Text Element'
    case LAYER_TYPES.GROUP: return 'Group Element'
    case LAYER_TYPES.BACKGROUND: return 'Canvas Background'
    case LAYER_TYPES.FRAME:
      return layer.data?.isCardFrame ? 'Card Frame Element' : 'Frame Element'
    default: return layer.name || 'Element'
  }
}

function getAvailableActions(layer, existingActions) {
  if (!layer) return []
  let layerKey = layer.type
  if (layer.type === LAYER_TYPES.FRAME) {
    layerKey = layer.data?.isCardFrame ? 'frame_card' : 'frame_normal'
  }
  let allowed = ACTION_AVAILABILITY[layerKey] || []

  // Filter out cornerRadius for non-rect/square shapes
  const shapeType = layer.data?.shapeType || 'rect'
  if (shapeType !== 'rect' && shapeType !== 'square') {
    allowed = allowed.filter(t => t !== 'cornerRadius')
  }

  const usedTypes = (existingActions || []).map(a => a.type)
  return allowed.filter(t => !usedTypes.includes(t))
}

function MotionPanel({
  isOpen = false,
  onClose,
  topToolbarHeight = 0,
  onStepEdit,
  onApplyMotion,
  onCancelMotion,
  onStartMotionCapture,
  onAddAnimation,
  sceneLayers = [],
  selectedLayerIds = [],
  motionControls = null,
  isMotionCaptureActive,
  editingStepId,
  onDeleteCaptureAction,
}) {
  const dispatch = useDispatch()

  const currentSceneId = useSelector(selectCurrentSceneId)
  const layers = useSelector(selectLayers)

  const motionFlowData = useSelector((state) =>
    currentSceneId ? selectSceneMotionFlow(state, currentSceneId) : DEFAULT_MOTION_FLOW
  )

  const motionFlow = motionFlowData.steps || []

  const [panelWidth, setPanelWidth] = useState(360)
  const [isResizing, setIsResizing] = useState(false)

  // Context menu state
  const [addAnimMenuLayerId, setAddAnimMenuLayerId] = useState(null)
  const [menuDirection, setMenuDirection] = useState('down')
  const menuRef = useRef(null)

  // Collapsible steps (Set of expanded step IDs; default = all collapsed)
  const [expandedSteps, setExpandedSteps] = useState(new Set())

  // Collapsible layers (Map<layerId, boolean> for manual overrides)
  const [manualLayerState, setManualLayerState] = useState(new Map())
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'

  // Reset manual layer overrides when editing step changes
  useEffect(() => { setManualLayerState(new Map()) }, [editingStepId])

  // Close menu on outside click
  useEffect(() => {
    if (!addAnimMenuLayerId) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAddAnimMenuLayerId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [addAnimMenuLayerId])

  useEffect(() => {
    if (!editingStepId || !selectedLayerIds?.length) return
    const layerId = selectedLayerIds[0]
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-layer-id="${layerId}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [selectedLayerIds, editingStepId])

  if (!isOpen || !currentSceneId) return null

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleDeleteStep = (stepId) => {
    if (!currentSceneId) return
    if (editingStepId === stepId) {
      // Active step: cancel capture mode first (resets editingStepId + isMotionCaptureActive)
      onCancelMotion?.()
      // Then ensure step is deleted (idempotent — filter on non-existent ID is a no-op)
      dispatch(deleteSceneMotionStep({ sceneId: currentSceneId, stepId }))
    } else {
      dispatch(deleteSceneMotionStep({ sceneId: currentSceneId, stepId }))
    }
  }

  const handleDeleteAction = (stepId, layerId, actionId, actionType) => {
    if (!currentSceneId) return
    dispatch(deleteSceneMotionAction({ sceneId: currentSceneId, stepId, layerId, actionId }))
    if (isMotionCaptureActive && onDeleteCaptureAction) {
      onDeleteCaptureAction(stepId, layerId, actionType)
    }
  }

  const handleEditStep = (stepId) => {
    if (onStepEdit) onStepEdit(stepId)
  }

  const toggleStepExpand = (stepId) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const toggleLayerCollapse = (layerId, currentlyExpanded) => {
    setManualLayerState(prev => {
      const next = new Map(prev)
      next.set(layerId, !currentlyExpanded)
      return next
    })
  }

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const renderLayerPreview = (layer) => {
    if (!layer) return null

    if (layer.type === LAYER_TYPES.IMAGE) {
      const src = layer.data?.url || layer.data?.src
      return src
        ? <img src={src} alt="" className="w-full h-full object-cover rounded-md" />
        : <div className={`w-full h-full rounded-md ${isLight ? 'bg-slate-200' : 'bg-gradient-to-br from-white/20 to-white/5'}`} />
    }

    if (layer.type === LAYER_TYPES.VIDEO) {
      const thumb = layer.data?.thumbnail
      return (
        <div className={`w-full h-full relative rounded-md overflow-hidden ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`}>
          {thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" />
            : <div className={`w-full h-full ${isLight ? 'bg-slate-100' : 'bg-zinc-900'}`} />
          }
          <div className={`absolute inset-0 flex items-center justify-center ${isLight ? 'bg-black/10' : 'bg-black/30'}`}>
            <Film className={`h-3 w-3 ${isLight ? 'text-gray-600' : 'text-white/70'}`} />
          </div>
        </div>
      )
    }

    if (layer.type === LAYER_TYPES.TEXT) {
      const text = layer.data?.content || ''
      const color = layer.data?.color || (isLight ? '#111827' : '#ffffff')
      return (
        <div className={`w-full h-full rounded-md flex items-center justify-center px-1 overflow-hidden ${isLight ? 'bg-white border border-gray-100 shadow-sm' : 'bg-white/5 border border-white/10'}`}>
          <span
            style={{ fontSize: '10px', color, lineHeight: 1.1, wordBreak: 'break-all' }}
            className="text-center font-bold"
          >
            {text.substring(0, 10) || 'Aa'}
          </span>
        </div>
      )
    }

    if (layer.type === LAYER_TYPES.SHAPE) {
      const fill = layer.data?.fill
      const shapeType = layer.data?.shapeType || 'rect'
      const fillColor = fill && fill !== 'transparent' ? fill : (isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.18)')

      if (shapeType === 'circle') {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className={`w-4 h-4 rounded-full border ${isLight ? 'border-gray-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} />
          </div>
        )
      }
      return <div className={`w-full h-full rounded-md border ${isLight ? 'border-gray-200' : 'border-white/10'}`} style={{ backgroundColor: fillColor }} />
    }

    if (layer.type === LAYER_TYPES.FRAME) {
      return (
        <div className={`w-full h-full rounded-md flex items-center justify-center text-[8px] font-bold ${isLight ? 'bg-slate-100 border border-gray-200 text-slate-500' : 'bg-white/10 border border-white/10 text-white/50'}`}>
          {layer.data?.isCardFrame ? 'C' : 'F'}
        </div>
      )
    }

    if (layer.type === LAYER_TYPES.BACKGROUND) {
      const color = typeof layer.data?.color === 'number'
        ? '#' + layer.data.color.toString(16).padStart(6, '0')
        : (layer.data?.color || (isLight ? '#ffffff' : '#000000'))
      return <div className={`w-full h-full rounded-md border ${isLight ? 'border-gray-200' : 'border-white/10'}`} style={{ backgroundColor: color }} />
    }

    return (
      <div className="w-full h-full rounded-md bg-white/10 border border-white/10 flex items-center justify-center text-[8px] text-white/50">
        {(layer.type || 'L').charAt(0).toUpperCase()}
      </div>
    )
  }

  const getActionMeta = (actionType) => actionTypes.find(a => a.id === actionType)

  const renderActionIcon = (actionType) => {
    const meta = getActionMeta(actionType)
    if (!meta) return null
    const Icon = meta.icon
    return <Icon className="h-3.5 w-3.5" />
  }

  const renderActionLabel = (actionType) => {
    const meta = getActionMeta(actionType)
    return meta ? meta.label : actionType
  }

  const getStepSummary = (step) => {
    if (!step.layerActions) return { layerCount: 0, actionCount: 0 }
    const entries = Object.entries(step.layerActions)
    const layerCount = entries.length
    const actionCount = entries.reduce((sum, [, actions]) => sum + (actions?.length || 0), 0)
    return { layerCount, actionCount }
  }

  // ============================================================================
  // SHARED: Render action rows (used by both active and read-only views)
  // ============================================================================

  const renderActionRow = (action, stepId, layerId, readOnly) => (
    <div
      key={action.id}
      className={`flex items-center gap-2 p-1.5 rounded-lg border text-[11px] group/action ${isLight ? 'bg-white border-slate-100/10 shadow-sm' : 'bg-zinc-900/60 border-zinc-800/20 shadow-none'
        }`}
    >
      <div className={`${isLight ? 'text-slate-400 opacity-80' : 'text-zinc-400 opacity-60'}`}>
        {renderActionIcon(action.type)}
      </div>
      <span className={`flex-1 font-medium ${isLight ? 'text-slate-700' : 'text-zinc-100'}`}>
        {renderActionLabel(action.type)}
      </span>
      {!readOnly && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteAction(stepId, layerId, action.id, action.type)
          }}
          className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover/action:opacity-100"
          title="Remove action"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )

  // ============================================================================
  // SHARED: Render a layer card
  // ============================================================================

  const renderLayerCard = (layer, step, readOnly) => {
    if (!layer) return null
    const layerId = layer.id
    const layerActions = step.layerActions?.[layerId] || []
    const available = readOnly ? [] : getAvailableActions(layer, layerActions)
    const isSelected = selectedLayerIds?.includes(layerId)

    // Collapsible logic (only for active step)
    const hasAnimations = layerActions.length > 0
    const manualOverride = manualLayerState.get(layerId)
    let isLayerExpanded
    if (readOnly) {
      // Read-only: always show actions inline (they're compact enough)
      isLayerExpanded = hasAnimations
    } else {
      isLayerExpanded = manualOverride !== undefined
        ? manualOverride
        : (!hasAnimations || isSelected)
    }

    return (
      <div
        key={layerId}
        data-layer-id={layerId}
        className={`rounded-xl p-2.5 border transition-all ${isSelected
            ? (isLight ? 'border-purple-200 bg-purple-50/50 shadow-sm' : 'border-purple-500/40 bg-purple-500/[0.03]')
            : (isLight ? 'border-slate-100 bg-white shadow-sm hover:border-slate-200' : 'border-zinc-800/10 bg-zinc-800/20 hover:border-zinc-800/30')
          }`}
      >
        {/* Layer Header */}
        <div
          className={`flex items-center gap-2.5 min-w-0 ${!readOnly ? 'cursor-pointer' : ''}`}
          onClick={!readOnly ? () => {
            dispatch(setSelectedLayer(layerId))
            toggleLayerCollapse(layerId, isLayerExpanded)
          } : undefined}
        >
          {!readOnly && (
            <ChevronDown className={`h-3 w-3 flex-shrink-0 transition-transform ${isLight ? 'text-slate-400' : 'text-zinc-500'} ${isLayerExpanded ? '' : '-rotate-90'}`} />
          )}
          <div className={`w-7 h-7 flex-shrink-0 rounded-lg overflow-hidden border ${isLight ? 'bg-slate-50 border-slate-100' : 'bg-black/20 border-white/5'}`}>
            {renderLayerPreview(layer)}
          </div>
          <span className={`text-[10px] font-semibold truncate leading-tight flex-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
            {getLayerDisplayName(layer)}
          </span>
          {!isLayerExpanded && hasAnimations && (
            <span className={`text-[9px] flex-shrink-0 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
              {layerActions.length} action{layerActions.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Expanded content */}
        {isLayerExpanded && (
          <>
            {/* Actions */}
            {layerActions.length > 0 && (
              <div className="mt-2 space-y-1">
                {layerActions.map((action) => renderActionRow(action, step.id, layerId, readOnly))}
              </div>
            )}

            {/* + Add Animation (active step only) */}
            {!readOnly && available.length > 0 && (
              <div className="mt-2 relative" ref={addAnimMenuLayerId === layerId ? menuRef : undefined}>
                <button
                  onClick={(e) => {
                    if (addAnimMenuLayerId === layerId) {
                      setAddAnimMenuLayerId(null)
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const spaceBelow = window.innerHeight - rect.bottom
                      setMenuDirection(spaceBelow < 200 ? 'up' : 'down')
                      setAddAnimMenuLayerId(layerId)
                    }
                  }}
                  className={`flex items-center gap-1.5 text-[10px] transition-colors px-1.5 py-1 rounded-md ${isLight
                      ? 'text-slate-400 hover:text-purple-600 hover:bg-purple-50'
                      : 'text-zinc-500 hover:text-purple-400 hover:bg-white/[0.03]'
                    }`}
                >
                  <Plus className="h-3 w-3" />
                  Add Animation
                </button>

                {/* Context Menu */}
                {addAnimMenuLayerId === layerId && (
                  <div className={`absolute left-0 ${menuDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} z-50 border rounded-lg shadow-xl py-1 min-w-[140px] ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700/60'
                    }`}>
                    {available.map((actionType) => {
                      const meta = getActionMeta(actionType)
                      if (!meta) return null
                      const Icon = meta.icon
                      return (
                        <button
                          key={actionType}
                          onClick={() => {
                            setAddAnimMenuLayerId(null)
                            onAddAnimation?.(layerId, actionType)
                          }}
                          className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-[11px] transition-colors ${isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-50' : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                            }`}
                        >
                          <Icon className={`h-3.5 w-3.5 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`} />
                          {meta.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ============================================================================
  // RENDER ACTIVE STEP (being edited)
  // ============================================================================

  const renderActiveStep = (step, stepIndex) => (
    <div
      key={step.id}
      className={`border rounded-xl p-3 transition-all duration-300 ${isLight
          ? 'border-purple-200 bg-white shadow-[0_4px_12px_rgba(124,74,240,0.08)]'
          : 'border-[#7c4af0]/40 bg-[#7c4af0]/5 shadow-[0_4px_20px_rgba(0,0,0,0.2)]'
        }`}
    >
      {/* Step Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple-500 text-white">
            {stepIndex + 1}
          </div>
          <span className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>
            Step {stepIndex + 1}
          </span>
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${isLight ? 'text-purple-600 bg-purple-50' : 'text-purple-300 bg-purple-500/15'}`}>
            Active
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onCancelMotion?.()}
            className={`px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all flex items-center gap-1.5 ${isLight ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
              }`}
            title="Cancel Step"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
          <button
            onClick={() => handleDeleteStep(step.id)}
            className={`p-1.5 rounded-md transition-all ${isLight ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10'
              }`}
            title="Delete step"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Helper hint */}
      <div className={`mt-3 px-2 py-2 rounded-lg border ${isLight ? 'bg-slate-50 border-slate-100' : 'bg-white/[0.03] border-white/[0.06]'}`}>
        <p className={`text-[10px] italic leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
          Edit anything on the canvas. Animations will appear here.
        </p>
      </div>

      {/* Layer Cards */}
      <div className="mt-3 space-y-2">
        {sceneLayers.length > 0 ? (
          sceneLayers.map((layer) => renderLayerCard(layer, step, false))
        ) : (
          <div className="text-center py-4">
            <p className="text-[10px] text-zinc-600 italic">No layers in this scene</p>
          </div>
        )}
      </div>

      {/* Bottom Save Step */}
      <div className={`mt-3 pt-3 border-t ${isLight ? 'border-slate-100' : 'border-white/[0.06]'}`}>
        <button
          onClick={() => onApplyMotion?.()}
          className={`w-full py-2 text-[11px] font-semibold transition-all duration-300 flex items-center justify-center gap-2 shadow-sm rounded-lg ${getStepSummary(step).actionCount > 0
              ? 'text-white bg-[#7c4af0] hover:bg-[#8b5cf6]'
              : (isLight
                ? 'text-slate-400 bg-slate-100 border border-slate-200 cursor-default'
                : 'text-zinc-500 bg-zinc-800/50 border border-white/5 cursor-default hover:bg-zinc-800/80')
            }`}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
          Save Step
        </button>
      </div>
    </div>
  )

  // ============================================================================
  // RENDER INACTIVE STEP (collapsed or expanded read-only)
  // ============================================================================

  const renderInactiveStep = (step, stepIndex) => {
    const { layerCount, actionCount } = getStepSummary(step)
    const isSelected = editingStepId === step.id
    const isExpanded = expandedSteps.has(step.id) || isSelected

    return (
      <div
        key={step.id}
        className={`border rounded-xl p-3 transition-all duration-300 ${isSelected
            ? (isLight ? 'border-purple-200 bg-white shadow-sm' : 'border-purple-500/40 bg-purple-500/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.1)]')
            : (isLight ? 'border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-200' : 'border-zinc-800/40 bg-zinc-800/5 hover:border-zinc-700/60')
          }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
            onClick={() => toggleStepExpand(step.id)}
          >
            <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${isLight ? 'text-slate-400' : 'text-zinc-500'} ${isExpanded ? '' : '-rotate-90'}`} />
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isSelected
                ? 'bg-purple-500 text-white'
                : (isLight ? 'bg-slate-200 text-slate-500' : 'bg-zinc-800 text-zinc-400')
              }`}>
              {stepIndex + 1}
            </div>
            <span className={`text-xs font-semibold ${isSelected ? (isLight ? 'text-slate-900' : 'text-white') : (isLight ? 'text-slate-600' : 'text-zinc-100')}`}>
              Step {stepIndex + 1}
            </span>
            {layerCount > 0 && (
              <span className={`text-[9px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                {layerCount} layer{layerCount > 1 ? 's' : ''}, {actionCount} action{actionCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleEditStep(step.id)}
              className={`p-2 rounded-lg transition-all ${isSelected
                  ? (isLight ? 'text-purple-600 bg-purple-50' : 'text-purple-400 bg-purple-500/10')
                  : (isLight ? 'text-slate-400 hover:text-purple-600 hover:bg-purple-50' : 'text-zinc-500 hover:text-purple-400 hover:bg-purple-500/10')
                }`}
              title="Update Step"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleDeleteStep(step.id)}
              className={`p-1.5 rounded-md transition-all ${isLight ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10'
                }`}
              title="Delete step"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Expanded read-only view */}
        {isExpanded && step.layerActions && Object.keys(step.layerActions).length > 0 && (
          <div className={`mt-3 space-y-2 border-t pt-3 ${isLight ? 'border-slate-100' : 'border-zinc-800/50'}`}>
            {Object.entries(step.layerActions).map(([layerId]) => {
              const layer = layers[layerId]
              if (!layer) return null
              return renderLayerCard(layer, step, true)
            })}
          </div>
        )}
      </div>
    )
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] bg-transparent transition-opacity duration-200 pointer-events-none"
          style={{ top: 0 }}
        />
      )}

      <div
        className={`fixed z-[61] flex flex-col shadow-2xl ${isResizing ? '' : 'transition-all duration-300'}
          ${typeof window !== 'undefined' && window.innerWidth < 1024
            ? 'bottom-0 left-0 right-0 rounded-t-2xl border-t mobile-sheet-in'
            : 'inset-y-0 right-0 border-l'}`}
        style={{
          top: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'auto' : `${topToolbarHeight}px`,
          height: typeof window !== 'undefined' && window.innerWidth < 1024 ? '42vh' : 'auto',
          minHeight: typeof window !== 'undefined' && window.innerWidth < 1024 ? '280px' : 'auto',
          maxHeight: typeof window !== 'undefined' && window.innerWidth < 1024 ? '45vh' : 'auto',
          width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100vw' : `${panelWidth}px`,
          backgroundColor: isLight ? '#f9fafb' : '#090a0d',
          backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(32px)',
          WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(32px)',
          borderColor: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.15)',
        }}
      >
        {/* Mobile Top Bar Header with swipe drag handle and click-to-close down arrow */}
        <div className="lg:hidden relative flex items-center justify-between px-4 py-3 flex-shrink-0 w-full border-b border-black/5 dark:border-white/5">
          {/* Spacing for symmetry */}
          <div className="w-8 h-8 flex-shrink-0" />

          {/* Centered Drag Handle */}
          <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
            <div className={`w-12 h-1.5 rounded-full ${isLight ? 'bg-black/15' : 'bg-white/30'}`} aria-hidden />
          </div>

          {/* Down Chevron button on the right */}
          <button
            onClick={onClose}
            className={`relative z-10 flex h-8 w-8 items-center justify-center transition-all duration-200 active:scale-90 ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-white/60 hover:text-white'}`}
            aria-label="Close panel"
          >
            <ChevronDown className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>

        {/* Header */}
        <div className="hidden lg:flex items-center justify-between px-5 py-4 flex-shrink-0">
          <h2 className={`text-sm font-semibold flex items-center gap-2.5 ${isLight ? 'text-gray-900' : 'text-zinc-200'}`}>
            <Zap className="h-4 w-4 text-[#7c4af0]" />
            Animation
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className={`p-1.5 rounded-md transition-all ${isLight ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}`}
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Left resize handle */}
        <div
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 transition-colors ${isLight ? 'hover:bg-purple-500/10' : 'hover:bg-zinc-700/50'}`}
          style={{
            borderLeft: isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '0.5px solid rgba(255, 255, 255, 0.15)',
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()

            const dragStartX = e.clientX
            const dragStartWidth = panelWidth

            const handleMouseMove = (moveEvent) => {
              const deltaX = moveEvent.clientX - dragStartX
              const newWidth = Math.min(600, Math.max(280, dragStartWidth - deltaX))
              setPanelWidth(newWidth)
              if (!isResizing) setIsResizing(true)
            }

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove)
              document.removeEventListener('mouseup', handleMouseUp)
              document.body.style.cursor = ''
              document.body.style.userSelect = ''
              setIsResizing(false)
            }

            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = 'ew-resize'
            document.body.style.userSelect = 'none'
          }}
          title="Drag to resize panel width"
        />

        {/* Step count summary */}
        <div className="hidden lg:block px-5 pb-3 flex-shrink-0">
          <div className={`text-[10px] font-bold tracking-widest uppercase ${isLight ? 'text-slate-400' : 'text-zinc-400'}`}>
            {motionFlow.length === 0 ? 'No animation steps' : `${motionFlow.length} Step${motionFlow.length > 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Steps List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {motionFlow.length === 0 && !isMotionCaptureActive ? (
            <div className="text-center py-12">
              <Play className={`h-12 w-12 mx-auto mb-4 opacity-50 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
              <p className={`text-sm mb-2 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>Start building animation</p>
              <p className={`text-xs mb-6 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>Add your first step to begin</p>
              <button
                onClick={() => onStartMotionCapture?.()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#7c4af0] hover:bg-[#8b5cf6] rounded-lg transition-all shadow-md shadow-purple-500/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Step
              </button>
            </div>
          ) : (
            <>
              {motionFlow.map((step, stepIndex) => {
                const isEditing = isMotionCaptureActive && editingStepId === step.id;
                return isEditing
                  ? renderActiveStep(step, stepIndex)
                  : renderInactiveStep(step, stepIndex);
              })}

              {/* + Add Step button — only when not currently editing */}
              {!isMotionCaptureActive && motionFlow.length > 0 && (
                <button
                  onClick={() => onStartMotionCapture?.()}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 text-[11px] font-semibold rounded-xl transition-all border border-dashed ${isLight
                      ? 'text-slate-400 hover:text-purple-600 border-slate-200 hover:border-purple-300 hover:bg-purple-50/50'
                      : 'text-zinc-400 hover:text-purple-400 border-zinc-800/60 hover:border-purple-500/30 hover:bg-white/[0.02]'
                    }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Step
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer — total duration */}
        {motionFlow.length > 0 && (
          <div className={`flex-shrink-0 p-4 border-t ${isLight ? 'border-slate-100 bg-white' : 'border-white/10 bg-black/20'}`}>
            <div className={`text-xs text-center ${isLight ? 'text-slate-500' : 'text-white/60'}`}>
              Total Animation Duration: <span className={`font-mono font-bold ${isLight ? 'text-[#7c4af0]' : 'text-white'}`}>{(motionFlowData.pageDuration / 1000).toFixed(1)}s</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default MotionPanel
