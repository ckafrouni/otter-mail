/** The app's small JSON documents (settings.json, accounts.json, …) in its own files. */

import { utf8Decode } from "./bytes.js";
import { platform } from "./platform.js";

/** The parsed file, or null when it doesn't exist or isn't JSON. */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const bytes = await platform().files.read(name);
    return bytes ? (JSON.parse(utf8Decode(bytes)) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await platform().files.write(name, JSON.stringify(value, null, 2));
}
