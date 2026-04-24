import { useRef } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
// Import the trimmed entry: core editor + contributions, NO basic-languages, NO
// CSS/HTML/JSON language services. Register only the tokenizer for JavaScript
// and the TypeScript language service (which powers JS diagnostics, hover, and
// completion). This drops ~80 language contribution chunks from the build.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
// Use the named exports of this contribution module directly. Monaco's public
// types already mark `languages.typescript` as deprecated in favor of a top-
// level `typescript` namespace, which IS this module's exports — so skip the
// attachment dance and talk to it straight.
import * as tsLang from 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { SCRIPT_TYPES_DTS } from '../../editor/scriptTypes';

// One-time worker + bundler setup. Vite resolves the `?worker` imports to
// bundled Web Workers so Monaco runs entirely self-hosted (no CDN).
// This block AND the theme/ambient-type registration below must run BEFORE
// any <Editor /> mounts — otherwise the first editor is created against an
// undefined theme (Monaco silently falls back to default) and re-rendering
// via prop changes doesn't always repaint. Running at module top-level is
// safe: this module is lazy-loaded via import(), so nothing pays the cost
// until the Script tab is opened.
const W = self as unknown as { MonacoEnvironment?: unknown; __mmeMonacoConfigured?: boolean };
if (!W.__mmeMonacoConfigured) {
  W.MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
  W.__mmeMonacoConfigured = true;
}

tsLang.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});
tsLang.javascriptDefaults.setCompilerOptions({
  target: tsLang.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  noLib: false,
  checkJs: false,
  allowJs: true,
});
tsLang.javascriptDefaults.addExtraLib(SCRIPT_TYPES_DTS, 'file:///mudlet-api.d.ts');

monaco.editor.defineTheme('mme-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'e6e9ef' },
      { token: 'comment', foreground: '5a6478', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8fb8ff', fontStyle: 'bold' },
      { token: 'string', foreground: 'b0e6c0' },
      { token: 'number', foreground: 'f0c080' },
      { token: 'regexp', foreground: 'f0a0a0' },
      { token: 'type', foreground: 'f0c080' },
      { token: 'type.identifier', foreground: 'f0c080' },
      { token: 'identifier', foreground: 'e6e9ef' },
      { token: 'delimiter', foreground: 'c8d0dc' },
      { token: 'delimiter.bracket', foreground: 'c8d0dc' },
      { token: 'delimiter.parenthesis', foreground: 'c8d0dc' },
    ],
    colors: {
      'editor.background': '#0c1220',
      'editor.foreground': '#e6e9ef',
      'editorCursor.foreground': '#8fb8ff',
      'editor.lineHighlightBackground': '#0f1a2e',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#3464a870',
      'editor.inactiveSelectionBackground': '#3464a840',
      'editor.selectionHighlightBackground': '#8fb8ff25',
      'editor.wordHighlightBackground': '#8fb8ff20',
      'editor.wordHighlightStrongBackground': '#8fb8ff30',
      'editor.findMatchBackground': '#f0c08040',
      'editor.findMatchHighlightBackground': '#f0c08020',
      'editorLineNumber.foreground': '#4a5568',
      'editorLineNumber.activeForeground': '#8fb8ff',
      'editorIndentGuide.background1': '#1a2232',
      'editorIndentGuide.activeBackground1': '#2a3548',
      'editorBracketMatch.background': '#8fb8ff30',
      'editorBracketMatch.border': '#8fb8ff45',
      'editorGutter.background': '#0c1220',
      'editorWidget.background': '#0c1220',
      'editorWidget.border': '#8fb8ff28',
      'editorSuggestWidget.background': '#0c1220',
      'editorSuggestWidget.border': '#8fb8ff28',
      'editorSuggestWidget.foreground': '#e6e9ef',
      'editorSuggestWidget.selectedBackground': '#3464a8',
      'editorSuggestWidget.highlightForeground': '#8fb8ff',
      'editorHoverWidget.background': '#0c1220',
      'editorHoverWidget.border': '#8fb8ff28',
      'list.hoverBackground': '#3464a838',
      'scrollbarSlider.background': '#8fb8ff18',
      'scrollbarSlider.hoverBackground': '#8fb8ff28',
      'scrollbarSlider.activeBackground': '#8fb8ff3c',
    },
  });

interface Props {
  value: string;
  onChange(value: string): void;
  onRun(): void;
  minHeight?: string;
}

export default function ScriptCodeEditor({ value, onChange, onRun, minHeight = '260px' }: Props) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const handleMount: OnMount = (editor, monacoInstance) => {
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
      () => onRunRef.current(),
    );
    // Monaco measures font metrics synchronously at mount. If our monospace
    // font wasn't resolved yet (lazy chunk / first paint), widths are wrong
    // and text renders squished until the next layout event. Force a
    // remeasure + layout on the next frame, and again once document fonts
    // have fully loaded, so the editor paints correctly on first open.
    const remeasure = () => {
      monacoInstance.editor.remeasureFonts();
      editor.layout();
    };
    requestAnimationFrame(remeasure);
    if (typeof document !== 'undefined' && 'fonts' in document) {
      (document.fonts as unknown as { ready: Promise<unknown> }).ready.then(remeasure).catch(() => {});
    }
  };

  return (
    <div className="script-code-editor" style={{ minHeight }}>
      <Editor
        height="100%"
        defaultLanguage="javascript"
        theme="mme-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        loading={
          <div className="script-editor-loading" role="status" aria-live="polite">
            <div className="script-editor-loading-bar" />
            <span>Loading editor…</span>
          </div>
        }
        options={{
          fontFamily: "'Consolas', 'Menlo', 'Monaco', monospace",
          fontSize: 12,
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: 'off',
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          smoothScrolling: true,
          padding: { top: 8, bottom: 8 },
          bracketPairColorization: { enabled: true },
          guides: { indentation: true },
          // Fixed-position suggest/hover popups so they escape the side
          // panel's overflow:hidden. The panel's backdrop-filter lives on a
          // ::before pseudo-element, so it no longer traps position:fixed.
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
