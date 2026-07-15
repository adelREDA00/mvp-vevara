import React from 'react';

const DashboardHero = ({ title, subtitle }) => {
  return (
    <section className="relative pt-12 md:pt-16 pb-6 md:pb-8 px-1 md:px-8 flex flex-col items-center justify-center text-center overflow-hidden select-none">
      {/* Decorative floating elements */}
      <div className="absolute top-10 left-10 w-24 h-24 bg-[#7c4af0]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '0s' }} />
      <div className="absolute bottom-10 right-10 w-32 h-32 bg-[#6940c9]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />

      <div className="relative z-10 w-full max-w-5xl mx-auto mb-2">
        <h1 className="text-[32px] sm:text-5xl md:text-[60px] font-extrabold tracking-tight text-[var(--dashboard-text)] leading-[1.15] max-w-4xl mx-auto">
          {title}
        </h1>
        {/* {subtitle && (
          <p className="text-zinc-500 dark:text-zinc-400 text-sm md:text-base mt-4 max-w-xl mx-auto font-medium leading-relaxed">
            {subtitle}
          </p>
        )} */}
      </div>
    </section>
  );
};

export default DashboardHero;
