import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  ChevronRight,
  Plus,
  Star,
  CalendarDays,
  Bell,
  Repeat,
  Clock,
  BarChart3,
  Gavel,
  ArrowLeftRight,
  TrendingUp,
  Sparkles,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Brand mark                                                                 */
/* -------------------------------------------------------------------------- */

const Logo: React.FC = () => (
  <Link to="/" className="flex items-center gap-2.5">
    <svg width="38" height="38" viewBox="0 0 38 38" className="drop-shadow-md">
      <defs>
        <linearGradient id="sp-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d946ef" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="38" height="38" rx="11" fill="url(#sp-logo)" />
      <path
        d="M25 13.5c-1.4-1.5-3.6-2.4-6-2.4-3.6 0-6.2 1.9-6.2 4.6 0 5.4 11.4 3 11.4 8.4 0 2.7-2.8 4.6-6.4 4.6-2.4 0-4.6-.9-6-2.4"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="27" cy="11.5" r="2.4" fill="white" />
    </svg>
    <span className="text-xl font-extrabold tracking-tight text-[#160e2e]">
      Shift
      <span className="bg-gradient-to-r from-fuchsia-500 to-violet-600 bg-clip-text text-transparent">
        oPia
      </span>
    </span>
  </Link>
);

/* -------------------------------------------------------------------------- */
/*  Self-contained avatars (no external images)                                */
/* -------------------------------------------------------------------------- */

