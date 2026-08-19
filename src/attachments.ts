import {mkdir, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

export type AttachmentKind = 'image' | 'voice' | 'other';

export interface AttachmentInfo {
  name: string;
  localPath: string;
  contentType: string;
  size: number;
  kind: AttachmentKind;
}

export interface DownloadableAttachment {
  name: string | null;
  url: string;
  contentType: string | null;
  size: number;
}

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB
export const DOWNLOAD_TIMEOUT_MS = 30_000;
const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/**
 * Sanitize a filename so it cannot escape the destination directory via path
 * traversal, null bytes, or platform-specific separators.
 */
function sanitizeFilename(name: string | null, uniqueSuffix: string): string {
  let base: string;
  if (!name) {
    base = `attachment-${uniqueSuffix}`;
  } else {
    base = basename(name);
    if (!base || base === '.' || base.includes('\0') || base.includes('..')) {
      base = `attachment-${uniqueSuffix}`;
    } else if (uniqueSuffix) {
      const lastDot = base.lastIndexOf('.');
      if (lastDot > 0) {
        base = `${base.slice(0, lastDot)}-${uniqueSuffix}${base.slice(lastDot)}`;
      } else {
        base = `${base}-${uniqueSuffix}`;
      }
    }
  }
  return base;
}

/** Escape control characters that could break out of a prompt line. */
function sanitizePromptText(value: string): string {
  return value.replace(/[\n\r\t\0]/g, ' ');
}

/** Verify a URL points to a Discord CDN host (SSRF protection). */
function isDiscordCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DISCORD_CDN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Classify an attachment by its MIME content type and filename.
 * Images: image/* — JPEG, PNG, GIF, WebP, AVIF, etc.
 * Voice: audio/* — OGG (Opus), MP3, etc. Also catches Discord voice messages
 *        whose filenames contain "voice" (only when no audio MIME type).
 * Other: anything else (documents, archives, etc.) — still downloaded.
 */
export function classifyAttachment(attachment: {contentType?: string | null; name?: string | null}): AttachmentKind {
  const ct = (attachment.contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'voice';
  if (ct === '' && /voice/i.test(attachment.name || '')) return 'voice';
  return 'other';
}

/**
 * Download a single attachment from its CDN URL to a local directory.
 * Throws on network failure, non-Discord URL, or size limit so the caller
 * can decide to fall back to including the URL in the prompt.
 */
export async function downloadAttachment(
  attachment: DownloadableAttachment,
  destDir: string,
  signal?: AbortSignal,
  uniqueSuffix = '',
): Promise<AttachmentInfo> {
  const name = sanitizeFilename(attachment.name, uniqueSuffix);
  const localPath = join(destDir, name);
  const kind = classifyAttachment(attachment);

  if (!isDiscordCdnUrl(attachment.url)) {
    throw new Error(`Refusing to download from non-Discord URL`);
  }

  if (attachment.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`Attachment too large: ${formatFileSize(attachment.size)}`);
  }

  // Follow redirects so CDN URLs that 302 (resize variants, regional hosts) still
  // download, but re-validate the FINAL URL stayed on a Discord CDN host so an
  // open redirect can't smuggle the fetch to an arbitrary host (SSRF).
  const response = await fetch(attachment.url, {signal, redirect: 'follow'});
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  if (!isDiscordCdnUrl(response.url)) {
    throw new Error(`Download redirected to non-Discord host`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_ATTACHMENT_SIZE) {
    throw new Error(`Attachment too large: ${formatFileSize(Number(contentLength))}`);
  }

  const buffer = await response.arrayBuffer();
  const data = Buffer.from(buffer);

  if (data.byteLength > MAX_ATTACHMENT_SIZE) {
    throw new Error(`Downloaded file exceeds size limit: ${formatFileSize(data.byteLength)}`);
  }

  await mkdir(destDir, {recursive: true});
  await writeFile(localPath, data);
  return {
    name,
    localPath,
    contentType: attachment.contentType || 'application/octet-stream',
    size: data.byteLength,
    kind,
  };
}

/**
 * Build the attachment section to append to the agent prompt.
 * Filenames are sanitized to prevent prompt injection.
 */
export function buildAttachmentPrompt(attachments: AttachmentInfo[]): string {
  if (!attachments.length) return '';
  const lines = attachments.map(att => {
    const safeName = sanitizePromptText(att.name);
    return `- ${safeName} (${att.contentType}, ${formatFileSize(att.size)}, ${att.kind}): ${att.localPath}`;
  });
  return `📎 **Attachments** — downloaded to local files:\n${lines.join('\n')}`;
}

/** Check that a path resolves within a base directory (path containment). */
export function isWithinBase(localPath: string, baseDir: string): boolean {
  const resolved = resolve(localPath);
  const resolvedBase = resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + '/');
}

/**
 * Remove all downloaded attachment files for a request.
 * Always deletes individual files (safe regardless of path). If `baseDir` is
 * provided, also removes per-message directories — but only after verifying
 * they reside within the attachments base to prevent catastrophic deletion.
 */
export async function cleanupAttachments(attachments: AttachmentInfo[], baseDir?: string): Promise<void> {
  if (!attachments.length) return;
  const attachmentsBase = baseDir ? join(baseDir, '.discord-attachments') : null;
  for (const att of attachments) {
    if (attachmentsBase && !isWithinBase(att.localPath, attachmentsBase)) continue;
    await rm(att.localPath, {force: true}).catch(() => undefined);
  }
  if (attachmentsBase) {
    const dirs = new Set(attachments.map(att => dirname(att.localPath)));
    for (const dir of dirs) {
      if (isWithinBase(dir, attachmentsBase)) {
        await rm(dir, {recursive: true, force: true}).catch(() => undefined);
      }
    }
  }
}

/**
 * Safely attempt to download attachments. On per-file failure, falls back
 * to including the original CDN URL in the prompt so the request still works.
 */
export async function downloadAttachments(
  attachments: DownloadableAttachment[],
  destDir: string,
  signal?: AbortSignal,
): Promise<{downloaded: AttachmentInfo[]; fallback: string[]}> {
  const downloaded: AttachmentInfo[] = [];
  const fallback: string[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const uniqueSuffix = `${Date.now()}-${i}`;
    try {
      const info = await downloadAttachment(attachment, destDir, signal, uniqueSuffix);
      downloaded.push(info);
    } catch (error) {
      const name = sanitizePromptText(sanitizeFilename(attachment.name, uniqueSuffix));
      const reason = error instanceof Error ? error.message : String(error);
      fallback.push(`- ${name}: ${attachment.url} (download failed: ${reason})`);
    }
  }

  return {downloaded, fallback};
}

export function formatFileSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
