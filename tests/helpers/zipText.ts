// Read an exported ZIP package (3MF, OBJ+MTL bundle) back as text, Node-side.
// Exports are DEFLATE-compressed, so specs can't regex the raw bytes; this
// inflates every entry with the app's own reader and joins `name\ncontents`
// for each, so both entry names and XML/JSON bodies are searchable.

import { openZip } from '../../src/import/zipReader';

export async function zipText(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new Uint8Array(Buffer.from(data, 'base64')) : data;
  const zip = openZip(bytes);
  const parts = await Promise.all(zip.entries.map(async (e) => `${e.name}\n${await zip.readText(e)}`));
  return parts.join('\n');
}
