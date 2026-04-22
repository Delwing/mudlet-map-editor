import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import type { EditorPlugin } from './editor/plugin';

const pluginModules = import.meta.glob('./plugins/*/index.ts', { eager: true });
const plugins = Object.values(pluginModules)
  .map((m) => (m as { default?: EditorPlugin }).default)
  .filter((p): p is EditorPlugin => p != null);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App plugins={plugins} />
  </React.StrictMode>,
);
