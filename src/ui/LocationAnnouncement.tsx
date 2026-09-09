import { useEffect, useState } from 'react';
import './location.css';

/** Keyed by district at the call site so each arrival gets one short announcement. */
export function LocationAnnouncement({ name }: { name: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <section className="location" role="status" aria-live="polite">
    <span className="eyebrow">THE NEIGHBOURHOOD</span>
    <h1>{name}</h1>
    <span className="location-rule"/>
  </section>;
}
