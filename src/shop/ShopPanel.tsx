import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import './shop.css';

export interface ShopPanelProps {
  open: boolean;
  mode: 'shop' | 'wardrobe';
  balance: number;
  items: Array<{
    id: string;
    name: string;
    slot: 'top' | 'bottoms' | 'shoes';
    price: number;
    colour: string;
    description: string;
  }>;
  owned: string[];
  equipped: { top: string; bottoms: string; shoes: string };
  selectedId: string;
  busy: boolean;
  error: string;
  notice: string;
  onSelect(id: string): void;
  onBuy(id: string): void;
  onEquip(id: string): void;
  onClose(): void;
  onRotate(direction: number): void;
  onFrame(view: 'face' | 'outfit' | 'shoes'): void;
}

const categories = [
  { id: 'all', label: 'All' },
  { id: 'top', label: 'Tops' },
  { id: 'bottoms', label: 'Trousers' },
  { id: 'shoes', label: 'Shoes' },
] as const;
type Category = typeof categories[number]['id'];

function ClothingIcon({ slot, colour }: { slot: 'top' | 'bottoms' | 'shoes'; colour: string }) {
  return <svg width="56" height="56" viewBox="0 0 64 64" fill={colour} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    {slot === 'top' ? <>
      <path d="m23 9-12 7-7 20 11 4 6-14v29h22V26l6 14 11-4-7-20-12-7-9 5-9-5Z" />
      <path d="m23 9 9 13 9-13M32 22v33M24 31h5M35 31h5" fill="none" strokeOpacity=".55" />
    </> : slot === 'bottoms' ? <>
      <path d="M18 8h28l-2 47H32l-1-29-3 29H16l2-47Z" />
      <path d="M18 16h28M31 16v10M22 16l-1 7M41 16l1 7" fill="none" strokeOpacity=".55" />
    </> : <>
      <path d="m10 21 13 2 9 10 13 4c6 1 9 5 9 10H7V32l3-11Z" />
      <path d="M7 42h46M27 29l-7 3M31 33l-6 3M35 36l-6 3M10 21l8 9" fill="none" strokeOpacity=".55" />
    </>}
  </svg>;
}

