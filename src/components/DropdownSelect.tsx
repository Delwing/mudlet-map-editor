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
}

export function DropdownSelect({ label, value, options, onChange, searchable, emptyText = '—' }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [listStyle, setListStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

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

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="dropdown-select">
      <button ref={triggerRef} type="button" className={`dropdown-trigger${open ? ' open' : ''}`} onClick={openList}>
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
            <div className="dropdown-options">
              {filtered.length === 0 && (
                <div className="dropdown-empty">No results</div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`dropdown-option${o.value === value ? ' selected' : ''}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
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
