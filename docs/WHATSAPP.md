# WhatsApp birthday reminders

Impact23 can send both a birthday summary to the foundation admin and a personal greeting to each celebrant who has opted in. The integration uses the official Meta WhatsApp Cloud API. It does not send messages until the required server configuration is present.

## Connect WhatsApp Business

1. Set up a Meta Business account, a WhatsApp Business account, and an approved sender in the Meta developer console. Obtain the sender's **phone number ID**, which is different from its actual phone number.
2. Create a server-side access token with access to that sender and the `whatsapp_business_messaging` permission. For a long-running service, use a suitable system-user token rather than a short-lived testing token.
3. Create and obtain approval for the two templates below, using the exact language code you configure. Meta determines which template category is appropriate. Adding a template name to the app does not create or approve that template.
4. Configure the variables below in your hosting provider's environment or secret settings. Keep the access token server-side. Do not paste it into the app, repository, chat, or a browser variable such as `VITE_*`.
5. Allow outbound HTTPS requests to `graph.facebook.com`, then restart the server so it reads the configuration.

The admin's WhatsApp number must belong to someone who has agreed to receive these reminders. Celebrants must give permission before the admin enables their WhatsApp birthday greeting in the birthday form. Add their number in international format, including `+` and country code with no spaces, and check the consent box. A number alone never opts someone in. Uncheck that box to stop future greetings.

## Server variables

| Variable | Requirement / default |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Required secret: the Meta access token authorized for your sender. |
| `WHATSAPP_PHONE_NUMBER_ID` | Required: numeric ID of your WhatsApp Business sender. |
| `WHATSAPP_RECIPIENT_PHONE` | Required for the admin summary: the admin's international WhatsApp number. |
| `WHATSAPP_TEMPLATE_NAME` | Admin template; defaults to `impact23_birthday_reminder`. |
| `WHATSAPP_GREETING_TEMPLATE_NAME` | Celebrant template; defaults to `impact23_birthday_greeting`. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved template language code; defaults to `en`. Use the exact approved code, such as `en_US`, if different. |
| `WHATSAPP_SEND_TIME` | Daily local time in 24-hour `HH:mm` format; defaults to `08:00`. |
| `APP_TIME_ZONE` | IANA timezone for automatic delivery; defaults to `Africa/Lagos`. |
| `DATABASE_PATH` | Persistent SQLite location; defaults to `.data/birthdays.sqlite` relative to the server's working directory. |

Set these values through the hosting environment. If you use a local, untracked `.env` file, it must be explicitly loaded into the Node server. For example, from the repository root after installing dependencies and building:

```sh
NODE_ENV=production node --env-file=.env server/index.js
```

The file must also provide any other production settings you need, including `ADMIN_PASSWORD` if the database does not already have an administrator password. Never commit `.env` or its values. The app's displayed current date and the scheduler both use APP_TIME_ZONE; the default is Africa/Lagos. The npm dev/start scripts also load an existing .env automatically.

## Approved template examples

Use **body** text parameters in this order. The sender must have approval for both templates in the configured language. Do not add header or button parameters without also updating the server integration.

### Admin: `impact23_birthday_reminder`

```text
Impact23 birthday reminder for {{1}}: {{2}}. Please help us celebrate our community today.
```

- `{{1}}`: the date, for example `28 October 2026`.
- `{{2}}`: today's names and optional titles, for example `Sample Member (Volunteer); Another Sample`.

The summary includes everyone whose birthday is today, regardless of whether they have a WhatsApp number or have opted in to a personal greeting. Long summaries are split into separate messages so no names are dropped.

### Celebrant: `impact23_birthday_greeting`

```text
Happy birthday, {{1}}! Thank you for your contribution as {{2}} at Impact23 International Support Foundation. We wish you a joyful year ahead.
```

- `{{1}}`: the celebrant's name.
- `{{2}}`: their recorded title or `Impact23 member` when no title was supplied.

The greeting is sent only when a valid number and recorded permission are both present. Duplicate birthday records with the same phone number receive one personal greeting per day.

## When reminders run

The server checks once at startup and then every minute. At or after the configured local send time, it sends that day's admin summary and eligible greetings. Each succeeds or fails independently, so a failed admin summary does not prevent celebrant greetings.

Keep the server online and its database on persistent storage. If it restarts later on the same date, it catches up on unsent reminders. It does not send missed birthdays from previous dates. February 29 birthdays are observed on February 28 in non-leap years without changing the recorded birthday.

The admin summary is a daily snapshot. Adding a birthday after that summary was sent does not send a second summary; an eligible celebrant greeting can still be sent later that day. Removing a birthday or withdrawing permission prevents future greetings, but cannot recall a message already accepted by Meta.

## Delivery state, retries, and verification

The Reminders screen reports whether server values are present and structurally valid. **Configured is not proof of an approved template, valid account access, or delivered message.** A unit test also does not establish live delivery. Verify the first authorized message and subsequent delivery outcomes in WhatsApp Business / Meta message logs.

The SQLite `whatsapp_dispatches` table retains dispatch keys, local dates, state, attempt counts, retry times, and safe error descriptions. Recipient identifiers in dispatch keys are hashed; tokens and message bodies are not stored in this table. The birthday database itself contains member contact details, so restrict access and preserve its backups. Losing this table while keeping the same recipients can cause previously accepted messages to be sent again.

Successful API acceptance is recorded as `sent` and is not retried. This indicates Meta returned a message ID, rather than confirming receipt on the person's device. Check the provider's delivery logs for final delivery status; this application does not ingest delivery webhooks.

HTTP `429` and server errors retry with backoff: one minute, five minutes, fifteen minutes, then one hour, with a maximum of five attempts. Permanent API rejections are recorded as `failed`. Standard server logs report safe HTTP status messages without access tokens, recipient numbers, or message text.

A network timeout, interrupted send, or ambiguous successful response is recorded as `uncertain` once detected. It is not automatically resent because Meta may already have accepted it. Check Meta's delivery logs before deciding whether to resend through an authorized operation. There is no automatic reset or manual resend button in this version.

Calendar exports are a separate reminder option. February 29 entries use the RFC 5545 yearly recurrence `BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1`, selecting the last valid day from February 28 and 29. They therefore follow the same February 28 observation in non-leap years. Imported files do not update automatically when the directory changes.