const AvatarNode: React.FC<{
  imgUrl?: string;
  initials?: string;
  ring: string;
  size?: 'lg' | 'sm';
}> = ({ imgUrl, initials, ring, size = 'lg' }) => {
  const dim = size === 'lg' ? 'h-14 w-14 text-sm' : 'h-9 w-9 text-[10px]';
  return (
    <div
      className={`${dim} rounded-full bg-gradient-to-br p-[2px] shadow-lg shadow-black/30 ${ring}`}
    >
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#241548] font-bold tracking-wide text-white">
        {imgUrl ? (
          <img src={imgUrl} alt="avatar" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </div>
    </div>
  );
};

const Tile: React.FC<{ icon: React.ReactNode; glowColor?: string }> = ({ icon, glowColor = '' }) => (
  <div className={`relative flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-white/20 bg-black/40 text-white shadow-xl backdrop-blur-md ${glowColor}`}>
    {icon}
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Orbital — fixed 480px stage so rings + nodes stay perfectly concentric;    */
/*  the whole stage scales responsively.                                       */
/* -------------------------------------------------------------------------- */

type OrbitItem =
  | { kind: 'avatar'; imgUrl?: string; initials?: string; ring: string }
  | { kind: 'tile'; icon: React.ReactNode; glowColor?: string };

const OrbitRing: React.FC<{
  radius: number;
  duration: number;
  reverse?: boolean;
  items: OrbitItem[];
}> = ({ radius, duration, reverse, items }) => (
  <motion.div
    className="absolute inset-0"
    animate={{ rotate: reverse ? -360 : 360 }}
    transition={{ duration, repeat: Infinity, ease: 'linear' }}
  >
    {items.map((item, i) => {
      const angle = (360 / items.length) * i;
      return (
        <div
          key={i}
          className="absolute left-1/2 top-1/2 w-0 h-0"
          style={{
            transform: `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`,
          }}
        >
          <motion.div
            className="-translate-x-1/2 -translate-y-1/2"
            animate={{ rotate: reverse ? 360 : -360 }}
            transition={{ duration, repeat: Infinity, ease: 'linear' }}
          >
            {item.kind === 'avatar' ? (
              <AvatarNode imgUrl={item.imgUrl} initials={item.initials} ring={item.ring} />
            ) : (
              <Tile icon={item.icon} glowColor={item.glowColor} />
            )}
          </motion.div>
        </div>
      );
    })}
  </motion.div>
);

const outerItems: OrbitItem[] = [
  { kind: 'avatar', imgUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d', ring: 'from-fuchsia-400 to-purple-500' },
  { kind: 'avatar', imgUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d', ring: 'from-amber-300 to-pink-400' },
  { kind: 'avatar', imgUrl: 'https://i.pravatar.cc/150?u=a04258114e29026702d', ring: 'from-sky-400 to-indigo-500' },
];

const innerItems: OrbitItem[] = [
  { kind: 'avatar', imgUrl: 'https://i.pravatar.cc/150?u=a048581f4e29026701d', ring: 'from-rose-400 to-fuchsia-500' },
  { kind: 'avatar', imgUrl: 'https://i.pravatar.cc/150?u=a04258114e29026302d', ring: 'from-violet-400 to-indigo-500' },
];

const Orbital: React.FC = () => (
  <div className="flex justify-center lg:justify-end">
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, ease: 'easeOut', delay: 0.2 }}
      className="relative h-[650px] w-[650px] origin-center scale-[0.6] sm:scale-75 md:scale-90 lg:scale-100"
    >
      {/* concentric guide rings (radii match the orbit radii) */}
      <div className="absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.08]" />
      <div className="absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.12]" />
      <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.12]" />

      {/* glow / "Sun" */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="h-56 w-56 rounded-full bg-fuchsia-500/30 blur-[60px]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="h-32 w-32 rounded-full bg-amber-200/20 blur-3xl" />
      </div>

      {/* centre stat */}
      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="text-center pointer-events-auto"
        >
          <div className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-[4.5rem] font-extrabold leading-none tracking-tight text-transparent drop-shadow-[0_0_40px_rgba(217,70,239,0.8)]">
            50K+
          </div>
          <div className="mt-2 text-base font-semibold text-white/80 uppercase tracking-widest drop-shadow-md animate-pulse">
            Shifts orchestrated
          </div>
        </motion.div>
      </div>

      <OrbitRing radius={320} duration={60} items={outerItems} />
      <OrbitRing radius={240} duration={45} reverse items={innerItems} />
    </motion.div>
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Capability dock — premium glass dock with an animated "+" expander         */
/* -------------------------------------------------------------------------- */

const baseCaps = [
  { label: 'Rostering', icon: CalendarDays },
  { label: 'Bidding', icon: Gavel },
  { label: 'Trading', icon: ArrowLeftRight },
  { label: 'KPIs', icon: BarChart3 },
];
const extraCaps = [
  { label: 'Demand Forecast', icon: TrendingUp },
  { label: 'AI Scheduling', icon: Sparkles },
];

const CapItem: React.FC<{
  label: string;
  icon: React.ElementType;
  accent?: boolean;
}> = ({ label, icon: Icon, accent }) => (
  <div className="flex items-center gap-3 whitespace-nowrap px-4 py-2 transition-transform hover:scale-105 duration-200">
    <Icon
      className={`h-7 w-7 transition-all ${
        accent
          ? 'text-fuchsia-400 drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]'
          : 'text-fuchsia-200/90 hover:text-white hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]'
      }`}
    />
    <span className="text-lg font-semibold text-white/90 drop-shadow-md">{label}</span>
  </div>
);

const CapabilityDock: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="flex items-center gap-4 flex-wrap justify-center w-full"
    >
      {baseCaps.map((c) => (
        <motion.div layout key={c.label}>
          <CapItem {...c} />
        </motion.div>
      ))}

      <AnimatePresence mode="popLayout">
        {open &&
          extraCaps.map((c, i) => (
            <motion.div
              layout
              key={c.label}
              initial={{ opacity: 0, scale: 0.7, width: 0 }}
              animate={{ opacity: 1, scale: 1, width: 'auto' }}
              exit={{ opacity: 0, scale: 0.7, width: 0 }}
              transition={{ duration: 0.3, delay: open ? i * 0.07 : 0 }}
              className="overflow-hidden"
            >
              <CapItem {...c} accent />
            </motion.div>
          ))}
      </AnimatePresence>

      <motion.button
        layout
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Show fewer' : 'Show more capabilities'}
        whileTap={{ scale: 0.9 }}
        className="ml-2 flex h-12 w-12 shrink-0 items-center justify-center text-white transition-colors hover:text-fuchsia-300"
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.25 }}>
          <Plus className="h-7 w-7" />
        </motion.span>
      </motion.button>
    </motion.div>
  );
};

/* -------------------------------------------------------------------------- */
/*  Social proof                                                               */
/* -------------------------------------------------------------------------- */

