import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWhatsAppScheduler, getWhatsAppStatus } from './whatsapp.js';

const configuredEnv = {
  WHATSAPP_ACCESS_TOKEN: 'fake-token-only-for-unit-tests',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_RECIPIENT_PHONE: '+2348012345678',
};
const people = [
  { id: '1', name: 'Ada Example', title: 'Volunteer', month: 10, day: 28, whatsappPhone: '+2348098765432', whatsappOptIn: true },
  { id: '2', name: 'Ben Example', title: '', month: 10, day: 28, whatsappPhone: '+2348098765433', whatsappOptIn: false },
  { id: '3', name: 'Cora Example', title: '', month: 10, day: 29, whatsappPhone: '+2348098765434', whatsappOptIn: true },
];

function harness({ env = configuredEnv, members = people, instant = '2026-10-28T07:00:00Z', responses = [], db = new DatabaseSync(':memory:') } = {}) {
  const calls = [];
  const logs = [];
  let currentTime = new Date(instant);
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options, payload: JSON.parse(options.body) });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response ?? { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.unit-test' }] }) };
  };
  const scheduler = createWhatsAppScheduler({
    db, env, getBirthdays: () => members, fetchImpl, now: () => currentTime,
    logger: { warn: (message) => logs.push(message), error: (message) => logs.push(message) },
  });
  return { db, calls, logs, scheduler, setTime: (time) => { currentTime = new Date(time); } };
}

test('status reports requirements without exposing secrets or phone numbers', () => {
  const missing = getWhatsAppStatus({});
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_RECIPIENT_PHONE']);
  assert.equal(missing.timeZone, 'Africa/Lagos');
  assert.equal(missing.sendTime, '08:00');
  const status = getWhatsAppStatus(configuredEnv);
  assert.equal(status.configured, true);
  assert.equal(status.adminConfigured, true);
  assert.equal(status.celebrantConfigured, true);
  assert.ok(!JSON.stringify(status).includes(configuredEnv.WHATSAPP_ACCESS_TOKEN));
  assert.ok(!JSON.stringify(status).includes(configuredEnv.WHATSAPP_RECIPIENT_PHONE));
});

test('invalid runtime configuration is surfaced and prevents dispatch', async () => {
  const env = { ...configuredEnv, APP_TIME_ZONE: 'Unknown/Zone', WHATSAPP_SEND_TIME: '25:01' };
  const status = getWhatsAppStatus(env);
  assert.equal(status.configured, false);
  assert.deepEqual(status.invalid, ['WHATSAPP_SEND_TIME', 'APP_TIME_ZONE']);
  const context = harness({ env });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 0);
  context.db.close();
});

test('unconfigured accounts never attempt network calls', async () => {
  const context = harness({ env: {} });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 0);
  context.db.close();
});

test('dispatches today at Lagos local send time, respects opt-in, and survives scheduler restart without duplicates', async () => {
  const context = harness({ instant: '2026-10-28T06:59:00Z' });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 0);
  context.setTime('2026-10-28T07:00:00Z');
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  const [admin, greeting] = context.calls;
  assert.equal(admin.payload.to, '2348012345678');
  assert.equal(admin.payload.template.name, 'impact23_birthday_reminder');
  assert.deepEqual(admin.payload.template.components[0].parameters.map((parameter) => parameter.text), [
    '28 October 2026', 'Ada Example (Volunteer); Ben Example',
  ]);
  assert.equal(greeting.payload.to, '2348098765432');
  assert.deepEqual(greeting.payload.template.components[0].parameters.map((parameter) => parameter.text), ['Ada Example', 'Volunteer']);
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  const restarted = harness({ db: context.db });
  await restarted.scheduler.tick();
  assert.equal(restarted.calls.length, 0);
  assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_dispatches WHERE state = 'sent'").get().count, 2);
  context.db.close();
});

test('celebrant greetings work independently when admin recipient is not configured', async () => {
  const env = { ...configuredEnv, WHATSAPP_RECIPIENT_PHONE: '' };
  assert.equal(getWhatsAppStatus(env).adminConfigured, false);
  assert.equal(getWhatsAppStatus(env).celebrantConfigured, true);
  const context = harness({ env });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].payload.template.name, 'impact23_birthday_greeting');
  context.db.close();
});

