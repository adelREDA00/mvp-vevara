import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Folder, 
  Layout, 
  Play, 
  Plus, 
  X
} from 'lucide-react';

const SidebarItem = ({ icon: Icon, label, to, active }) => (
  <Link
    to={to}
    className={`flex flex-col items-center justify-center gap-1 w-full py-3.5 transition-all duration-200 group relative ${
      active 
        ? 'text-[var(--dashboard-accent)]' 
        : 'text-[var(--dashboard-text-muted)] hover:text-[var(--dashboard-text)]'
    }`}
  >
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[var(--dashboard-accent)] rounded-r-full" />}
    <Icon size={18} strokeWidth={active ? 2 : 1.5} className="transition-transform group-hover:scale-110" />
    <span className={`text-[9px] tracking-tight text-center ${active ? 'font-semibold' : 'font-medium opacity-80'}`}>{label}</span>
  </Link>
);

const DashboardSidebar = ({ onCreateProject, isOpen, onClose }) => {
  const location = useLocation();
  
  const navItems = [
    { icon: Layout, label: 'Templates', to: '/dashboard#templates' },
    { icon: Folder, label: 'Projects', to: '/dashboard#projects' },
    { icon: Play, label: 'How it works', to: '/dashboard#learn' }
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`w-[var(--sidebar-width)] h-screen fixed left-0 top-0 bg-[var(--dashboard-sidebar-bg)] py-6 flex flex-col items-center z-[101] transition-transform duration-300 lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex flex-col items-center gap-6 w-full mb-6">
          <Link to="/" className="w-10 h-10 bg-[var(--dashboard-accent)] rounded-xl flex items-center justify-center hover:scale-105 transition-transform">
            <span className="text-white font-bold text-2xl group-hover:rotate-12 transition-transform">v</span>
          </Link>
          
          <button
            onClick={() => {
              onCreateProject();
              if (window.innerWidth < 1024) onClose();
            }}
            className="group flex flex-col items-center gap-1 text-[var(--dashboard-text-muted)] hover:text-[#7c4af0] transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--dashboard-card-bg)] border border-[var(--dashboard-border)] flex items-center justify-center group-hover:border-[var(--dashboard-accent)]/50 transition-all">
              <Plus size={22} strokeWidth={2} />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-tight opacity-80">Create</span>
          </button>
        </div>

        <nav className="flex-1 w-full space-y-1">
          {navItems.map((item) => (
            <div key={item.label} onClick={() => window.innerWidth < 1024 && onClose()} className="w-full">
              <SidebarItem 
                {...item} 
                active={location.pathname === item.to || (location.hash && item.to.includes(location.hash))}
              />
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default DashboardSidebar;
