import { createApp } from './app.js';
import { startWhatsAppScheduler } from './whatsapp.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const { app, db, getBirthdays, close } = createApp();
const stopWhatsApp = startWhatsAppScheduler({ db, getBirthdays });
const server = app.listen(port, host, () => {
  console.log(`Impact23 birthday API listening on ${host}:${port}`);
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  stopWhatsApp();
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
