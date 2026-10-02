import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Info, AlertTriangle } from 'lucide-react';
import { DashboardUser, signIn } from '../services/auth';

interface LoginPageProps {
  onSignedIn: (user: DashboardUser) => void;
  // Why the dashboard came back here (e.g. signed in on another device).
  notice?: string | null;
}

// Staff sign in with their own restoAdmin account. Which accounts may sign
// in (role and branch) is decided by the backend (server/auth.ts); its
// message is shown as-is when it refuses one.
export const LoginPage: React.FC<LoginPageProps> = ({ onSignedIn, notice }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    'w-full h-12 px-4 rounded-xl bg-[#0e0f1a] border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20 transition-colors disabled:opacity-60';

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#0b0c16] text-slate-100 font-sans p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-xl font-bold tracking-wide text-white uppercase">Blue Moon</div>
          <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Floor Dashboard</div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-[#16182c] border border-white/10 rounded-3xl shadow-2xl p-6 flex flex-col gap-4"
        >
          <h1 className="text-base font-bold text-white">Sign in</h1>

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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-xs font-semibold text-slate-400">
              Password
            </label>
            <div className="relative">
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
                className="absolute right-1 top-1 w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
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
            className="h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 px-2 text-center text-[11px] leading-relaxed text-slate-500">
          Use your restoAdmin account. Signing in here signs that account out on any other device.
        </p>
      </div>
    </div>
  );
};
