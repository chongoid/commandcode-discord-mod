import {mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {collectDeliverableImages} from '../src/delivery/output-delivery.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const TXT = Buffer.from('not an image');

async function seed(root: string, mtimeMs: number): Promise<void> {
  await mkdir(root, {recursive: true});
  const put = async (name: string, data: Buffer, mtime: number) => {
    const path = join(root, name);
    await writeFile(path, data);
    const {utimes} = await import('node:fs/promises');
    await utimes(path, new Date(mtime), new Date(mtime)).catch(() => undefined);
  };
  await put('a.jpg', JPEG, mtimeMs + 1000);
  await put('b.png', PNG, mtimeMs + 1000);
  await put('old.jpg', JPEG, mtimeMs - 100_000);   // before sinceMs -> ignored
  await put('stray.txt', TXT, mtimeMs + 1000);       // non-image
}

describe('collectDeliverableImages', () => {
  it('returns only fresh image files with valid magic bytes', async () => {
    const dir = join(tmpdir(), `outdel-${Date.now()}`);
    await seed(dir, Date.now());
    const got = await collectDeliverableImages(dir, Date.now() - 50_000);
    expect(got.map(p => p.slice(p.lastIndexOf('/') + 1)).sort()).toEqual(['a.jpg', 'b.png']);
    await rm(dir, {recursive: true, force: true});
  });

  it('ignores non-image extensions even with valid content', async () => {
    const dir = join(tmpdir(), `outdel2-${Date.now()}`);
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, 'a.jpeg.txt'), JPEG);
    await writeFile(join(dir, 'noext'), JPEG);
    const got = await collectDeliverableImages(dir, 0);
    expect(got).toHaveLength(0);
    await rm(dir, {recursive: true, force: true});
  });

  it('returns empty for a missing directory', async () => {
    const got = await collectDeliverableImages(join(tmpdir(), `missing-${Date.now()}`), 0);
    expect(got).toEqual([]);
  });

  it('ignores a file larger than the attachment cap', async () => {
    const dir = join(tmpdir(), `outdel3-${Date.now()}`);
    await mkdir(dir, {recursive: true});
    const big = Buffer.concat([JPEG, Buffer.alloc(26 * 1024 * 1024)]);
    await writeFile(join(dir, 'big.jpg'), big);
    const got = await collectDeliverableImages(dir, 0);
    expect(got).toHaveLength(0);
    await rm(dir, {recursive: true, force: true});
  });
});
