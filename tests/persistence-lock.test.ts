import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonStore} from '../src/persistence/json-store.js';
import {SingleInstanceLock} from '../src/persistence/single-instance-lock.js';
const dirs:string[]=[];afterEach(async()=>Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true}))));
async function dir(){const d=await mkdtemp(join(tmpdir(),'discord-test-'));dirs.push(d);return d;}
describe('JSON store',()=>{it('writes valid state atomically and recovers backup',async()=>{const d=await dir();const file=join(d,'state.json');const store=new JsonStore(file);const state=await store.load();state.runtime.totalRequests=1;await store.save(state);state.runtime.totalRequests=2;await store.save(state);await writeFile(file,'broken');expect((await store.load()).runtime.totalRequests).toBe(1);expect(JSON.parse(await readFile(`${file}.bak`,'utf8')).version).toBe(2);});});
describe('single instance lock',()=>{it('fails closed for a live owner and allows release',async()=>{const file=join(await dir(),'lock');const first=new SingleInstanceLock(file,{pid:process.pid,instanceId:'a',startedAt:1});await first.acquire();await expect(new SingleInstanceLock(file,{pid:process.pid,instanceId:'b',startedAt:1}).acquire()).rejects.toThrow('already running');await first.release();await expect(new SingleInstanceLock(file,{pid:process.pid,instanceId:'b',startedAt:1}).acquire()).resolves.toBeUndefined();});});
