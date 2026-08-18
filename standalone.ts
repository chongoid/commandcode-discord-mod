#!/usr/bin/env node
import {loadConfig} from './src/config.js';
import {createRuntime} from './src/runtime.js';
async function main(): Promise<void> {let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined; let stopping = false; const shutdown = async (code = 0) => {if (stopping) return; stopping = true; try {await runtime?.stop();} finally {process.exitCode = code;}}; process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown()); process.once('uncaughtException', error => {console.error(error instanceof Error ? error.message : String(error)); void shutdown(1);}); process.once('unhandledRejection', error => {console.error(error instanceof Error ? error.message : String(error)); void shutdown(1);}); try {runtime = await createRuntime(loadConfig()); await runtime.start(); console.log('Command Code Discord runtime ready');} catch (error) {console.error(error instanceof Error ? error.message : String(error)); await shutdown(1);}}
void main();
