import {constants, promises as fs} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import type {AppState} from '../domain.js';
import type {StateStore} from '../ports.js';
import {emptyState} from '../domain.js';
import {migrateLegacy} from './migrate-v1.js';
import {validateState} from './state-schema.js';

export class JsonStore implements StateStore {
  private chain = Promise.resolve();
  constructor(private readonly file: string, private readonly legacyFile?: string) {}
  async load(): Promise<AppState> {
    try {return validateState(JSON.parse(await fs.readFile(this.file, 'utf8')));}
    catch (primaryError) {
      try {const backup = validateState(JSON.parse(await fs.readFile(`${this.file}.bak`, 'utf8'))); await this.atomicPrimary(backup); return backup;}
      catch (backupError) {
        if ((primaryError as NodeJS.ErrnoException).code !== 'ENOENT') throw primaryError;
        if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError;
      }
    }
    if (this.legacyFile) {
      const marker = `${this.file}.migrated`;
      try {await fs.access(marker);}
      catch {
        try {const migrated = migrateLegacy(JSON.parse(await fs.readFile(this.legacyFile, 'utf8'))); await this.save(migrated); await fs.writeFile(marker, `${Date.now()}\n`, {mode: 0o600}); return migrated;}
        catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
      }
    }
    const state = emptyState(); await this.save(state); return state;
  }
  async save(state: AppState): Promise<void> {const operation = this.chain.then(() => this.atomicWrite(validateState(structuredClone(state)))); this.chain = operation.catch(() => undefined); return operation;}
  private async atomicWrite(state: AppState): Promise<void> {
    try {const current = validateState(JSON.parse(await fs.readFile(this.file, 'utf8'))); await this.atomicFile(`${this.file}.bak`, current);} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
    await this.atomicPrimary(state);
  }
  private async atomicPrimary(state: AppState): Promise<void> {await this.atomicFile(this.file, state);}
  private async atomicFile(file: string, state: AppState): Promise<void> {
    const dir = dirname(file); await fs.mkdir(dir, {recursive: true}); const temp = join(dir, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`); const payload = `${JSON.stringify(state, null, 2)}\n`;
    const handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {await handle.writeFile(payload); await handle.sync();} finally {await handle.close();}
    await fs.rename(temp, file);
    const dh = await fs.open(dir, 'r'); try {await dh.sync();} finally {await dh.close();}
  }
}

export class MemoryStore implements StateStore {constructor(public state = emptyState()) {} async load(): Promise<AppState> {return structuredClone(this.state);} async save(state: AppState): Promise<void> {this.state = structuredClone(validateState(state));}}
