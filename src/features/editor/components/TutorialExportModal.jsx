import React, { useState, useEffect, useContext, useMemo } from 'react';
import Modal from './Modal';
import { Download, Film, Image as ImageIcon } from 'lucide-react';
import { ThemeContext } from '../../../app/context/ThemeContext';

const VIDEO_OPTIONS = [
  { id: '720p', label: '720p (HD)', description: 'Fast export, good for social media' },
  { id: '1080p', label: '1080p (Full HD)', description: 'Recommended for best quality/speed' },
  { id: '1440p', label: '2K (QHD)', description: 'High resolution for sharp displays' },
  { id: '2160p', label: '4K (Ultra HD)', description: 'Highest quality, takes more time' },
];

const GIF_WIDTH_OPTIONS = [
  { value: 360, label: '360', description: 'Small' },
  { value: 480, label: '480', description: 'Medium' },
  { value: 720, label: '720', description: 'Large', recommended: true },
  { value: 1080, label: '1080', description: 'HD (Huge file)' },
];

const GIF_FPS_OPTIONS = [
  { value: 12, label: '12 fps', description: 'Smallest file' },
  { value: 15, label: '15 fps', description: 'Basic' },
  { value: 24, label: '24 fps', description: 'Smooth', recommended: true },
  { value: 30, label: '30 fps', description: 'Ultra smooth' },
];

const GIF_LOOP_OPTIONS = [
  { value: 0, label: 'Infinite', description: 'Loops forever', recommended: true },
  { value: 1, label: 'Once', description: 'Plays once' },
];

const DEFAULT_GIF = { width: 720, fps: 24, loop: 0 };
const DEFAULT_RES = '720p';

