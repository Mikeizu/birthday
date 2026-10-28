import { createHash } from 'node:crypto';

const REQUIRED_BASE = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];
const ADMIN_PHONE = 'WHATSAPP_RECIPIENT_PHONE';
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000];
const API_VERSION = 'v22.0';

function readConfiguration(env) {
  const read = (name, fallback = '') => String(env[name] ?? fallback).trim();
  const config = {
    token: read('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: read('WHATSAPP_PHONE_NUMBER_ID'),
    adminPhone: read(ADMIN_PHONE),
    templateName: read('WHATSAPP_TEMPLATE_NAME', 'impact23_birthday_reminder'),
    greetingTemplateName: read('WHATSAPP_GREETING_TEMPLATE_NAME', 'impact23_birthday_greeting'),
    language: read('WHATSAPP_TEMPLATE_LANGUAGE', 'en'),
    timeZone: read('APP_TIME_ZONE', 'Africa/Lagos'),
    sendTime: read('WHATSAPP_SEND_TIME', '08:00'),
  };
  const missing = REQUIRED_BASE.filter((name) => !read(name));
  if (!config.adminPhone) missing.push(ADMIN_PHONE);
  const invalid = [];
  if (config.phoneNumberId && !/^\d+$/.test(config.phoneNumberId)) invalid.push('WHATSAPP_PHONE_NUMBER_ID');
  if (config.adminPhone && !/^\+?[1-9]\d{7,14}$/.test(config.adminPhone)) invalid.push(ADMIN_PHONE);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.sendTime)) invalid.push('WHATSAPP_SEND_TIME');
  for (const [field, name] of [['templateName', 'WHATSAPP_TEMPLATE_NAME'], ['greetingTemplateName', 'WHATSAPP_GREETING_TEMPLATE_NAME']]) {
    if (!/^[a-z0-9_]{1,512}$/.test(config[field])) invalid.push(name);
  }
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language)) invalid.push('WHATSAPP_TEMPLATE_LANGUAGE');
  try {
    new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format();
  } catch {
    invalid.push('APP_TIME_ZONE');
  }
  const baseNames = [...REQUIRED_BASE, 'APP_TIME_ZONE', 'WHATSAPP_SEND_TIME', 'WHATSAPP_TEMPLATE_LANGUAGE'];
  config.baseConfigured = !missing.some((name) => REQUIRED_BASE.includes(name)) && !invalid.some((name) => baseNames.includes(name));
  config.adminConfigured = config.baseConfigured && !!config.adminPhone && !invalid.includes(ADMIN_PHONE) && !invalid.includes('WHATSAPP_TEMPLATE_NAME');
  config.celebrantConfigured = config.baseConfigured && !invalid.includes('WHATSAPP_GREETING_TEMPLATE_NAME');
  return { config, missing, invalid };
}

/** Safe to return to the client: never includes tokens or recipient phone numbers. */
export function getWhatsAppStatus(env = process.env) {
  const { config, missing, invalid } = readConfiguration(env);
  return {
    configured: config.adminConfigured && config.celebrantConfigured,
    adminConfigured: config.adminConfigured,
    celebrantConfigured: config.celebrantConfigured,
    missing,
    invalid,
    sendTime: config.sendTime,
    timeZone: config.timeZone,
    templateName: config.templateName,
    greetingTemplateName: config.greetingTemplateName,
    language: config.language,
  };
}

function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    time: `${parts.hour}:${parts.minute}`,
  };
}

function occursToday(birthday, clock) {
  let day = birthday.day;
  const leapYear = clock.year % 4 === 0 && (clock.year % 100 !== 0 || clock.year % 400 === 0);
  if (birthday.month === 2 && day === 29 && !leapYear) day = 28;
  return birthday.month === clock.month && day === clock.day;
}

function recipientKey(date, kind, phone) {
  const target = createHash('sha256').update(phone.replace(/^\+/, '')).digest('hex').slice(0, 32);
  return `${date}:${kind}:${target}`;
}

