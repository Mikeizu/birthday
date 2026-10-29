import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";

// One self-contained file: no CDN, API, font, image, or stylesheet requests.
const output = await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  write: false,
  outfile: "preview.js",
  format: "iife",
  minify: true,
  target: "es2022",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": '{"PROD":false,"MODE":"preview"}',
  },
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  legalComments: "inline",
});
const js = output.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replace(/<\/script/gi, "<\\/script");
const css = output.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/<\/style/gi, "<\\/style");
const icon = (await readFile("public/favicon.svg")).toString("base64");
const notices = (await Promise.all(['react', 'react-dom', 'scheduler', 'lucide-react', '@fontsource/dm-sans', '@fontsource/manrope'].map(async name => `${name}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`))).join('\n\n========================================\n\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#365e49"><meta name="description" content="Impact23 Birthday Book — a self-contained offline HTML app. Records stay in your browser on this device."><title>Impact23 Birthday Book · Offline HTML App</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}"><style>${css}</style></head><body><div id="root"></div><noscript>Enable JavaScript to use the offline birthday book.</noscript><script type="text/plain" id="third-party-notices">${notices.replace(/<\/script/gi, '<\\/script')}</script><script>window.__IMPACT23_STANDALONE__=true;</script><script>${js}</script></body></html>`;
await mkdir("dist", { recursive: true });
await writeFile("dist/preview.html", html);
const instructions = `IMPACT23 BIRTHDAY BOOK — OFFLINE HTML APP

1. Extract this ZIP.
2. Double-click preview.html and open it in a current Chrome, Edge, Firefox, or Safari browser.
3. Choose Admin sign in and create a local password (at least 12 characters).
4. Add names, titles, and MM/DD birthdays. No installation or internet is required.

This is a local birthday book, not a connection to the shared server.
It saves records in this browser on this device. Keep preview.html at a stable location;
file storage behavior varies between browsers. Use Birthday directory > Back up birthdays
regularly. Restore backup lets you transfer data to another copy of the app.
Do not clear browser storage until you have backed up your records.

Local browser storage is not encrypted. Use a trusted device. The local password is
hashed and gates the interface; it does not provide shared-server access control.
No real member records, passwords, or WhatsApp credentials are included in this file.

For automatic reminders when the app is closed: download the birthday calendar and
import it into your calendar app. Calendar notifications follow your device settings.
Browser notifications work while the app is open. Automatic WhatsApp messages require
the hosted server, internet, Meta credentials, and approved templates.
`;
// A ZIP reliably downloads from GitHub even when a browser displays raw HTML as text.
if (process.argv.includes('--write-root')) {
await writeFile('preview.html', html);
await writeFile(
  "impact23-preview.zip",
  zipSync(
    {
      "preview.html": strToU8(html),
      "OPEN-THE-APP.txt": strToU8(instructions),
      "THIRD-PARTY-NOTICES.txt": strToU8(notices),
    },
    { level: 9, mtime: new Date(2020, 0, 1) },
  ),
);
}
console.log(
  `Self-contained preview.html built (${Math.round(Buffer.byteLength(html) / 1024)} KB). Open it directly in a browser; no server required.`,
);