const proofAvatars = [
  { initials: 'AK', imgUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d', ring: 'from-fuchsia-400 to-purple-500' },
  { initials: 'MR', imgUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d', ring: 'from-amber-300 to-pink-400' },
  { initials: 'JL', imgUrl: 'https://i.pravatar.cc/150?u=a04258114e29026702d', ring: 'from-sky-400 to-indigo-500' },
  { initials: 'SP', imgUrl: 'https://i.pravatar.cc/150?u=a048581f4e29026701d', ring: 'from-rose-400 to-fuchsia-500' },
];

const SocialProof: React.FC = () => (
  <div className="flex items-center gap-4">
    <div className="flex -space-x-3">
      {proofAvatars.map((a) => (
        <div key={a.initials} className="ring-2 ring-[#5a3b9e] rounded-full">
          <AvatarNode imgUrl={a.imgUrl} initials={a.initials} ring={a.ring} size="sm" />
        </div>
      ))}
    </div>
    <div>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
        ))}
      </div>
      <p className="mt-0.5 text-sm text-white/75">
        Trusted by <span className="font-semibold text-white">2,500+ staff</span>{' '}
        across ICC Sydney & leading venues
      </p>
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */

const Index: React.FC = () => {
  return (
    <div
      className="flex min-h-screen w-full flex-col overflow-hidden font-sans"
      style={{
        background:
          'radial-gradient(125% 125% at 0% 0%, #f6dcb8 0%, #e7c2dd 16%, #c69ae4 30%, #8a5fc8 44%, #3b2570 64%, #140d2c 84%, #0b0718 100%)',
      }}
    >
      {/* ---- Navigation ---- */}
      <motion.nav
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-20 mx-auto flex w-full max-w-[1500px] items-center justify-between px-8 py-6 lg:px-16"
      >
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden rounded-full px-5 py-2.5 text-[15px] font-semibold text-[#1a1130] transition-colors hover:text-black sm:block"
          >
            Log In
          </Link>
          <Link
            to="/signup"
            className="rounded-full bg-[#140d2c] border border-purple-500/30 px-6 py-2.5 text-[15px] font-semibold text-white shadow-[0_0_20px_rgba(168,85,247,0.6)] transition-all hover:scale-[1.03] hover:shadow-[0_0_30px_rgba(168,85,247,0.8)] active:scale-95"
          >
            Get Started
          </Link>
        </div>
      </motion.nav>

      {/* ---- Hero ---- */}
      <main className="relative z-10 mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 items-center gap-10 px-8 py-8 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:px-16">
        {/* Left column */}
        <div className="relative max-w-2xl text-left">
          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="text-[clamp(3.5rem,6vw,5.5rem)] font-medium leading-[1.08] tracking-tight text-[#160e2e]"
          >
            <span className="text-white drop-shadow-md">Stop Chasing Shifts.</span>{' '}
            <span className="text-fuchsia-200/90 drop-shadow-md">
              Start Managing Teams.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="mt-6 max-w-md text-lg leading-relaxed text-[#2a1d45]/75"
          >
            Create rosters, manage shift swaps, track compliance, and keep your
            workforce aligned from one intelligent platform.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center"
          >
            <div className="relative">
              <Link
                to="/signup"
                className="group inline-flex w-fit items-center gap-3 rounded-full bg-[#140d2c] border border-purple-500/20 px-8 py-4 text-[17px] font-semibold text-white shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all hover:scale-[1.03] hover:shadow-[0_0_25px_rgba(168,85,247,0.4)] active:scale-95"
              >
                Start Scheduling
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>

              {/* Multiplayer Cursor Mockup for ICC Sydney */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8, x: 20, y: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6, type: 'spring' }}
                className="absolute left-[200px] top-[38px] flex items-start gap-1 pointer-events-none select-none z-20"
              >
                {/* Purple cursor arrow */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-violet-500 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] shrink-0">
                  <path
                    d="M3 3L10.5 21L13.5 13.5L21 10.5L3 3Z"
                    fill="currentColor"
                  />
                </svg>
                
                {/* Pill */}
                <div className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[14px] font-semibold text-white shadow-lg shadow-purple-500/25 border border-white/20 backdrop-blur-md whitespace-nowrap">
                  {/* ICC Sydney geometric logo */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
                    <path d="M2 20L10 4L14 11L7 20H2Z" fill="#ff5a00" />
                    <path d="M7 20L14 11L18 17L16 20H7Z" fill="#e6007e" />
                    <path d="M16 20L18 17L20 20H16Z" fill="#00a0e9" />
                  </svg>
                  <span>ICC Sydney</span>
                </div>
              </motion.div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.42 }}
            className="mt-8"
          >
            <SocialProof />
          </motion.div>
        </div>

        {/* Right column — orbital */}
        <Orbital />
      </main>

      {/* ---- Capability dock (bottom, seamless) ---- */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="relative z-10 flex w-full justify-center px-6 pb-10 pt-2"
      >
        <CapabilityDock />
      </motion.div>
    </div>
  );
};

export default Index;
