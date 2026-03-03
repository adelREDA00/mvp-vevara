import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  GripVertical,
  Copy,
  Trash2,
  PauseCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  X,
} from 'lucide-react'
import { updateLayer, reorderLayer, selectCurrentScene } from '../../../store/slices/projectSlice'
import { selectSelectedLayerId, selectSelectedLayerIds } from '../../../store/slices/selectionSlice'
import { selectLayers } from '../../../store/slices/projectSlice'
import { LAYER_TYPES } from '../../../store/models'

const segmentTypes = [
  { id: 'reveal', label: 'Reveal' },
  { id: 'hold', label: 'Hold' },
  { id: 'exit', label: 'Exit' },
  { id: 'move', label: 'Move' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'opacity', label: 'Opacity' },
]

const easingOptions = [
  { id: 'linear', label: 'Linear' },
  { id: 'power2.inOut', label: 'Power 2 In/Out' },
  { id: 'power3.inOut', label: 'Power 3 In/Out' },
  { id: 'back.out(1.4)', label: 'Back Out' },
]

function MotionInspector({
  selectedLayer: selectedLayerProp,
  segments = [],
  onLayerUpdate,
  onAddSegment,
  onUpdateSegment,
  onDeleteSegment,
  onDuplicateSegment,
  onToggleSegmentBypass,
  onClose,
}) {
  const dispatch = useDispatch()
  const selectedLayerId = useSelector(selectSelectedLayerId)
  const layers = useSelector(selectLayers)
  const currentScene = useSelector(selectCurrentScene)
  const [activeTab, setActiveTab] = useState('design')

  // Use Redux selected layer if available, otherwise use prop
  const selectedLayer = selectedLayerProp || (selectedLayerId ? layers[selectedLayerId] : null)

  // Calculate current layer index
  const currentLayerIndex = selectedLayer && currentScene
    ? currentScene.layers.indexOf(selectedLayer.id)
    : -1
  const totalLayers = currentScene ? currentScene.layers.length : 0

  // Default update handler uses Redux
  const handleLayerUpdate = (updates) => {
    if (selectedLayerId && onLayerUpdate) {
      onLayerUpdate(updates)
    } else if (selectedLayerId) {
      dispatch(updateLayer({ id: selectedLayerId, ...updates }))
    }
  }

  if (!selectedLayer) {
    return (
      <div className="w-[340px] h-full flex flex-col overflow-hidden backdrop-blur-md" style={{
        backgroundColor: '#0f1015',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}>
        <div className="p-4 text-center text-gray-500">
          <p className="text-sm">Select a layer to edit</p>
        </div>
      </div>
    )
  }

  const renderDesignTab = () => (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Layer Name & Controls */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={selectedLayer.name || 'Layer'}
          onChange={(e) => handleLayerUpdate({ name: e.target.value })}
          className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
        />
        <button
          onClick={() => handleLayerUpdate({ visible: selectedLayer.visible !== false ? false : true })}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          title="Visibility"
        >
          {selectedLayer.visible !== false ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => handleLayerUpdate({ locked: !selectedLayer.locked })}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          title="Lock"
        >
          {selectedLayer.locked ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Unlock className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Position & Size */}
      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Position & Size</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">X</label>
            <input
              type="number"
              value={selectedLayer.x || 0}
              onChange={(e) => handleLayerUpdate({ x: parseFloat(e.target.value) || 0 })}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Y</label>
            <input
              type="number"
              value={selectedLayer.y || 0}
              onChange={(e) => handleLayerUpdate({ y: parseFloat(e.target.value) || 0 })}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">W</label>
            <input
              type="number"
              value={selectedLayer.width || 100}
              onChange={(e) => handleLayerUpdate({ width: parseFloat(e.target.value) || 0 })}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">H</label>
            <input
              type="number"
              value={selectedLayer.height || 100}
              onChange={(e) => handleLayerUpdate({ height: parseFloat(e.target.value) || 0 })}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-gray-400">Anchor</label>
          <button className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">
            Center
          </button>
        </div>
        <div className="mt-2 space-y-2">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Rotation</label>
            <input
              type="number"
              value={selectedLayer.rotation || 0}
              onChange={(e) => handleLayerUpdate({ rotation: parseFloat(e.target.value) || 0 })}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Opacity</label>
            <input
              type="range"
              min="0"
              max="100"
              value={selectedLayer.opacity !== undefined ? selectedLayer.opacity * 100 : 100}
              onChange={(e) => handleLayerUpdate({ opacity: parseFloat(e.target.value) / 100 })}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-right mt-1">
              {Math.round(selectedLayer.opacity !== undefined ? selectedLayer.opacity * 100 : 100)}%
            </div>
          </div>
        </div>
      </div>

      {/* Style (for shapes) */}
      {selectedLayer.type === LAYER_TYPES.SHAPE && selectedLayer.data && (
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Style</div>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Fill</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={selectedLayer.data?.fill || '#3b82f6'}
                  onChange={(e) => handleLayerUpdate({ data: { fill: e.target.value } })}
                  className="h-8 w-16 rounded border border-gray-800"
                />
                <button className="flex-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300">
                  Gradient
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Stroke</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={selectedLayer.data?.stroke || '#000000'}
                  onChange={(e) => handleLayerUpdate({ data: { stroke: e.target.value } })}
                  className="h-8 w-16 rounded border border-gray-800"
                />
                <input
                  type="number"
                  value={selectedLayer.data?.strokeWidth || 0}
                  onChange={(e) => handleLayerUpdate({ data: { strokeWidth: parseFloat(e.target.value) || 0 } })}
                  placeholder="Width"
                  className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Text (when text selected) */}
      {selectedLayer.type === LAYER_TYPES.TEXT && (
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Text</div>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Content</label>
              <textarea
                value={selectedLayer.data?.content || ''}
                onChange={(e) => handleLayerUpdate({ data: { content: e.target.value } })}
                className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500 resize-none"
                rows={3}
                placeholder="Enter text..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Font Family</label>
              <select
                value={selectedLayer.data?.fontFamily || 'Arial'}
                onChange={(e) => handleLayerUpdate({ data: { fontFamily: e.target.value } })}
                className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
              >
                <option>Arial</option>
                <option>Georgia</option>
                <option>Times New Roman</option>
                <option>Verdana</option>
                <option>Courier New</option>
                <option>Helvetica</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Size</label>
                <input
                  type="number"
                  value={selectedLayer.data?.fontSize || 16}
                  onChange={(e) => handleLayerUpdate({ data: { fontSize: parseFloat(e.target.value) || 16 } })}
                  className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Weight</label>
                <select
                  value={selectedLayer.data?.fontWeight || 'normal'}
                  onChange={(e) => handleLayerUpdate({ data: { fontWeight: e.target.value } })}
                  className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="lighter">Light</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Color</label>
              <input
                type="color"
                value={selectedLayer.data?.color || '#ffffff'}
                onChange={(e) => handleLayerUpdate({ data: { color: e.target.value } })}
                className="h-8 w-full rounded border border-gray-800"
              />
            </div>
          </div>
        </div>
      )}

      {/* Fixed on Screen (HUD) toggle */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selectedLayer.hud || false}
            onChange={(e) => onLayerUpdate && onLayerUpdate({ ...selectedLayer, hud: e.target.checked })}
            className="w-4 h-4 text-purple-600 rounded"
          />
          <span className="text-xs text-gray-400">Fixed on Screen (HUD)</span>
        </label>
      </div>

      {/* Layer Order */}
      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Layer Order</div>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Layer Index</label>
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => {
                    if (currentScene && selectedLayer && currentLayerIndex >= 0 && currentLayerIndex < totalLayers - 1) {
                      dispatch(reorderLayer({
                        sceneId: currentScene.id,
                        fromIndex: currentLayerIndex,
                        toIndex: currentLayerIndex + 1
                      }))
                    }
                  }}
                  disabled={currentLayerIndex < 0 || currentLayerIndex >= totalLayers - 1}
                  className="p-0.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move forward (higher index)"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (currentScene && selectedLayer && currentLayerIndex > 0) {
                      dispatch(reorderLayer({
                        sceneId: currentScene.id,
                        fromIndex: currentLayerIndex,
                        toIndex: currentLayerIndex - 1
                      }))
                    }
                  }}
                  disabled={currentLayerIndex <= 0}
                  className="p-0.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move backward (lower index)"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="number"
                min="0"
                max={Math.max(0, totalLayers - 1)}
                value={currentLayerIndex >= 0 ? currentLayerIndex : 0}
                onChange={(e) => {
                  const newIndex = parseInt(e.target.value, 10)
                  if (!isNaN(newIndex) && currentScene && selectedLayer && newIndex >= 0 && newIndex < totalLayers) {
                    const fromIndex = currentLayerIndex
                    if (fromIndex !== newIndex && fromIndex >= 0) {
                      dispatch(reorderLayer({
                        sceneId: currentScene.id,
                        fromIndex: fromIndex,
                        toIndex: newIndex
                      }))
                    }
                  }
                }}
                className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
              />
              <span className="text-xs text-gray-500">/ {Math.max(0, totalLayers - 1)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {currentLayerIndex === 0 && totalLayers > 1 && 'Back (behind all layers)'}
              {currentLayerIndex > 0 && currentLayerIndex < totalLayers - 1 && `Middle (layer ${currentLayerIndex + 1} of ${totalLayers})`}
              {currentLayerIndex === totalLayers - 1 && totalLayers > 1 && 'Front (in front of all layers)'}
              {totalLayers === 1 && 'Only layer'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderMotionTab = () => (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Add Segment Button */}
      <div className="flex-shrink-0 p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAddSegment && onAddSegment({ type: 'reveal' })}
            className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm text-white transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Segment
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {segmentTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => onAddSegment && onAddSegment({ type: type.id })}
              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 transition-colors"
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Segment Stack */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {segments.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">No animation segments</p>
            <p className="text-xs mt-1">Add animation: Reveal / Move / Zoom / Rotate</p>
          </div>
        ) : (
          segments.map((segment, index) => (
            <div
              key={segment.id || index}
              className={`p-3 rounded-lg border ${segment.bypassed ? 'bg-gray-900/50 border-gray-800 opacity-50' : 'bg-gray-900 border-gray-800'
                }`}
            >
              <div className="flex items-start gap-2">
                <GripVertical className="h-4 w-4 text-gray-600 cursor-move" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="px-2 py-0.5 bg-purple-600/20 text-purple-400 rounded text-xs">
                      {segment.type}
                    </div>
                    <span className="text-xs text-gray-300 truncate">
                      {segment.type === 'move' ? `Move → ${segment.direction || 'Right'} ${segment.distance || 200}px` : segment.type}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Start (ms)</label>
                      <input
                        type="number"
                        value={segment.start || 0}
                        onChange={(e) => onUpdateSegment && onUpdateSegment(segment.id, { ...segment, start: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Duration (ms)</label>
                      <input
                        type="number"
                        value={segment.duration || 500}
                        onChange={(e) => onUpdateSegment && onUpdateSegment(segment.id, { ...segment, duration: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Ease</label>
                    <select
                      value={segment.ease || 'linear'}
                      onChange={(e) => onUpdateSegment && onUpdateSegment(segment.id, { ...segment, ease: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-purple-500"
                    >
                      {easingOptions.map((ease) => (
                        <option key={ease.id} value={ease.id}>
                          {ease.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(segment.type === 'move' || segment.type === 'zoom') && (
                    <button className="mt-2 w-full px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 transition-colors flex items-center justify-center gap-1">
                      <Clock className="h-3 w-3" />
                      Set Target
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => onDuplicateSegment && onDuplicateSegment(segment.id)}
                    className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                    title="Duplicate"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onToggleSegmentBypass && onToggleSegmentBypass(segment.id)}
                    className={`p-1 rounded transition-colors ${segment.bypassed ? 'text-purple-400 hover:text-purple-300' : 'text-gray-400 hover:text-white'
                      } hover:bg-gray-800`}
                    title="Bypass"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteSegment && onDeleteSegment(segment.id)}
                    className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Segment Timeline Mini-Bar */}
      {segments.length > 0 && (
        <div className="flex-shrink-0 p-4 border-t border-gray-800">
          <div className="text-xs text-gray-400 mb-2">Timeline</div>
          <div className="relative h-8 bg-gray-900 rounded">
            {segments.map((segment, index) => {
              const totalDuration = Math.max(...segments.map(s => (s.start || 0) + (s.duration || 500)), 2000)
              const left = ((segment.start || 0) / totalDuration) * 100
              const width = ((segment.duration || 500) / totalDuration) * 100
              return (
                <div
                  key={segment.id || index}
                  className="absolute h-full bg-purple-600 rounded"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${segment.type} (${segment.start}ms - ${(segment.start || 0) + (segment.duration || 500)}ms)`}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div
      className="flex flex-col h-full relative backdrop-blur-md transition-all duration-300"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : '340px',
        backgroundColor: '#0f1015',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '2px 0 12px rgba(0,0,0,0.3)',
      }}
    >
      {/* Resize Handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-zinc-700/50 transition-colors"
      />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Advanced</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0 bg-gray-950 z-10">
        <button
          onClick={() => setActiveTab('design')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'design'
            ? 'text-white border-b-2 border-purple-500'
            : 'text-gray-400 hover:text-gray-300'
            }`}
        >
          Design
        </button>
        <button
          onClick={() => setActiveTab('motion')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'motion'
            ? 'text-white border-b-2 border-purple-500'
            : 'text-gray-400 hover:text-gray-300'
            }`}
        >
          Animation
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'design' && renderDesignTab()}
        {activeTab === 'motion' && renderMotionTab()}
      </div>
    </div>
  )
}

export default MotionInspector
