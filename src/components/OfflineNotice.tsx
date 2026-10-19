import React, { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { ConnectionStatus, getConnectionStatus, subscribeToConnectionStatus } from '../services/adminSync';

// Whether order changes can reach restoAdmin right now: not while the
// sidebar's connection badge says Offline or restoAdmin offline. The web
// dashboard then asks for a connection; only the tablet app saves order
// changes to send later (mobile/lib/state/offline_queue.dart), since a
// browser tab offline can't even reload the page.
export function isOnline(status: ConnectionStatus): boolean {
  return status !== 'offline' && status !== 'adminOffline';
}

export function useOnline(): boolean {
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);
  useEffect(() => subscribeToConnectionStatus(setStatus), []);
  return isOnline(status);
}

// Shown on the order screens and a zone's detail while offline, in the
// tablet app's notice colours (OfflineNotice in mobile/lib/ui/common.dart).
export const OfflineNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-300 flex items-start gap-2">
    <CloudOff className="w-4 h-4 shrink-0" />
    <div>{children}</div>
  </div>
);

export const NEEDS_CONNECTION_TEXT =
  "Offline. Orders can't be changed from this browser until the dashboard reconnects; it retries by itself.";
