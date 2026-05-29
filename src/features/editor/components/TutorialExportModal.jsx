import React, { useState, useEffect, useContext, useMemo } from 'react';
import Modal from './Modal';
import { Download, Film, Image as ImageIcon, Award, X, ChevronDown } from 'lucide-react';
import { ThemeContext } from '../../../app/context/ThemeContext';

const VIDEO_OPTIONS = [
  { id: '720p', label: '720p (HD)', description: 'Fast export' },
  { id: '1080p', label: '1080p (Full HD)', description: 'Recommended ' },
  { id: '1440p', label: '2K (QHD)', description: 'High resolution ' },
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
const DEFAULT_RES = '1080p';

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
      title={null}
      showCloseButton={false}
      maxWidth="max-w-md"
    >
      <div className="relative space-y-5 pt-2">
        {/* Manual Close Button inside content */}
        <button
          onClick={onClose}
          className={`absolute -top-4 -right-4 p-2 rounded-full transition-all ${isLight ? 'hover:bg-black/5 text-gray-400' : 'hover:bg-white/5 text-white/40'}`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* <div className={`p-5 rounded-2xl border ${isLight ? 'bg-gray-50/50 border-gray-200' : 'bg-white/5 border-white/10'}`}>
          <div className="flex items-start gap-4">
            <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg ${isLight ? 'bg-white shadow-black/5' : 'bg-black shadow-white/5'} overflow-hidden`}>
              <img src="/apple.webp" className="w-6 h-6 object-contain" alt="Apple" />
            </div>
            <div className="space-y-2">
              <h3 className={`font-bold text-lg leading-tight ${isLight ? 'text-gray-900' : 'text-white'}`}>
                Congrats! You're ready.
              </h3>
              <p className={`text-[13px] leading-relaxed ${isLight ? 'text-gray-600' : 'text-white/70'}`}>
                You are now ready to be a motion designer at <span className={`font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Apple</span>.
                Download your project, add it to your CV, and submit it.
              </p>

              <div className={`py-1 px-2.5 rounded-lg border ${isLight ? 'bg-amber-50 text-amber-700 border-amber-200/50' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'} text-[10px] font-bold inline-flex items-center gap-2`}>
                <span className="opacity-90">If they say no, try again in 4K.</span>
              </div>
            </div>
          </div>
        </div> */}

        <div className={`flex gap-2 p-1 rounded-xl ${isLight ? 'bg-black/5' : 'bg-white/5'}`}>
          <button type="button" className={tabClass(format === 'mp4')} onClick={() => setFormat('mp4')}>
            <Film className="w-4 h-4" /> Video (MP4)
          </button>
          <button type="button" className={tabClass(format === 'gif')} onClick={() => setFormat('gif')}>
            <ImageIcon className="w-4 h-4" /> GIF
          </button>
        </div>

        {format === 'mp4' && (
          <div className="space-y-1.5">
            <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${isLight ? 'text-gray-400' : 'text-white/40'}`}>
              Resolution
            </label>
            <div className="relative">
              <select
                value={selectedResolution}
                onChange={(e) => setSelectedResolution(e.target.value)}
                className={`w-full appearance-none pl-4 pr-10 py-3 rounded-xl border text-[13px] font-bold transition-all outline-none cursor-pointer ${isLight
                  ? 'bg-black/5 border-transparent hover:bg-black/10 text-gray-900'
                  : 'bg-white/5 border-transparent hover:bg-white/10 text-white'
                  }`}
              >
                {VIDEO_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label} — {opt.description}</option>
                ))}
              </select>
              <div className={`absolute right-4 top-1/2 -translateY-1/2 pointer-events-none ${isLight ? 'text-gray-400' : 'text-white/40'}`}>
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </div>
        )}

        {format === 'gif' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${isLight ? 'text-gray-400' : 'text-white/40'}`}>Size</label>
              <div className="relative">
                <select
                  value={gifWidth}
                  onChange={(e) => setGifWidth(Number(e.target.value))}
                  className={`w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl border text-[12px] font-bold transition-all outline-none cursor-pointer ${isLight ? 'bg-black/5 border-transparent text-gray-900' : 'bg-white/5 border-transparent text-white'
                    }`}
                >
                  {GIF_WIDTH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={restrictLargeGif && opt.value >= 720}>
                      {opt.label} ({opt.description})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translateY-1/2 w-3.5 h-3.5 pointer-events-none opacity-40" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${isLight ? 'text-gray-400' : 'text-white/40'}`}>FPS</label>
              <div className="relative">
                <select
                  value={gifFps}
                  onChange={(e) => setGifFps(Number(e.target.value))}
                  className={`w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl border text-[12px] font-bold transition-all outline-none cursor-pointer ${isLight ? 'bg-black/5 border-transparent text-gray-900' : 'bg-white/5 border-transparent text-white'
                    }`}
                >
                  {GIF_FPS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translateY-1/2 w-3.5 h-3.5 pointer-events-none opacity-40" />
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 ${isLight ? 'text-gray-400' : 'text-white/40'}`}>Playback</label>
              <div className="relative">
                <select
                  value={gifLoop}
                  onChange={(e) => setGifLoop(Number(e.target.value))}
                  className={`w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl border text-[12px] font-bold transition-all outline-none cursor-pointer ${isLight ? 'bg-black/5 border-transparent text-gray-900' : 'bg-white/5 border-transparent text-white'
                    }`}
                >
                  {GIF_LOOP_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label} Loop</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translateY-1/2 w-3.5 h-3.5 pointer-events-none opacity-40" />
              </div>
            </div>
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
