import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript, javascriptLanguage, localCompletionSource, scopeCompletionSource, snippets } from '@codemirror/lang-javascript';
import { autocompletion, completeFromList, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { SCRIPT_API, ROOM_FIELDS, AREA_FIELDS, ENV_FIELDS, ARRAY_METHODS, type ApiEntry, type ApiReturnType } from '../../editor/scriptApiDocs';

interface Props {
  value: string;
  onChange(value: string): void;
  onRun(): void;
  minHeight?: string;
}

function apiEntryToCompletion(e: ApiEntry): Completion {
  const label = e.name;
  const detail = e.signature ?? e.detail;
  return {
    label,
    type: e.kind === 'function' ? 'function' : e.kind === 'namespace' ? 'namespace' : 'variable',
    detail,
    info: e.info,
    boost: e.kind === 'function' ? 1 : 0,
  };
}

const TOP_LEVEL_COMPLETIONS: Completion[] = SCRIPT_API.map(apiEntryToCompletion);
const ROOM_FIELD_COMPLETIONS: Completion[] = ROOM_FIELDS.map(apiEntryToCompletion);
const AREA_FIELD_COMPLETIONS: Completion[] = AREA_FIELDS.map(apiEntryToCompletion);
const ENV_FIELD_COMPLETIONS: Completion[] = ENV_FIELDS.map(apiEntryToCompletion);
const ARRAY_METHOD_COMPLETIONS: Completion[] = ARRAY_METHODS.map(apiEntryToCompletion);

const API_RETURN_BY_NAME: Map<string, ApiReturnType> = new Map(
  SCRIPT_API.flatMap((e) => (e.returns ? [[e.name, e.returns]] as Array<[string, ApiReturnType]> : [])),
);

/** Array methods that return an array of (roughly) the same element type. */
const ARRAY_RETURNING_METHODS = new Set([
  'map', 'filter', 'slice', 'concat', 'flat', 'flatMap',
  'reverse', 'sort', 'splice', 'toSorted', 'toReversed', 'toSpliced', 'fill',
]);

function isArrayType(t: ApiReturnType | null): boolean {
  return t === 'RoomArray' || t === 'AreaArray' || t === 'DirectionArray' || t === 'EnvArray';
}

/** Human-readable form of an inferred type, shown as the `detail` on a completion. */
function formatTypeDetail(t: ApiReturnType | null): string | undefined {
  switch (t) {
    case 'Room': return 'Room';
    case 'RoomArray': return 'Room[]';
    case 'Area': return 'Area';
    case 'AreaArray': return 'Area[]';
    case 'Env': return 'Env';
    case 'EnvArray': return 'Env[]';
    case 'Direction': return 'Direction';
    case 'DirectionArray': return 'Direction[]';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'void': return 'void';
    default: return undefined;
  }
}

/**
 * Wrap `localCompletionSource` to annotate user-declared variables with an
 * inferred type in the `detail` column. Declarations we can't resolve
 * (for-of bindings, function params, destructuring) pass through untouched.
 */
function typedLocalSource(ctx: CompletionContext): CompletionResult | null {
  const result = localCompletionSource(ctx);
  if (!result) return null;
  const text = ctx.state.doc.toString();
  const options: Completion[] = result.options.map((opt) => {
    if (opt.detail || typeof opt.label !== 'string') return opt;
    const type = resolveDeclaredVariable(text, opt.label, ctx.pos, 0);
    const detail = formatTypeDetail(type);
    return detail ? { ...opt, detail } : opt;
  });
  return { ...result, options };
}

/**
 * Infer the type of the expression that immediately ends at `endPos` in `text`.
 * Understands:
 *   - `fn(...)`            → SCRIPT_API return type
 *   - `expr.method(...)`   → array type when method is array-returning
 *   - bare identifier      → SCRIPT_API entry; else look back for `const|let|var NAME = EXPR`
 *                            and recurse into EXPR
 * Recursion is depth-limited to protect against pathological inputs.
 */
function inferTypeBeforeDot(text: string, endPos: number, depth = 0): ApiReturnType | null {
  if (depth > 4) return null;
  let i = endPos - 1;
  // Skip trailing whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return null;

  // Call expression: `…(…)`
  if (text[i] === ')') {
    let d = 1;
    i--;
    while (i >= 0 && d > 0) {
      const c = text[i];
      if (c === ')') d++;
      else if (c === '(') d--;
      i--;
    }
    if (d !== 0) return null;
    // Read the callee identifier just before the `(`.
    let end = i + 1;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    let start = end;
    while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
    if (start === end) return null;
    const name = text.slice(start, end);
    // Method call? (preceded by `.`)
    let k = start - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    if (k >= 0 && text[k] === '.') {
      // Generic-array flag: actual element type isn't tracked.
      return ARRAY_RETURNING_METHODS.has(name) ? 'RoomArray' : null;
    }
    return API_RETURN_BY_NAME.get(name) ?? null;
  }

  // Bare identifier
  let end = i + 1;
  let start = end;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  if (start === end) return null;
  const name = text.slice(start, end);
  const apiType = API_RETURN_BY_NAME.get(name);
  if (apiType) return apiType;
  return resolveDeclaredVariable(text, name, start, depth);
}

/**
 * Look backwards in `text` (before `upTo`) for the most recent
 *   `(const|let|var) NAME = <initializer>`
 * and return the inferred type of its initializer.
 */
function resolveDeclaredVariable(text: string, name: string, upTo: number, depth: number): ApiReturnType | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:const|let|var)\\s+${esc}\\s*=`, 'g');
  const prefix = text.slice(0, upTo);
  let m: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(prefix)) !== null) last = m;
  if (!last) return null;

  // Scan forward from just after `=` to the end of the initializer expression.
  // Stop on `;` at depth 0, or on a newline at depth 0 that isn't a method-chain continuation.
  let j = last.index + last[0].length;
  let d = 0;
  let seen = false;
  while (j < text.length) {
    const c = text[j];
    if (c === '(' || c === '[' || c === '{') { d++; seen = true; }
    else if (c === ')' || c === ']' || c === '}') {
      if (d === 0) break;
      d--;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      seen = true;
      j++;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === q) break;
        j++;
      }
    } else if (d === 0 && c === ';') {
      break;
    } else if (d === 0 && c === '\n' && seen) {
      // Allow chain continuation: `…\n  .map(…)`
      let k = j + 1;
      while (k < text.length && /[\t ]/.test(text[k])) k++;
      if (text[k] !== '.' && text[k] !== '?') break;
    } else if (!/\s/.test(c)) {
      seen = true;
    }
    j++;
  }
  let end = j;
  while (end > last.index && /\s/.test(text[end - 1])) end--;
  if (end <= last.index + last[0].length) return null;
  return inferTypeBeforeDot(text, end, depth + 1);
}

function scriptCompletions(ctx: CompletionContext) {
  const dotBefore = ctx.matchBefore(/\.\w*$/);
  if (dotBefore) {
    const word = ctx.matchBefore(/\w*$/);
    if (!word) return null;
    const text = ctx.state.doc.toString();
    const dotPos = dotBefore.from; // position of the `.`
    const inferred = inferTypeBeforeDot(text, dotPos);
    // Types that offer nothing useful after `.` — let the JS defaults (scope / snippets) handle them.
    if (inferred === 'void' || inferred === 'number' || inferred === 'boolean') {
      return null;
    }
    let options: Completion[];
    if (isArrayType(inferred)) {
      options = ARRAY_METHOD_COMPLETIONS;
    } else if (inferred === 'Area') {
      options = AREA_FIELD_COMPLETIONS;
    } else if (inferred === 'Env') {
      options = ENV_FIELD_COMPLETIONS;
    } else if (inferred === 'Room') {
      options = ROOM_FIELD_COMPLETIONS;
    } else {
      // Unknown. Only fall back to Room fields when the thing before the dot
      // is a bare identifier — that's the common for-of / lambda-binding case
      // (`for (const r of rooms()) { r. }` or `rooms().forEach(r => r. )`).
      // For unresolvable method chains or literals, don't pollute with Room fields.
      let k = dotPos - 1;
      while (k >= 0 && /\s/.test(text[k])) k--;
      if (k >= 0 && /[\w$]/.test(text[k])) {
        options = ROOM_FIELD_COMPLETIONS;
      } else {
        return null;
      }
    }
    return {
      from: word.from,
      options,
      validFor: /^\w*$/,
    };
  }
  const word = ctx.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: TOP_LEVEL_COMPLETIONS,
    validFor: /^\w*$/,
  };
}

// Palette sourced from src/styles.css so the editor blends with the rest of the UI.
const PALETTE = {
  fg: '#e6e9ef',
  fgMuted: '#8fb8ff',
  fgDim: '#6a7588',
  accent: '#8fb8ff',
  accentStrong: '#cfe1ff',
  caret: '#8fb8ff',
  selection: 'rgba(52, 100, 168, 0.45)',
  selectionMatch: 'rgba(143, 184, 255, 0.15)',
  activeLine: 'rgba(143, 184, 255, 0.05)',
  activeLineGutter: 'rgba(143, 184, 255, 0.08)',
  gutterFg: '#4a5568',
  gutterFgActive: '#8fb8ff',
  border: 'rgba(143, 184, 255, 0.14)',
  borderStrong: 'rgba(143, 184, 255, 0.28)',
  panelBg: 'rgba(12, 18, 30, 0.98)',
  panelBgSolid: '#0c1220',
  rowHover: 'rgba(52, 100, 168, 0.22)',
  rowSelected: 'rgba(52, 100, 168, 0.55)',
  string: '#b0e6c0',
  number: '#f0c080',
  keyword: '#8fb8ff',
  comment: '#5a6478',
  fn: '#cfe1ff',
  prop: '#cfe1ff',
  literal: '#f0a0a0',
  type: '#f0c080',
  bracket: '#c8d0dc',
};

const editorTheme = EditorView.theme({
  '&': {
    color: PALETTE.fg,
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    caretColor: PALETTE.caret,
    fontFamily: "'Consolas', 'Menlo', 'Monaco', monospace",
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: PALETTE.caret, borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: `${PALETTE.selection} !important`,
  },
  '.cm-selectionMatch': { backgroundColor: PALETTE.selectionMatch },
  '.cm-activeLine': { backgroundColor: PALETTE.activeLine },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: PALETTE.gutterFg,
    border: 'none',
    borderRight: `1px solid ${PALETTE.border}`,
  },
  '.cm-activeLineGutter': {
    backgroundColor: PALETTE.activeLineGutter,
    color: PALETTE.gutterFgActive,
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'rgba(52, 100, 168, 0.25)',
    border: `1px solid ${PALETTE.border}`,
    color: PALETTE.accent,
    borderRadius: '3px',
    padding: '0 4px',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'rgba(143, 184, 255, 0.18)',
    outline: `1px solid ${PALETTE.borderStrong}`,
  },
  // --- Autocomplete popup --------------------------------------------------
  '.cm-tooltip': {
    backgroundColor: PALETTE.panelBg,
    border: `1px solid ${PALETTE.borderStrong}`,
    borderRadius: '6px',
    color: PALETTE.fg,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(6px)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    '& > ul': {
      fontFamily: "'Consolas', 'Menlo', 'Monaco', monospace",
      fontSize: '12px',
      maxHeight: '18em',
      minWidth: '240px',
    },
    '& > ul > li': {
      padding: '4px 10px',
      lineHeight: '1.45',
      borderRadius: '3px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: PALETTE.rowSelected,
      color: '#ffffff',
    },
  },
  '.cm-tooltip-autocomplete ul li:hover:not([aria-selected])': {
    backgroundColor: PALETTE.rowHover,
  },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionDetail': {
    color: PALETTE.fgDim,
    fontStyle: 'normal',
    marginLeft: 'auto',
    paddingLeft: '14px',
    fontSize: '11px',
  },
  'li[aria-selected] .cm-completionDetail': { color: PALETTE.accentStrong },
  '.cm-completionMatchedText': {
    color: PALETTE.accent,
    textDecoration: 'none',
    fontWeight: '700',
  },
  'li[aria-selected] .cm-completionMatchedText': { color: '#ffffff' },
  '.cm-completionIcon': {
    width: '1em',
    opacity: '1',
    marginRight: '2px',
    fontWeight: '700',
    textAlign: 'center',
  },
  '.cm-completionIcon-function': { color: '#8fb8ff' },
  '.cm-completionIcon-namespace': { color: '#f0c080' },
  '.cm-completionIcon-variable': { color: '#b0e6c0' },
  '.cm-completionIcon-property': { color: '#cfe1ff' },
  'li[aria-selected] .cm-completionIcon': { color: '#ffffff' },
  '.cm-tooltip.cm-completionInfo': {
    marginLeft: '6px',
    padding: '8px 10px',
    maxWidth: '360px',
    fontSize: '11px',
    lineHeight: '1.5',
    color: PALETTE.fg,
    backgroundColor: PALETTE.panelBgSolid,
  },
  // --- Search panel --------------------------------------------------------
  '.cm-panels': {
    backgroundColor: PALETTE.panelBg,
    color: PALETTE.fg,
    borderTop: `1px solid ${PALETTE.border}`,
  },
  '.cm-panels input, .cm-panels button': {
    backgroundColor: 'rgba(10, 14, 22, 0.7)',
    color: PALETTE.fg,
    border: `1px solid ${PALETTE.border}`,
    borderRadius: '3px',
    padding: '2px 6px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(240, 192, 128, 0.25)',
    outline: '1px solid rgba(240, 192, 128, 0.5)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(240, 192, 128, 0.55)',
  },
}, { dark: true });

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: PALETTE.keyword, fontWeight: '600' },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: PALETTE.keyword, fontWeight: '600' },
  { tag: [t.operatorKeyword, t.self], color: PALETTE.keyword },
  { tag: [t.string, t.special(t.string)], color: PALETTE.string },
  { tag: t.number, color: PALETTE.number },
  { tag: [t.bool, t.null, t.atom], color: PALETTE.literal },
  { tag: t.regexp, color: PALETTE.literal },
  { tag: t.escape, color: PALETTE.number },
  { tag: t.comment, color: PALETTE.comment, fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: PALETTE.fn },
  { tag: t.variableName, color: PALETTE.fg },
  { tag: t.propertyName, color: PALETTE.prop },
  { tag: [t.typeName, t.className], color: PALETTE.type },
  { tag: t.operator, color: PALETTE.accent },
  { tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.punctuation], color: PALETTE.bracket },
  { tag: t.definition(t.variableName), color: PALETTE.accentStrong },
  { tag: t.invalid, color: PALETTE.literal, textDecoration: 'underline' },
  { tag: t.meta, color: PALETTE.fgDim },
]);

export default function ScriptCodeEditor({ value, onChange, onRun, minHeight = '260px' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);
  onRunRef.current = onRun;
  onChangeRef.current = onChange;

  const themeCompartment = useRef(new Compartment()).current;

  useEffect(() => {
    if (!containerRef.current) return;

    const runKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        mac: 'Mod-Enter',
        preventDefault: true,
        run: () => { onRunRef.current(); return true; },
      },
    ]);

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({
            activateOnTyping: true,
            defaultKeymap: true,
            icons: true,
            tooltipClass: () => 'mme-completion',
          }),
          highlightActiveLine(),
          highlightSelectionMatches(),
          javascript(),
          javascriptLanguage.data.of({ autocomplete: scriptCompletions }),
          javascriptLanguage.data.of({ autocomplete: typedLocalSource }),
          javascriptLanguage.data.of({ autocomplete: completeFromList(snippets) }),
          javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(globalThis) }),
          syntaxHighlighting(highlightStyle),
          themeCompartment.of(editorTheme),
          runKeymap,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.theme({
            '&': { height: '100%', minHeight, fontSize: '12px' },
            '.cm-scroller': {
              fontFamily: "'Consolas', 'Menlo', 'Monaco', monospace",
              lineHeight: '1.55',
            },
            '.cm-content': { padding: '8px 0' },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={containerRef} className="script-code-editor" />;
}
