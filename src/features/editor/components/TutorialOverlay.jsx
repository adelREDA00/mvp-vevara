import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { selectTutorialState } from '../../../store/slices/tutorialSlice';
import { X } from 'lucide-react';

const TutorialOverlay = () => {
  const { active, step } = useSelector(selectTutorialState);
  const [isHintDismissed, setIsHintDismissed] = useState(false);
  const videoRef = useRef(null);

  // Reset dismissed state on step changes
  useEffect(() => {
    setIsHintDismissed(false);
  }, [step]);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.load();
        } catch (_) {}
      }
    };
  }, []);

  useEffect(() => {
    if (isHintDismissed && videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.load();
      } catch (_) {}
    }
  }, [isHintDismissed]);

  if (!active) return null;

  if (step === 2 && !isHintDismissed) {
    return (
      <div className="absolute inset-0 pointer-events-none z-[10000]">
        <div className="absolute inset-0 flex items-end justify-center lg:items-end lg:justify-end p-6 lg:pointer-events-none">
          {/* Main Card Container — Workspace relative */}
          <div className="w-[300px] sm:w-[320px] pointer-events-auto bg-[#01B2FD] border border-white/20 rounded-2xl overflow-hidden transition-all duration-300 transform animate-in fade-in slide-in-from-bottom-5
            absolute bottom-6 right-6 lg:bottom-6 lg:right-6 max-lg:left-1/2 max-lg:top-1/2 max-lg:-translate-x-1/2 max-lg:-translate-y-1/2 max-lg:bottom-auto max-lg:right-auto p-4 flex flex-col gap-3.5 shadow-xl">

            {/* Video preview framed inside card, object-cover to remove borders */}
            <div className="relative w-full overflow-hidden bg-black flex items-center justify-center border border-white/10 aspect-[16/10]">
              <video ref={videoRef} className="w-full h-full object-cover" src="/videos/mini1.mp4" autoPlay muted loop playsInline webkit-playsinline="true" />
            </div>

            {/* Content Text: Clean visual hierarchy with white text */}
            <div className="flex flex-col gap-1 text-left">
              <span className="text-[11px] font-bold text-white/70 uppercase tracking-wider">
                Create First Moment
              </span>
              <h4 className="text-[13px] font-semibold text-white leading-normal">
                Move or resize any layer, then save your moment.
              </h4>
            </div>

            {/* Got It Button (Flat) */}
            <button
              onClick={() => setIsHintDismissed(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-white/95 text-[#01B2FD] text-xs font-bold transition-colors duration-200"
            >
              Got It
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 4 is Completion (Removed Success message visually as requested)
  return null;
};

export default TutorialOverlay;
