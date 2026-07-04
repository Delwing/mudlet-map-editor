import i18n from '../i18n';
import { store, type RoomClipboard } from './store';

/** Another same-origin editor tab with a map open, discovered over BroadcastChannel. */
export interface PeerInfo {
  tabId: string;
  fileName: string;
  roomCount: number;
}

/** Rooms sent over from another tab, waiting for the user to place them. */
export interface IncomingRooms {
  fromFileName: string;
  clipboard: RoomClipboard;
}

type PeerMessage =
  | { type: 'hello'; tabId: string; info: { fileName: string; roomCount: number } | null }
  | { type: 'who'; tabId: string }
  | { type: 'bye'; tabId: string }
  | { type: 'rooms'; to: string; from: string; fromFileName: string; clipboard: RoomClipboard }
  | { type: 'ack'; to: string; from: string; count: number };

// BroadcastChannel is origin-scoped, so two deployments never cross-talk.
const CHANNEL_NAME = 'mudlet-map-editor-peers';
const ACK_TIMEOUT_MS = 1500;

const selfTabId: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null = null;
/** Outstanding transfers awaiting the receiver's ack, keyed by receiver tabId. */
const pendingAcks = new Map<string, { timer: ReturnType<typeof setTimeout>; fileName: string }>();

function post(msg: PeerMessage): void {
  channel?.postMessage(msg);
}

function upsertPeer(info: PeerInfo): void {
  store.setState((s) => {
    const rest = s.peers.filter((p) => p.tabId !== info.tabId);
    return { peers: [...rest, info].sort((a, b) => a.fileName.localeCompare(b.fileName)) };
  });
}

function removePeer(tabId: string): void {
  store.setState((s) =>
    s.peers.some((p) => p.tabId === tabId) ? { peers: s.peers.filter((p) => p.tabId !== tabId) } : {},
  );
}

/** Broadcast this tab's current map (or lack of one) to the other tabs. */
export function announceSelf(): void {
  if (!channel) return;
  const { map, loaded } = store.getState();
  const info = map && loaded
    ? { fileName: loaded.fileName, roomCount: Object.values(map.rooms).filter(Boolean).length }
    : null;
  post({ type: 'hello', tabId: selfTabId, info });
}

/** Ask every tab to re-announce — used to refresh names/counts when the context menu opens. */
export function refreshPeers(): void {
  post({ type: 'who', tabId: selfTabId });
}

/** Send a room snapshot to another tab. The receiver acks the transfer; if no ack
 *  arrives within the timeout the peer is presumed gone and dropped from the list.
 *  Outcome is reported via the status bar. */
export function sendRoomsToPeer(peer: PeerInfo, clipboard: RoomClipboard): void {
  if (!channel) return;
  post({
    type: 'rooms',
    to: peer.tabId,
    from: selfTabId,
    fromFileName: store.getState().loaded?.fileName ?? '?',
    clipboard,
  });
  const existing = pendingAcks.get(peer.tabId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingAcks.delete(peer.tabId);
    removePeer(peer.tabId);
    store.setState({ status: i18n.t('context:menu.sendFailed', { name: peer.fileName }) });
  }, ACK_TIMEOUT_MS);
  pendingAcks.set(peer.tabId, { timer, fileName: peer.fileName });
}

function onMessage(ev: MessageEvent<PeerMessage>): void {
  const msg = ev.data;
  switch (msg?.type) {
    case 'hello':
      if (msg.info) upsertPeer({ tabId: msg.tabId, ...msg.info });
      else removePeer(msg.tabId);
      break;
    case 'who':
      announceSelf();
      break;
    case 'bye':
      removePeer(msg.tabId);
      break;
    case 'rooms':
      if (msg.to !== selfTabId) break;
      store.setState({ incomingRooms: { fromFileName: msg.fromFileName, clipboard: msg.clipboard } });
      post({ type: 'ack', to: msg.from, from: selfTabId, count: msg.clipboard.rooms.length });
      break;
    case 'ack': {
      if (msg.to !== selfTabId) break;
      const pending = pendingAcks.get(msg.from);
      if (!pending) break;
      clearTimeout(pending.timer);
      pendingAcks.delete(msg.from);
      store.setState({ status: i18n.t('context:menu.sentRooms', { count: msg.count, name: pending.fileName }) });
      break;
    }
  }
}

/** Open the cross-tab channel. Returns a cleanup that says goodbye and closes it. */
export function initPeers(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = onMessage;
  const onPageHide = () => post({ type: 'bye', tabId: selfTabId });
  window.addEventListener('pagehide', onPageHide);
  refreshPeers();
  announceSelf();
  return () => {
    post({ type: 'bye', tabId: selfTabId });
    window.removeEventListener('pagehide', onPageHide);
    channel?.close();
    channel = null;
    for (const { timer } of pendingAcks.values()) clearTimeout(timer);
    pendingAcks.clear();
  };
}
