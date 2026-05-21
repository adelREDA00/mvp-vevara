import React from 'react';

const DashboardHero = ({ userName }) => {
  return (
    <section className="relative pt-12 md:pt-20 pb-8 md:pb-12 px-1 md:px-8 flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Decorative floating elements with reduced visibility */}
      <div className="absolute top-10 left-10 w-24 h-24 bg-[#7c4af0]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '0s' }} />
      <div className="absolute bottom-10 right-10 w-32 h-32 bg-[#6940c9]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />

      <div className="relative z-10 w-full max-w-5xl mx-auto mb-4 md:mb-8">
        <h1 className="text-[28px] sm:text-5xl md:text-[68px] font-bold tracking-tight text-[var(--dashboard-text)] leading-[1.1] max-w-4xl mx-auto">
          What are you<br className="hidden md:block" />
          <span className="bg-gradient-to-r from-[var(--dashboard-accent)] to-[#c084fc] bg-clip-text text-transparent italic font-normal"> making </span> today?

        </h1>
      </div>
    </section>
  );
};

export default DashboardHero;
