import { useEffect, useState } from 'react';

// Fullscreen API with the webkit-prefixed fallback older iPadOS Safari needs.
// iPhone Safari doesn't support element fullscreen at all, so there the
// toggles are hidden rather than shown as dead controls.
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const isFullscreenSupported = () => {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
};
const getFullscreenElement = () => {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};
const enterFullscreen = () => {
  const el = document.documentElement as WebkitElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  return el.webkitRequestFullscreen?.();
};
const exitFullscreen = () => {
  const doc = document as WebkitDocument;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  return doc.webkitExitFullscreen?.();
};

// Fullscreen covers the whole page, so the sign-in page's toggle and the
// sidebar's share the browser's one state: it carries over across signing in.
// Browsers only allow entering it from a click, so the web version always
// starts out of fullscreen. State follows the browser's change event, so
// leaving via Esc or a back gesture updates every toggle.
export function useFullscreen() {
  const [supported] = useState<boolean>(isFullscreenSupported);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => getFullscreenElement() !== null);
  useEffect(() => {
    if (!supported) return;
    const onChange = () => setIsFullscreen(getFullscreenElement() !== null);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [supported]);
  const toggle = () => {
    const result = getFullscreenElement() !== null ? exitFullscreen() : enterFullscreen();
    Promise.resolve(result).catch(() => {
      // Browser refused (e.g. permissions policy) - leave the state as-is.
    });
  };
  return { supported, isFullscreen, toggle };
}
