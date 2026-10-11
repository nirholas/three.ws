export const SITE_VARIANT: string = (() => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('hq-variant');
    if (stored === 'tech' || stored === 'full') return stored;
  }
  return import.meta.env.VITE_VARIANT || 'full';
})();
