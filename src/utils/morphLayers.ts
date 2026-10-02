// Shared-element morph between two stacked layouts of the same panel (used
// by the sidebar's expanded <-> collapsed switch). Elements tagged with the
// same data-morph key in both layouts glide from their old spot to their new
// one, resizing and blending color; everything else cross-fades. The old
// layout must still be mounted, at its old position, when this runs.
//
// Each shared element flies as a clone in `overlay` (above both layouts) so
// it stays fully visible while the layouts fade under it; the real copies are
// hidden until it lands. Returns a cleanup that ends everything at once
// (call it before starting another morph, or on unmount).

// Tailwind's ease-out, matching the sidebar's width transition.
export const MORPH_EASING = 'cubic-bezier(0, 0, 0.2, 1)';

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function morphLayers({
  from,
  to,
  overlay,
  duration,
}: {
  from: HTMLElement;
  to: HTMLElement;
  overlay: HTMLElement;
  duration: number;
}): () => void {
  // Reduced motion: switch instantly (the old layout is hidden at once).
  const ms = prefersReducedMotion() ? 0 : duration;
  const animations: Animation[] = [];
  const clones: Element[] = [];
  const hidden: (HTMLElement | SVGElement)[] = [];

  if (ms > 0) {
    const base = overlay.getBoundingClientRect();
    to.querySelectorAll<HTMLElement | SVGElement>('[data-morph]').forEach((target) => {
      const key = target.getAttribute('data-morph');
      const source = from.querySelector<HTMLElement | SVGElement>(`[data-morph="${key}"]`);
      if (!source) return;
      const a = source.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      if (!a.width || !a.height || !b.width || !b.height) return;

      const clone = source.cloneNode(true) as HTMLElement | SVGElement;
      clone.removeAttribute('data-morph');
      clone.removeAttribute('id');
      // Its own animations (spin/pulse) would fight the flight's transform.
      clone.classList.remove('animate-spin', 'animate-pulse');
      Object.assign(clone.style, {
        position: 'absolute',
        left: `${a.left - base.left}px`,
        top: `${a.top - base.top}px`,
        width: `${a.width}px`,
        height: `${a.height}px`,
        margin: '0',
        transformOrigin: '0 0',
      });
      overlay.appendChild(clone);
      clones.push(clone);

      // Icons take their color from their button (currentColor), which the
      // clone no longer sits in, so carry it over explicitly.
      animations.push(
        clone.animate(
          [
            { transform: 'none', color: getComputedStyle(source).color },
            {
              transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})`,
              color: getComputedStyle(target).color,
            },
          ],
          { duration: ms, easing: MORPH_EASING, fill: 'both' }
        )
      );
      source.style.visibility = 'hidden';
      target.style.visibility = 'hidden';
      hidden.push(source, target);
    });
  }

  // The old layout fades out quickly; the new one fades in as the panel
  // settles into its new size.
  animations.push(from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.5, easing: 'ease-out', fill: 'both' }));
  animations.push(
    to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.7, delay: ms * 0.3, easing: 'ease-out', fill: 'both' })
  );

  const land = () => {
    clones.forEach((clone) => clone.remove());
    clones.length = 0;
    hidden.forEach((el) => (el.style.visibility = ''));
    hidden.length = 0;
  };
  const timer = window.setTimeout(land, ms);

  return () => {
    window.clearTimeout(timer);
    land();
    animations.forEach((animation) => animation.cancel());
  };
}