test('Feb 29 birthdays are celebrated on Feb 28 only in non-leap years', async () => {
  const members = [{ ...people[0], month: 2, day: 29 }];
  const context = harness({ members, instant: '2027-02-28T08:00:00Z' });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  const leap = harness({ members, instant: '2028-02-28T08:00:00Z' });
  await leap.scheduler.tick();
  assert.equal(leap.calls.length, 0);
  leap.setTime('2028-02-29T08:00:00Z');
  await leap.scheduler.tick();
  assert.equal(leap.calls.length, 2);
  context.db.close();
  leap.db.close();
});

test('temporary provider errors retry with backoff, without repeating successful greetings', async () => {
  const context = harness({ responses: [{ ok: false, status: 429 }] });
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_dispatches WHERE state = 'retry'").get().count, 1);
  context.setTime('2026-10-28T07:00:30Z');
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  context.setTime('2026-10-28T07:01:00Z');
  await context.scheduler.tick();
  assert.equal(context.calls.length, 3);
  assert.equal(context.calls[2].payload.template.name, 'impact23_birthday_reminder');
  context.db.close();
});

test('permanent provider errors do not retry, and logs never contain credentials or recipients', async () => {
  const context = harness({ responses: [{ ok: false, status: 400 }, { ok: false, status: 400 }] });
  await context.scheduler.tick();
  context.setTime('2026-10-28T12:00:00Z');
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  const output = context.logs.join(' ');
  assert.ok(!output.includes(configuredEnv.WHATSAPP_ACCESS_TOKEN));
  assert.ok(!output.includes(configuredEnv.WHATSAPP_RECIPIENT_PHONE));
  assert.ok(!output.includes(people[0].whatsappPhone));
  context.db.close();
});

test('ambiguous network errors remain uncertain rather than risking duplicate greetings', async () => {
  const context = harness({ responses: [new Error('fake network error with sensitive payload')] });
  await context.scheduler.tick();
  context.setTime('2026-10-28T12:00:00Z');
  await context.scheduler.tick();
  assert.equal(context.calls.length, 2);
  assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_dispatches WHERE state = 'uncertain'").get().count, 1);
  assert.ok(!context.logs.join(' ').includes('sensitive payload'));
  context.db.close();
});

test('duplicate member records sharing a phone receive a single greeting', async () => {
  const context = harness({ members: [people[0], { ...people[0], id: 'duplicate' }] });
  await context.scheduler.tick();
  assert.equal(context.calls.filter((call) => call.payload.template.name === 'impact23_birthday_greeting').length, 1);
  context.db.close();
});

test('long admin summaries split into supported template parameter lengths', async () => {
  const members = Array.from({ length: 30 }, (_, index) => ({
    ...people[0], id: String(index).padStart(2, '0'), name: `Member ${index} ${'a'.repeat(60)}`, whatsappOptIn: false,
  }));
  const context = harness({ members });
  await context.scheduler.tick();
  assert.ok(context.calls.length > 1);
  const summaries = context.calls.map((call) => call.payload.template.components[0].parameters[1].text);
  assert.ok(summaries.every((summary) => summary.length <= 1_000));
  for (const member of members) assert.ok(summaries.some((summary) => summary.includes(member.name)));
  context.db.close();
});

test('template parameters normalize embedded newlines, tabs, and repeated spaces', async () => {
  const context = harness({ members: [{ ...people[0], name: 'Ada\r\nExample', title: 'Board\t\tMember' }] });
  await context.scheduler.tick();
  const greeting = context.calls.find((call) => call.payload.template.name === 'impact23_birthday_greeting');
  assert.deepEqual(greeting.payload.template.components[0].parameters.map((parameter) => parameter.text), ['Ada Example', 'Board Member']);
  const summary = context.calls[0].payload.template.components[0].parameters[1].text;
  assert.equal(summary, 'Ada Example (Board Member)');
  context.db.close();
});
