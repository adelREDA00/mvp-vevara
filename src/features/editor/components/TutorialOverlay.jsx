import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { selectTutorialState } from '../../../store/slices/tutorialSlice';
import { selectProjectName } from '../../../store/slices/projectSlice';

const TutorialOverlay = ({ isPlaying, manualTargetRect }) => {
  const { active, step } = useSelector(selectTutorialState);
  const projectName = useSelector(selectProjectName);
  const [targetRect, setTargetRect] = useState(null);
  const [hintPos, setHintPos] = useState({ top: 0, left: 0 });
  const requestRef = useRef();

  // Reset targetRect on step change to prevent stale highlights between steps
  useEffect(() => {
    setTargetRect(null);
  }, [step]);

  const updatePosition = useCallback(() => {
    const viewWidth = window.innerWidth;
    const margin = 16;
    const modalWidth = 280;

    // Step 2 uses the manual target rect from the canvas
    if (step === 2 && manualTargetRect) {
      const padding = 20;
      const paddedRect = {
        x: manualTargetRect.x - padding / 2,
        y: manualTargetRect.y - padding / 2,
        width: manualTargetRect.width + padding,
        height: manualTargetRect.height + padding
      };
      setTargetRect(paddedRect);
      const offset = 60; // Increased offset for hint box to clear handles

      const hasSpaceLeft = paddedRect.x > (modalWidth + margin + offset);
      const hasSpaceRight = viewWidth - (paddedRect.x + paddedRect.width) > (modalWidth + margin + offset);

      if (hasSpaceLeft) {
        setHintPos({
          top: paddedRect.y + paddedRect.height / 2,
          left: paddedRect.x - offset,
          position: 'left'
        });
      } else if (hasSpaceRight) {
        setHintPos({
          top: paddedRect.y + paddedRect.height / 2,
          left: paddedRect.x + paddedRect.width + offset,
          position: 'right'
        });
      } else {
        const hasSpaceTop = paddedRect.y > 180;
        setHintPos({
          top: hasSpaceTop ? (paddedRect.y - 100) : (paddedRect.y + paddedRect.height + 100),
          left: Math.max(modalWidth / 2 + margin, Math.min(viewWidth - modalWidth / 2 - margin, paddedRect.x + paddedRect.width / 2)),
          position: hasSpaceTop ? 'top' : 'bottom'
        });
      }
      return;
    }

    // Steps 1 and 3 target the Animate / Save Step button
    const buttonElements = document.querySelectorAll('[data-tutorial="add-step-button"]');
    let buttonElement = null;
    if (buttonElements.length > 0) {
      // Find the button element that is currently visible in the DOM
      buttonElement = Array.from(buttonElements).find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      // Fallback if none are visible or rect is in transition
      if (!buttonElement) {
        buttonElement = window.innerWidth < 1024 ? buttonElements[buttonElements.length - 1] : buttonElements[0];
      }
    }

    if (buttonElement) {
      const rect = buttonElement.getBoundingClientRect();
      const padding = 8;

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

      // Determine if Animate/Save button is at the bottom of the screen (on mobile)
      const isAtBottom = rect.top > window.innerHeight / 2;
      const top = isAtBottom ? rect.top - 20 : rect.bottom + 20;
      const position = isAtBottom ? 'top' : 'bottom';

      setHintPos(prev => {
        let targetCenter = rect.left + rect.width / 2;
        const modalHalfWidth = 140;
        const left = Math.max(modalHalfWidth + margin, Math.min(viewWidth - modalHalfWidth - margin, targetCenter));

        if (Math.abs(prev.top - top) > 1 || Math.abs(prev.left - left) > 1 || prev.position !== position) {
          return { top, left, position };
        }
        return prev;
      });
    } else {
      setTargetRect(null);
    }
  }, [step, manualTargetRect]);

  useEffect(() => {
    if (active && step > 0 && step <= 3) {
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

  const clipPath = useMemo(() => {
    if (!targetRect || step === 3) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
    const pts = ['0px 0px', '100% 0px', '100% 100%', '0px 100%', '0px 0px'];
    const { x, y, width: w, height: h } = targetRect;
    pts.push(`${x}px ${y}px`); // Bridge
    pts.push(`${x}px ${y + h}px`, `${x + w}px ${y + h}px`, `${x + w}px ${y}px`, `${x}px ${y}px`);
    pts.push('0px 0px'); // Bridge back
    return `polygon(${pts.join(', ')})`;
  }, [targetRect, step]);

  if (!active || step <= 0 || step > 3 || !targetRect) return null;

  const getHintText = () => {
    if (step === 1) return "Add the final moment";
    if (step === 2) {
      return projectName === "Mistral AI Studio"
        ? "Try moving it to the left (outside the canvas)"
        : "Try scaling or moving it";
    }
    if (step === 3) return "When you're ready, Save your moment";
    return "";
  };

  const getHintContainerStyle = () => {
    if (hintPos.position === 'left') return { top: `${hintPos.top}px`, left: `${hintPos.left}px`, transform: 'translate(-100%, -50%)' };
    if (hintPos.position === 'right') return { top: `${hintPos.top}px`, left: `${hintPos.left}px`, transform: 'translate(0, -50%)' };
    if (hintPos.position === 'top') {
      return {
        top: `${hintPos.top}px`,
        left: `${hintPos.left}px`,
        transform: step === 2 ? 'translateX(-50%)' : 'translate(-50%, -100%)'
      };
    }
    return { top: `${hintPos.top}px`, left: `${hintPos.left}px`, transform: 'translateX(-50%)' };
  };

  const getArrowClasses = () => {
    const base = "absolute w-4 h-4 bg-[#6940c9] rotate-45 border-white/20";
    if (hintPos.position === 'bottom') return `${base} -top-2 left-1/2 -translate-x-1/2 border-l border-t`;
    if (hintPos.position === 'top') return `${base} -bottom-2 left-1/2 -translate-x-1/2 border-r border-b`;
    if (hintPos.position === 'left') return `${base} -right-2 top-1/2 -translate-y-1/2 border-r border-t`;
    if (hintPos.position === 'right') return `${base} -left-2 top-1/2 -translate-y-1/2 border-l border-b`;
    return base;
  };

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none overflow-hidden">
      {/* Overlay - Skip for Step 3 */}
      {step < 3 && (
        <div
          className="absolute inset-0 bg-black/40 pointer-events-auto transition-[clip-path] duration-300"
          style={{ clipPath, WebkitClipPath: clipPath }}
        />
      )}

      {/* Target Highlight */}
      {targetRect && step < 3 && (
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
      <div className="absolute transition-all duration-300 pointer-events-none" style={getHintContainerStyle()}>
        <div className={`bg-[#6940c9] text-white px-4 py-2.5 rounded-xl shadow-2xl border border-white/20 flex flex-col items-center gap-1.5 animate-bounce-subtle pointer-events-auto text-center ${step === 2 ? 'max-w-[400px] sm:max-w-md' : 'max-w-[280px] sm:max-w-xs'}`}>
          <span className="text-[9px] font-black tracking-[0.2em] uppercase opacity-50">Tutorial</span>
          <span className="text-xs font-bold leading-relaxed break-words">{getHintText()}</span>
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
