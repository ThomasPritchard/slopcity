import { useEffect, useRef, type ReactNode } from 'react';

export function CommunityDialog({ title, onClose, children, className = '' }: { title: string; onClose(): void; children: ReactNode; className?: string }) {
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(() => {
  const node = dialog.current!, previous = document.activeElement;
  node.showModal();
  return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('world')?.focus({ preventScroll: true }); };
 }, []);
 return <dialog ref={dialog} className={`community-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
  {children}
 </dialog>;
}
