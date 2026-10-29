// The service worker caches the public shell; this adapter owns device data.
// Server passwords/cookies are never persisted. Standalone data is not encrypted.
const DEFAULT_WHATSAPP = { configured: false, adminConfigured: false, celebrantConfigured: false, missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_RECIPIENT_PHONE'], invalid: [], sendTime: '08:00', timeZone: 'Africa/Lagos', templateName: 'impact23_birthday_reminder', greetingTemplateName: 'impact23_birthday_greeting', language: 'en' };
const fields = ['name', 'title', 'month', 'day', 'whatsappPhone', 'whatsappOptIn'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const sameRecord = (a, b) => fields.every(key => a[key] === b[key]);
const stripPrivate = record => ({ ...record, whatsappPhone: '', whatsappOptIn: false });

export class DataError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export function validateRecord(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DataError('Enter a name and a valid birthday.', 400);
  const { name: rawName, title: rawTitle = '', month, day, whatsappPhone: rawPhone = '', whatsappOptIn = false } = body;
  if (typeof rawName !== 'string' || typeof rawTitle !== 'string' || typeof rawPhone !== 'string') throw new DataError('Provide a name, an optional title, and a valid birthday (MM/DD).', 400);
  const name = rawName.trim(), title = rawTitle.trim(), whatsappPhone = rawPhone.trim();
  const maximum = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!name || name.length > 100 || title.length > 100 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > maximum) throw new DataError('Provide a name, an optional title, and a valid birthday (MM/DD).', 400);
  if (typeof whatsappOptIn !== 'boolean' || (whatsappPhone && !/^\+[1-9][0-9]{7,14}$/.test(whatsappPhone)) || (whatsappOptIn && !whatsappPhone)) throw new DataError('Use an international WhatsApp number and record permission before enabling greetings.', 400);
  return { name, title, month, day, whatsappPhone, whatsappOptIn };
}

export function createDataClient({ storage, fetchImpl = globalThis.fetch, standalone = false, cryptoImpl = globalThis.crypto, now = () => new Date(), locks = globalThis.navigator?.locks, eventTarget = typeof window === 'undefined' ? undefined : window } = {}) {
  const key = standalone ? 'impact23-preview-v1' : 'impact23-offline-v1';
  const fresh = () => ({ version: 1, records: [], pending: [], hasCache: false, adminUnlocked: false, authSetup: false, whatsapp: clone(DEFAULT_WHATSAPP), lastSyncedAt: null, credential: null, needsLogin: false, conflict: null, deferredLogout: false });
  function readStored(fallback = fresh()) {
    try {
      const saved = JSON.parse(storage?.getItem(key) || 'null');
      return saved?.version === 1 && Array.isArray(saved.records) && Array.isArray(saved.pending) ? { ...fresh(), ...saved } : fresh();
    } catch { return fallback; }
  }
  let state = readStored();
  let online = !standalone && (typeof navigator === 'undefined' || navigator.onLine);
  let serverAuthenticated = false, syncing = false, initialized = false, error = '';
  let sequence = Promise.resolve();
  let lockManager = locks;
  const listeners = new Set();

  function snapshot() {
    return { standalone, online, syncing, pendingCount: state.pending.length, hasCache: state.hasCache, adminUnlocked: state.adminUnlocked, needsLogin: state.needsLogin, deferredLogout: state.deferredLogout, crossTabSafe: Boolean(lockManager?.request), conflict: state.adminUnlocked ? clone(state.conflict) : null, error, lastSyncedAt: state.lastSyncedAt, records: clone(state.adminUnlocked ? state.records : state.records.map(stripPrivate)) };
  }
  function emit() { for (const listener of listeners) { try { listener(snapshot()); } catch { /* An observer must not interrupt a durable write. */ } } }
  function persist(next) {
    if (!storage) throw new DataError('This browser cannot save offline data. Allow site storage before making changes.');
    try { storage.setItem(key, JSON.stringify(next)); }
    catch { throw new DataError('Your device could not save this change. Free some browser storage or download a backup, then try again.'); }
    state = next;
    emit();
  }
  function update(changes) { persist({ ...state, ...changes }); }
  function reloadStored() { state = readStored(state); }
  // Hold one lock from latest-snapshot read through all durable writes. Without
  // Web Locks only this tab is serialized: keep the app open in one tab there.
  function serialized(task) {
    const run = async () => { reloadStored(); return task(); };
    const result = sequence.then(async () => {
      if (!lockManager?.request) return run();
      let entered = false;
      try { return await lockManager.request(`${key}:write`, async () => { entered = true; return run(); }); }
      catch (err) {
        if (!entered && ['SecurityError', 'NotSupportedError'].includes(err?.name)) { lockManager = undefined; return run(); }
        throw err;
      }
    });
    sequence = result.catch(() => {});
    return result;
  }
  function requireAdmin() { if (!state.adminUnlocked) throw new DataError(standalone ? 'Sign in to this preview before changing birthdays.' : 'Please sign in online before changing birthdays on this device.', 401); }
  async function remote(path, options = {}) {
    if (standalone) throw new DataError('The standalone preview never contacts a server.');
    let response;
    try { response = await fetchImpl(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(8000) }); }
    catch { online = false; emit(); throw new DataError('Offline. Your saved birthdays and changes are still on this device.'); }
    online = true;
    const body = response.status === 204 ? undefined : await response.json().catch(() => ({}));
    if (!response.ok) throw new DataError(body?.error || 'The server could not complete this request.', response.status);
    return body;
  }
  async function finishDeferredLogout() {
    if (!state.deferredLogout || standalone) return;
    await remote('/auth/logout', { method: 'POST', body: '{}' });
    serverAuthenticated = false;
    update({ deferredLogout: false, adminUnlocked: false, needsLogin: false });
  }
  async function refreshInternal() {
    // An HttpOnly cookie must never undo an explicit offline sign-out.
    await finishDeferredLogout();
    const auth = await remote('/auth/status');
    serverAuthenticated = auth.authenticated;
    update({ authSetup: auth.setupRequired, adminUnlocked: state.adminUnlocked || auth.authenticated, needsLogin: !auth.authenticated && state.adminUnlocked });
    if (!state.needsLogin && !state.pending.length) {
      const result = await remote('/birthdays');
      update({ records: result.birthdays, hasCache: true, lastSyncedAt: now().toISOString() });
    }
    try { const result = await remote('/reminders/status'); update({ whatsapp: result.whatsapp }); } catch { /* Keep cached reminder configuration. */ }
    error = ''; emit();
  }
  async function initializeInternal() {
    if (initialized) return;
    if (standalone) { if (!state.hasCache) update({ hasCache: true, authSetup: !state.credential }); initialized = true; return; }
    try { await refreshInternal(); await flushInternal(); initialized = true; }
    catch (err) { error = err.message; emit(); if (!state.hasCache) throw err; initialized = true; }
  }
  function rebased(pending, records, id, revision) {
    let nextRevision = revision;
    pending = pending.map(op => {
      if (op.recordId !== id) return op;
      const next = { ...op, payload: { ...op.payload, baseRevision: nextRevision } };
      if (op.method === 'PUT') nextRevision++;
      return next;
    });
    return { pending, records: records.map(record => record.id === id ? { ...record, revision: nextRevision } : record) };
  }
  async function readConflictServer() {
    if (!state.conflict) return;
    const auth = await remote('/auth/status');
    if (!auth.authenticated) {
      serverAuthenticated = false;
      update({ needsLogin: true });
      throw new DataError('Sign in again to load the server birthday before resolving this conflict.', 401);
    }
    const result = await remote('/birthdays');
    update({ conflict: { ...state.conflict, serverKnown: true, serverRecord: result.birthdays.find(record => record.id === state.conflict.recordId) || null, localRecord: state.records.find(record => record.id === state.conflict.recordId) || null } });
  }
  async function flushInternal() {
    if (standalone || !online || !state.adminUnlocked || state.deferredLogout || !state.pending.length || state.needsLogin || state.conflict) return;
    syncing = true; error = ''; emit();
    try {
      while (state.pending.length) {
        const op = state.pending[0];
        let result;
        try { result = await remote(op.path, { method: op.method, body: JSON.stringify(op.payload) }); }
        catch (err) {
          if (err.status === 401) { serverAuthenticated = false; update({ needsLogin: true }); error = 'Sign in again to sync your saved changes.'; break; }
          if (err.status === 409 || (err.status === 404 && op.method !== 'DELETE')) {
            update({ conflict: { recordId: op.recordId, serverKnown: false, serverRecord: null, localRecord: state.records.find(record => record.id === op.recordId) || null, message: err.message } });
            try { await readConflictServer(); } catch { /* Failed reads never imply a server deletion. */ }
            error = state.conflict.serverKnown ? 'A birthday changed on the server. Review it before syncing.' : 'Reconnect to load the server birthday before resolving this conflict.';
            break;
          }
          if (!(err.status === 404 && op.method === 'DELETE')) { error = err.message; break; }
        }
        const pending = state.pending.filter(item => item.opId !== op.opId);
        let changes = { pending, records: state.records };
        if (result?.birthday) {
          changes = pending.some(item => item.recordId === op.recordId) ? rebased(pending, state.records, op.recordId, result.birthday.revision) : { pending, records: state.records.map(record => record.id === op.recordId ? result.birthday : record) };
        }
        // Acknowledgement, rebase and visible data are persisted atomically.
        update({ ...changes, lastSyncedAt: now().toISOString() });
      }
      if (!state.pending.length && online && serverAuthenticated) {
        const result = await remote('/birthdays');
        update({ records: result.birthdays, hasCache: true, lastSyncedAt: now().toISOString() });
      }
    } finally { syncing = false; emit(); }
  }
  async function syncInternal() {
    if (standalone) return snapshot();
    try {
      await initializeInternal();
      await refreshInternal();
      if (state.conflict && !state.conflict.serverKnown && !state.needsLogin) await readConflictServer();
      await flushInternal();
    } catch (err) { error = err.message; emit(); }
    return snapshot();
  }
  async function flushSavedChanges() {
    // Once a change is durable, sync failure must not invite a duplicate save.
    try { await flushInternal(); } catch (err) { error = err.message; emit(); }
  }
  async function localCredential(password, credential) {
    if (!cryptoImpl?.subtle) throw new DataError('This browser does not provide secure local password storage. Use a current browser.');
    const salt = credential ? Uint8Array.from(credential.salt) : cryptoImpl.getRandomValues(new Uint8Array(16));
    const material = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoImpl.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material, 256);
    return { salt: [...salt], hash: [...new Uint8Array(bits)] };
  }
  async function signOutInternal(discardPending = false) {
    if (!discardPending && state.pending.length) throw new DataError('There are changes saved only on this device. Sync them, or download a backup before signing out.', 428);
    // Persist the locked state before networking; retries cannot unlock it.
    update({ records: standalone ? state.records : state.records.map(stripPrivate), pending: discardPending ? [] : state.pending, conflict: null, adminUnlocked: false, needsLogin: false, deferredLogout: !standalone });
    serverAuthenticated = false;
    if (!standalone && online) {
      try { await finishDeferredLogout(); } catch (err) { error = err.message; emit(); }
    }
    return { authenticated: false };
  }
  async function requestInternal(path, options) {
    await initializeInternal();
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
      if (path === '/auth/status') return { authenticated: state.adminUnlocked, setupRequired: standalone ? !state.credential : state.authSetup };
      if (path === '/birthdays') return { birthdays: snapshot().records };
      if (path === '/reminders/status') return { whatsapp: clone(state.whatsapp) };
      if (path === '/health') return { status: standalone || online ? 'ok' : 'offline' };
    }
    let body;
    try { body = options.body ? JSON.parse(options.body) : {}; } catch { throw new DataError('Request JSON is invalid.', 400); }
    if (path === '/auth/setup' || path === '/auth/login') {
      if (standalone) {
        const password = body.password;
        if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new DataError('Choose a password with at least 12 characters.', 400);
        if (path === '/auth/setup' && state.credential) throw new DataError('The local admin is already set up.', 403);
        if (path === '/auth/login' && !state.credential) throw new DataError('Create the local admin password first.', 409);
        const credential = await localCredential(password, state.credential);
        if (state.credential && credential.hash.reduce((diff, byte, i) => diff | (byte ^ state.credential.hash[i]), 0)) throw new DataError('The administrator password is incorrect.', 401);
        update({ credential, adminUnlocked: true, authSetup: false, needsLogin: false, deferredLogout: false });
      } else {
        await finishDeferredLogout();
        const auth = await remote(path, options);
        serverAuthenticated = true;
        update({ adminUnlocked: true, authSetup: auth.setupRequired, needsLogin: false });
        await flushSavedChanges();
        if (!state.pending.length) {
          try { const result = await remote('/birthdays'); update({ records: result.birthdays, hasCache: true, lastSyncedAt: now().toISOString() }); }
          catch (err) { error = err.message; emit(); }
        }
      }
      return { authenticated: true, setupRequired: false };
    }
    if (path === '/auth/logout') return signOutInternal();
    if ((path === '/birthdays' && method === 'POST') || (path.startsWith('/birthdays/') && ['PUT', 'DELETE'].includes(method))) {
      requireAdmin();
      const id = method === 'POST' ? cryptoImpl.randomUUID() : path.split('/').at(-1);
      const existing = state.records.find(record => record.id === id);
      if (method !== 'POST' && !existing) throw new DataError('This birthday record could not be found.', 404);
      const data = method === 'DELETE' ? null : validateRecord(body);
      if (method === 'PUT' && sameRecord(existing, data)) return { birthday: clone(existing) };
      const birthday = data ? { ...existing, ...data, id, createdAt: existing?.createdAt || now().toISOString(), revision: existing ? (existing.revision || 1) + 1 : 1, hasWhatsapp: !!(data.whatsappPhone && data.whatsappOptIn) } : null;
      const records = method === 'POST' ? [...state.records, birthday] : method === 'DELETE' ? state.records.filter(record => record.id !== id) : state.records.map(record => record.id === id ? birthday : record);
      const payload = method === 'POST' ? { ...data, id } : { ...data, baseRevision: existing.revision || 1 };
      const pending = standalone ? [] : [...state.pending, { opId: cryptoImpl.randomUUID(), recordId: id, path: method === 'POST' ? '/birthdays' : `/birthdays/${id}`, method, payload }];
      const conflict = state.conflict?.recordId === id ? { ...state.conflict, localRecord: birthday } : state.conflict;
      update({ records, pending, conflict, hasCache: true });
      if (!standalone && online && !state.needsLogin) await flushSavedChanges();
      return birthday ? { birthday: clone(state.records.find(record => record.id === id) || birthday) } : undefined;
    }
    throw new DataError('This action is not available.', 404);
  }
  async function resolveConflictInternal(choice) {
    requireAdmin();
    const conflict = state.conflict;
    if (!conflict) return snapshot();
    if (!['local', 'server'].includes(choice)) throw new DataError('Choose the local or server record.', 400);
    if (!conflict.serverKnown) throw new DataError('Reconnect to load the server birthday before resolving this conflict.', 409);
    const other = state.pending.filter(op => op.recordId !== conflict.recordId);
    let records = state.records.filter(record => record.id !== conflict.recordId);
    if (choice === 'server') {
      if (conflict.serverRecord) records.push(conflict.serverRecord);
      update({ records, pending: other, conflict: null });
    } else {
      const desired = state.records.find(record => record.id === conflict.recordId) || null;
      const source = conflict.serverRecord;
      let op;
      if (!desired && source) op = { method: 'DELETE', path: `/birthdays/${source.id}`, recordId: source.id, payload: { baseRevision: source.revision } };
      if (desired && source) op = { method: 'PUT', path: `/birthdays/${source.id}`, recordId: source.id, payload: { ...validateRecord(desired), baseRevision: source.revision } };
      if (desired && !source) { const id = cryptoImpl.randomUUID(); op = { method: 'POST', path: '/birthdays', recordId: id, payload: { ...validateRecord(desired), id } }; records.push({ ...desired, id, revision: 1 }); }
      else if (desired) records.push({ ...desired, revision: source.revision + 1 });
      update({ records, pending: op ? [{ ...op, opId: cryptoImpl.randomUUID() }, ...other] : other, conflict: null });
    }
    error = '';
    return syncInternal();
  }
  function exportBackup() {
    // localStorage snapshots are atomic; exporting is a synchronous read only.
    reloadStored(); requireAdmin();
    return { format: 'impact23-birthdays-v1', exportedAt: now().toISOString(), birthdays: clone(state.records) };
  }
  async function importBackupInternal(backup) {
    await initializeInternal(); requireAdmin();
    if (!backup || backup.format !== 'impact23-birthdays-v1' || !Array.isArray(backup.birthdays) || backup.birthdays.length > 10000) throw new DataError('Choose a valid Impact23 birthday backup.', 400);
    const records = [...state.records], pending = [...state.pending];
    let imported = 0;
    for (const row of backup.birthdays) {
      const data = validateRecord(row);
      if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new DataError('A birthday in this backup has an invalid record ID.', 400);
      const id = row.id.toLowerCase();
      const existing = records.find(record => record.id === id);
      if (existing) { if (!sameRecord(existing, data)) throw new DataError('This backup contains a different version of an existing birthday. No records were imported.', 409); continue; }
      records.push({ ...data, id, createdAt: now().toISOString(), revision: 1, hasWhatsapp: Boolean(data.whatsappPhone && data.whatsappOptIn) });
      if (!standalone) pending.push({ opId: cryptoImpl.randomUUID(), recordId: id, path: '/birthdays', method: 'POST', payload: { ...data, id } });
      imported++;
    }
    update({ records, pending, hasCache: true });
    if (!standalone && online && !state.needsLogin) await flushSavedChanges();
    return { imported };
  }
  const onStorage = event => { if (event.key === key || event.key === null) void serialized(() => emit()).catch(() => {}); };
  eventTarget?.addEventListener?.('storage', onStorage);
  return {
    request: (path, options = {}) => serialized(() => requestInternal(path, options)),
    sync: () => serialized(syncInternal),
    getState: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    resolveConflict: choice => serialized(() => resolveConflictInternal(choice)),
    backupAndSignOut: () => serialized(() => signOutInternal(true)),
    exportBackup,
    importBackup: backup => serialized(() => importBackupInternal(backup)),
    setOnline(value) { online = !standalone && Boolean(value); emit(); if (online) void serialized(syncInternal).catch(() => {}); },
    dispose() { eventTarget?.removeEventListener?.('storage', onStorage); listeners.clear(); },
  };
}

function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
export const standalone = typeof window !== 'undefined' && window.__IMPACT23_STANDALONE__ === true;
export const dataClient = createDataClient({ storage: browserStorage(), standalone });
if (typeof window !== 'undefined' && !standalone) {
  window.addEventListener('online', () => dataClient.setOnline(true));
  window.addEventListener('offline', () => dataClient.setOnline(false));
  window.addEventListener('focus', () => { if (navigator.onLine) void dataClient.sync(); });
  setInterval(() => { const state = dataClient.getState(); if (navigator.onLine && (!state.online || state.pendingCount > 0 || state.deferredLogout)) void dataClient.sync(); }, 15000);
}
