import { useState, useContext, useRef, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { selectCanUndo, selectCanRedo } from '../../../store/slices/historySlice'
import {
  ChevronDown, ChevronUp, Pencil, Trash2, Plus,
  Undo2, Redo2,
} from 'lucide-react'

function getLayerTypeLabel(layer) {
  if (!layer) return 'Element'
  switch (layer.type) {
    case 'image': return 'Image layer'
    case 'video': return 'Video layer'
    case 'shape': return 'Shape layer'
    case 'text': return 'Text layer'
    case 'group': return 'Group'
    case 'background': return 'Background'
    case 'frame': return layer.data?.isCardFrame ? 'Card Frame' : 'Frame'
    default: return 'Element'
  }
}

function MobileMotionBar({
  motionFlow = [],
  isMotionCaptureActive = false,
  editingStepId = null,
  editingMomentLabel = '',
  editingStepActionCount = 0,
  isDoneEnabled = false,
  onAddMoment,
  onEditMoment,
  onDeleteStep,
  onApplyMotion,
  onCancelMotion,
  onUndo,
  onRedo,
  sceneLayers = [],
  activeStepId = null,
  onSelectStepEnd = null,
}) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const canUndo = useSelector(selectCanUndo)
  const canRedo = useSelector(selectCanRedo)
  const { active: tutorialActive, step: tutorialStep } = useSelector(state => state.tutorial)

  const [expandedCardId, setExpandedCardId] = useState(null)

  // Auto-close moment card if it is no longer the active one
  useEffect(() => {
    if (expandedCardId && expandedCardId !== activeStepId) {
      setExpandedCardId(null)
    }
  }, [activeStepId, expandedCardId])
  const carouselRef = useRef(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const cardRefs = useRef({})

  useEffect(() => {
    if (activeStepId && cardRefs.current[activeStepId]) {
      cardRefs.current[activeStepId].scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [activeStepId])

  // [ONBOARDING] Auto-scroll to the Add Moment button when Step 1 activates
  const isTutorialStep1 = tutorialActive && tutorialStep === 1;
  const isTutorialStep3 = tutorialActive && tutorialStep === 3;
  const isTutorialStep4 = tutorialActive && tutorialStep === 4;
  const hasSteps = motionFlow.length > 0;
  useEffect(() => {
    if (!isTutorialStep1 || !hasSteps || !carouselRef.current) return
    const addMomentEl = carouselRef.current.querySelector('[data-tutorial="add-moment-button"]')
    if (addMomentEl) {
      addMomentEl.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
    }
  }, [isTutorialStep1, hasSteps])

  // ── capture mode bar ────────────────────────────────────────────────────────
  if (isMotionCaptureActive) {
    return (
      <div className="lg:hidden relative shrink-0 z-30 w-full">
        <div
          className={`flex items-stretch w-full ${isLight ? 'bg-white border-b border-slate-200 shadow-sm' : 'bg-[#0f1015] border-b border-white/10 shadow-lg'
            }`}
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            minHeight: 48,
          }}
        >
          {/* Left: undo/redo + label — grows to fill available space */}
          <div className="flex items-center flex-1 gap-2 px-3 min-w-0">
            <div className={`flex items-center gap-0.5 shrink-0 pr-2 border-r ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${canUndo
                  ? (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                  : (isLight ? 'text-slate-300' : 'text-zinc-700')
                  }`}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${canRedo
                  ? (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                  : (isLight ? 'text-slate-300' : 'text-zinc-700')
                  }`}
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </div>
            <span className={`flex-1 text-xs font-semibold truncate ${isLight ? 'text-slate-700' : 'text-zinc-200'
              }`}
            >
              {editingMomentLabel || 'New Moment'}
            </span>
          </div>

          {/* Right: cancel + save */}
          <button
            onClick={onCancelMotion}
            className={`flex items-center justify-center px-4 font-semibold text-xs border-l ${isLight ? 'text-slate-500 border-slate-200 active:bg-slate-100' : 'text-zinc-400 border-white/10 active:bg-white/10'
              }`}
          >
            Cancel
          </button>
          <button
            onClick={() => { if (isDoneEnabled) onApplyMotion?.() }}
            className={`flex items-center justify-center px-5 font-semibold text-xs border-l transition-all duration-300 ${isDoneEnabled
              ? (isTutorialStep3
                ? 'bg-[#7C4AF0] text-white border-[#7C4AF0] animate-onboarding-pulse'
                : 'bg-[#7c4af0] text-white border-[#7c4af0] shadow-[0_0_15px_rgba(124,74,240,0.4)]')
              : (isLight ? 'text-slate-400 border-slate-200' : 'text-zinc-600 border-white/10')
              }`}
          >
            Save moment
          </button>
        </div>
      </div>
    )
  }

  // ── normal mode carousel ────────────────────────────────────────────────────
  const expandedStep = motionFlow.find(s => s.id === expandedCardId)
  const expandedAllLayerIds = expandedStep
    ? new Set([
      ...Object.keys(expandedStep.layerActions || {}),
      ...Object.keys(expandedStep.layerPresets || {}),
    ])
    : new Set()
  return (
    <div className="lg:hidden shrink-0 z-30 relative">
      {/* Flat bar */}
      <div
        className={`overflow-hidden ${isLight ? 'bg-white border-y border-slate-200' : 'bg-[#0f1015] border-y border-white/10'
          }`}
        style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
      >
        <div className="flex flex-col relative">
          <div
            ref={carouselRef}
            className="flex items-stretch overflow-x-auto gap-2 px-3 py-1"
            data-tutorial="mobile-moments-carousel"
            style={{
              scrollSnapType: 'x mandatory',
              scrollBehavior: 'smooth',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {/* Design Card */}
            <div
              style={{
                scrollSnapAlign: 'start',
                minWidth: 120,
                minHeight: 30,
                pointerEvents: isTutorialStep1 ? 'none' : 'auto',
              }}
              onClick={() => onSelectStepEnd?.('base')}
              className={`shrink-0 transition-all duration-150 flex flex-col justify-center rounded-lg border-2 cursor-pointer ${activeStepId === 'base'
                ? isLight
                  ? 'border-transparent bg-[#b0b5be] shadow-sm'
                  : 'border-transparent bg-[#3a3b48] shadow-sm'
                : isLight
                  ? 'border-transparent bg-[#eaecef] hover:bg-[#b0b5be]'
                  : 'border-transparent bg-[#1c1d26] hover:bg-[#3a3b48]'
                }`}
            >
              <div className="flex items-center gap-1.5 px-2.5 py-1">
                <p className={`text-[11px] font-semibold leading-none truncate whitespace-nowrap ${isLight ? 'text-[#111827]' : 'text-[#F2F2F2]'
                  }`}>
                  Design
                </p>
              </div>
            </div>

            {motionFlow.map((step, stepIndex) => {
              const allLayerIds = new Set([
                ...Object.keys(step.layerActions || {}),
                ...Object.keys(step.layerPresets || {}),
              ])
              const layerCount = allLayerIds.size
              const isActive = activeStepId === step.id
              const isExpanded = expandedCardId === step.id
              const isConfirming = confirmDeleteId === step.id

              return (
                <div
                  key={step.id}
                  ref={el => { if (el) cardRefs.current[step.id] = el }}
                  style={{
                    scrollSnapAlign: 'start',
                    minWidth: 160,
                    minHeight: 30,
                    pointerEvents: isTutorialStep1 ? 'none' : 'auto',
                  }}
                  onClick={(e) => {
                    const isActionButton = e.target.closest('button');
                    if (isActionButton) return;

                    onSelectStepEnd?.(step.id);
                  }}
                  className={`group shrink-0 transition-all duration-150 flex flex-col rounded-lg border-2 cursor-pointer ${isActive
                    ? isLight
                      ? 'border-transparent bg-[#cab3f8] shadow-sm'
                      : 'border-transparent bg-[#4c3b70] shadow-sm'
                    : isLight
                      ? 'border-transparent bg-white text-slate-800 hover:bg-[#cab3f8]'
                      : 'border-transparent bg-[#121319] text-zinc-400 hover:bg-[#3b3847]'
                    }`}
                >
                  {isConfirming ? (
                    // Delete confirmation — fixed height matches normal card height, no resize
                    <div className="flex overflow-hidden rounded-md" style={{ height: 26 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                        className={`flex-1 flex items-center justify-center transition-colors ${isLight ? 'bg-slate-100 text-slate-700 active:bg-slate-200' : 'bg-white/[0.06] text-zinc-300 active:bg-white/[0.1]'
                          }`}
                      >
                        <span className="text-[11px] font-bold">No</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteStep?.(step.id); setConfirmDeleteId(null); setExpandedCardId(null) }}
                        className="flex-1 flex items-center justify-center bg-red-500 active:bg-red-600 text-white text-[11px] font-bold transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Card header */}
                      <div className="flex items-center gap-1.5 px-2.5 py-0.5">
                        {/* Title only */}
                        <div className="min-w-0 flex-1">
                          <p className={`text-[11px] font-semibold leading-none truncate whitespace-nowrap ${isActive
                            ? isLight ? 'text-[#2d1b4e]' : 'text-purple-100'
                            : isLight ? 'text-slate-800 group-hover:text-[#2d1b4e]' : 'text-zinc-400 group-hover:text-purple-100'
                            }`}>
                            Moment {stepIndex + 1}
                          </p>
                        </div>

                        {/* Edit + Delete */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditMoment?.(step.id) }}
                            className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors ${isActive
                              ? isLight ? 'text-[#3b1e70]/85 hover:text-[#2d1b4e] hover:bg-[#cab3f8]/30' : 'text-purple-200/80 hover:text-white hover:bg-white/10'
                              : isLight ? 'text-slate-400 hover:text-[#7c4af0] group-hover:text-[#3b1e70]/85 hover:bg-[#cab3f8]/10' : 'text-zinc-500 hover:text-[#c084fc] group-hover:text-purple-200/80 hover:bg-white/10'
                              }`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(step.id) }}
                            className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors ${isActive
                              ? isLight ? 'text-[#3b1e70]/85 hover:text-red-600 hover:bg-[#cab3f8]/30' : 'text-purple-200/80 hover:text-red-400 hover:bg-white/10'
                              : isLight ? 'text-slate-400 hover:text-red-500 group-hover:text-[#3b1e70]/85 hover:bg-red-50' : 'text-zinc-500 hover:text-red-400 group-hover:text-purple-200/80 hover:bg-[#cab3f8]/10'
                              }`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Expand toggle */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isActiveStep = activeStepId === step.id;
                            if (isActiveStep) {
                              setExpandedCardId(isExpanded ? null : step.id);
                            } else {
                              onSelectStepEnd?.(step.id);
                              setExpandedCardId(step.id);
                            }
                          }}
                          className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors shrink-0 ${isExpanded
                            ? isActive
                              ? isLight ? 'text-[#2d1b4e] bg-[#cab3f8]/30' : 'text-purple-200 bg-white/10'
                              : (isLight ? 'text-[#7c4af0] bg-[#7c4af0]/10' : 'text-[#c084fc] bg-white/10')
                            : isActive
                              ? isLight ? 'text-[#3b1e70]/85 hover:bg-[#cab3f8]/30' : 'text-purple-200/60 hover:bg-white/10'
                              : (isLight ? 'text-slate-400 hover:bg-black/5 group-hover:text-[#3b1e70]/85' : 'text-zinc-500 hover:bg-white/10 group-hover:text-purple-200/80')
                            }`}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* Add Moment card */}
            <div
              data-tutorial="add-moment-button"
              onClick={onAddMoment}
              style={{ scrollSnapAlign: 'start', minWidth: 120 }}
              className={`shrink-0 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg border-2 border-solid transition-all ${isTutorialStep1 || isTutorialStep4 ? 'animate-onboarding-pulse border-[#7c4af0] bg-[#7c4af0]/5 dark:bg-[#7c4af0]/10 relative z-20 pointer-events-auto' : ''} ${isLight
                ? 'border-[#7c4af0]/30 text-[#7c4af0] hover:border-[#7c4af0] hover:bg-[#7c4af0]/5'
                : 'border-[#7050c0]/35 text-[#8e7ebd] hover:border-[#7050c0] hover:bg-[#7050c0]/5'
                }`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-semibold whitespace-nowrap">Add Moment</span>
            </div>
          </div>

          {/* Expanded detail panel */}
          {expandedCardId && expandedStep && (() => {
            const isExpandedCardActive = activeStepId === expandedCardId;
            return (
              <div className={`border-t px-3 py-2.5 transition-all duration-150 ${isExpandedCardActive
                ? isLight ? 'border-purple-900/10 bg-[#cab3f8] text-[#2d1b4e]' : 'border-purple-200/10 bg-[#4c3b70] text-purple-100'
                : isLight ? 'border-slate-200 bg-white text-slate-800' : 'border-white/[0.06] bg-[#121319] text-zinc-400'
                }`}>
                {expandedAllLayerIds.size === 0 ? (
                  <p className={`text-[10px] italic text-center py-1 ${isExpandedCardActive
                    ? isLight ? 'text-[#3b1e70]/80' : 'text-purple-300'
                    : isLight ? 'text-slate-400' : 'text-zinc-650'
                    }`}>
                    No effects in this moment
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {[...expandedAllLayerIds].map(layerId => {
                      const layer = sceneLayers.find(l => l.id === layerId)
                      const actions = expandedStep.layerActions?.[layerId] || []
                      const preset = expandedStep.layerPresets?.[layerId]
                      const actionTags = [
                        ...(preset ? [preset.type === 'IN' ? 'Entrance' : 'Exit'] : []),
                        ...actions.map(a => a.type),
                      ]
                      return (
                        <div
                          key={layerId}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${isExpandedCardActive
                            ? isLight ? 'bg-[#2d1b4e]/10 border border-[#2d1b4e]/10' : 'bg-white/10 border border-white/5'
                            : isLight ? 'bg-slate-100 border border-slate-200' : 'bg-white/[0.04] border border-white/[0.06]'
                            }`}
                        >
                          <span className={`text-[10px] font-semibold ${isExpandedCardActive
                            ? isLight ? 'text-[#2d1b4e]' : 'text-purple-100'
                            : isLight ? 'text-slate-700' : 'text-zinc-300'
                            }`}>
                             {getLayerTypeLabel(layer)}
                          </span>
                          {actionTags.slice(0, 3).map((tag, i) => (
                            <span
                              key={i}
                              className={`text-[8px] font-bold px-1 py-px rounded ${isExpandedCardActive
                                ? isLight ? 'bg-[#2d1b4e]/15 text-[#2d1b4e]/90' : 'bg-zinc-800 text-zinc-350'
                                : isLight ? 'bg-slate-100 text-slate-500' : 'bg-zinc-800 text-zinc-400'
                                }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  )
}

export default MobileMotionBar