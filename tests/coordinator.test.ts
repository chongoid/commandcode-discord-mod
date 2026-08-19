import {access, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {emptyState, newProgress} from '../src/domain.js';
import {MemoryStore} from '../src/persistence/json-store.js';
import {OutboxWorker} from '../src/delivery/outbox-worker.js';
import {RequestCoordinator} from '../src/orchestration/request-coordinator.js';
import {FakeDiscord, FakeRunner, dm, eventually} from './helpers/fakes.js';

function setup(workingDir = '.') {const state = emptyState(); const store = new MemoryStore(state); const discord = new FakeDiscord(); const runner = new FakeRunner(); const outbox = new OutboxWorker(state, store, discord, 1); const coordinator = new RequestCoordinator(state, store, runner, outbox, {workingDir, yolo: false, maxTurns: 10, timeoutMs: 1000}); return {state, store, discord, runner, outbox, coordinator};}

describe('coordinator', () => {
  it('runs rapid followups FIFO with separate final messages and correct counts', async () => {
    const x = setup(); x.runner.outcomes.push({kind: 'success', finalText: 'first', sessionId: 's'}, {kind: 'success', finalText: 'second', sessionId: 's'});
    await Promise.all([x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '1', prompt: 'one'}), x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '2', prompt: 'two'})]);
    await eventually(() => x.runner.runs.length === 2 && x.state.runtime.activeCount === 0);
    expect(x.runner.runs.map(run => run.prompt)).toEqual(['one', 'two']);
    expect(x.discord.sent.filter(message => ['first', 'second'].includes(message.content)).map(message => message.content)).toEqual(['first', 'second']);
    expect(x.state.runtime).toMatchObject({activeCount: 0, queuedCount: 0});
  });

  it('deduplicates sequential and concurrent source messages', async () => {
    const x = setup(); x.runner.outcomes.push({kind: 'success', finalText: 'ok'});
    const input = {conversationId: 'c', destination: dm(), sourceMessageId: 'same', prompt: 'once'};
    const [a, b, c] = await Promise.all([x.coordinator.accept(input), x.coordinator.accept(input), x.coordinator.accept(input)]);
    await eventually(() => x.runner.runs.length === 1);
    expect(a).toBe(b); expect(b).toBe(c); expect(Object.keys(x.state.requests)).toHaveLength(1);
  });

  it('marks restart work unknown, cancels queued work, and does not deliver before resume phase', async () => {
    const x = setup();
    x.state.conversations.c = {id: 'c', destination: dm(), sessionState: 'usable', sessionId: 's', activeRequestId: 'r', queue: ['q'], paused: false, resetNoticePending: false, createdAt: 1, updatedAt: 1};
    x.state.requests.r = {id: 'r', conversationId: 'c', sourceMessageId: 'm', prompt: 'danger', state: 'running', acceptedAt: 1};
    x.state.requests.q = {id: 'q', conversationId: 'c', sourceMessageId: 'q', prompt: 'queued', state: 'queued', acceptedAt: 2};
    x.state.progress.r = newProgress(); x.state.progress.q = newProgress();
    await x.coordinator.recoverState();
    expect(x.discord.sent).toHaveLength(0);
    expect(x.state.requests.r.state).toBe('interrupted_unknown'); expect(x.state.requests.q.state).toBe('cancelled'); expect(x.state.conversations.c.activeRequestId).toBeUndefined(); expect(x.state.runtime.activeCount).toBe(0); expect(x.runner.runs).toHaveLength(0);
    await x.coordinator.resumeDeliveryAndQueues();
    expect(x.discord.sent.filter(message => message.content.includes('outcome is unknown'))).toHaveLength(1);
  });

  it('does not start queued work during shutdown', async () => {
    const x = setup();
    await x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '1', prompt: 'one'});
    await x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '2', prompt: 'two'});
    await eventually(() => x.runner.runs.length === 1);
    await x.coordinator.shutdown();
    expect(x.runner.runs).toHaveLength(1);
    expect(x.state.conversations.c.paused).toBe(true);
    expect(Object.values(x.state.requests).some(request => request.sourceMessageId === '2' && request.state === 'cancelled')).toBe(true);
    expect(x.state.runtime.queuedCount).toBe(0);
  });

  it('recreates deleted status without blocking the final response', async () => {
    const x = setup(); x.runner.outcomes.push({kind: 'success', finalText: 'FINAL'});
    x.discord.failEdits = true;
    await x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '1', prompt: 'one'});
    await eventually(() => x.discord.sent.some(message => message.content === 'FINAL'));
    expect(x.discord.sent.some(message => message.content === 'FINAL')).toBe(true);
  });

  it('cleans up downloaded attachments after successful execution', async () => {
    const workingDir = join(tmpdir(), `ccoord-exec-${Date.now()}`);
    const x = setup(workingDir); x.runner.outcomes.push({kind: 'success', finalText: 'done'});
    const destDir = join(workingDir, '.discord-attachments', 'msg1');
    await mkdir(destDir, {recursive: true});
    await writeFile(join(destDir, 'photo.jpeg'), 'image-data');

    const att = {name: 'photo.jpeg', localPath: join(destDir, 'photo.jpeg'), contentType: 'image/jpeg', size: 10, kind: 'image' as const};
    await x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '1', prompt: 'edit this', attachments: [att]});
    await eventually(() => x.runner.runs.length === 1 && x.state.runtime.activeCount === 0);

    const request = Object.values(x.state.requests).find(r => r.attachments?.length);
    expect(request?.attachments).toHaveLength(1);
    expect(request?.attachments?.[0].name).toBe('photo.jpeg');

    // File should be cleaned up after execution
    await expect(access(att.localPath)).rejects.toThrow();
    await rm(workingDir, {recursive: true, force: true});
  });

  it('cleans up attachments from interrupted requests during shutdown', async () => {
    const workingDir = join(tmpdir(), `ccoord-shutdown-${Date.now()}`);
    const x = setup(workingDir);
    const destDir = join(workingDir, '.discord-attachments', 'msg2');
    await mkdir(destDir, {recursive: true});
    await writeFile(join(destDir, 'voice.ogg'), 'audio-data');

    const att = {name: 'voice.ogg', localPath: join(destDir, 'voice.ogg'), contentType: 'audio/ogg', size: 10, kind: 'voice' as const};
    await x.coordinator.accept({conversationId: 'c', destination: dm(), sourceMessageId: '1', prompt: 'transcribe', attachments: [att]});
    await eventually(() => x.runner.runs.length === 1);

    await x.coordinator.shutdown();
    await expect(access(att.localPath)).rejects.toThrow();
    await rm(workingDir, {recursive: true, force: true});
  });
});
