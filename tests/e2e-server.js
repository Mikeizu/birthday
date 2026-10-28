// The browser suite always uses an isolated database and cannot send messages.
// Do not load .env here: a developer's real credentials must stay out of tests.
delete process.env.ADMIN_PASSWORD;
for (const name of Object.keys(process.env)) {
  if (name.startsWith('WHATSAPP_')) delete process.env[name];
}
process.env.NODE_ENV = 'test';
await import('../server/index.js');
