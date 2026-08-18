import {randomUUID} from 'node:crypto';
import type {Config} from './config.js';
import type {AppState} from './domain.js';
import {CmdRunner} from './agent/cmd-runner.js';
import {DiscordAdapter} from './discord/discord-adapter.js';
import {OutboxWorker} from './delivery/outbox-worker.js';
import {RequestCoordinator} from './orchestration/request-coordinator.js';
import {JsonStore} from './persistence/json-store.js';
import {SingleInstanceLock} from './persistence/single-instance-lock.js';

export async function createRuntime(config: Config) {
  const instanceId = randomUUID();
  const lock = new SingleInstanceLock(config.lockFile, {pid: process.pid, instanceId, startedAt: Date.now()});
  await lock.acquire();
  const store = new JsonStore(config.stateFile, config.legacyFile);
  let state: AppState;
  try {state = await store.load();}
  catch (error) {await lock.release(); throw error;}
  state.runtime = {...state.runtime, pid: process.pid, instanceId, ready: false, heartbeatAt: Date.now(), startedAt: Date.now()};
  const discord = new DiscordAdapter(config, state);
  const runner = new CmdRunner(undefined, config.cmdPath);
  const outbox = new OutboxWorker(state, store, discord);
  const coordinator = new RequestCoordinator(state, store, runner, outbox, config);
  outbox.onDelivered(conversationId => void coordinator.resumeConversation(conversationId));
  discord.bind(coordinator);
  let heartbeat: NodeJS.Timeout | undefined;
  return {
    state,
    async start() {
      await coordinator.recoverState();
      await discord.start();
      state.runtime.ready = true; state.runtime.heartbeatAt = Date.now(); await store.save(state);
      outbox.start();
      await coordinator.resumeDeliveryAndQueues();
      heartbeat = setInterval(() => {state.runtime.heartbeatAt = Date.now(); void store.save(state);}, 15_000);
    },
    async stop() {
      if (heartbeat) clearInterval(heartbeat);
      state.runtime.ready = false; state.runtime.heartbeatAt = Date.now();
      await coordinator.shutdown();
      await outbox.stop();
      await store.save(state);
      await discord.stop();
      await lock.release();
    }
  };
}
