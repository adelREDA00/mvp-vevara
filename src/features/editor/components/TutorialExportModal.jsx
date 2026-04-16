import React, { useState, useContext } from 'react';
import Modal from './Modal';
import { Download, Loader2 } from 'lucide-react';
import { ThemeContext } from '../../../app/context/ThemeContext';

const EXPORT_OPTIONS = [
  { id: '720p', label: '720p (HD)', description: 'Fast export, good for social media' },
  { id: '1080p', label: '1080p (Full HD)', description: 'Recommended for best quality/speed' },
  { id: '1440p', label: '2K (QHD)', description: 'High resolution for sharp displays' },
  { id: '2160p', label: '4K (Ultra HD)', description: 'Highest quality, takes more time' },
];

const TutorialExportModal = ({ isOpen, onClose, onExport }) => {
  const [selectedResolution, setSelectedResolution] = useState('720p');
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';

  const handleExport = () => {
    if (onExport) {
      onExport(selectedResolution);
    }
    // Modal will be closed by EditorPage when export starts or finishes
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Your Animation"
      maxWidth="max-w-md"
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-white/60'}`}>
            Congratulations! You've created your first motion design. Select a resolution below to export your work.
          </p>

          <div className="grid gap-3">
            {EXPORT_OPTIONS.map((option) => (
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
        </div>

        <button
          onClick={handleExport}
          className="w-full py-3.5 bg-[#7c4af0] hover:bg-[#8d61f2] active:bg-[#6b3fd4] text-white rounded-xl text-[14px] font-bold transition-all shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 group"
        >
          <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
          Export Project
        </button>
      </div>
    </Modal>
  );
};

export default TutorialExportModal;
