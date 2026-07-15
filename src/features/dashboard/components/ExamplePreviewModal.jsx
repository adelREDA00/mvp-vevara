import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, X, ChevronDown, ChevronLeft, ChevronRight, Sparkles, Loader2 } from 'lucide-react';

const ExamplePreviewModal = ({ isOpen, onClose, selectedTemplate, templates, onCopyAndCustomize, isLight }) => {
  const [currentTemplate, setCurrentTemplate] = useState(selectedTemplate);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [thumbnailsLoaded, setThumbnailsLoaded] = useState({});
  const videoRef = useRef(null);
  const sliderRef = useRef(null);
  const modalRef = useRef(null);

  // Video Controls Inactivity Fade-out
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef(null);

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2500);
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      setProgress(0);
      setVideoLoaded(false);
      setShowControls(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
        videoRef.current.load();
      }
      setCurrentTemplate(null);
    } else if (selectedTemplate) {
      setCurrentTemplate(selectedTemplate);
      setIsPlaying(false);
      setProgress(0);
      setVideoLoaded(false);
      setShowControls(false);
    }
  }, [isOpen, selectedTemplate]);

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying && videoLoaded) {
        videoRef.current.play().catch(() => setIsPlaying(false));
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, currentTemplate, videoLoaded]);

  // Autoplay once video is loaded and drawer is open
  useEffect(() => {
    if (videoLoaded && videoRef.current) {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [videoLoaded]);

  if (!isOpen || !currentTemplate) return null;

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    resetControlsTimeout();
  };

  const handleMuteToggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
    resetControlsTimeout();
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const total = videoRef.current.duration || 1;
      setProgress((current / total) * 100);
    }
  };

  const handleProgressChange = (e) => {
    if (videoRef.current) {
      const total = videoRef.current.duration || 0;
      const newTime = (parseFloat(e.target.value) / 100) * total;
      videoRef.current.currentTime = newTime;
      setProgress(parseFloat(e.target.value));
    }
    resetControlsTimeout();
  };

  const selectRelatedTemplate = (tpl) => {
    setCurrentTemplate(tpl);
    setIsPlaying(false);
    setProgress(0);
    setVideoLoaded(false);
    setShowControls(false);
  };

  const handleCopyAction = () => {
    onCopyAndCustomize(currentTemplate);
  };

  const scrollSlider = (direction) => {
    if (sliderRef.current) {
      const scrollAmount = 300;
      sliderRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleBackdropClick = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      onClose();
    }
  };

  const handleVideoWrapperClick = () => {
    setShowControls(prev => !prev);
    resetControlsTimeout();
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const currentTimeFormatted = videoRef.current ? formatTime(videoRef.current.currentTime) : '0:00';
  const durationFormatted = videoRef.current ? formatTime(videoRef.current.duration) : '0:10';

  const relatedTemplates = templates.filter(t => t._id !== currentTemplate._id);

  // Aspect ratio calculations
  const duration = currentTemplate.duration || 10.0;
  const aspectRatio = currentTemplate.aspectRatio || '16:9';
  const dimensions = aspectRatio === '9:16' ? '1080 × 1920 px' : '1920 × 1080 px';

  // Theme-specific styles
  const bgClass = isLight ? 'bg-white text-zinc-900 border-zinc-200' : 'bg-[#151F2B] text-white border-[#263445]';
  const playerBgClass = isLight ? 'bg-zinc-100 border-zinc-250' : 'bg-[#0F1720] border-[#263445]';
  const borderClass = isLight ? 'border-zinc-200' : 'border-[#263445]';

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-300"
    >
      {/* Bottom Drawer Container */}
      <div
        ref={modalRef}
        className={`relative w-full max-w-7xl h-[85vh] max-h-[85vh] rounded-t-[24px] border-t border-x border-b-none flex flex-col shadow-2xl overflow-hidden transition-all duration-300 ease-out animate-in slide-in-from-bottom duration-300 ${bgClass}`}
      >

        {/* Unified Header Bar */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--dashboard-border)] shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[15px] truncate">{currentTemplate.name}</span>
            {/* <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)]">
              {currentTemplate.category}
            </span> */}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--dashboard-card-hover)] rounded-full text-[var(--dashboard-text-muted)] transition-colors"
            aria-label="Close drawer"
          >
            <ChevronDown size={22} />
          </button>
        </div>

        {/* Content Area */}
        <div className="overflow-y-auto custom-scrollbar flex-1 p-6 md:p-8 space-y-6">

          {/* Main Top Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">

            {/* Video Player Section */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              <div
                onClick={handleVideoWrapperClick}
                onMouseEnter={() => setShowControls(true)}
                onMouseLeave={() => setShowControls(false)}
                onMouseMove={resetControlsTimeout}
                className={`relative aspect-video w-full rounded-[12px] overflow-hidden border flex flex-col group/player cursor-pointer select-none ${playerBgClass}`}
              >
                {/* Lazy Loaded Video Element */}
                <div className="flex-1 relative flex items-center justify-center bg-black">
                  {currentTemplate.videoUrl ? (
                    <video
                      ref={videoRef}
                      src={currentTemplate.videoUrl}
                      className={`w-full h-full object-contain transition-opacity duration-300 ${videoLoaded ? 'opacity-100' : 'opacity-0 absolute'}`}
                      muted={isMuted}
                      loop
                      playsInline
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedData={() => setVideoLoaded(true)}
                      onCanPlay={() => setVideoLoaded(true)}
                    />
                  ) : null}

                  {/* Skeleton Placeholder for video area */}
                  {!videoLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/25 dark:bg-slate-900/40 animate-pulse text-zinc-500 gap-3">
                      <div className="w-10 h-10 border-4 border-slate-500/10 border-t-[var(--dashboard-accent)] rounded-full animate-spin" />
                      <span className="text-[11px] font-semibold text-[var(--dashboard-text-muted)]">Loading preview...</span>
                    </div>
                  )}

                  {/* Play/Pause indicator overlay */}
                  {videoLoaded && !isPlaying && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayPause();
                      }}
                      className="absolute w-14 h-14 bg-white/95 text-black hover:scale-105 transition-all shadow-xl rounded-full flex items-center justify-center pl-1 z-10"
                    >
                      <Play fill="black" size={24} />
                    </button>
                  )}
                </div>

                {/* Video controls */}
                {videoLoaded && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute bottom-3 left-3 right-3 p-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-[8px] flex items-center gap-4 text-xs text-white transition-opacity duration-300 z-20 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  >
                    <button onClick={handlePlayPause} className="hover:text-zinc-300 transition-colors shrink-0">
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>

                    <div className="text-[10px] opacity-85 shrink-0 select-none">
                      {currentTimeFormatted} / {durationFormatted}
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={handleProgressChange}
                      className="flex-1 h-1 bg-white/20 appearance-none cursor-pointer accent-white rounded-full outline-none"
                    />

                    <button onClick={handleMuteToggle} className="hover:text-zinc-300 transition-colors shrink-0">
                      {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Information & Action Section */}
            <div className="lg:col-span-5 flex flex-col justify-center py-2 space-y-5">
              <div className="space-y-3">
                <h2 className="text-xl md:text-2xl font-extrabold tracking-tight leading-tight">
                  {currentTemplate.name}
                </h2>
                <p className="text-[13px] text-[var(--dashboard-text-muted)] font-medium leading-relaxed">
                  {currentTemplate.description || "A clean, modern animation to kickstart your next video project."}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--dashboard-text-muted)] font-bold opacity-75">
                  <span>{aspectRatio} Ratio</span>
                  <span className="opacity-40">•</span>
                  <span>{dimensions}</span>
                  <span className="opacity-40">•</span>
                  <span>{duration}s Duration</span>
                </div>
              </div>

              <div>
                <button
                  onClick={handleCopyAction}
                  className={`px-8 h-11 text-xs bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent-hover)] active:scale-95 ${isLight ? 'text-white' : 'text-[#06121A]'} font-extrabold rounded-[8px] transition-all flex items-center justify-center gap-2`}
                >

                  <span>Copy and Customize</span>
                </button>
              </div>
            </div>

          </div>

          {/* Bottom Section: Related Examples Horizontal Slider */}
          {relatedTemplates.length > 0 && (
            <div className="pt-4 border-t border-[var(--dashboard-border)]">
              <div className="flex items-center justify-between mb-4 select-none">
                <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--dashboard-text-muted)]">
                  More like this
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => scrollSlider('left')}
                    className="p-1 hover:text-[var(--dashboard-text)] text-[var(--dashboard-text-muted)] transition-colors"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => scrollSlider('right')}
                    className="p-1 hover:text-[var(--dashboard-text)] text-[var(--dashboard-text-muted)] transition-colors"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {/* Slider Track */}
              <div
                ref={sliderRef}
                className="flex items-center gap-4 overflow-x-auto py-2 snap-x scroll-smooth no-scrollbar"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {relatedTemplates.map((related) => {
                  const isLoaded = thumbnailsLoaded[related._id];
                  return (
                    <div
                      key={related._id}
                      onClick={() => selectRelatedTemplate(related)}
                      className={`flex-shrink-0 w-48 sm:w-56 snap-start cursor-pointer aspect-video bg-black border rounded-[12px] overflow-hidden relative transition-all hover:border-[var(--dashboard-border-hover)] ${borderClass}`}
                    >
                      {related.thumbnail ? (
                        <>
                          <img
                            src={related.thumbnail}
                            alt={related.name}
                            onLoad={() => setThumbnailsLoaded(prev => ({ ...prev, [related._id]: true }))}
                            className={`w-full h-full object-cover transition-all duration-300 hover:scale-105 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                          />
                          {!isLoaded && (
                            <div className="absolute inset-0 bg-slate-800/30 animate-pulse flex items-center justify-center">
                              <Loader2 className="w-5 h-5 animate-spin text-[var(--dashboard-text-muted)]" />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-[10px]">
                          Preview
                        </div>
                      )}

                      <div className="absolute inset-0 bg-black/45 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center select-none">
                        <span className="text-[10px] font-bold bg-white text-black px-3 py-1.5 rounded-[6px] shadow-md">
                          Quick Preview
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default ExamplePreviewModal;
