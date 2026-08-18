import type {ModApi} from '@commandcode/harness';
import {readRuntimeState, runtimeSessions, runtimeStatus} from './src/mod/state-reader.js';
export default function discordStatusMod(cmd: ModApi): void {cmd.addCommand({name: 'discord-status', description: 'Read standalone Discord runtime status', handler: async () => ({message: runtimeStatus(await readRuntimeState())})}); cmd.addCommand({name: 'discord-sessions', description: 'Read standalone Discord conversation sessions', handler: async () => ({message: runtimeSessions(await readRuntimeState())})});}
