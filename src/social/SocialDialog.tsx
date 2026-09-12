import { useEffect, useRef, type ReactNode } from 'react';

/** Native top-layer dialogs stay above the WebGL canvas and cinema compositor. */
export function SocialDialog({ labelledBy, className = '', onClose, children }: { labelledBy: string; className?: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!, previous = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      else document.getElementById('world')?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`social-panel ${className}`} aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}>{children}</dialog>;
}
