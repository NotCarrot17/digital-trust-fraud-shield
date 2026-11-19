import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Home, FolderDown, PhoneCall, ShieldCheck, Shield, MessageCircleHeart } from 'lucide-react';
import { useAssistant } from '@/components/AssistantChat';

const NAV_ITEMS = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Downloads', href: '/downloads', icon: FolderDown },
  { label: 'Calls', href: '/calls', icon: PhoneCall },
  { label: 'Safety', href: '/checks', icon: ShieldCheck },
];

const TEXT_SIZE_KEY = 'silver-shield-text-size';

function readTextSize(): number {
  const stored = Number(localStorage.getItem(TEXT_SIZE_KEY));
  return stored === 18 || stored === 20 || stored === 16 ? stored : 16;
}

export const ShieldNav: React.FC = () => {
  const [location] = useLocation();
  const [textSize, setTextSize] = useState(16);
  const { open: openAssistant } = useAssistant();

  useEffect(() => {
    const size = readTextSize();
    setTextSize(size);
    document.documentElement.style.fontSize = `${size}px`;
  }, []);

  const changeTextSize = (size: number) => {
    setTextSize(size);
    localStorage.setItem(TEXT_SIZE_KEY, String(size));
    document.documentElement.style.fontSize = `${size}px`;
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/">
            <div className="flex cursor-pointer items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                <Shield size={26} strokeWidth={2.4} />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-xl font-extrabold tracking-tight text-slate-900">Silver Shield</span>
                <span className="text-sm font-medium text-slate-500">Your safety companion</span>
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const active = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition-colors ${
                      active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon size={20} strokeWidth={2.2} />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 rounded-xl border border-slate-200 px-1 py-1 sm:flex" aria-label="Text size">
              <button
                type="button"
                onClick={() => changeTextSize(Math.max(16, textSize - 2))}
                className="h-10 w-10 rounded-lg text-lg font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                disabled={textSize <= 16}
                aria-label="Smaller text"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => changeTextSize(Math.min(20, textSize + 2))}
                className="h-10 w-10 rounded-lg text-xl font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                disabled={textSize >= 20}
                aria-label="Larger text"
              >
                A+
              </button>
            </div>
            <button
              type="button"
              onClick={openAssistant}
              className="hidden items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white hover:bg-slate-800 md:flex"
            >
              <MessageCircleHeart size={20} />
              Ask for help
            </button>
          </div>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main navigation"
      >
        <div className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex cursor-pointer flex-col items-center gap-1 py-3 text-sm font-semibold ${
                    active ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  <Icon size={24} strokeWidth={active ? 2.6 : 2} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default ShieldNav;
