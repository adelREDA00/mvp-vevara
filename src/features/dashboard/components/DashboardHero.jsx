import React, { useState } from 'react';
import { Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';
import api from '../../../api/client';

const DashboardHero = ({ userName }) => {
  const [feedback, setFeedback] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, success, error

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!feedback.trim() || status === 'loading') return;

    try {
      setStatus('loading');
      await api.post('/feedback', { text: feedback });
      setStatus('success');
      setFeedback('');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      console.error('Failed to send feedback:', error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <section className="relative pt-8 md:pt-12 pb-12 md:pb-20 px-1 md:px-8 flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Decorative floating elements with reduced visibility */}
      <div className="absolute top-10 left-10 w-24 h-24 bg-[#7c4af0]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '0s' }} />
      <div className="absolute bottom-10 right-10 w-32 h-32 bg-[#6940c9]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />

      <div className="relative z-10 w-full max-w-4xl mx-auto space-y-10">
        <h1 className="text-[22px] sm:text-4xl md:text-[56px] font-bold tracking-tighter md:tracking-tight text-[var(--dashboard-text)] leading-tight">
          Design anywhere, <span className="bg-gradient-to-r from-[var(--dashboard-accent)] to-[#c084fc] bg-clip-text text-transparent italic font-normal">Animate </span> here
        </h1>

        <div className="relative max-w-3xl mx-auto group">
          <form 
            onSubmit={handleSubmit}
            className="relative flex items-center bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] rounded-full px-4 md:px-8 py-3 md:py-5 transition-all duration-300 group-focus-within:border-[var(--dashboard-accent)] group-focus-within:ring-4 group-focus-within:ring-[var(--dashboard-accent)]/10 shadow-sm"
          >
            {status === 'success' ? (
              <div className="flex items-center justify-center w-full py-1 text-[var(--dashboard-accent)] animate-in fade-in zoom-in duration-300">
                <CheckCircle2 className="mr-2" size={20} />
                <span className="font-bold text-[14px] md:text-[16px]">Feedback received! Thank you.</span>
              </div>
            ) : (
              <>
                <Sparkles 
                  className={`${feedback.trim() ? 'text-[var(--dashboard-accent)]' : 'text-[var(--dashboard-text-muted)]'} mr-3 md:mr-4 group-focus-within:text-[var(--dashboard-accent)] transition-colors`} 
                  size={20} 
                />
                <input
                  type="text"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={status === 'loading'}
                  placeholder="Request a template, feature or bug..."
                  className="w-full bg-transparent border-none outline-none text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-text-muted)] text-[14px] md:text-[18px] font-medium"
                />
                <button 
                  type="submit"
                  disabled={!feedback.trim() || status === 'loading'}
                  className="bg-[var(--dashboard-accent)] text-white p-2 md:px-6 md:py-2.5 rounded-full font-bold text-sm ml-2 md:ml-4 hover:opacity-90 transition-all flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="hidden md:inline">
                    {status === 'loading' ? 'Sending...' : 'Submit Request'}
                  </span>
                  <ArrowRight className="md:ml-2" size={18} />
                </button>
              </>
            )}
          </form>

          <div className="flex justify-center mt-6">
            <a
              href="#dev-message"
              className="text-[12px] font-medium text-[#7c4af0] underline underline-offset-4 hover:text-[#6940c9] transition-colors"
            >
              Important: Read message from the developer
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DashboardHero;