const TutorialExportModal = ({ isOpen, onClose, onExport, initialFormat = 'mp4' }) => {
  const [format, setFormat] = useState(initialFormat);
  const [selectedResolution, setSelectedResolution] = useState(DEFAULT_RES);
  const [gifWidth, setGifWidth] = useState(DEFAULT_GIF.width);
  const [gifFps, setGifFps] = useState(DEFAULT_GIF.fps);
  const [gifLoop, setGifLoop] = useState(DEFAULT_GIF.loop);
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';

  useEffect(() => {
    if (isOpen) {
      setFormat(initialFormat);
      setSelectedResolution(DEFAULT_RES);
      setGifWidth(DEFAULT_GIF.width);
      setGifFps(DEFAULT_GIF.fps);
      setGifLoop(DEFAULT_GIF.loop);
    }
  }, [isOpen, initialFormat]);

  // Mobile adaptation: disable the largest GIF width on very-low-memory
  // devices so we don't OOM during the palette pass.
  const deviceMemGB = useMemo(() => (typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined) ?? 4, []);
  const restrictLargeGif = deviceMemGB <= 2;

  const handleExport = () => {
    if (!onExport) return;
    if (format === 'gif') {
      onExport({
        format: 'gif',
        gifOptions: { width: gifWidth, fps: gifFps, loop: gifLoop },
      });
    } else {
      onExport({
        format: 'mp4',
        resolution: selectedResolution,
      });
    }
  };

  const tabClass = (active) =>
    `flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all ${active
      ? 'bg-[#7c4af0] text-white shadow-lg shadow-purple-500/20'
      : isLight
        ? 'bg-black/5 text-gray-600 hover:bg-black/10'
        : 'bg-white/5 text-white/70 hover:bg-white/10'
    }`;

  const segmentClass = (active, disabled) =>
    `flex-1 py-2 px-3 rounded-lg text-[12px] font-semibold transition-all ${disabled
      ? (isLight ? 'text-gray-300 bg-black/5 cursor-not-allowed' : 'text-white/20 bg-white/5 cursor-not-allowed')
      : active
        ? 'bg-[#7c4af0]/20 border border-[#7c4af0] text-[#7c4af0]'
        : isLight
          ? 'bg-black/5 border border-transparent text-gray-600 hover:bg-black/10'
          : 'bg-white/5 border border-transparent text-white/70 hover:bg-white/10'
    }`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Your Animation"
      maxWidth="max-w-md"
    >
      <div className="space-y-5">
        <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-white/60'}`}>
          Pick an output format and quality, then export your work.
        </p>

        <div className={`flex gap-2 p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
          <button type="button" className={tabClass(format === 'mp4')} onClick={() => setFormat('mp4')}>
            <Film className="w-4 h-4" /> Video (MP4)
          </button>
          <button type="button" className={tabClass(format === 'gif')} onClick={() => setFormat('gif')}>
            <ImageIcon className="w-4 h-4" /> GIF
          </button>
        </div>

        {format === 'mp4' && (
          <div className="grid gap-3">
            {VIDEO_OPTIONS.map((option) => (
              <label
                key={option.id}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer group ${selectedResolution === option.id
                  ? 'bg-[#7c4af0]/10 border-[#7c4af0] shadow-[0_0_20px_rgba(124,74,240,0.1)]'
                  : (isLight ? 'bg-black/5 border-black/5 hover:bg-black/10 hover:border-black/10' : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20')
                  }`}
              >
                <div className="pt-0.5">
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${selectedResolution === option.id
                    ? 'border-[#7c4af0] bg-[#7c4af0]'
                    : (isLight ? 'border-black/20 bg-transparent' : 'border-white/30 bg-transparent')
                    }`}>
                    {selectedResolution === option.id && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </div>
                <input
                  type="radio"
                  name="resolution"
                  value={option.id}
                  checked={selectedResolution === option.id}
                  onChange={() => setSelectedResolution(option.id)}
                  className="hidden"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] font-bold ${selectedResolution === option.id
                      ? (isLight ? 'text-gray-900' : 'text-white')
                      : (isLight ? 'text-gray-700' : 'text-white/80')
                      }`}>
                      {option.label}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-0.5 group-hover:transition-colors ${isLight ? 'text-gray-400 group-hover:text-gray-600' : 'text-white/40 group-hover:text-white/50'}`}>
                    {option.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}

        {format === 'gif' && (
          <div className="space-y-4">
            <div>
              <div className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>Width</div>
              <div className="flex gap-2">
                {GIF_WIDTH_OPTIONS.map((opt) => {
                  const disabled = restrictLargeGif && opt.value >= 720;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabled}
                      title={disabled ? 'Not available on this device' : (opt.recommended ? `${opt.description} · Recommended` : opt.description)}
                      onClick={() => !disabled && setGifWidth(opt.value)}
                      className={`relative ${segmentClass(gifWidth === opt.value, disabled)}`}
                    >
                      {opt.recommended && !disabled && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#7c4af0]" aria-label="Recommended" />
                      )}
                      {opt.label}
                      <span className={`block text-[10px] font-normal mt-0.5 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>Frame Rate</div>
              <div className="flex gap-2">
                {GIF_FPS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.recommended ? `${opt.description} · Recommended` : opt.description}
                    onClick={() => setGifFps(opt.value)}
                    className={`relative ${segmentClass(gifFps === opt.value, false)}`}
                  >
                    {opt.recommended && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#7c4af0]" aria-label="Recommended" />
                    )}
                    {opt.label}
                    <span className={`block text-[10px] font-normal mt-0.5 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>Loop</div>
              <div className="flex gap-2">
                {GIF_LOOP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.recommended ? `${opt.description} · Recommended` : opt.description}
                    onClick={() => setGifLoop(opt.value)}
                    className={`relative ${segmentClass(gifLoop === opt.value, false)}`}
                  >
                    {opt.recommended && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#7c4af0]" aria-label="Recommended" />
                    )}
                    {opt.label}
                    <span className={`block text-[10px] font-normal mt-0.5 ${isLight ? 'text-gray-500' : 'text-white/50'}`}>
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <p className={`text-[11px] ${isLight ? 'text-gray-400' : 'text-white/40'}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#7c4af0] align-middle mr-1.5" />
              Recommended for balanced quality and file size.
            </p>
          </div>
        )}

        <button
          onClick={handleExport}
          className="w-full py-3.5 bg-[#7c4af0] hover:bg-[#8d61f2] active:bg-[#6b3fd4] text-white rounded-xl text-[14px] font-bold transition-all shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 group"
        >
          <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
          {format === 'gif' ? 'Export GIF' : 'Export Project'}
        </button>
      </div>
    </Modal>
  );
};

export default TutorialExportModal;
