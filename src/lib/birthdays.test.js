import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, nextBirthday, sortUpcoming, createCalendar } from './birthdays.js';

test('upcoming birthdays cross the year boundary and include today', () => {
  const now = new Date(2026, 11, 31, 23, 59);
  assert.equal(daysUntil({ month: 12, day: 31 }, now), 0);
  assert.equal(daysUntil({ month: 1, day: 1 }, now), 1);
  assert.equal(nextBirthday({ month: 1, day: 1 }, now).getFullYear(), 2027);
  assert.deepEqual(sortUpcoming([{name:'Tomorrow',month:1,day:1},{name:'Today',month:12,day:31}], now).map(b=>b.name), ['Today', 'Tomorrow']);
});

test('February 29 is observed February 28 outside leap years', () => {
  assert.equal(daysUntil({month:2,day:29}, new Date(2027,1,28)), 0);
  assert.equal(daysUntil({month:2,day:29}, new Date(2028,1,28)), 1);
});

test('annual calendar export escapes text, folds UTF-8 lines and includes a reminder', () => {
  const ics = createCalendar([{id:'abc',name:'A, B; C\\D',title:'Member '.repeat(30),month:2,day:29}], new Date('2026-10-28T12:00:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20000229/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
  assert.match(ics, /A\\, B\\; C\\\\D/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});

test('calendar export neutralizes CR, CRLF and LF in names and titles', () => {
  const ics = createCalendar([{id:'safe',name:'A\rBEGIN:VEVENT',title:'B\r\nC\nD',month:1,day:1}]);
  assert.match(ics, /SUMMARY:A\\nBEGIN:VEVENT's birthday/);
  assert.match(ics, /DESCRIPTION:B\\nC\\nD/);
  assert.equal(ics.split('\r\n').filter(line => line === 'BEGIN:VEVENT').length, 1);
});
