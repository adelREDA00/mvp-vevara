import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { selectTutorialState } from '../../../store/slices/tutorialSlice';

const TutorialOverlay = ({ isPlaying, manualTargetRect, onNext }) => {
  const { active, step } = useSelector(selectTutorialState);
  const [targetRect, setTargetRect] = useState(null);
  const [canvasRect, setCanvasRect] = useState(null);
  const [hintPos, setHintPos] = useState({ top: 0, left: 0 });
  const requestRef = useRef();

  const updatePosition = useCallback(() => {
    const margin = 16;
    const viewWidth = window.innerWidth;

    // If Step 4 and manualTargetRect provided, use it
    if (step === 4 && manualTargetRect) {
      setTargetRect(manualTargetRect);
      // Position to the LEFT of the target with enough gap
      setHintPos({
        top: manualTargetRect.y + manualTargetRect.height / 2,
        left: Math.max(margin, manualTargetRect.x - 40),
        position: 'left'
      });
      return;
    }

    let buttonSelector = '';
    if (step === 1) buttonSelector = '[data-tutorial="play-button"]';
    else if (step === 2) buttonSelector = '[data-tutorial="steps-area"]';
    else if (step === 3 || step === 5) buttonSelector = '[data-tutorial="add-step-button"]';

    const buttonElement = buttonSelector ? document.querySelector(buttonSelector) : null;
    const canvasElement = document.querySelector('[data-tutorial="canvas-area"]');

    if (buttonElement) {
      const rect = buttonElement.getBoundingClientRect();
      const padding = 8;

      // Update target rect with stability buffer
      setTargetRect(prev => {
        if (!prev || Math.abs(prev.x - (rect.x - padding / 2)) > 1 || Math.abs(prev.y - (rect.y - padding / 2)) > 1) {
          return {
            x: rect.x - padding / 2,
            y: rect.y - padding / 2,
            width: rect.width + padding,
            height: rect.height + padding,
          };
        }
        return prev;
      });

      // Positioning logic
      let isBottom = (step === 3 || step === 5);
      let offset = 80;
      if (step === 1) offset = 100;
      if (step === 2) offset = 160;

      let top = isBottom ? (rect.bottom + 20) : (rect.top - offset);

      // Safety Check: if it goes off top, force to bottom
      if (top < 10) {
        top = rect.bottom + 20;
        isBottom = true;
      }

      setHintPos(prev => {
        // Horizontal safety for mobile: ensure 'left' center doesn't push edges off screen
        // rect.left + rect.width / 2 is the center of the target
        let targetCenter = rect.left + rect.width / 2;

        // Modal is roughly 280px wide on mobile (from max-w)
        const modalHalfWidth = 140;
        const left = Math.max(modalHalfWidth + margin, Math.min(viewWidth - modalHalfWidth - margin, targetCenter));

        // Only update if change is significant to avoid "vibrating" hint
        if (Math.abs(prev.top - top) > 1 || Math.abs(prev.left - left) > 1 || prev.position !== (isBottom ? 'bottom' : 'top')) {
          return {
            top,
            left,
            position: isBottom ? 'bottom' : 'top'
          };
        }
        return prev;
      });
    } else {
      setTargetRect(null);
    }

    if (canvasElement) {
      const rect = canvasElement.getBoundingClientRect();
      setCanvasRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      });
    }
  }, [step, manualTargetRect]);

  useEffect(() => {
    if (active && step > 0 && step < 6) {
      updatePosition();
      requestRef.current = requestAnimationFrame(function loop() {
        updatePosition();
        requestRef.current = requestAnimationFrame(loop);
      });
    } else {
      cancelAnimationFrame(requestRef.current);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [active, step, updatePosition]);

  // Create the clip-path polygon with stable multi-hole bridges
  const clipPath = useMemo(() => {
    if (!targetRect) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';

    // 1. Frame (Clockwise)
    const pts = ['0px 0px', '100% 0px', '100% 100%', '0px 100%', '0px 0px'];

    // Step 5 has no overlay (hint only)
    if (step === 5) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';

    // 2. Canvas Hole (Counter-Clockwise) - Only in Step 1
    if (step === 1 && canvasRect) {
      const { x, y, width: w, height: h } = canvasRect;
      pts.push(`${x}px ${y}px`); // Bridge
      pts.push(`${x}px ${y + h}px`, `${x + w}px ${y + h}px`, `${x + w}px ${y}px`, `${x}px ${y}px`);
      pts.push('0px 0px'); // Bridge back
    }

    // 3. Target Hole (Counter-Clockwise)
    if (targetRect) {
      const { x, y, width: w, height: h } = targetRect;
      pts.push(`${x}px ${y}px`); // Bridge
      pts.push(`${x}px ${y + h}px`, `${x + w}px ${y + h}px`, `${x + w}px ${y}px`, `${x}px ${y}px`);
      pts.push('0px 0px'); // Bridge back
    }

    return `polygon(${pts.join(', ')})`;
  }, [targetRect, canvasRect, step]);

  // Hide overlay while playing in Step 1
  if (!active || step <= 0 || step > 6 || (!targetRect && step !== 5) || (step === 1 && isPlaying)) return null;

  const getHintText = () => {
    switch (step) {
      case 1: return "Press Play to see the animation.";
      case 2: return "This scene has 2 Steps. Each Step is a moment in your animation.";
      case 3: return "It's your turn! Click 'Add Step' to create Step 3.";
      case 4: return "Move the Blue iPhone to the bottom and scale it.";
      case 5: return "When you're done, click 'Add Step' again to save Step 3.";
      default: return "";
    }
  }

  // Positioning style based on anchor
  const getHintContainerStyle = () => {
    if (hintPos.position === 'left') {
      return {
        top: `${hintPos.top}px`,
        left: `${hintPos.left}px`,
        transform: 'translate(-100%, -50%)',
      };
    }
    return {
      top: `${hintPos.top}px`,
      left: `${hintPos.left}px`,
      transform: 'translateX(-50%)',
    };
  }

  const getArrowClasses = () => {
    const base = "absolute w-4 h-4 bg-[#6940c9] rotate-45 border-white/20";
    if (hintPos.position === 'bottom') return `${base} -top-2 left-1/2 -translateX-1/2 border-l border-t`;
    if (hintPos.position === 'top') return `${base} -bottom-2 left-1/2 -translateX-1/2 border-r border-b`;
    if (hintPos.position === 'left') return `${base} -right-2 top-1/2 -translateY-1/2 border-r border-t`;
    return base;
  };

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none overflow-hidden">
      {/* Dark Overlay with Holes */}
      {step < 5 && !(step === 4 && typeof window !== 'undefined' && window.innerWidth < 1024) && (
        <div
          className="absolute inset-0 bg-black/40 pointer-events-auto transition-[clip-path] duration-300"
          style={{
            clipPath,
            WebkitClipPath: clipPath,
          }}
        />
      )}

      {/* Target Highlight (Visual only) */}
      {targetRect && step < 5 && !(step === 4 && typeof window !== 'undefined' && window.innerWidth < 1024) && (
        <div
          className="absolute border-2 border-[#6940c9] rounded-xl transition-all duration-300 shadow-[0_0_20px_rgba(105,64,201,0.6)] pointer-events-none"
          style={{
            top: `${targetRect.y}px`,
            left: `${targetRect.x}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          }}
        />
      )}

      {/* Hint Message */}
      <div
        className="absolute transition-all duration-300 pointer-events-none"
        style={getHintContainerStyle()}
      >
        <div className={`bg-[#6940c9] text-white px-4 py-2.5 rounded-xl shadow-2xl border border-white/20 flex flex-col items-center gap-1.5 animate-bounce-subtle pointer-events-auto text-center ${step === 4 ? 'max-w-[400px] sm:max-w-md' : 'max-w-[280px] sm:max-w-xs'
          }`}>
          <span className="text-[9px] font-black tracking-[0.2em] uppercase opacity-50">Tutorial</span>
          <span className="text-xs font-bold leading-relaxed break-words">
            {getHintText()}
          </span>

          {step === 2 && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onNext) onNext();
              }}
              className="mt-1 px-4 py-1.5 bg-white text-[#6940c9] rounded-lg text-xs font-bold hover:bg-white/90 transition-colors"
            >
              Next
            </button>
          )}

          {/* Arrow */}
          <div className={getArrowClasses()} />
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s infinite ease-in-out;
        }
      `}} />
    </div>
  );
};

export default TutorialOverlay;
