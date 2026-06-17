import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { selectTutorialState } from '../../../store/slices/tutorialSlice';
import { selectProjectName } from '../../../store/slices/projectSlice';

const TutorialOverlay = ({ isPlaying, manualTargetRect }) => {
  const { active, step } = useSelector(selectTutorialState);
  const projectName = useSelector(selectProjectName);
  
  const [targetRect, setTargetRect] = useState(null);
  const [hintPos, setHintPos] = useState({ top: 0, left: 0 });
  const [panelWidth, setPanelWidth] = useState(300);
  const [mobileBarHeight, setMobileBarHeight] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const requestRef = useRef();

  // Reset targetRect on step change to prevent stale highlights between steps
  useEffect(() => {
    setTargetRect(null);
  }, [step]);

  const updatePosition = useCallback(() => {
    const viewWidth = window.innerWidth;
    const margin = 16;
    const modalWidth = 280;

    // Detect mobile size
    const mobile = window.innerWidth < 1024;
    setIsMobile(mobile);

    // Measure right panel width dynamically
    const panelEl = document.querySelector('.editor-panel-container');
    if (panelEl) {
      setPanelWidth(panelEl.getBoundingClientRect().width);
    } else {
      setPanelWidth(300);
    }

    // Measure mobile motion bar container height dynamically - only apply if step is 1 (non-capture mode)
    const mobileBarEl = document.querySelector('[data-tutorial="mobile-motion-bar-container"]');
    if (mobileBarEl && step === 1) {
      setMobileBarHeight(mobileBarEl.getBoundingClientRect().bottom);
    } else {
      setMobileBarHeight(0);
    }

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

    // Selector update: Step 1 highlights Add Moment, Step 3 highlights Save Step
    let selector = '[data-tutorial="add-step-button"]';
    if (step === 1) {
      selector = '[data-tutorial="add-moment-button"]';
    }
    
    const buttonElements = document.querySelectorAll(selector);
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

      // Determine if button is at the bottom of the screen (e.g. mobile bottom vs top placement)
      const isAtBottom = rect.top > window.innerHeight / 2;
      // [ISSUE 4 FIX] On mobile the Add Moment button sits at the very bottom of the viewport.
      // 20px clearance was too tight — the hint tooltip overlapped the highlight ring.
      // Use 90px clearance on mobile so the tooltip has room to breathe above the button.
      const verticalOffset = isAtBottom ? (mobile ? 90 : 20) : 20;
      const top = isAtBottom ? rect.top - verticalOffset : rect.bottom + verticalOffset;
      const position = isAtBottom ? 'top' : 'bottom';

      setHintPos(prev => {
        let targetCenter = rect.left + rect.width / 2;
        const modalHalfWidth = 140;
        // [ISSUE 4 FIX] Use a tighter margin on mobile (20px) vs desktop (16px) so the
        // tooltip is clamped away from screen edges on small viewports.
        const clampMargin = mobile ? 20 : margin;
        const left = Math.max(modalHalfWidth + clampMargin, Math.min(viewWidth - modalHalfWidth - clampMargin, targetCenter));

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

  // Layout boundaries for the backdrop offset
  const backdropLeft = 0;
  const backdropTop = isMobile ? mobileBarHeight : 0;
  const backdropRight = isMobile ? 0 : panelWidth;
  const backdropBottom = 0;

  const clipPath = useMemo(() => {
    if (!targetRect || step === 3) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
    const pts = ['0px 0px', '100% 0px', '100% 100%', '0px 100%', '0px 0px'];
    const { x, y, width: w, height: h } = targetRect;

    // Translate screen coords to backdrop local coords
    const localX = x - backdropLeft;
    const localY = y - backdropTop;

    pts.push(`${localX}px ${localY}px`); // Bridge
    pts.push(`${localX}px ${localY + h}px`, `${localX + w}px ${localY + h}px`, `${localX + w}px ${localY}px`, `${localX}px ${localY}px`);
    pts.push('0px 0px'); // Bridge back
    return `polygon(${pts.join(', ')})`;
  }, [targetRect, step, isMobile, mobileBarHeight, panelWidth]);

  if (!active || step <= 0 || step > 3) return null;

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

  // Fallback: no target rect to highlight yet
  if (!targetRect) return null;

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
      {/* Dynamic Overlay Backdrop - Skip for Step 3 */}
      {step < 3 && (
        <div
          className="absolute bg-black/40 pointer-events-auto transition-[clip-path] duration-300"
          style={{
            left: `${backdropLeft}px`,
            top: `${backdropTop}px`,
            right: `${backdropRight}px`,
            bottom: `${backdropBottom}px`,
            clipPath,
            WebkitClipPath: clipPath,
          }}
        />
      )}

      {/* Interaction blockers during Step 1 (to block collapsed panel elements on desktop except add-moment-button) */}
      {step === 1 && !isMobile && (
        <div
          className="fixed right-0 top-0 bottom-0 z-[9999] bg-transparent pointer-events-auto"
          style={{ width: `${panelWidth}px`, clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 0px ${targetRect ? targetRect.y : 0}px, 0px ${targetRect ? targetRect.y + targetRect.height : 0}px, ${panelWidth}px ${targetRect ? targetRect.y + targetRect.height : 0}px, ${panelWidth}px ${targetRect ? targetRect.y : 0}px, 0px ${targetRect ? targetRect.y : 0}px)` }}
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