function TurnIcon({ right = false }: { right?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={right ? { transform: 'scaleX(-1)' } : undefined}><path d="M5 9a8 8 0 1 1-1 8M5 3v6h6" /></svg>;
}

export function ShopPanel({ open, mode, balance, items, owned, equipped, selectedId, busy, error, notice, onSelect, onBuy, onEquip, onClose, onRotate, onFrame }: ShopPanelProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  const [category, setCategory] = useState<Category>('all');
  const titleId = useId();
  const catalogueId = useId();
  const tabsId = useId();

  useEffect(() => { closeAction.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    setCategory('all');
    const previousFocus = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAction.current();
      } else if (event.key === 'Tab' && overlay.current) {
        const buttons = [...overlay.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])')]
          .filter(button => button.getClientRects().length > 0);
        const first = buttons[0], last = buttons[buttons.length - 1];
        const outside = !overlay.current.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const restoreTarget = previousFocus instanceof HTMLElement && previousFocus.isConnected ? previousFocus : document.getElementById('world');
      restoreTarget?.focus({ preventScroll: true });
    };
  }, [open]);

  function changeTab(event: ReactKeyboardEvent<HTMLButtonElement>, current: Category) {
    const index = categories.findIndex(tab => tab.id === current);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % categories.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + categories.length - 1) % categories.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = categories.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setCategory(categories[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  if (!open) return null;

  const wardrobe = mode === 'wardrobe';
  const availableItems = items.filter(item => !wardrobe || owned.includes(item.id));
  const shownItems = availableItems.filter(item => category === 'all' || item.slot === category);
  const selected = availableItems.find(item => item.id === selectedId);
  const isOwned = selected ? owned.includes(selected.id) : false;
  const isEquipped = selected ? equipped[selected.slot] === selected.id : false;
  const canAfford = selected ? balance >= selected.price : false;

  return <div ref={overlay} className="shop-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="shop-preview-heading" aria-hidden="true"><span className="eyebrow">THE FITTING ROOM</span><h2>{wardrobe ? <>Make it <em>your own.</em></> : <>Find your<br/><em>next favourite.</em></>}</h2><p>Take a look. Take a turn.</p></div>

    <section className="shop-panel">
      <header className="shop-header">
        <div><span className="eyebrow">{wardrobe ? 'YOUR COLLECTION' : 'THE CLOTHING SHOP'}</span><h2 id={titleId}>{wardrobe ? 'Your wardrobe.' : 'Form & Thread'}</h2></div>
        <button ref={closeButton} type="button" className="shop-close" aria-label={wardrobe ? 'Close wardrobe' : 'Leave clothing shop'} onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        <div className="shop-balance"><span>{wardrobe ? `${availableItems.length} pieces in your wardrobe` : 'Select a piece to try it on.'}</span><strong>{balance.toLocaleString('en-GB')} <span>credits</span></strong></div>
      </header>

      <div className="shop-tabs" role="tablist" aria-label="Clothing categories">
        {categories.map(tab => <button key={tab.id} id={`${tabsId}-${tab.id}`} type="button" role="tab" aria-selected={category === tab.id} aria-controls={catalogueId} tabIndex={category === tab.id ? 0 : -1} onClick={() => setCategory(tab.id)} onKeyDown={event => changeTab(event, tab.id)}>{tab.label}</button>)}
      </div>

      <div className="shop-catalogue" role="tabpanel" id={catalogueId} aria-labelledby={`${tabsId}-${category}`}>
        {shownItems.length > 0 ? <ul className="shop-items">
          {shownItems.map(item => {
            const wearing = equipped[item.slot] === item.id;
            const itemOwned = owned.includes(item.id);
            return <li key={item.id}><button type="button" className="shop-item" disabled={busy} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
              <span className="shop-item-art"><ClothingIcon slot={item.slot} colour={item.colour} /><span className="shop-colour-dot" style={{ background: item.colour }} /></span>
              <strong>{item.name}</strong><span className={`shop-item-state${wearing ? ' is-wearing' : ''}`}>{wearing ? 'Wearing' : itemOwned ? 'Owned' : item.price === 0 ? 'Complimentary' : `${item.price.toLocaleString('en-GB')} credits`}</span>
            </button></li>;
          })}
        </ul> : <p className="shop-empty">{wardrobe ? 'No pieces in this part of your wardrobe yet.' : 'No pieces in this collection yet.'}</p>}
      </div>

      <footer className="shop-selection">
        {selected ? <>
          <div className="shop-selection-title"><h3>{selected.name}</h3><span>{isEquipped ? 'CURRENTLY WEARING' : 'TRYING ON'}</span></div>
          <p className="shop-description">{selected.description}</p>
          <button type="button" className="shop-action" disabled={busy || isEquipped || (!isOwned && !canAfford)} onClick={() => isOwned ? onEquip(selected.id) : onBuy(selected.id)}>
            {busy ? 'One moment…' : isEquipped ? 'Wearing this' : isOwned ? 'Wear this' : !canAfford ? 'Not enough credits' : selected.price === 0 ? 'Add to wardrobe' : `Buy for ${selected.price.toLocaleString('en-GB')} credits`}
            {!busy && !isEquipped && (isOwned || canAfford) && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>}
          </button>
          <p className="shop-selection-note">{isEquipped ? 'Part of your current outfit.' : isOwned ? 'Just trying it on. Choose Wear this to keep it on.' : !canAfford ? `Just trying it on. You need ${(selected.price - balance).toLocaleString('en-GB')} more credits to own it.` : selected.price === 0 ? 'Add it to your wardrobe, then choose Wear this.' : 'Buying adds it to your wardrobe. Choose Wear this afterwards.'}</p>
        </> : <p className="shop-empty">Choose a piece to try on.</p>}
        {notice && <p className="shop-notice" role="status">{notice}</p>}
        {error && <p className="shop-error" role="alert">{error}</p>}
      </footer>
    </section>

    <div className="shop-preview-controls" role="group" aria-label="Character preview controls">
      <button type="button" className="shop-turn" aria-label="Rotate character left" onClick={() => onRotate(-1)}><TurnIcon /></button>
      <div className="shop-frame-controls" role="group" aria-label="Character view"><button type="button" aria-label="View face" onClick={() => onFrame('face')}>Face</button><button type="button" aria-label="View outfit" onClick={() => onFrame('outfit')}>Outfit</button><button type="button" aria-label="View shoes" onClick={() => onFrame('shoes')}>Shoes</button></div>
      <button type="button" className="shop-turn" aria-label="Rotate character right" onClick={() => onRotate(1)}><TurnIcon right /></button>
    </div>
  </div>;
}
