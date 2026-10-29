# Impact23 Birthday Book

A birthday reminder app for **Impact23 International Support Foundation**. Keep every name, title, and birthday together, browse by month, and celebrate your people on time.

## Open the offline HTML app

Download **[impact23-preview.zip](impact23-preview.zip)**, extract it, and open **[preview.html](preview.html)** in a current browser. No Node.js installation or server is needed for this version. Choose **Admin sign in** to create a local password, then add your people. You can also explore clearly labeled sample records.

The HTML app includes its JavaScript, design, icons, and fonts in one file. It makes no API or CDN requests. Records stay in that browser on that device and are separate from the hosted app's database. Keep the file in a stable location; browser storage for local files varies between browsers. Use **Birthday directory → Back up birthdays** regularly, and **Restore backup** to transfer records. Browser storage is not encrypted; the local password gates the interface on a trusted personal device. It is not a replacement for the hosted app's server authentication.

Some managed work or school browsers block local HTML files. If so, use a permitted browser or serve the built app through your approved hosting environment. Do not disable managed browser policies.

## What it does

- A responsive dashboard with upcoming birthdays and community totals.
- A month calendar and searchable directory, with month filters and sorting.
- Password-protected admin access to add, edit, and remove names, titles, and birthdays in **MM/DD**. No birth year is collected.
- SQLite persistence. Records survive browser refreshes and server restarts.
- Automatic WhatsApp daily summaries for the admin and individual greetings for opted-in celebrants, through the official Meta WhatsApp Cloud API.
- Yearly calendar downloads with a reminder one day before, and optional browser alerts while the app is open.
- Clearly labeled sample view for exploring the design without creating real records.
- Installable offline app: cached pages and fonts, remembered local admin access, durable queued edits, automatic reconnection sync, and explicit conflict resolution.
- A standalone HTML app, JSON birthday backups, and backup restoration.

February 29 birthdays are observed on February 28 in non-leap years, including WhatsApp reminders and calendar exports. Dates default to Africa/Lagos time. The app starts with an empty directory; sample names are never saved as real foundation members.

## Use the shared app offline

1. Open the hosted app over HTTPS (or the locally built app on loopback), sign in, and let the birthday book finish loading.
2. Wait for **Available offline**, then use **Install app** or the browser's **Add to Home Screen / Install app** option. Installation is optional; the same saved browser can reopen the app offline.
3. Keep using the calendar, search, and directory without internet. Remembered admins can add, edit, and remove birthdays. Every change is saved on the device before a sync is attempted, and pending changes survive page refreshes.
4. Reconnect to sync. If the server session expired, choose **Sign in to sync**; your offline changes remain saved until you do. If another device changed the same record, choose **Keep device version** or **Keep server version**. New records use client UUIDs to prevent duplicates after interrupted requests.

Offline access belongs to this browser and device. Use a trusted device, keep backups, and do not clear site storage until unsynced changes are saved elsewhere. Explicit sign-out removes private contact details from the hosted app's local snapshot. If changes are pending, the app offers **Backup & sign out** instead of silently losing them; this clears the pending queue after downloading a restorable backup. In the standalone HTML version the local records remain on the device after sign-out, while contact details are hidden until local login.

Offline snapshots and pending writes are separate from the service worker cache. The worker caches only the public application shell and assets, never API responses. Modern browsers with Web Locks serialize tabs sharing this device's book; on browsers without Web Locks use one editing tab at a time. The app requests persistent storage when installing, but a browser can still clear or evict local data. Backups remain important.

The Vite development server does not install a service worker. To validate installed offline behavior use `npm run build`, then serve the built app. Production requires the admin configuration described below. The standalone HTML works independently of that server.

### What runs while you are offline or the app is closed

| Feature | Offline behavior |
| --- | --- |
| Birthday records, calendar, search, and remembered admin edits | Work offline after the shared app has been saved, or directly in the HTML app |
| Sync to the shared database | Waits for the server and a valid admin session |
| Browser birthday notifications | Work while the app is open, subject to browser permission |
| Calendar reminders | Import the downloaded `.ics` into a calendar app; it can notify while this app is closed, according to device settings |
| Automatic WhatsApp summaries and greetings | Continue independently of your browser when the configured server is online; sending still requires the server's internet connection |

A browser cannot guarantee scheduled notifications while a page is closed or a device is powered off. The calendar download is the offline option for reminders handled by your device's calendar application. No birthday information is lost merely because a WhatsApp connection is unavailable.

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
npm run test:offline
```

The unit/API tests cover admin authentication, authorization, validation, contact privacy, persistence, year boundaries, leap days, calendar exports, and WhatsApp dispatch/retry behavior with a mock provider. Playwright browser tests use an isolated test database and exercise the real UI. They use `/usr/bin/chromium` when available; otherwise install Chromium with `npx playwright install chromium` first. Optional `CHROMIUM_PATH` selects another installed Chromium binary.

`npm run build` also generates `dist/preview.html` and a versioned precache list in `dist/sw.js`, without rewriting the tracked downloads. `npm run build:preview` explicitly refreshes the root `preview.html` and downloadable ZIP after source changes. Do not edit generated preview files manually. `npm run test:offline` serves the production build on an isolated port and tests real service-worker offline reload, queued CRUD, exactly-once replay, reauthentication, and conflict handling. The self-contained HTML test fulfills the exact generated document in memory with the network disabled and rejects all API/asset requests. The managed test browser blocks `file://` navigation, so direct file opening is not verified by that test.

Calendar downloads are static imports. Import again when birthdays change, and remove the older imported calendar first to avoid duplicates. Browser alerts work only while the app is open and the browser permits notifications. Automatic WhatsApp delivery needs the running server and configured Meta account; it does not depend on an open browser.
