import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getWhatsAppStatus } from './whatsapp.js';

const SESSION_TTL = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const COOKIE_NAME = 'impact23_admin';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || !stored) return false;
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expectedBytes = Buffer.from(expected, 'hex');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 1024;
}

function validateBirthday(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { name, title = '', month, day, whatsappPhone = '', whatsappOptIn = false } = body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return null;
  if (typeof title !== 'string' || title.trim().length > 100) return null;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return null;
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  if (typeof whatsappPhone !== 'string' || (whatsappPhone.trim() && !/^\+[1-9][0-9]{7,14}$/.test(whatsappPhone.trim()))) return null;
  if (typeof whatsappOptIn !== 'boolean' || (whatsappOptIn && !whatsappPhone.trim())) return null;
  return { name: name.trim(), title: title.trim(), month, day, whatsappPhone: whatsappPhone.trim(), whatsappOptIn };
}

function sessionKey(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Create an isolated app. Call close() when tests or the HTTP server finish. */
export function createApp({
  databasePath = process.env.DATABASE_PATH || path.resolve('.data/birthdays.sqlite'),
  adminPassword = process.env.ADMIN_PASSWORD,
  production = process.env.NODE_ENV === 'production',
  distPath = path.resolve('dist'),
} = {}) {
  if (adminPassword !== undefined && !validPassword(adminPassword)) {
    throw new Error('ADMIN_PASSWORD must contain between 12 and 1024 characters.');
  }
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS birthdays (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      whatsappPhone TEXT NOT NULL DEFAULT '',
      whatsappOptIn INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(birthdays)').all().map((column) => column.name));
  if (!columns.has('whatsappPhone')) db.exec("ALTER TABLE birthdays ADD COLUMN whatsappPhone TEXT NOT NULL DEFAULT ''");
  if (!columns.has('whatsappOptIn')) db.exec('ALTER TABLE birthdays ADD COLUMN whatsappOptIn INTEGER NOT NULL DEFAULT 0');
  const readBirthday = (row) => ({ ...row, whatsappOptIn: Boolean(row.whatsappOptIn), hasWhatsapp: Boolean(row.whatsappPhone && row.whatsappOptIn) });
  const getBirthdays = () => db.prepare('SELECT * FROM birthdays ORDER BY month, day, name COLLATE NOCASE').all().map(readBirthday);
  let passwordHash = adminPassword ? hashPassword(adminPassword) : db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get()?.value;
  if (production && !passwordHash) {
    db.close();
    throw new Error('Configure ADMIN_PASSWORD (at least 12 characters) before starting in production, or complete local administrator setup first.');
  }
  const app = express();
  const sessions = new Map();
  const attempts = new Map();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    let sameOrigin = true;
    if (origin) {
      try { sameOrigin = new URL(origin).host === req.get('host'); } catch { sameOrigin = false; }
    }
    if (!sameOrigin || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Requests must come from this application.' });
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send request data as application/json.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, _res, next) => {
    const cookie = (req.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
    const token = cookie?.slice(COOKIE_NAME.length + 1);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const key = sessionKey(token);
      const expiry = sessions.get(key);
      if (expiry && expiry > Date.now()) req.admin = true;
      else if (expiry) sessions.delete(key);
    }
    next();
  });
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/', maxAge: SESSION_TTL };
  function createSession(res) {
    const now = Date.now();
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
    const token = randomBytes(32).toString('hex');
    sessions.set(sessionKey(token), now + SESSION_TTL);
    res.cookie(COOKIE_NAME, token, cookieOptions);
  }
  function requireAdmin(req, res, next) {
    if (!req.admin) return res.status(401).json({ error: 'Please sign in as an administrator.' });
    next();
  }
  function limitLogin(req, res, next) {
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (attempt.reset <= now) attempts.delete(ip);
    const ip = req.ip;
    const attempt = attempts.get(ip) || { count: 0, reset: now + LOGIN_WINDOW };
    attempt.count += 1;
    attempts.set(ip, attempt);
    if (attempt.count > 10) {
      res.set('Retry-After', String(Math.ceil((attempt.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' });
    }
    next();
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/reminders/status', (_req, res) => res.json({ whatsapp: getWhatsAppStatus() }));
  app.get('/api/auth/status', (req, res) => res.json({ authenticated: Boolean(req.admin), setupRequired: !passwordHash }));
  app.post('/api/auth/setup', limitLogin, (req, res) => {
    if (passwordHash || production) return res.status(403).json({ error: 'Administrator setup is already complete or unavailable.' });
    if (!validPassword(req.body?.password)) return res.status(400).json({ error: 'Choose a password containing at least 12 characters (maximum 1024).' });
    const newHash = hashPassword(req.body.password);
    db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?)").run(newHash);
    passwordHash = newHash;
    createSession(res);
    res.status(201).json({ authenticated: true, setupRequired: false });
  });
  app.post('/api/auth/login', limitLogin, (req, res) => {
    if (!passwordHash) return res.status(409).json({ error: 'Complete administrator setup first.' });
    if (!passwordMatches(req.body?.password, passwordHash)) return res.status(401).json({ error: 'The administrator password is incorrect.' });
    createSession(res);
    res.json({ authenticated: true, setupRequired: false });
  });
  app.post('/api/auth/logout', (req, res) => {
    const cookie = (req.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (cookie) sessions.delete(sessionKey(cookie.slice(COOKIE_NAME.length + 1)));
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: production, path: '/' });
    res.json({ authenticated: false });
  });
  app.get('/api/birthdays', (req, res) => {
    const birthdays = getBirthdays().map((row) => req.admin ? row : { ...row, whatsappPhone: '', whatsappOptIn: false });
    res.json({ birthdays });
  });
  app.post('/api/birthdays', requireAdmin, (req, res) => {
    const data = validateBirthday(req.body);
    if (!data) return res.status(400).json({ error: 'Provide a name (up to 100 characters), an optional title, a valid birthday, and an international WhatsApp number if opted in.' });
    const birthday = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO birthdays (id, name, title, month, day, whatsappPhone, whatsappOptIn, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(birthday.id, birthday.name, birthday.title, birthday.month, birthday.day, birthday.whatsappPhone, Number(birthday.whatsappOptIn), birthday.createdAt);
    res.status(201).json({ birthday: { ...birthday, hasWhatsapp: Boolean(birthday.whatsappPhone && birthday.whatsappOptIn) } });
  });
  app.put('/api/birthdays/:id', requireAdmin, (req, res) => {
    const data = validateBirthday(req.body);
    if (!data) return res.status(400).json({ error: 'Provide a name (up to 100 characters), an optional title, a valid birthday, and an international WhatsApp number if opted in.' });
    const result = db.prepare('UPDATE birthdays SET name = ?, title = ?, month = ?, day = ?, whatsappPhone = ?, whatsappOptIn = ? WHERE id = ?')
      .run(data.name, data.title, data.month, data.day, data.whatsappPhone, Number(data.whatsappOptIn), req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'This birthday record could not be found.' });
    res.json({ birthday: readBirthday(db.prepare('SELECT * FROM birthdays WHERE id = ?').get(req.params.id)) });
  });
  app.delete('/api/birthdays/:id', requireAdmin, (req, res) => {
    const result = db.prepare('DELETE FROM birthdays WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'This birthday record could not be found.' });
    res.status(204).end();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  if (existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request JSON is invalid.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error('Request failed:', error.code || error.name || 'Error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, db, getBirthdays, close: () => db.close() };
}
