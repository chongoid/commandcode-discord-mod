import {promises as fs} from 'node:fs';
import {dirname} from 'node:path';
export interface LockOwner {pid: number; instanceId: string; startedAt: number; processStart?: string; bootId?: string}
export class SingleInstanceLock {
  private held = false;
  constructor(private readonly file: string, private readonly owner: LockOwner) {}
  async acquire(): Promise<void> {
    await fs.mkdir(dirname(this.file), {recursive: true});
    this.owner.processStart ||= await processStart(this.owner.pid);
    this.owner.bootId ||= await bootId();
    try {const handle = await fs.open(this.file, 'wx', 0o600); await handle.writeFile(JSON.stringify(this.owner)); await handle.sync(); await handle.close(); this.held = true; return;}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
    const raw = await fs.readFile(this.file, 'utf8').catch(() => '');
    let owner: Partial<LockOwner> = {}; try {owner = JSON.parse(raw);} catch {}
    if (typeof owner.pid === 'number' && await sameProcess(owner)) throw new Error(`Discord runtime already running (pid ${owner.pid})`);
    const current = await fs.readFile(this.file, 'utf8').catch(() => '');
    if (current !== raw) throw new Error('Discord runtime lock changed during takeover');
    await fs.unlink(this.file);
    return this.acquire();
  }
  async release(): Promise<void> {if (!this.held) return; try {const current = JSON.parse(await fs.readFile(this.file, 'utf8')) as LockOwner; if (current.instanceId === this.owner.instanceId) await fs.unlink(this.file);} catch {} this.held = false;}
}
async function sameProcess(owner: Partial<LockOwner>): Promise<boolean> {if (!owner.pid || !isAlive(owner.pid)) return false; if (!owner.processStart || !owner.bootId) return true; const [start, boot] = await Promise.all([processStart(owner.pid), bootId()]); return owner.processStart === start && owner.bootId === boot;}
function isAlive(pid: number): boolean {try {process.kill(pid, 0); return true;} catch (error) {return (error as NodeJS.ErrnoException).code === 'EPERM';}}
async function processStart(pid: number): Promise<string | undefined> {try {const fields = (await fs.readFile(`/proc/${pid}/stat`, 'utf8')).split(' '); return fields[21];} catch {return undefined;}}
async function bootId(): Promise<string | undefined> {try {return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();} catch {return undefined;}}
