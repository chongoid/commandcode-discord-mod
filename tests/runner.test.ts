import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {describe, expect, it, vi} from 'vitest';
import type {ChildProcess} from 'node:child_process';
import {CmdRunner} from '../src/agent/cmd-runner.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); pid = 12345; exitCode: null | number = null; killed = false; autoClose = true;
  kill = vi.fn((signal?: NodeJS.Signals) => {this.killed = true; if (this.autoClose && (signal === 'SIGKILL' || signal === 'SIGTERM')) {this.exitCode = signal === 'SIGKILL' ? 137 : 143; queueMicrotask(() => this.emit('close', this.exitCode, signal));} return true;});
  close(code = 0) {this.exitCode = code; this.emit('close', code, null);}
}
const options = {attemptId: 'a', prompt: 'hello', cwd: '.', yolo: false, maxTurns: 10, timeoutMs: 100};

describe('cmd runner', () => {
  it('awaits result and close and parses events incrementally', async () => {const child = new FakeChild(); const spawn = vi.fn(() => child as unknown as ChildProcess); const runner = new CmdRunner(spawn as never, 'cmd', 1, 10); const events: unknown[] = []; const promise = runner.run(options, event => events.push(event)); child.stdout.write('{"type":"event","event":{"type":"tool_running","toolCallId":"1"}}\n'); child.stdout.write('{"type":"result","subtype":"success","finalText":"done","sessionId":"s"}\n'); let settled = false; void promise.then(() => settled = true); await Promise.resolve(); expect(settled).toBe(false); child.close(); expect(await promise).toEqual({kind: 'success', finalText: 'done', sessionId: 's', durationMs: undefined, usage: undefined}); expect(events).toHaveLength(1);});
  it('does not timeout or cancel after receiving a successful result', async () => {const child = new FakeChild(); const runner = new CmdRunner((() => child as unknown as ChildProcess) as never, 'cmd', 1, 20); const promise = runner.run({...options, timeoutMs: 5}, () => {}); child.stdout.write('{"type":"result","subtype":"success","finalText":"done"}\n'); await new Promise(resolve => setTimeout(resolve, 10)); expect(child.kill).not.toHaveBeenCalled(); expect(await runner.cancel('a')).toBe(false); child.close(); expect((await promise).kind).toBe('success');});
  it('forces cancellation settlement when close never arrives', async () => {const child = new FakeChild(); child.autoClose = false; const runner = new CmdRunner((() => child as unknown as ChildProcess) as never, 'cmd', 1, 2); const promise = runner.run(options, () => {}); expect(await runner.cancel('a')).toBe(true); expect(await promise).toEqual({kind: 'cancelled'}); expect(child.kill).toHaveBeenCalledWith('SIGKILL');});
  it('classifies stale resume without recursive replay', async () => {const child = new FakeChild(); const spawn = vi.fn(() => child as unknown as ChildProcess); const runner = new CmdRunner(spawn as never, 'cmd', 1); const promise = runner.run({...options, sessionId: 'old'}, () => {}); child.stderr.write('Error: session not found'); child.close(1); expect(await promise).toMatchObject({kind: 'stale_session'}); expect(spawn).toHaveBeenCalledTimes(1);});
  it('handles malformed close and timeout terminal paths', async () => {const malformed = new FakeChild(); const runner1 = new CmdRunner((() => malformed as unknown as ChildProcess) as never, 'cmd', 1); const p1 = runner1.run(options, () => {}); malformed.stdout.write('bad\n'); malformed.close(1); expect(await p1).toMatchObject({kind: 'error', error: expect.stringContaining('malformed')}); const timed = new FakeChild(); const runner2 = new CmdRunner((() => timed as unknown as ChildProcess) as never, 'cmd', 1, 2); const p2 = runner2.run({...options, timeoutMs: 1}, () => {}); expect(await p2).toEqual({kind: 'timeout'});});
});
