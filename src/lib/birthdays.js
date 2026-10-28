export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function observedDate(birthday, year) {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 28 : birthday.day;
  return new Date(year, birthday.month - 1, day);
}

export function nextBirthday(birthday, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date = observedDate(birthday, today.getFullYear());
  if (date < today) date = observedDate(birthday, today.getFullYear() + 1);
  return date;
}

export function daysUntil(birthday, now = new Date()) {
  const next = nextBirthday(birthday, now);
  const utcNext = Date.UTC(next.getFullYear(), next.getMonth(), next.getDate());
  const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((utcNext - utcNow) / 86400000);
}

export function sortUpcoming(birthdays, now = new Date()) {
  return [...birthdays].sort((a, b) => daysUntil(a, now) - daysUntil(b, now) || a.name.localeCompare(b.name));
}

export function birthdayLabel(birthday) {
  return `${MONTHS[birthday.month - 1].slice(0, 3)} ${birthday.day}`;
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
}

function escapeIcs(value) {
  return value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

export function createCalendar(birthdays, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Impact23 Foundation//Birthdays//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Impact23 Birthdays'];
  for (const birthday of birthdays) {
    // Use leap year 2000 as the annual anchor, preserving MM/DD without a birth year.
    const date = `2000${String(birthday.month).padStart(2, '0')}${String(birthday.day).padStart(2, '0')}`;
    lines.push('BEGIN:VEVENT', `UID:${birthday.id}@birthdays.impact23.local`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date}`, 'DURATION:P1D', birthday.month === 2 && birthday.day === 29 ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : 'RRULE:FREQ=YEARLY', `SUMMARY:${escapeIcs(birthday.name)}'s birthday`, `DESCRIPTION:${escapeIcs(`${birthday.title ? birthday.title + ' · ' : ''}Impact23 International Support Foundation`)}`, 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:Birthday tomorrow: ${escapeIcs(birthday.name)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545: fold physical lines at 75 UTF-8 octets without splitting characters.
  return lines.map(line => {
    let result = '', length = 0;
    for (const character of line) {
      const size = new TextEncoder().encode(character).length;
      if (length + size > 75) { result += '\r\n '; length = 1; }
      result += character;
      length += size;
    }
    return result;
  }).join('\r\n') + '\r\n';
}
