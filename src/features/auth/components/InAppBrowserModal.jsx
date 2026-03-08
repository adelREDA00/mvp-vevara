import React from 'react';
import { X, ExternalLink, Globe, Smartphone, CheckCircle2 } from 'lucide-react';
import { getPlatformHelp } from '../../../utils/inAppBrowser';

const InAppBrowserModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    const help = getPlatformHelp();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-[#0f1015]/80 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-[#1a1b23] border border-white/5 rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#6940c9] via-[#8b5cf6] to-[#6940c9]" />

                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 text-white/20 hover:text-white hover:bg-white/5 rounded-full transition-all"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="p-8 md:p-10">
                    <div className="w-16 h-16 bg-[#6940c9]/10 rounded-3xl flex items-center justify-center mb-8">
                        <Globe className="w-8 h-8 text-[#6940c9]" />
                    </div>

                    <h2 className="text-2xl font-semibold text-white mb-3">
                        External Browser Required
                    </h2>

                    <p className="text-white/40 text-[14px] leading-relaxed mb-8">
                        Google blocks sign-in from in-app browsers (like Instagram or TikTok) for your security. Please open this page in your system browser to continue.
                    </p>

                    <div className="space-y-6">
                        <div className="flex items-center gap-3 text-white/60 mb-2">
                            <Smartphone className="w-4 h-4" />
                            <span className="text-[12px] font-bold uppercase tracking-widest">How to on {help.platform}</span>
                        </div>

                        <div className="space-y-4">
                            {help.steps.map((step, index) => (
                                <div key={index} className="flex gap-4">
                                    <div className="w-6 h-6 rounded-full bg-[#6940c9]/20 flex items-center justify-center shrink-0 mt-0.5">
                                        <span className="text-[#6940c9] text-[11px] font-bold">{index + 1}</span>
                                    </div>
                                    <p className="text-white/60 text-[14px] leading-relaxed">
                                        {step.split('**').map((part, i) =>
                                            i % 2 === 1 ? <span key={i} className="text-white font-semibold">{part}</span> : part
                                        )}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-10 pt-8 border-t border-white/5">
                        <div className="flex items-start gap-4 p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                            <CheckCircle2 className="w-5 h-5 text-[#6940c9] shrink-0" />
                            <p className="text-[12px] text-white/30 leading-relaxed font-light">
                                Once opened in your system browser, you'll be able to sign in with Google instantly.
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full mt-8 bg-white/5 hover:bg-white/10 text-white font-medium py-4 rounded-2xl transition-all active:scale-[0.98] text-[15px]"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InAppBrowserModal;
