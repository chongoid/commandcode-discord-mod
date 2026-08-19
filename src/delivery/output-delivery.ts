import {readdir, readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {MAX_ATTACHMENT_SIZE} from '../attachments.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/**
 * Magic-byte signatures for the accepted image formats. Only used as a
 * defense-in-depth check on top of the extension, so a malicious file can't be
 * smuggled in under an image name (and a stray non-image won't be uploaded).
 */
const MAGIC: number[][] = [
  [0xff, 0xd8, 0xff],                       // JPEG
  [0x89, 0x50, 0x4e, 0x47],                 // PNG
  [0x47, 0x49, 0x46],                       // GIF
  [0x52, 0x49, 0x46, 0x46],                 // RIFF (WebP: RIFF....WEBP)
];

const WEBP_TAIL = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

/**
 * Scan a per-request output directory for image files the agent produced and
 * should be delivered back to the user as Discord attachments.
 *
 * Only files that:
 *   - sit directly inside `rootDir` (path-containment guard),
 *   - have an image extension AND matching magic bytes,
 *   - are a regular file within [1, MAX_ATTACHMENT_SIZE],
 *   - and were modified at/after `sinceMs`
 * are returned.
 *
 * `sinceMs` should be the request's `startedAt` so pre-existing files in the
 * directory (if any) are ignored and only this run's deliverables are picked up.
 */
export async function collectDeliverableImages(rootDir: string, sinceMs: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(rootDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const full = resolve(rootDir, name);
    if (!isWithinDir(full, rootDir)) continue; // defense-in-depth containment
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;

    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.mtimeMs < sinceMs) continue;
    if (st.size <= 0 || st.size > MAX_ATTACHMENT_SIZE) continue;
    if (!(await looksLikeImage(full))) continue;
    out.push(full);
  }
  return out;
}

function isWithinDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
}

async function looksLikeImage(path: string): Promise<boolean> {
  try {
    const data = await readFile(path);
    const b = Array.from(data.subarray(0, 12));
    const matched = MAGIC.some(sig => sig.every((v, i) => b[i] === v));
    if (!matched) return false;
    // WebP additionally carries "WEBP" at offset 8.
    if (b[0] === 0x52 && b[1] === 0x49) {
      return WEBP_TAIL.every((v, i) => b[8 + i] === v);
    }
    return true;
  } catch {
    return false;
  }
}
