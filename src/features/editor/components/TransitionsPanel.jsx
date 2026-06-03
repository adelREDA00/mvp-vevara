import React, { useContext, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { X, Zap, Sparkles, Layers, Slash, Circle, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight } from 'lucide-react'
import { ThemeContext } from '../../../app/context/ThemeContext'
import {
  selectScenes,
  updateScene,
  selectProjectTimelineInfo,
  selectTotalProjectDuration
} from '../../../store/slices/projectSlice'

import TransitionColorPickerModal from './TransitionColorPickerModal'

function TransitionsPanel({ onClose, activeTransitionSceneId, motionControls }) {
  const [activeColorPickerIdx, setActiveColorPickerIdx] = React.useState(null)
  const [anchorEl, setAnchorEl] = React.useState(null)
  const { theme } = useContext(ThemeContext)
  const isLight = theme === 'light'
  const dispatch = useDispatch()

  const scenes = useSelector(selectScenes)
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const totalProjectDuration = useSelector(selectTotalProjectDuration)

  // Find the target scene and its previous scene
  const { targetScene, prevScene, currentTransition } = useMemo(() => {
    if (!activeTransitionSceneId || !scenes) return { targetScene: null, prevScene: null, currentTransition: 'None' }

    const targetIdx = scenes.findIndex(s => s.id === activeTransitionSceneId)
    const target = scenes[targetIdx] || null
    const prev = targetIdx > 0 ? scenes[targetIdx - 1] : null
    const transition = target?.transition || 'None'

    return { targetScene: target, prevScene: prev, currentTransition: transition }
  }, [scenes, activeTransitionSceneId])

  const TRANSITION_OPTIONS = [
    {
      id: 'None',
      name: 'None (Direct Cut)',
      description: 'An instantaneous change from the previous scene to the next scene.',
      icon: Slash,
      color: 'from-gray-500/20 to-zinc-500/10'
    },
    {
      id: 'Fade',
      name: 'Fade (Cross Dissolve)',
      description: 'A smooth fade out of the old scene and fade in of the new scene.',
      icon: Layers,
      color: 'from-blue-500/20 to-indigo-500/10'
    },
    {
      id: 'LiquidShapes',
      name: 'Liquid Shapes',
      description: 'A premium, organic wave of liquid shapes sweeping across the canvas.',
      icon: Sparkles,
      color: 'from-[#7c4af0]/25 to-pink-500/10'
    },
    {
      id: 'BubbleWipe',
      name: 'Bubble Wipe',
      description: 'A gorgeous cascading sequence of growing bubbles sweeping from bottom-left to top-left.',
      icon: Circle,
      color: 'from-pink-500/20 to-[#7c4af0]/15'
    }
  ]

  // Handler to select and apply transition
  const handleSelectTransition = (transitionId) => {
    if (!activeTransitionSceneId) return

    // 1. Dispatch update to Redux state.
    // [BUG 2 FIX] Clear any custom colors/direction left over from the previous
    // transition type. Each transition type expects a different palette length
    // (Fade=1, LiquidShapes/BubbleWipe=4); carrying a stale 1-color array into a
    // 4-color transition previously caused "Unable to convert color undefined".
    // Resetting lets MotionEngine fall back to each type's own default palette.
    dispatch(updateScene({
      id: activeTransitionSceneId,
      transition: transitionId,
      transitionColors: undefined,
      transitionDirection: undefined,
    }))

    // 2. Performance-optimized instant preview sequence
    // Using setTimeout to guarantee Redux state has propagated and PIXI has rebuilt
    setTimeout(() => {
      if (!motionControls || !timelineInfo) return

      // Find boundary time (startTime of the target scene)
      const sceneTimeline = timelineInfo.find(s => s.id === activeTransitionSceneId)
      if (!sceneTimeline) return

      const T = sceneTimeline.startTime

      // Stop any ongoing play first
      try {
        motionControls.pauseAll()
      } catch (err) {
        console.warn('Preview error pausing playback:', err)
      }

      // Calculate safe preview range (0.75s before to 0.85s after)
      const startPreviewTime = Math.max(0, T - 0.75)
      const endPreviewTime = Math.min(totalProjectDuration || T + 0.85, T + 0.85)

      // Seek to beginning of preview
      try {
        motionControls.seek(startPreviewTime)
      } catch (err) {
        console.warn('Preview error seeking playhead:', err)
      }

      // Play through the boundary with hardware-accelerated tweenTo
      setTimeout(() => {
        try {
          motionControls.tweenTo(endPreviewTime, {
            duration: (endPreviewTime - startPreviewTime) * 1.1, // Slight ease buffer
            ease: 'none'
          })
        } catch (err) {
          console.warn('Preview error initiating transition animation:', err)
        }
      }, 80)
    }, 50)
  }

  // Handler to customize transition colors in real-time
  const handleColorChange = (index, newColor) => {
    if (!activeTransitionSceneId || !targetScene) return

    const defaultPalette = targetScene.transition === 'Fade'
      ? ['#000000']
      : targetScene.transition === 'BubbleWipe'
        ? ['#ec4899', '#f43f5e', '#d946ef', '#8b5cf6']
        : ['#5b21b6', '#7c3aed', '#8b5cf6', '#a78bfa']

    const currentColors = [...(targetScene.transitionColors || defaultPalette)]
    currentColors[index] = newColor

    // Update Redux state with the new color array
    dispatch(updateScene({ id: activeTransitionSceneId, transitionColors: currentColors }))

    // Performance-optimized immediate preview sequence
    setTimeout(() => {
      if (!motionControls || !timelineInfo) return

      const sceneTimeline = timelineInfo.find(s => s.id === activeTransitionSceneId)
      if (!sceneTimeline) return

      const T = sceneTimeline.startTime

      try {
        motionControls.pauseAll()
      } catch (err) { }

      const startPreviewTime = Math.max(0, T - 0.75)
      const endPreviewTime = Math.min(totalProjectDuration || T + 0.85, T + 0.85)

      try {
        motionControls.seek(startPreviewTime)
      } catch (err) { }

      setTimeout(() => {
        try {
          motionControls.tweenTo(endPreviewTime, {
            duration: (endPreviewTime - startPreviewTime) * 1.1,
            ease: 'none'
          })
        } catch (err) { }
      }, 80)
    }, 50)
  }

  // Handler to customize transition direction
  const handleDirectionChange = (directionId) => {
    if (!activeTransitionSceneId) return

    dispatch(updateScene({ id: activeTransitionSceneId, transitionDirection: directionId }))

    // Trigger instant canvas reload and preview
    setTimeout(() => {
      if (!motionControls || !timelineInfo) return

      const sceneTimeline = timelineInfo.find(s => s.id === activeTransitionSceneId)
      if (!sceneTimeline) return

      const T = sceneTimeline.startTime

      try {
        motionControls.pauseAll()
      } catch (err) { }

      const startPreviewTime = Math.max(0, T - 0.75)
      const endPreviewTime = Math.min(totalProjectDuration || T + 0.85, T + 0.85)

      try {
        motionControls.seek(startPreviewTime)
      } catch (err) { }

      setTimeout(() => {
        try {
          motionControls.tweenTo(endPreviewTime, {
            duration: (endPreviewTime - startPreviewTime) * 1.1,
            ease: 'none'
          })
        } catch (err) { }
      }, 80)
    }, 50)
  }


  // Group options into rows of 3
  const rows = useMemo(() => {
    const result = []
    for (let i = 0; i < TRANSITION_OPTIONS.length; i += 3) {
      result.push(TRANSITION_OPTIONS.slice(i, i + 3))
    }
    return result
  }, [TRANSITION_OPTIONS])


  if (!activeTransitionSceneId || !targetScene) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center p-6 text-center"
        style={{
          width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
          backgroundColor: isLight ? '#f3f4f7' : '#090a0d',
          color: isLight ? '#64748b' : '#94a3b8'
        }}
      >
        <Zap className="h-8 w-8 mb-3 opacity-30 animate-pulse text-[#7c4af0]" />
        <p className="text-sm font-medium">Select a scene boundary to edit transitions</p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full relative transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '320px',
        backgroundColor: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'transparent' : (isLight ? '#f3f4f7' : '#090a0d'),
        backdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : 'blur(20px)',
        borderRight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 'none' : `1px solid ${isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}
    >

      {/* Header - Hidden on Mobile to match other panels */}
      <div className={`hidden lg:block px-4 pt-4 pb-3.5 border-b ${isLight ? 'border-black/5' : 'border-zinc-800/50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className={`text-base font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>Transitions</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className={`transition-all duration-200 p-1.5 rounded-lg active:scale-95 ${isLight ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-900' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              aria-label="Close transitions panel"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Options Grid & Nested Settings */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 select-none">
        {rows.map((row, rowIndex) => {
          // Check if the currently active transition is in this row
          const activeOptionInRow = row.find(opt => opt.id === currentTransition)
          const hasConfig = activeOptionInRow && activeOptionInRow.id !== 'None'

          return (
            <div key={rowIndex} className="space-y-4">
              {/* Row Grid */}
              <div className="grid grid-cols-3 gap-3.5">
                {row.map((option) => {
                  const isActive = currentTransition === option.id

                  return (
                    <button
                      key={option.id}
                      onClick={() => handleSelectTransition(option.id)}
                      className="flex flex-col items-center gap-1.5 group focus:outline-none"
                    >
                      {/* Square card with illustration */}
                      <div
                        className={`w-full aspect-square rounded-[12px] border flex items-center justify-center transition-all duration-300 relative overflow-hidden ${isActive
                          ? 'border-[#7c4af0] bg-[#7c4af0]/5 shadow-[0_0_12px_rgba(124,74,240,0.15)]'
                          : isLight
                            ? 'bg-white border-transparent hover:border-purple-300 hover:bg-purple-50/10'
                            : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/10'
                          }`}
                      >
                        {option.id === 'None' && (
                          <div className="w-8 h-[2px] bg-[#7c4af0] transform -rotate-45" />
                        )}
                        {option.id === 'Fade' && (
                          <div className="flex gap-1.5 items-center">
                            <div className="w-1.5 h-6 rounded-sm bg-[#7c4af0] opacity-30" />
                            <div className="w-1.5 h-6 rounded-sm bg-[#7c4af0] opacity-50" />
                            <div className="w-1.5 h-6 rounded-sm bg-[#7c4af0] opacity-75" />
                            <div className="w-1.5 h-6 rounded-sm bg-[#7c4af0]" />
                          </div>
                        )}
                        {option.id === 'LiquidShapes' && (
                          <div className="flex gap-1.5 items-end">
                            <div className="w-1.5 h-3.5 rounded-sm bg-[#7c4af0] opacity-40" />
                            <div className="w-1.5 h-5 rounded-sm bg-[#7c4af0] opacity-70" />
                            <div className="w-1.5 h-7 rounded-sm bg-[#7c4af0]" />
                            <div className="w-1.5 h-4.5 rounded-sm bg-[#7c4af0] opacity-80" />
                          </div>
                        )}
                        {option.id === 'BubbleWipe' && (
                          <div className="relative w-8 h-8 flex items-center justify-center">
                            <div className="absolute w-2 h-2 rounded-full bg-[#7c4af0] opacity-40 -translate-x-2 translate-y-2 scale-75" />
                            <div className="absolute w-3.5 h-3.5 rounded-full bg-[#7c4af0] opacity-70 translate-x-1.5 translate-y-1.5" />
                            <div className="absolute w-5 h-5 rounded-full bg-[#7c4af0] -translate-x-1 -translate-y-1" />
                            <div className="absolute w-2.5 h-2.5 rounded-full bg-[#7c4af0] opacity-80 translate-x-2 -translate-y-2 scale-90" />
                          </div>
                        )}
                      </div>

                      {/* Transition Name below the card */}
                      <span
                        className={`text-[10px] font-bold transition-colors text-center truncate w-full ${isActive
                          ? isLight ? 'text-slate-900' : 'text-white'
                          : isLight ? 'text-slate-500' : 'text-zinc-400 group-hover:text-white'
                          }`}
                      >
                        {option.id === 'None' ? 'None' : option.id === 'Fade' ? 'Dissolve' : option.id === 'LiquidShapes' ? 'Colour Wipe' : 'Bubble Wipe'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Settings Rendered Inline Under This Specific Row */}
              {hasConfig && (
                <div className={`p-3.5 rounded-xl flex flex-col gap-4 animate-fadeIn ${isLight
                  ? 'bg-black/[0.03]'
                  : 'bg-black/[0.25]'
                  }`}>
                  {/* Colors */}
                  <div className="py-2 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-zinc-500'
                        }`}>
                        {currentTransition === 'Fade' ? 'Custom Fade Color' : 'Custom Curtain Colors'}
                      </span>
                      <span className={`text-[9px] font-semibold opacity-40 ${isLight ? 'text-slate-500' : 'text-slate-400'
                        }`}>
                        Click to customize
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {(() => {
                        const isFade = currentTransition === 'Fade'
                        const defaultColors = isFade
                          ? ['#000000']
                          : currentTransition === 'BubbleWipe'
                            ? ['#ec4899', '#f43f5e', '#d946ef', '#8b5cf6']
                            : ['#5b21b6', '#7c3aed', '#8b5cf6', '#a78bfa']
                        const currentColors = targetScene.transitionColors || defaultColors

                        if (isFade) {
                          const color = currentColors[0] || '#000000'
                          return (
                            <button
                              onClick={(e) => {
                                setActiveColorPickerIdx(0)
                                setAnchorEl(e.currentTarget)
                              }}
                              className={`w-7 h-7 rounded-full border shadow-sm transition-all duration-200 hover:scale-110 active:scale-90 ${activeColorPickerIdx === 0 ? 'ring-2 ring-[#7c4af0] border-white scale-105' : 'border-white/20'
                                }`}
                              style={{
                                backgroundColor: color,
                              }}
                              title="Fade Color"
                            />
                          )
                        } else {
                          return currentColors.map((color, colorIdx) => (
                            <button
                              key={colorIdx}
                              onClick={(e) => {
                                setActiveColorPickerIdx(colorIdx)
                                setAnchorEl(e.currentTarget)
                              }}
                              className={`w-7 h-7 rounded-full border shadow-sm transition-all duration-200 hover:scale-110 active:scale-90 ${activeColorPickerIdx === colorIdx ? 'ring-2 ring-[#7c4af0] border-white scale-105' : 'border-white/20'
                                }`}
                              style={{
                                backgroundColor: color,
                              }}
                              title={`Curtain ${colorIdx + 1} Color`}
                            />
                          ))
                        }
                      })()}
                    </div>
                  </div>

                  {/* Directions */}
                  {(currentTransition === 'LiquidShapes' || currentTransition === 'BubbleWipe') && (
                    <div className="py-2.5 flex flex-col gap-2 border-t border-black/5 dark:border-white/5 pt-3.5">
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-zinc-500'
                          }`}>
                          Wipe Direction
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const isBubble = currentTransition === 'BubbleWipe'
                          const directions = isBubble
                            ? [
                              { id: 'bottom-left', icon: ArrowDownLeft, title: 'Bottom Left' },
                              { id: 'bottom-right', icon: ArrowDownRight, title: 'Bottom Right' },
                              { id: 'top-left', icon: ArrowUpLeft, title: 'Top Left' },
                              { id: 'top-right', icon: ArrowUpRight, title: 'Top Right' }
                            ]
                            : [
                              { id: 'left', icon: ArrowLeft, title: 'Left to Right' },
                              { id: 'right', icon: ArrowRight, title: 'Right to Left' },
                              { id: 'top', icon: ArrowUp, title: 'Top to Bottom' },
                              { id: 'bottom', icon: ArrowDown, title: 'Bottom to Top' }
                            ]

                          const currentDir = targetScene.transitionDirection || (isBubble ? 'bottom-left' : 'left')

                          return directions.map((dir) => {
                            const isDirSel = currentDir === dir.id
                            const Icon = dir.icon

                            return (
                              <button
                                key={dir.id}
                                onClick={() => handleDirectionChange(dir.id)}
                                title={dir.title}
                                className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-all duration-200 active:scale-95 shadow-sm ${isDirSel
                                  ? 'border-[#7c4af0] bg-[#7c4af0]/15 text-[#7c4af0] font-extrabold shadow-[0_0_8px_rgba(124,74,240,0.15)]'
                                  : isLight
                                    ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                    : 'border-white/5 bg-white/5 text-zinc-400 hover:border-white/10 hover:text-white hover:bg-white/10'
                                  }`}
                              >
                                <Icon className="w-4 h-4" strokeWidth={2.5} />
                              </button>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>



      {activeColorPickerIdx !== null && anchorEl && (
        <TransitionColorPickerModal
          initialColor={
            targetScene.transitionColors?.[activeColorPickerIdx] ||
            (targetScene.transition === 'Fade' ? '#000000' : targetScene.transition === 'BubbleWipe' ? ['#ec4899', '#f43f5e', '#d946ef', '#8b5cf6'][activeColorPickerIdx] : ['#5b21b6', '#7c3aed', '#8b5cf6', '#a78bfa'][activeColorPickerIdx])
          }
          onColorSelect={(newColor) => handleColorChange(activeColorPickerIdx, newColor)}
          onClose={() => {
            setActiveColorPickerIdx(null)
            setAnchorEl(null)
          }}
          anchorElement={anchorEl}
        />
      )}
    </div>
  )
}

export default TransitionsPanel
