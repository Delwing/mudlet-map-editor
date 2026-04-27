import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useEditorState, saveUserSettings } from '../editor/store';
import type { SceneHandle } from '../editor/scene';
import type { RoomPanelSection, SidebarTab } from '../editor/plugin';
import { AreaPanel } from './AreaManagerModal';
import { EnvPanel } from './EnvManagerModal';
import { HistoryPanel } from './panels/HistoryPanel';
import { MapPanel, warningKey } from './panels/MapPanel';
import { loadAcks, mapAckKey } from '../editor/warningAcks';
import { ScriptPanel } from './panels/ScriptPanel';
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

export function SidePanel({ sceneRef, extraTabs = [], pluginRoomSections = [] }: SidePanelProps) {
  const { t } = useTranslation('panels');
  const selection = useEditorState((s) => s.selection);
  const map = useEditorState((s) => s.map);
  const activeTool = useEditorState((s) => s.activeTool);
  const pending = useEditorState((s) => s.pending);
  const sidebarTab = useEditorState((s) => s.sidebarTab);
  const panelCollapsed = useEditorState((s) => s.panelCollapsed);
  const panelExpanded = useEditorState((s) => s.panelExpanded);
  const panelWidth = useEditorState((s) => s.panelWidth);
  const undoCount = useEditorState((s) => s.undo.length);
  const warnings = useEditorState((s) => s.warnings);

  const envsCount = map ? Object.keys(map.mCustomEnvColors).length : 0;
  const areasCount = map ? Object.keys(map.areaNames).length : 0;
  const warningCount = map
    ? warnings.filter((w) => !loadAcks(mapAckKey(map)).has(warningKey(w))).length
    : 0;

  if (activeTool === 'customLine' && pending?.kind === 'customLine') {
    return <CustomLineDrawPanel pending={pending} sceneRef={sceneRef} />;
  }

  if (panelCollapsed && !panelExpanded) {
    const collapsedTabs = [
      { id: 'selection', label: t('sidebar.selectionShort') },
      { id: 'areas',     label: t('sidebar.areas') },
      { id: 'envs',      label: t('sidebar.envs') },
      { id: 'history',   label: t('sidebar.historyShort') },
      { id: 'map',       label: t('sidebar.map') },
      { id: 'script',    label: t('sidebar.script') },
    ];
    return (
      <div className="side-panel side-panel--collapsed">
        <button type="button" className="side-panel-collapse-btn" title={t('sidebar.expandPanel')} onClick={() => store.setState({ panelCollapsed: false })}>
          ◀
        </button>
        <div className="side-panel-tabs side-panel-tabs--vert">
          {[...collapsedTabs, ...extraTabs].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`side-panel-tab${sidebarTab === tab.id ? ' active' : ''}`}
              onClick={() => store.setState({ sidebarTab: tab.id, panelCollapsed: false })}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const tabBar = (
    <div className="side-panel-tabs">
      <button type="button" className={`side-panel-tab${sidebarTab === 'selection' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'selection' })}>{t('sidebar.selection')}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'areas' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'areas' })}>{t('sidebar.areas')}{areasCount > 0 && <span className="tab-badge">{areasCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'envs' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'envs' })}>{t('sidebar.envs')}{envsCount > 0 && <span className="tab-badge">{envsCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'history' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'history' })}>{t('sidebar.history')}{undoCount > 0 && <span className="tab-badge">{undoCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'map' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'map' })}>{t('sidebar.map')}{warningCount > 0 && <span className="tab-badge tab-badge--warn">{warningCount}</span>}</button>
      <button type="button" className={`side-panel-tab${sidebarTab === 'script' ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: 'script' })}>{t('sidebar.script')}</button>
      {extraTabs.map((tab) => (
        <button key={tab.id} type="button" className={`side-panel-tab${sidebarTab === tab.id ? ' active' : ''}`} onClick={() => store.setState({ sidebarTab: tab.id })}>{tab.label}</button>
      ))}
      <button
        type="button"
        className="side-panel-tab side-panel-tab--expand"
        title={panelExpanded ? t('sidebar.restorePanel') : t('sidebar.expandPanel')}
        onClick={() => store.setState({ panelExpanded: !panelExpanded })}
      >
        {panelExpanded ? '⧉' : '⛶'}
      </button>
      {!panelExpanded && (
        <button type="button" className="side-panel-tab side-panel-tab--collapse" title={t('sidebar.collapsePanel')} onClick={() => store.setState({ panelCollapsed: true })}>▶</button>
      )}
    </div>
  );

  let body: ReactNode;
  let isEmpty = false;

  if (sidebarTab === 'areas') {
    body = <AreaPanel sceneRef={sceneRef} />;
  } else if (sidebarTab === 'envs') {
    body = <EnvPanel sceneRef={sceneRef} />;
  } else if (sidebarTab === 'history') {
    body = <HistoryPanel sceneRef={sceneRef} />;
  } else if (sidebarTab === 'map') {
    body = <MapPanel sceneRef={sceneRef} />;
  } else if (sidebarTab === 'script') {
    body = <ScriptPanel sceneRef={sceneRef} />;
  } else {
    const pluginTab = extraTabs.find((tab) => tab.id === sidebarTab);
    if (pluginTab) {
      body = <div className="panel-content">{pluginTab.render(sceneRef)}</div>;
    } else if (selection?.kind === 'label') {
      body = <LabelPanel selection={selection} sceneRef={sceneRef} />;
    } else if (selection?.kind === 'exit' && map) {
      body = (
        <div className="panel-content">
          <ExitPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      );
    } else if (selection?.kind === 'stub' && map) {
      body = (
        <div className="panel-content">
          <StubPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      );
    } else if (selection?.kind === 'customLine' && map) {
      body = (
        <div className="panel-content">
          <CustomLineSelectPanel selection={selection} map={map} sceneRef={sceneRef} />
        </div>
      );
    } else if (selection?.kind === 'room' && selection.ids.length > 1 && map) {
      body = <MultiRoomPanel selection={selection} map={map} sceneRef={sceneRef} />;
    } else {
      const room = selection?.kind === 'room' && map ? map.rooms[selection.ids[0]] : null;
      if (!room || !selection || selection.kind !== 'room') {
        isEmpty = true;
        body = (
          <div className="panel-content">
            <h3>{t('sidebar.noSelection')}</h3>
            <p className="hint">{t('sidebar.noSelectionHint')}</p>
            <ToolHint activeTool={activeTool} />
          </div>
        );
      } else {
        body = <RoomPanel selection={selection} room={room} map={map!} pluginSections={pluginRoomSections} sceneRef={sceneRef} />;
      }
    }
  }

  const classes = ['side-panel'];
  if (isEmpty) classes.push('empty');
  if (panelExpanded) classes.push('side-panel--expanded');

  const inlineStyle = panelCollapsed || panelExpanded ? undefined : { width: panelWidth };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = store.getState().panelWidth;
    const MIN = 300;
    const MAX = Math.max(MIN, Math.min(1200, window.innerWidth - 120));
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN, Math.min(MAX, startWidth + (startX - ev.clientX)));
      store.setState({ panelWidth: next });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveUserSettings({ panelWidth: store.getState().panelWidth });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const panel = (
    <div className={classes.join(' ')} style={inlineStyle}>
      {!panelCollapsed && !panelExpanded && (
        <div
          className="side-panel-resize-handle"
          onPointerDown={startResize}
          title={t('sidebar.dragToResize')}
        />
      )}
      {tabBar}
      {body}
    </div>
  );

  if (panelExpanded) {
    return (
      <div
        className="modal-overlay side-panel-modal-overlay"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) store.setState({ panelExpanded: false });
        }}
      >
        {panel}
      </div>
    );
  }

  return panel;
}
