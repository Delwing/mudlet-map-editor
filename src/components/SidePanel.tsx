import { store, useEditorState } from '../editor/store';
import type { SceneHandle } from '../editor/scene';
import type { RoomPanelSection, SidebarTab } from '../editor/plugin';
import { AreaPanel } from './AreaManagerModal';
import { EnvPanel } from './EnvManagerModal';
import { HistoryPanel } from './panels/HistoryPanel';
import { MapPanel, collectWarnings } from './panels/MapPanel';
import { ExitPanel } from './panels/ExitPanel';
import { StubPanel } from './panels/StubPanel';
import { CustomLineDrawPanel, CustomLineSelectPanel } from './panels/CustomLinePanel';
import { LabelPanel } from './panels/LabelPanel';
import { RoomPanel } from './RoomPanel';
import { MultiRoomPanel } from './MultiRoomPanel';
import { ToolHint } from './panelShared';

interface SidePanelProps {
  sceneRef: { current: SceneHandle | null };
  extraTabs?: SidebarTab[];
  pluginRoomSections?: RoomPanelSection[];
}

const TABS = [
  { id: 'selection', label: 'Sel' },
  { id: 'areas',     label: 'Areas' },
  { id: 'envs',      label: 'Envs' },
  { id: 'history',   label: 'Hist' },
  { id: 'map',       label: 'Map' },
] as const;

export function SidePanel({ sceneRef, extraTabs = [], pluginRoomSections = [] }: SidePanelProps) {
  const selection = useEditorState((s) => s.selection);
  const map = useEditorState((s) => s.map);
  const activeTool = useEditorState((s) => s.activeTool);
  const pending = useEditorState((s) => s.pending);
  const sidebarTab = useEditorState((s) => s.sidebarTab);
  const panelCollapsed = useEditorState((s) => s.panelCollapsed);
  const undoCount = useEditorState((s) => s.undo.length);
  useEditorState((s) => s.dataVersion); // subscribe so exit/door/weight mutations re-render

  const envsCount = map ? Object.keys(map.mCustomEnvColors).length : 0;
  const areasCount = map ? Object.keys(map.areaNames).length : 0;
  const warningCount = map ? collectWarnings(sceneRef, map).length : 0;

  if (activeTool === 'customLine' && pending?.kind === 'customLine') {
    return <CustomLineDrawPanel pending={pending} sceneRef={sceneRef} />;
  }

  if (panelCollapsed) {
    return (
      <div className="side-panel side-panel--collapsed">
        <button type="button" className="side-panel-collapse-btn" title="Expand panel" onClick={() => store.setState({ panelCollapsed: false })}>
          ◀
        </button>
        <div className="side-panel-tabs side-panel-tabs--vert">
          {[...TABS, ...extraTabs].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`side-panel-tab${sidebarTab === t.id ? ' active' : ''}`}
              onClick={() => store.setState({ sidebarTab: t.id, panelCollapsed: false })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const tabBar = (
    <div className="side-panel-tabs">
      <button type="button" className={`side-panel-tab${sidebarTab === 'selection' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'selection' })}>Selection</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'areas' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'areas' })}>Areas{areasCount > 0 && <span className="tab-badge">{areasCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'envs' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'envs' })}>Envs{envsCount > 0 && <span className="tab-badge">{envsCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'history' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'history' })}>History{undoCount > 0 && <span className="tab-badge">{undoCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'map' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'map' })}>Map{warningCount > 0 && <span className="tab-badge tab-badge--warn">{warningCount}</span>}</button>
      {extraTabs.map((t) => (
        <button key={t.id} type="button" className={`side-panel-tab${sidebarTab === t.id ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: t.id })}>{t.label}</button>
      ))}
      <button type="button" className="side-panel-tab side-panel-tab--collapse" title="Collapse panel" onClick={() => store.setState({ panelCollapsed: true })}>▶</button>
    </div>
  );

  if (sidebarTab === 'areas') {
    return (
      <div className="side-panel">
        {tabBar}
        <AreaPanel sceneRef={sceneRef} />
      </div>
    );
  }

  if (sidebarTab === 'envs') {
    return (
      <div className="side-panel">
        {tabBar}
        <EnvPanel sceneRef={sceneRef} />
      </div>
    );
  }

  if (sidebarTab === 'history') {
    return (
      <div className="side-panel">
        {tabBar}
        <HistoryPanel sceneRef={sceneRef} />
      </div>
    );
  }

  if (sidebarTab === 'map') {
    return (
      <div className="side-panel">
        {tabBar}
        <MapPanel sceneRef={sceneRef} />
      </div>
    );
  }

  const pluginTab = extraTabs.find((t) => t.id === sidebarTab);
  if (pluginTab) {
    return (
      <div className="side-panel">
        {tabBar}
        <div className="panel-content">{pluginTab.render(sceneRef)}</div>
      </div>
    );
  }

  if (selection?.kind === 'label') {
    return (
      <div className="side-panel">
        {tabBar}
        <LabelPanel selection={selection} sceneRef={sceneRef} />
      </div>
    );
  }

  if (selection?.kind === 'exit' && map) {
    return (
      <div className="side-panel">
        {tabBar}
        <div className="panel-content">
          <ExitPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      </div>
    );
  }

  if (selection?.kind === 'stub' && map) {
    return (
      <div className="side-panel">
        {tabBar}
        <div className="panel-content">
          <StubPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      </div>
    );
  }

  if (selection?.kind === 'customLine' && map) {
    return (
      <div className="side-panel">
        {tabBar}
        <div className="panel-content">
          <CustomLineSelectPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      </div>
    );
  }

  if (selection?.kind === 'room' && selection.ids.length > 1 && map) {
    return (
      <div className="side-panel">
        {tabBar}
        <MultiRoomPanel selection={selection} map={map} sceneRef={sceneRef} />
      </div>
    );
  }

  const room = selection?.kind === 'room' && map ? map.rooms[selection.ids[0]] : null;

  if (!room || !selection || selection.kind !== 'room') {
    return (
      <div className="side-panel empty">
        {tabBar}
        <div className="panel-content">
          <h3>No selection</h3>
          <p className="hint">Select a room with the Select tool to edit its properties.</p>
          <ToolHint activeTool={activeTool} />
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel">
      {tabBar}
      <RoomPanel selection={selection} room={room} map={map!} sceneRef={sceneRef} pluginSections={pluginRoomSections} />
    </div>
  );
}
