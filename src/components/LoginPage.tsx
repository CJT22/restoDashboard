import React, { useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Info, AlertTriangle, Maximize2, Minimize2, User, Lock } from 'lucide-react';
import { DashboardUser, signIn } from '../services/auth';
import { useFullscreen } from '../utils/fullscreen';

interface LoginPageProps {
  onSignedIn: (user: DashboardUser) => void;
  // Why the dashboard came back here (e.g. signed in on another device).
  notice?: string | null;
}

// Staff sign in with their own restoAdmin account. Which accounts may sign
// in (role and branch) is decided by the backend (server/auth.ts); its
// message is shown as-is when it refuses one.
//
// Landscape screens get two halves: the Blue Moon brand on the left (logo in
// its glow, in a quiet night sky) fading into a navy panel with the form on
// the right. Narrow or portrait screens stack them.

// The same sky as the app's (login_page.dart): a fixed seed and the same
// generator, so both draw identical stars. Spread across the page, denser on
// the moon's side and thinning out to the right; a few brighter, a few in
// the logo's gold.
const STARS = (() => {
  let seed = 7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 160 }, () => ({
    x: Math.pow(next(), 1.35),
    y: next(),
    radius: 0.5 + next() * 0.9,
    opacity: 0.22 + next() * 0.5,
    gold: next() < 0.06,
    bright: next() < 0.08,
  }));
})();

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Drawn over the whole page, leaving out [keepOut] (the form and the logo
// block, with margins). It moves only if they do.
const StarField: React.FC<{ width: number; height: number; keepOut: Box[] }> = ({ width, height, keepOut }) => (
  <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none">
    {STARS.map((star, i) => {
      const cx = star.x * width;
      const cy = star.y * height;
      if (keepOut.some((b) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom)) return null;
      const color = star.gold ? '#f1c83e' : '#ffffff';
      const radius = star.bright ? star.radius + 0.5 : star.radius;
      return (
        <g key={i}>
          {star.bright && <circle cx={cx} cy={cy} r={radius * 4} fill={color} opacity={star.opacity * 0.15} />}
          <circle cx={cx} cy={cy} r={radius} fill={color} opacity={star.opacity} />
        </g>
      );
    })}
  </svg>
);

// A faint grain over the page, so the dark gradients don't step into
// visible bands.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const LoginPage: React.FC<LoginPageProps> = ({ onSignedIn, notice }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullscreen = useFullscreen();

  // Where the form and the logo block sit on the page, so the night sky
  // keeps clear of them. Measured from wrappers outside their entrance
  // animations (so, where they come to rest), and again whenever the page
  // or the form changes size (a notice or an error makes it taller).
  const pageRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [sky, setSky] = useState<{ width: number; height: number; keepOut: Box[] }>({ width: 0, height: 0, keepOut: [] });
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => {
      const p = page.getBoundingClientRect();
      const boxOf = (el: HTMLElement | null, clearance: number): Box[] => {
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [
          {
            left: r.left - p.left - clearance,
            top: r.top - p.top - clearance,
            right: r.right - p.left + clearance,
            bottom: r.bottom - p.top + clearance,
          },
        ];
      };
      // The form gets a wider margin than the logo, whose glow the stars may fill.
      setSky({ width: p.width, height: p.height, keepOut: [...boxOf(formRef.current, 28), ...boxOf(brandRef.current, 10)] });
    };
    // Things can move without anything observed changing size (the window
    // or fullscreen resizing the page, web fonts arriving), so re-measure on
    // those too, a moment later so layout has settled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remeasure = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 50);
    };
    measure();
    const observer = new ResizeObserver(remeasure);
    [page, brandRef.current, formRef.current].forEach((el) => el && observer.observe(el));
    window.addEventListener('resize', remeasure);
    void document.fonts?.ready.then(remeasure);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', remeasure);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onSignedIn(await signIn(username.trim(), password));
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Please try again.');
      setPassword('');
      setSubmitting(false);
    }
  };

  const inputClasses =
    'w-full h-[52px] pl-11 pr-4 rounded-xl bg-[#0e0f1a] border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors disabled:opacity-60';

  return (
    <div ref={pageRef} className="relative min-h-screen w-screen flex flex-col lg:flex-row bg-[#0b0c16] text-slate-100 font-sans overflow-hidden">
      {/* Fullscreen before signing in; the sidebar's toggle shares it. Off
          until tapped: browsers only allow it from a click. */}
      {fullscreen.supported && (
        <button
          type="button"
          onClick={fullscreen.toggle}
          className="absolute z-10 top-4 right-4 h-10 pl-[11px] pr-3.5 rounded-xl bg-[#141628]/90 border border-white/10 flex items-center gap-2 text-[13px] font-bold text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          {fullscreen.isFullscreen ? <Minimize2 className="w-4 h-4 text-slate-400" /> : <Maximize2 className="w-4 h-4 text-slate-400" />}
          {fullscreen.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      )}

      {/* Brand */}
      <section className="relative lg:basis-[55%] min-h-[44vh] lg:min-h-screen flex flex-col items-center justify-center px-8 pt-16 pb-14 lg:py-0 overflow-hidden">
        {/* The moon's glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(79,70,229,0.3),transparent_58%)] pointer-events-none" />

        <div ref={brandRef} className="relative">
        <div className="login-brand-in flex flex-col items-center text-center">
          {/* The Blue Moon badge (it spells out the name), set off from the
              dark page by a faint gold ring and halo. */}
          <div className="p-1.5 rounded-full border-[1.5px] border-[#f1c83e]/35 shadow-[0_0_64px_8px_rgba(99,102,241,0.38),0_0_22px_rgba(241,200,62,0.14)]">
            <img src="/blue-moon-logo.png" alt="Blue Moon" width={232} height={232} className="block w-40 h-40 lg:w-[232px] lg:h-[232px]" />
          </div>
          {/* "FLOOR DASHBOARD" in the logo's gold, between thin gold rules. */}
          <div className="mt-6 flex items-center justify-center gap-3">
            <span className="w-8 h-px bg-[#f1c83e]/40" />
            <span className="text-xs font-bold tracking-[0.24em] text-[#f1c83e]/85 uppercase">Floor Dashboard</span>
            <span className="w-8 h-px bg-[#f1c83e]/40" />
          </div>
          <p className="mt-3 text-sm text-slate-400">Tables, rooms and orders, live at a glance.</p>
        </div>
        </div>

        <div className="absolute bottom-5 left-8 text-[11px] text-slate-600">
          © {new Date().getFullYear()} 3CORE LeadersTech
        </div>
      </section>

      {/* Form: a navy panel the brand side's glow fades into, with no hard edge */}
      <section className="relative flex-1 lg:basis-[45%] flex items-center justify-center px-8 py-12 bg-[#141628]">
        <div aria-hidden="true" className="hidden lg:block absolute inset-y-0 -left-80 w-80 bg-gradient-to-r from-transparent to-[#141628] pointer-events-none" />
        <div aria-hidden="true" className="lg:hidden absolute inset-x-0 -top-36 h-36 bg-gradient-to-b from-transparent to-[#141628] pointer-events-none" />

        <div ref={formRef} className="relative w-full max-w-sm">
        <form onSubmit={handleSubmit} noValidate className="login-form-in flex flex-col gap-4">
          <div className="mb-2">
            <h1 className="text-[26px] font-bold text-white tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-400">Sign in with your restoAdmin account.</p>
          </div>

          {notice && !error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-username" className="text-xs font-semibold text-slate-400">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                className={inputClasses}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-xs font-semibold text-slate-400">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className={`${inputClasses} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-[52px] rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="flex items-start gap-2 text-[11px] leading-snug text-slate-500">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            Signing in here signs this account out on any other device.
          </p>
        </form>
        </div>
      </section>

      {/* A quiet night sky across the whole page: plentiful around the moon,
          thinning toward the form and never on it. */}
      <StarField {...sky} />

      <div aria-hidden="true" className="absolute inset-0 opacity-[0.05] pointer-events-none" style={{ backgroundImage: GRAIN }} />
    </div>
  );
};