function splitSummary(members) {
  // A template text parameter supports up to 1,024 characters. Split large lists
  // into distinct messages so every birthday remains included.
  const chunks = [];
  let current = '';
  for (const member of members) {
    const label = `${member.name}${member.title ? ` (${member.title})` : ''}`;
    const next = current ? `${current}; ${label}` : label;
    if (next.length > 1_000 && current) {
      chunks.push(current);
      current = label;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Creates the durable dispatcher. tick() is exported for deterministic tests.
 * Keep credentials in server environment variables, never database or logs.
 */
export function createWhatsAppScheduler({ db, getBirthdays, env = process.env, fetchImpl = globalThis.fetch, logger = console, now = () => new Date() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_dispatches (
    dispatch_key TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER,
    last_error TEXT
  )`);
  const find = db.prepare('SELECT * FROM whatsapp_dispatches WHERE dispatch_key = ?');
  const insert = db.prepare("INSERT OR IGNORE INTO whatsapp_dispatches (dispatch_key, local_date, state) VALUES (?, ?, 'pending')");
  const claim = db.prepare(`UPDATE whatsapp_dispatches SET state = 'sending', attempts = attempts + 1, lease_until = ?
    WHERE dispatch_key = ? AND state IN ('pending', 'retry') AND next_attempt_at <= ? AND attempts < ?`);
  const markSent = db.prepare("UPDATE whatsapp_dispatches SET state = 'sent', sent_at = ?, lease_until = 0, last_error = NULL WHERE dispatch_key = ?");
  const markFailed = db.prepare('UPDATE whatsapp_dispatches SET state = ?, next_attempt_at = ?, lease_until = 0, last_error = ? WHERE dispatch_key = ?');
  // A process that died during delivery leaves an ambiguous result. Do not
  // resend it automatically: Meta may have accepted the original request.
  const markStale = db.prepare("UPDATE whatsapp_dispatches SET state = 'uncertain', lease_until = 0, last_error = 'Delivery interrupted; check WhatsApp Business delivery logs before resending.' WHERE state = 'sending' AND lease_until < ?");
  let running = false;

  async function deliver({ date, kind, phone, template, parameters }, config, instant) {
    const key = recipientKey(date, kind, phone);
    insert.run(key, date);
    if (!claim.run(instant + 120_000, key, instant, MAX_ATTEMPTS).changes) return;
    const attempt = find.get(key).attempts;
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${API_VERSION}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: template,
            language: { code: config.language },
            // Meta template parameters cannot contain line breaks or tabs.
            components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text: String(text).replace(/\s+/gu, ' ').trim() })) }],
          },
        }),
      });
      if (response.ok) {
        // A successful HTTP response must also contain a Meta message ID.
        const result = await response.json().catch(() => null);
        if (!Array.isArray(result?.messages) || !result.messages.some((message) => typeof message.id === 'string' && message.id)) {
          markFailed.run('uncertain', 0, 'Provider returned an unconfirmed delivery; check WhatsApp Business logs.', key);
          logger.warn?.('WhatsApp delivery could not be confirmed. Check WhatsApp Business delivery logs.');
          return;
        }
        markSent.run(instant, key);
        return;
      }
      const transient = response.status === 429 || response.status >= 500;
      const retry = transient && attempt < MAX_ATTEMPTS;
      const reason = `WhatsApp provider HTTP ${response.status}.`;
      markFailed.run(retry ? 'retry' : 'failed', retry ? instant + RETRY_DELAYS[attempt - 1] : 0, reason, key);
      logger.warn?.(`${reason} ${retry ? 'A retry is scheduled.' : 'Check the approved template, recipient and account configuration.'}`);
    } catch {
      // Network errors/timeouts are ambiguous: the provider may have sent the
      // message. Avoid duplicate greetings, and ask an operator to inspect logs.
      markFailed.run('uncertain', 0, 'Network delivery could not be confirmed; check WhatsApp Business logs.', key);
      logger.warn?.('WhatsApp delivery is uncertain after a network error. Check WhatsApp Business delivery logs before resending.');
    }
  }

  async function tick() {
    if (running) return;
    const { config } = readConfiguration(env);
    if (!config.adminConfigured && !config.celebrantConfigured) return;
    running = true;
    try {
      const instant = now();
      const timestamp = instant.getTime();
      const clock = localClock(instant, config.timeZone);
      if (clock.time < config.sendTime) return;
      markStale.run(timestamp);
      const birthdays = (await getBirthdays()).filter((member) => occursToday(member, clock))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      if (!birthdays.length) return;
      const jobs = [];
      if (config.adminConfigured) {
        const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(instant);
        for (const [index, summary] of splitSummary(birthdays).entries()) {
          jobs.push({ date: clock.key, kind: `admin-${index}`, phone: config.adminPhone, template: config.templateName, parameters: [dateLabel, summary] });
        }
      }
      if (config.celebrantConfigured) {
        // One greeting per phone/day even if a member is accidentally entered twice.
        const recipients = new Set();
        for (const member of birthdays) {
          if (!member.whatsappOptIn || !/^\+[1-9]\d{7,14}$/.test(member.whatsappPhone || '')) continue;
          if (recipients.has(member.whatsappPhone)) continue;
          recipients.add(member.whatsappPhone);
          jobs.push({ date: clock.key, kind: 'greeting', phone: member.whatsappPhone, template: config.greetingTemplateName, parameters: [member.name, member.title || 'Impact23 member'] });
        }
      }
      for (const job of jobs) await deliver(job, config, timestamp);
    } catch {
      // Avoid leaking names, phone numbers, Graph payloads or access tokens.
      logger.error?.('Birthday reminder scheduler could not complete this check. Review server configuration and database availability.');
    } finally {
      running = false;
    }
  }

  return { tick };
}

/** Returns a stop function. Live processes must be restarted after deployment. */
export function startWhatsAppScheduler(options) {
  const scheduler = createWhatsAppScheduler(options);
  void scheduler.tick();
  const timer = setInterval(() => void scheduler.tick(), 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
