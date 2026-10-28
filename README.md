# Impact23 Birthday Book

A birthday reminder app for **Impact23 International Support Foundation**. Keep every name, title, and birthday together, browse by month, and celebrate your people on time.

## What it does

- A responsive dashboard with upcoming birthdays and community totals.
- A month calendar and searchable directory, with month filters and sorting.
- Password-protected admin access to add, edit, and remove names, titles, and birthdays in **MM/DD**. No birth year is collected.
- SQLite persistence. Records survive browser refreshes and server restarts.
- Automatic WhatsApp daily summaries for the admin and individual greetings for opted-in celebrants, through the official Meta WhatsApp Cloud API.
- Yearly calendar downloads with a reminder one day before, and optional browser alerts while the app is open.
- Clearly labeled sample view for exploring the design without creating real records.

February 29 birthdays are observed on February 28 in non-leap years, including WhatsApp reminders and calendar exports. Dates default to Africa/Lagos time. The app starts with an empty directory; sample names are never saved as real foundation members.

## Run locally

Requires **Node.js 24+** and npm. No external database or other service is needed for the birthday book.

```sh
cd /workspace/birthday
npm ci --cache /tmp/impact23-npm-cache
npm run dev
```

Vite runs on port **5173** and proxies API requests to Express on **3001**. In the app, choose **Admin sign in** and create a password of at least 12 characters on the first local run. Keep this password: the app stores only a salted hash, and there is no password recovery email. To replace a forgotten password, configure a new `ADMIN_PASSWORD` in the server environment and restart.

Copy `.env.example` to an untracked `.env` if you need local configuration. The npm dev/start scripts load that file. Do not leave a blank `ADMIN_PASSWORD` assignment: omit it until you set a real password. The API reads credentials only on the server.

## WhatsApp reminders

See [docs/WHATSAPP.md](docs/WHATSAPP.md) for complete Meta setup, template wording, and delivery behavior. The Reminders page shows which configuration is missing. Required server settings:

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta access token with WhatsApp messaging permission; keep secret |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta sender phone number ID |
| `WHATSAPP_RECIPIENT_PHONE` | Admin WhatsApp number, including country code |
| `WHATSAPP_TEMPLATE_NAME` | Approved admin summary template; default `impact23_birthday_reminder` |
| `WHATSAPP_GREETING_TEMPLATE_NAME` | Approved personal greeting; default `impact23_birthday_greeting` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved template language; default `en` |
| `WHATSAPP_SEND_TIME` | Local send time, default `08:00` |
| `APP_TIME_ZONE` | Foundation timezone, default `Africa/Lagos` |

Each member’s optional WhatsApp number is stored in international format, such as `+2348012345678`. Record permission in the admin form before enabling that member’s greeting. An admin daily summary is sent only when there are birthdays that day. The server must remain online; it checks every minute and can catch up later the same day. Duplicate dispatches are prevented by durable SQLite records.

**Configured** means the settings are present and structurally valid. It does not confirm account authorization, template approval, or delivery. No live WhatsApp messages are sent by the test suites. Add `graph.facebook.com` to your hosting network allowlist if outbound access is restricted.

## Build and production

```sh
npm run build
npm start
```

Express serves both the built frontend and API on port **3001**. The initial production launch requires `ADMIN_PASSWORD` (at least 12 characters) or an admin password already saved by local setup. Use HTTPS through your reverse proxy; production session cookies are Secure and HttpOnly. Set `HOST=0.0.0.0` when your hosting platform needs a publicly bound server. The default loopback binding is suitable behind a local reverse proxy. Session expiry is 12 hours, and sessions reset when the server restarts.

Your reverse proxy must preserve the browser's original `Host` header for same-origin write protection. For Nginx, set `proxy_set_header Host $http_host;`. When using a custom API port in development, also supply the matching `API_PORT` to Vite.

Attach **persistent storage** for `.data/`, or set `DATABASE_PATH` to a persistent volume path. The database includes birthday records, private WhatsApp contact details, the administrator password hash, and reminder dispatch state. The birthday calendar and names/titles are publicly readable by people who can access this application; contact numbers require admin access. Put the whole app behind your foundation’s access gateway if names and dates should also be restricted.

To make a consistent database backup while the app is running:

```sh
node --env-file-if-exists=.env --input-type=module -e "import { DatabaseSync, backup } from 'node:sqlite'; const db = new DatabaseSync(process.env.DATABASE_PATH || '.data/birthdays.sqlite'); await backup(db, '.data/birthdays-backup.sqlite'); db.close();"
```

Protect backup files like the original database. To restore, stop the server, preserve the current database for recovery, then restore the backup to `DATABASE_PATH` and restart. Do not copy only the main SQLite file while the app is running: write-ahead log files may contain newer records.

## Validation

```sh
npm run check
npm test
npm run build
npm run test:e2e
```

The unit/API tests cover admin authentication, authorization, validation, contact privacy, persistence, year boundaries, leap days, calendar exports, and WhatsApp dispatch/retry behavior with a mock provider. Playwright browser tests use an isolated test database and exercise the real UI. They use `/usr/bin/chromium` when available; otherwise install Chromium with `npx playwright install chromium` first. Optional `CHROMIUM_PATH` selects another installed Chromium binary.

Calendar downloads are static imports. Import again when birthdays change, and remove the older imported calendar first to avoid duplicates. Browser alerts work only while the app is open and the browser permits notifications. Automatic WhatsApp delivery needs the running server and configured Meta account; it does not depend on an open browser.
