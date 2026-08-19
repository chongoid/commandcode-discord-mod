import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it, beforeEach, afterEach} from 'vitest';
import {transcribeVoiceFile, hasWhisperPrereqs, type WhisperConfig} from '../src/transcription/whisper.js';

const WORK = join(tmpdir(), `cc-whisper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function writeFakeWhisper(outputJson: object, exitCode = 0): string {
  const bin = join(WORK, 'whisper-cli');
  // Fake whisper-cli: ignores inputs, writes result.json reflecting the model
  // path and the -of prefix, returns exitCode.
  const script = `#!/usr/bin/env node
const fs=require('fs');
let of='';
for(let i=0;i<process.argv.length;i++){if(process.argv[i]==='-of'){of=process.argv[++i];}}
const json=${JSON.stringify(outputJson)};
fs.writeFileSync(of+'.json', JSON.stringify(json));
process.exit(${exitCode});
`;
  writeFileSync(bin, script, {mode: 0o755});
  return bin;
}

function mockModel(): string {
  const model = join(WORK, 'ggml-base.bin');
  writeFileSync(model, 'fake-model-bytes');
  return model;
}

beforeEach(() => {
  mkdirSync(WORK, {recursive: true});
});
afterEach(() => {
  rmSync(WORK, {recursive: true, force: true});
});

const baseCfg = (overrides: Partial<WhisperConfig> = {}): WhisperConfig => ({
  enabled: true,
  binary: join(WORK, 'whisper-cli'),
  model: mockModel(),
  language: 'auto',
  timeoutMs: 10000,
  ffmpegPath: 'ffmpeg',
  minTokenProb: 0.4,
  ...overrides,
});

function makeAudio(): string {
  // Use .wav (a native whisper-cli format) so the unit test path skips the
  // real ffmpeg transcode step (which only runs for .ogg/.opus/other).
  const p = join(WORK, 'voice.wav');
  writeFileSync(p, 'fake-wav-bytes');
  return p;
}

describe('hasWhisperPrereqs', () => {
  it('true when binary + model exist and enabled', () => {
    const bin = writeFakeWhisper({});
    expect(hasWhisperPrereqs(baseCfg({binary: bin}))).toBe(true);
  });
  it('false when disabled', () => {
    expect(hasWhisperPrereqs(baseCfg({enabled: false}))).toBe(false);
  });
  it('false when binary missing', () => {
    expect(hasWhisperPrereqs(baseCfg({binary: join(WORK, 'missing')}))).toBe(false);
  });
});

describe('transcribeVoiceFile', () => {
  it('returns success with transcript from JSON transcription segments', async () => {
    writeFakeWhisper({
      transcription: [
        {text: 'hello there', tokens: [{p: 0.99}, {p: 0.98}]},
        {text: ' world', tokens: [{p: 0.97}]},
      ],
    });
    const result = await transcribeVoiceFile(makeAudio(), baseCfg());
    expect(result.success).toBe(true);
    expect(result.transcript).toContain('hello there');
    expect(result.transcript).toContain('world');
  });

  it('drops low-confidence hallucinated segments', async () => {
    writeFakeWhisper({
      transcription: [
        {text: 'real speech', tokens: [{p: 0.95}]},
        {text: 'crickets chirping', tokens: [{p: 0.1}, {p: 0.08}]},
      ],
    });
    const result = await transcribeVoiceFile(makeAudio(), baseCfg());
    expect(result.success).toBe(true);
    expect(result.transcript).toContain('real speech');
    expect(result.transcript).not.toContain('crickets');
  });

  it('returns empty transcript for inaudible audio', async () => {
    writeFakeWhisper({transcription: [{text: '', tokens: []}]});
    const result = await transcribeVoiceFile(makeAudio(), baseCfg());
    expect(result.success).toBe(true);
    expect(result.transcript.trim()).toBe('');
  });

  it('returns error when whisper not configured', async () => {
    const result = await transcribeVoiceFile(makeAudio(), baseCfg({enabled: false}));
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when whisper-cli exits non-zero', async () => {
    writeFakeWhisper({}, 1);
    const result = await transcribeVoiceFile(makeAudio(), baseCfg());
    expect(result.success).toBe(false);
    expect(result.error).toContain('whisper-cli exited 1');
  });

  it('returns error on missing audio file', async () => {
    const result = await transcribeVoiceFile(join(WORK, 'nope.ogg'), baseCfg());
    expect(result.success).toBe(false);
  });

  it('transcodes .ogg through a fake ffmpeg before whisper-cli', async () => {
    // Fake ffmpeg: writes a valid-enough wav next to the -i target so the
    // whisper stage proceeds, and records that it ran.
    const ffmpegLog = join(WORK, 'ffmpeg-ran');
    const fakeFfmpeg = join(WORK, 'ffmpeg');
    const script = `#!/usr/bin/env node
const fs=require('fs');
let out=''; let inp='';
for(let i=0;i<process.argv.length;i++){
  if(process.argv[i]==='-y') continue;
  if(process.argv[i]==='-i'){inp=process.argv[++i];}
  if(process.argv[i]==='-c:a'){process.argv[++i];}
  if(process.argv[i]==='-ar'){process.argv[++i];}
  if(process.argv[i]==='-ac'){process.argv[++i];}
}
out=process.argv[process.argv.length-1];
fs.writeFileSync(out, 'FAKE-WAV');
fs.writeFileSync(${JSON.stringify(ffmpegLog)}, [inp, out].join('|'));
`;
    writeFileSync(fakeFfmpeg, script, {mode: 0o755});
    writeFakeWhisper({transcription: [{text: 'transcribed', tokens: [{p: 0.9}]}]});
    const ogg = join(WORK, 'voice.ogg');
    writeFileSync(ogg, 'fake-ogg');
    const result = await transcribeVoiceFile(ogg, baseCfg({ffmpegPath: fakeFfmpeg}));
    expect(result.success).toBe(true);
    expect(result.transcript).toContain('transcribed');
    // Confirm ffmpeg actually ran (the .ogg path is the real production path).
    const log = await import('node:fs/promises').then(m => m.readFile(ffmpegLog, 'utf8')).catch(() => '');
    expect(log).toContain(ogg);
  });

  it('honours a timeout deterministically', async () => {
    // A fake whisper-cli that never exits: transcribeVoiceFile must return
    // promptly (not hang) once timeoutMs elapses.
    const hangBin = join(WORK, 'hang-whisper');
    writeFileSync(hangBin, '#!/usr/bin/env node\nsetInterval(()=>{}, 1000);\n', {mode: 0o755});
    const start = Date.now();
    const result = await transcribeVoiceFile(makeAudio(), baseCfg({binary: hangBin, timeoutMs: 300}));
    const elapsed = Date.now() - start;
    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(5000);
    expect(result.error).toContain('timed out');
  });
});
