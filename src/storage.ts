// Same document operations as the existing UI, backed by the local HTTP/SQLite service.
type Data = Record<string, any>;
type Stored = { collection: string; id: string; data: Data; version: number };
export type DocumentReference = { kind: 'document'; db: DocumentClient; collection: string; id: string };
export type CollectionReference = { kind: 'collection'; db: DocumentClient; collection: string };
export class StorageError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export class FieldPath {
  constructor(...segments: string[]) { this.segments = segments; }
  segments: string[];
}
class DocumentSnapshot {
  id: string;
  version: number;
  constructor(private record: Stored | null, ref: DocumentReference) {
    this.id = ref.id; this.version = record?.version || 0;
  }
  exists() { return this.record !== null; }
  data(): any { return this.record ? structuredClone(this.record.data) : undefined; }
}
class CollectionSnapshot {
  docs: DocumentSnapshot[];
  constructor(records: Stored[], ref: CollectionReference) {
    this.docs = records.map(record => new DocumentSnapshot(record, { kind: 'document', db: ref.db, collection: ref.collection, id: record.id }));
  }
  forEach(callback: (document: DocumentSnapshot) => void) { this.docs.forEach(callback); }
}
type Listener = { ref: DocumentReference | CollectionReference; refresh: () => void };
export function createDocumentClient(baseURL = '', fetcher: typeof fetch = fetch) {
  const listeners = new Set<Listener>();
  let controller: AbortController | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetcher(baseURL + path, { credentials: 'same-origin', ...init,
        headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
    } catch { throw new StorageError('unavailable', '保存サーバーに接続できません。'); }
    const body = await response.json();
    if (!response.ok) throw new StorageError(body.code || 'unavailable', body.error || '保存できませんでした。');
    return body;
  }
  function invalidated(event: { refresh?: boolean; changes?: { collection: string; id: string }[] }) {
    for (const listener of listeners) if (event.refresh || event.changes?.some(change =>
      change.collection === listener.ref.collection && (listener.ref.kind === 'collection' || change.id === listener.ref.id))) listener.refresh();
  }
  async function connect() {
    if (!listeners.size || controller) return;
    controller = new AbortController();
    const current = controller;
    try {
      const response = await fetcher(baseURL + '/api/events', { credentials: 'same-origin', signal: current.signal });
      if (!response.ok || !response.body) throw new Error('events unavailable');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (!current.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const line = frame.split('\n').find(line => line.startsWith('data: '));
          if (line) invalidated(JSON.parse(line.slice(6)));
        }
      }
    } catch { /* Each listener's HTTP refresh reports errors; a new stream refreshes all data. */ }
    finally {
      if (controller === current) controller = null;
      if (listeners.size) reconnect = setTimeout(() => { void connect(); }, 1000);
    }
  }
  function subscribe(listener: Listener) {
    listeners.add(listener); void connect();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { clearTimeout(reconnect); controller?.abort(); controller = null; }
    };
  }
  return { request, subscribe };
}
export type DocumentClient = ReturnType<typeof createDocumentClient>;
export const db = createDocumentClient('');
export function doc(store: DocumentClient, collection: string, id: string): DocumentReference {
  return { kind: 'document', db: store, collection, id };
}
export function collection(store: DocumentClient, name: string): CollectionReference {
  return { kind: 'collection', db: store, collection: name };
}
export function serverTimestamp() { return { __serverTimestamp: true }; }
export async function getDocFromServer(ref: DocumentReference) {
  const result = await ref.db.request('/api/documents/' + encodeURIComponent(ref.collection) + '/' + encodeURIComponent(ref.id));
  return new DocumentSnapshot(result.document, ref);
}
export async function setDoc(ref: DocumentReference, data: Data, options: { merge?: boolean } = {}) {
  await ref.db.request('/api/commit', { method: 'POST', body: JSON.stringify({ reads: [],
    writes: [{ collection: ref.collection, id: ref.id, mode: 'set', data, merge: !!options.merge }] }) });
}
function updateFields(args: any[]) {
  const fields: { path: string[]; value: any }[] = [];
  if (args.length === 1 && !(args[0] instanceof FieldPath)) {
    for (const [key, value] of Object.entries(args[0])) fields.push({ path: key.split('.'), value });
  } else {
    if (args.length % 2) throw new StorageError('invalid-argument', '更新項目が不正です。');
    for (let i = 0; i < args.length; i += 2) fields.push({
      path: args[i] instanceof FieldPath ? args[i].segments : String(args[i]).split('.'), value: args[i + 1]
    });
  }
  return fields;
}
export async function updateDoc(ref: DocumentReference, ...args: any[]) {
  await ref.db.request('/api/commit', { method: 'POST', body: JSON.stringify({ reads: [],
    writes: [{ collection: ref.collection, id: ref.id, mode: 'update', fields: updateFields(args) }] }) });
}
export async function runTransaction<T>(store: DocumentClient, callback: (transaction: {
  get: (ref: DocumentReference) => Promise<DocumentSnapshot>;
  set: (ref: DocumentReference, data: Data, options?: { merge?: boolean }) => void;
  update: (ref: DocumentReference, ...args: any[]) => void;
}) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reads = new Map<string, { collection: string; id: string; version: number }>(), writes: any[] = [];
    const snapshots = new Map<string, DocumentSnapshot>();
    const result = await callback({
      async get(ref) {
        const identity = ref.collection + '/' + ref.id;
        if (snapshots.has(identity)) return snapshots.get(identity)!;
        const snapshot = await getDocFromServer(ref);
        snapshots.set(identity, snapshot);
        reads.set(identity, { collection: ref.collection, id: ref.id, version: snapshot.version });
        return snapshot;
      },
      set(ref, data, options = {}) {
        writes.push({ collection: ref.collection, id: ref.id, mode: 'set', data, merge: !!options.merge });
      },
      update(ref, ...args) {
        writes.push({ collection: ref.collection, id: ref.id, mode: 'update', fields: updateFields(args) });
      }
    });
    if (!writes.length) return result;
    try {
      await store.request('/api/commit', { method: 'POST', body: JSON.stringify({ reads: [...reads.values()], writes }) });
      return result;
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'aborted' || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw new StorageError('aborted', '別の端末で更新されました。');
}
export function onSnapshot(ref: DocumentReference, next: (snapshot: DocumentSnapshot) => void, error?: (error: any) => void): () => void;
export function onSnapshot(ref: CollectionReference, next: (snapshot: CollectionSnapshot) => void, error?: (error: any) => void): () => void;
export function onSnapshot(ref: DocumentReference | CollectionReference, next: (snapshot: any) => void, error?: (error: any) => void) {
  let active = true, fetching = false, again = false;
  async function refresh() {
    if (!active) return;
    if (fetching) { again = true; return; }
    fetching = true;
    try {
      let snapshot;
      if (ref.kind === 'document') snapshot = await getDocFromServer(ref);
      else {
        const result = await ref.db.request('/api/collections/' + encodeURIComponent(ref.collection));
        snapshot = new CollectionSnapshot(result.documents, ref);
      }
      if (active) next(snapshot);
    } catch (err) { if (active) error?.(err); }
    finally { fetching = false; if (again) { again = false; void refresh(); } }
  }
  const unsubscribe = ref.db.subscribe({ ref, refresh: () => { void refresh(); } });
  void refresh();
  return () => { active = false; unsubscribe(); };
}
export async function initializeSession() {
  const url = new URL(window.location.href);
  const key = new URLSearchParams(url.hash.slice(1)).get('key');
  let session;
  if (key) {
    session = await db.request('/api/session', { method: 'POST', body: JSON.stringify({ key }) });
    url.hash = '';
  } else session = await db.request('/api/session');
  if (session.readOnly) url.searchParams.set('readonly', '1');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
