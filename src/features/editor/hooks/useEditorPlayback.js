/**
 * Hook to manage video/audio playback functionality in the editor.
 * Handles playhead positioning, playback state, scene timing, and segment management.
 * Calculates total duration from scene durations and provides time formatting utilities.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { getGlobalMotionEngine } from '../../engine/motion'
import { selectProjectTimelineInfo, setCurrentScene, selectCurrentSceneId } from '../../../store/slices/projectSlice'

export function useEditorPlayback(scenes) {
  const dispatch = useDispatch()
  const motionEngine = getGlobalMotionEngine()
  const timelineInfo = useSelector(selectProjectTimelineInfo)
  const currentSceneId = useSelector(selectCurrentSceneId)
  const [playheadTime, setPlayheadTime] = useState(0)
  const playheadTimeRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [segments, setSegments] = useState([])

  const totalTime = useMemo(() => {
    if (!timelineInfo || timelineInfo.length === 0) return 0
    return timelineInfo[timelineInfo.length - 1].endTime
  }, [timelineInfo])

  const formatTime = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  const handleAddSegment = useCallback((segment) => {
    setSegments((prev) => [
      ...prev,
      {
        id: Date.now(),
        bypassed: false,
        ...segment,
      },
    ])
  }, [])

  const handleUpdateSegment = useCallback((segmentId, updates) => {
    setSegments((prev) =>
      prev.map((segment) =>
        segment.id === segmentId ? { ...segment, ...updates } : segment
      )
    )
  }, [])

  const handleDeleteSegment = useCallback((segmentId) => {
    setSegments((prev) => prev.filter((segment) => segment.id !== segmentId))
  }, [])

  const handleDuplicateSegment = useCallback((segmentId) => {
    setSegments((prev) => {
      const segment = prev.find((item) => item.id === segmentId)
      if (!segment) return prev
      return [...prev, { ...segment, id: Date.now() }]
    })
  }, [])

  const handleToggleSegmentBypass = useCallback((segmentId) => {
    setSegments((prev) =>
      prev.map((segment) =>
        segment.id === segmentId ? { ...segment, bypassed: !segment.bypassed } : segment
      )
    )
  }, [])

  // Sync with MotionEngine
  useEffect(() => {
    const handleUpdate = (time) => {
      setPlayheadTime(time)
      playheadTimeRef.current = time
    }

    const handleComplete = () => {
      setIsPlaying(false)
    }

    motionEngine.onUpdate(handleUpdate)
    motionEngine.onAllComplete(handleComplete)

    return () => {
      motionEngine.onUpdateCallbacks = motionEngine.onUpdateCallbacks.filter(cb => cb !== handleUpdate)
      motionEngine.onAllCompleteCallbacks = motionEngine.onAllCompleteCallbacks.filter(cb => cb !== handleComplete)
    }
  }, [motionEngine])

  // Handle Automatic Scene Switching based on playhead time
  // This works both during playback (auto-follow) and during manual seeking (auto-select)
  useEffect(() => {
    if (!timelineInfo || timelineInfo.length === 0) return

    // Find which scene should be active at the current playhead time
    // using a small epsilon to handle floating point precision at exact boundaries
    let activeScene = timelineInfo.find(
      (scene) => playheadTime >= scene.startTime - 0.002 && playheadTime < scene.endTime - 0.002
    )

    // Fallback logic if we missed the window due to precision or if at extreme ends
    if (!activeScene && timelineInfo.length > 0) {
      if (playheadTime < timelineInfo[0].startTime) {
        activeScene = timelineInfo[0]
      } else {
        activeScene = timelineInfo[timelineInfo.length - 1]
      }
    }

    if (activeScene && activeScene.id !== currentSceneId) {
      console.log(`🎬 [useEditorPlayback] Scene Sync: playhead=${playheadTime.toFixed(3)}s, currentId=${currentSceneId}, targetId=${activeScene.id} (${activeScene.name})`)
      dispatch(setCurrentScene(activeScene.id))
    }
  }, [playheadTime, timelineInfo, currentSceneId, dispatch])

  // Monitor engine's playing state
  useEffect(() => {
    const interval = setInterval(() => {
      if (motionEngine.isPlaying !== isPlaying) {
        setIsPlaying(motionEngine.isPlaying)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [motionEngine, isPlaying])

  return {
    playheadTime,
    setPlayheadTime,
    playheadTimeRef,
    isPlaying,
    setIsPlaying,
    segments,
    totalTime,
    formatTime,
    handleAddSegment,
    handleUpdateSegment,
    handleDeleteSegment,
    handleDuplicateSegment,
    handleToggleSegmentBypass,
  }
}

