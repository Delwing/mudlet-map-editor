import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  value: string;
  options: string[];
  onChange: (family: string) => void;
}

export function FontPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState<number>(-1);
  const [listStyle, setListStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const filtered = search.trim()
    ? options.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    const idx = filtered.findIndex((f) => f === value);
    setHighlighted(idx >= 0 ? idx : filtered.length > 0 ? 0 : -1);
  }, [filtered.length, search, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !optionsRef.current || highlighted < 0) return;
    const item = optionsRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'center' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
        minWidth: Math.max(rect.width, 240),
      });
    }
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const commit = (idx: number) => {
    const family = filtered[idx];
    if (!family) return;
    onChange(family);
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
    <div className="dropdown-select" style={{ flex: 1 }}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${open ? ' open' : ''}`}
        style={{ width: '100%', fontFamily: `"${value}", sans-serif` }}
        onClick={openList}
      >
        <span className="dropdown-trigger-value" style={{ flex: 1, textAlign: 'left' }}>{value}</span>
        <span className="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>

      {open && createPortal(
        <>
          <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="dropdown-list" style={listStyle}>
            <div className="dropdown-search-wrap">
              <input
                ref={searchRef}
                className="dropdown-search"
                placeholder="Search fonts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="dropdown-options" ref={optionsRef}>
              {filtered.length === 0 && (
                <div className="dropdown-empty">No results</div>
              )}
              {filtered.map((family, i) => (
                <button
                  key={family}
                  type="button"
                  className={`dropdown-option${family === value ? ' selected' : ''}${i === highlighted ? ' highlighted' : ''}`}
                  style={{ fontFamily: `"${family}", sans-serif` }}
                  onClick={() => { onChange(family); setOpen(false); }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  {family}
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
