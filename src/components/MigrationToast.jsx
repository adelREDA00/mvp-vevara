import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, Check } from 'lucide-react'

/**
 * Migration floating toast — compact, polished notification.
 * Purple background (#7c4af0), horizontal progress, action buttons.
 */
export default function MigrationToast({
    isActive,
    progress,
    total,
    currentItem,
    errors,
    completed,
    failed,
    hasProjects = true,
    hasAssets = false,
    onCancel,
    onRetry,
    onDismiss,
}) {
    const [visible, setVisible] = useState(false)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        if ((isActive || completed || failed) && !dismissed) {
            requestAnimationFrame(() => setVisible(true))
        } else {
            setVisible(false)
        }
    }, [isActive, completed, failed, dismissed])

    if (!isActive && !completed && !failed) return null
    if (dismissed) return null

    const percent = total > 0 ? Math.round((progress / total) * 100) : 0

    const handleDismiss = () => {
        setVisible(false)
        setTimeout(() => {
            setDismissed(true)
            onDismiss?.()
        }, 300)
    }

    return createPortal(
        <div
            className="fixed z-[99999] transition-all duration-300 ease-out"
            style={{
                bottom: '24px',
                right: '24px',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(12px)',
                pointerEvents: visible ? 'auto' : 'none',
            }}
        >
            <div
                className="rounded-2xl shadow-xl border border-white/10 overflow-hidden"
                style={{
                    backgroundColor: '#01B2FD',
                    minWidth: '320px',
                    maxWidth: '380px',
                }}
            >
                <div className="px-5 py-4">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                            {!completed && !failed && (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0 mt-0.5" />
                            )}
                            {completed && !failed && (
                                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                                </div>
                            )}
                            {failed && (
                                <RefreshCw className="h-5 w-5 text-white/80 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="min-w-0">
                                <p className="text-[14px] font-semibold text-white leading-tight truncate">
                                    {completed 
                                        ? 'All done' 
                                        : failed 
                                            ? (!hasProjects && hasAssets ? "Couldn't move assets" : "Couldn't move projects")
                                            : (!hasProjects && hasAssets ? 'Moving your assets to your account' : 'Moving your projects to your account')
                                    }
                                </p>
                                {!completed && !failed && currentItem && (
                                    <p className="text-[12px] text-white/50 truncate mt-0.5">{currentItem}</p>
                                )}
                                {completed && (
                                    <p className="text-[12px] text-white/50 mt-0.5">
                                        {!hasProjects && hasAssets 
                                            ? 'Your assets have been transferred successfully.' 
                                            : errors.length > 0 
                                                ? `${progress} moved, ${errors.length} skipped`
                                                : `${progress} projects moved successfully`
                                        }
                                    </p>
                                )}
                                {failed && (
                                    <p className="text-[12px] text-white/50 mt-0.5">
                                        {errors.length > 0 
                                            ? `${errors.length} item(s) had issues` 
                                            : (!hasProjects && hasAssets ? 'Please try uploading assets again' : 'Please try again')
                                        }
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                            {!completed && !failed && (
                                <button
                                    onClick={() => { setDismissed(true); onCancel?.() }}
                                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors text-white/60 hover:text-white"
                                    title="Cancel"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                            {failed && onRetry && (
                                <button
                                    onClick={onRetry}
                                    className="h-7 px-3 rounded-lg hover:bg-white/15 transition-colors text-white/80 hover:text-white flex items-center gap-1.5 text-[12px] font-semibold"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Retry
                                </button>
                            )}
                            {completed && (
                                <button
                                    onClick={handleDismiss}
                                    className="h-7 px-4 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white text-[12px] font-bold flex items-center"
                                >
                                    Done
                                </button>
                            )}
                        </div>
                    </div>
 
                    {/* Progress bar */}
                    <div className="h-[4px] w-full bg-white/15 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500 ease-out bg-white"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
 
                    {/* Bottom label */}
                    <div className="flex items-center justify-between mt-2.5">
                        <span className="text-[11px] font-medium text-white/40">
                            {failed 
                                ? (!hasProjects && hasAssets ? 'Your assets are kept locally' : 'Your projects are kept locally') 
                                : completed 
                                    ? 'All moved to your account' 
                                    : `${progress}/${total} ${!hasProjects && hasAssets ? 'assets' : 'items'}`
                            }
                        </span>
                        {!completed && !failed && (
                            <span className="text-[11px] font-bold text-white/60">{percent}%</span>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}