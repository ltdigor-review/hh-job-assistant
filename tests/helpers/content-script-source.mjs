import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const contentScriptFiles = [
  'src/error-text.js',
  'src/action-overlay.js',
  'src/defaults.js',
  'src/content-text.js',
  'src/content-dom.js',
  'src/content-hh.js'
];

export async function readContentScriptSource() {
  const parts = await Promise.all(contentScriptFiles.map((file) => readFile(new URL(file, root), 'utf8')));
  return parts.join('\n;\n');
}
