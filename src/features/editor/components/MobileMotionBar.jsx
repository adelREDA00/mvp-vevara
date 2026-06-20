import { useState, useContext, useRef, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { ThemeContext } from '../../../app/context/ThemeContext'
import { selectCanUndo, selectCanRedo } from '../../../store/slices/historySlice'
import {
  ChevronDown, ChevronUp, Pencil, Trash2, Plus,
  Undo2, Redo2,
} from 'lucide-react'

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
}) {
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const canUndo = useSelector(selectCanUndo)
  const canRedo = useSelector(selectCanRedo)
  const { active: tutorialActive, step: tutorialStep } = useSelector(state => state.tutorial)

  const [expandedCardId, setExpandedCardId] = useState(null)
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
        className={`flex items-stretch w-full ${
          isLight ? 'bg-white border-b border-slate-200 shadow-sm' : 'bg-[#0f1015] border-b border-white/10 shadow-lg'
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
              className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${
                canUndo
                  ? (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                  : (isLight ? 'text-slate-300' : 'text-zinc-700')
              }`}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${
                canRedo
                  ? (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                  : (isLight ? 'text-slate-300' : 'text-zinc-700')
              }`}
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
          <span className={`flex-1 text-xs font-semibold truncate ${
            isLight ? 'text-slate-700' : 'text-zinc-200'
          }`}>
            {editingMomentLabel || ''}
          </span>
        </div>

        {/* Cancel — secondary, immediately left of Done */}
        <button
          onClick={onCancelMotion}
          className={`flex items-center justify-center px-5 shrink-0 transition-colors text-xs font-semibold border-l ${
            isLight
              ? 'text-slate-600 active:bg-slate-100 border-slate-200'
              : 'text-zinc-300 active:bg-white/[0.08] border-white/10'
          }`}
        >
          Cancel
        </button>

        {/* Done — primary, far right */}
        <button
          data-tutorial="add-step-button"
          onClick={isDoneEnabled ? onApplyMotion : undefined}
          className={`flex items-center justify-center px-5 shrink-0 transition-all border-l text-xs font-semibold ${
            isDoneEnabled
              ? 'bg-[#7c4af0] text-white border-[#7c4af0] shadow-[0_0_16px_rgba(124,74,240,0.4)]'
              : (isLight
                ? 'text-slate-400 cursor-default border-slate-200'
                : 'text-zinc-600 cursor-default border-white/10')
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
        className={`overflow-hidden ${
          isLight ? 'bg-white border-y border-slate-200' : 'bg-[#0f1015] border-y border-white/10'
        }`}
        style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
      >
      {!hasSteps ? (
        /* Empty state — centered create card */
        <div className="flex items-center justify-center py-1 px-4 w-full">
          <div
            data-tutorial="add-moment-button"
            onClick={onAddMoment}
            className={`rounded-lg cursor-pointer border-2 border-dashed transition-all duration-200 overflow-hidden flex items-center justify-center gap-1.5 px-3 shadow-sm active:scale-[0.99] ${
              isLight
                ? 'border-[#7c4af0]/20 hover:border-[#7c4af0]/50 text-[#7c4af0] bg-[#7c4af0]/[0.02]'
                : 'border-[#a78bfa]/20 hover:border-[#a78bfa]/40 text-[#a78bfa] hover:text-[#c084fc] bg-white/[0.02]'
            }`}
            style={{
              width: 170,
              height: 30,
            }}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <span className="font-semibold tracking-wide text-[10px] whitespace-nowrap">
              Create your first moment
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col relative">
          {/* Horizontal carousel — during Step 1, moment cards are visually dimmed
              but the carousel itself remains scrollable so users can reach the Add Moment button. */}
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
                    opacity: isTutorialStep1 ? 0.4 : 1,
                    pointerEvents: isTutorialStep1 ? 'none' : 'auto',
                  }}
                  className={`shrink-0 transition-all duration-150 flex flex-col rounded-lg border-2 ${
                    isActive
                      ? (isLight ? 'border-[#b89eff]' : 'border-[#5a4b81]')
                      : (isLight ? 'border-slate-200' : 'border-white/10')
                  } ${
                    isLight ? 'bg-white hover:bg-slate-50' : 'bg-[#151620] hover:bg-white/[0.02]'
                  }`}
                >
                  {isConfirming ? (
                    // Delete confirmation — fixed height matches normal card height, no resize
                    <div className="flex overflow-hidden rounded-md" style={{ height: 26 }}>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className={`flex-1 flex items-center justify-center transition-colors ${
                          isLight ? 'bg-slate-100 text-slate-700 active:bg-slate-200' : 'bg-white/[0.06] text-zinc-300 active:bg-white/[0.1]'
                        }`}
                      >
                        <span className="text-[11px] font-bold">No</span>
                      </button>
                      <button
                        onClick={() => { onDeleteStep?.(step.id); setConfirmDeleteId(null); setExpandedCardId(null) }}
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
                          <p className={`text-[11px] font-semibold leading-none truncate whitespace-nowrap ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                            Moment {stepIndex + 1}
                          </p>
                        </div>

                        {/* Edit + Delete */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditMoment?.(step.id) }}
                            className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors ${
                              isLight ? 'text-slate-400 hover:text-[#7c4af0] hover:bg-slate-100 active:bg-slate-100' : 'text-zinc-500 hover:text-[#c084fc] hover:bg-white/10 active:bg-white/10'
                            }`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(step.id) }}
                            className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors ${
                              isLight ? 'text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-50' : 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10 active:bg-red-500/10'
                            }`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Expand toggle */}
                        <button
                          onClick={() => setExpandedCardId(isExpanded ? null : step.id)}
                          className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                            isExpanded
                              ? (isLight ? 'text-[#7c4af0] bg-[#7c4af0]/10' : 'text-[#c084fc] bg-white/10')
                              : (isLight ? 'text-slate-400 hover:bg-slate-100 active:bg-slate-100' : 'text-zinc-500 hover:bg-white/10 active:bg-white/10')
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

            {/* Add Moment card — [ONBOARDING] Elevated above dim overlay during Step 1 */}
            <div
              data-tutorial="add-moment-button"
              onClick={onAddMoment}
              style={{ scrollSnapAlign: 'start', minWidth: 120 }}
              className={`shrink-0 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg border-2 border-dashed transition-colors ${isTutorialStep1 ? 'relative z-20 pointer-events-auto' : ''} ${
                isLight
                  ? 'border-[#7c4af0]/20 text-[#7c4af0]/60 hover:border-[#7c4af0]/50 hover:bg-slate-50'
                  : 'border-[#7c4af0]/15 text-[#7c4af0]/50 hover:border-[#c084fc]/40 hover:bg-white/[0.02]'
              }`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-semibold whitespace-nowrap">Add Moment</span>
            </div>
          </div>

          {/* Expanded detail panel */}
          {expandedCardId && expandedStep && (
            <div className={`border-t px-3 py-2.5 ${
              isLight ? 'border-slate-200 bg-slate-50' : 'border-white/[0.06] bg-black/20'
            }`}>
              {expandedAllLayerIds.size === 0 ? (
                <p className={`text-[10px] italic text-center py-1 ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
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
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${
                          isLight ? 'bg-white border border-slate-200' : 'bg-white/[0.04] border border-white/[0.06]'
                        }`}
                      >
                        <span className={`text-[10px] font-semibold ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                          {layer?.name || 'Element'}
                        </span>
                        {actionTags.slice(0, 3).map((tag, i) => (
                          <span
                            key={i}
                            className={`text-[8px] font-bold px-1 py-px rounded ${
                              isLight ? 'bg-slate-100 text-slate-500' : 'bg-zinc-800 text-zinc-400'
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
          )}
        </div>
      )}
      </div>
    </div>
  )
}

export default MobileMotionBar