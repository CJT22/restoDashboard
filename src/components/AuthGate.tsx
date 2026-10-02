import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import App from '../App';
import { LoginPage } from './LoginPage';
import { DashboardUser, getCurrentUser, onSignedOut, signOut, SIGNED_OUT_MESSAGES } from '../services/auth';

type AuthState =
  | { status: 'checking' }
  | { status: 'signedOut'; notice: string | null }
  | { status: 'signedIn'; user: DashboardUser };

// Shows the login page until this browser is signed in, then the dashboard.
// Goes back to the login page (with the reason) whenever any backend call
// reports the session is gone.
export const AuthGate: React.FC = () => {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setAuth(user ? { status: 'signedIn', user } : { status: 'signedOut', notice: null });
      })
      .catch((err) => {
        if (!cancelled) setAuth({ status: 'signedOut', notice: err?.message || "Can't reach the dashboard server." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onSignedOut((reason) =>
        setAuth((prev) => (prev.status === 'signedIn' ? { status: 'signedOut', notice: SIGNED_OUT_MESSAGES[reason] } : prev))
      ),
    []
  );

  const handleSignOut = async () => {
    await signOut();
    setAuth({ status: 'signedOut', notice: null });
  };

  if (auth.status === 'checking') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0b0c16]" aria-label="Loading">
        <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
      </div>
    );
  }
  if (auth.status === 'signedOut') {
    return <LoginPage notice={auth.notice} onSignedIn={(user) => setAuth({ status: 'signedIn', user })} />;
  }
  return <App user={auth.user} onSignOut={handleSignOut} />;
};
