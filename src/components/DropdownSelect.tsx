import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption {
  value: number;
  label: string;
}

interface Props {
  label: string;
  value: number | null;
  options: DropdownOption[];
  onChange: (value: number) => void;
  searchable?: boolean;
  emptyText?: string;
  width?: number;
}

export function DropdownSelect({ label, value, options, onChange, searchable, emptyText = '—', width }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState<number>(-1);
  const [listStyle, setListStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Reset highlight to current value's index (or 0) when filtered list changes
  useEffect(() => {
    const idx = filtered.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : filtered.length > 0 ? 0 : -1);
  }, [filtered.length, search, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // On open: center the current selection in the list
  useEffect(() => {
    if (!open || !optionsRef.current || highlighted < 0) return;
    const item = optionsRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'center' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // On arrow navigation: keep highlighted item visible (nearest, not center)
  useEffect(() => {
    if (!open || !optionsRef.current || highlighted < 0) return;
    const item = optionsRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]); // eslint-disable-line react-hooks/exhaustive-deps

  const openList = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setListStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        minWidth: Math.max(rect.width, 220),
      });
    }
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const commit = (idx: number) => {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(highlighted);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, highlighted, filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dropdown-select">
      <button ref={triggerRef} type="button" className={`dropdown-trigger${open ? ' open' : ''}`} style={width != null ? { width } : undefined} onClick={openList}>
        <span className="dropdown-trigger-label">{label}</span>
        <span className="dropdown-trigger-value">{selected?.label ?? emptyText}</span>
        <span className="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>

      {open && createPortal(
        <>
          <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="dropdown-list" style={listStyle}>
            {searchable && (
              <div className="dropdown-search-wrap">
                <input
                  ref={searchRef}
                  className="dropdown-search"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            <div className="dropdown-options" ref={optionsRef}>
              {filtered.length === 0 && (
                <div className="dropdown-empty">No results</div>
              )}
              {filtered.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  className={`dropdown-option${o.value === value ? ' selected' : ''}${i === highlighted ? ' highlighted' : ''}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
