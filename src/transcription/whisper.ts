import {spawn, type ChildProcess} from 'node:child_process';
import {accessSync, constants as fsConstants} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir, availableParallelism} from 'node:os';
import {join, extname} from 'node:path';

/**
 * Self-contained voice transcription via a whisper.cpp `whisper-cli` binary
 * plus a GGML model file. Spawned as a subprocess (fits this bot's
 * subprocess-centric architecture), with NO dependency on Hermes, Python, or
 * any shared agent install. Every user who runs the mod provisions their own
 * binary + model via `scripts/install-whisper.sh` (or points WHISPER_BINARY /
 * WHISPER_MODEL at an existing installation).
 *
 * Pipeline (mirrors how Hermes does it, but self-contained):
 *   1. Transcode the incoming container (Discord voice notes are Opus/OGG) to
 *      16kHz mono WAV with ffmpeg — whisper-cli's bundled miniaudio cannot
 *      decode Opus, so normalize first.
 *   2. Run whisper-cli: `-l auto` (language detect), `-nt -np` (no timestamps,
 *      no prints), `-ojf` (full JSON with per-token probabilities).
 *   3. Parse `transcription[]`, join segment text, and drop low-confidence /
 *      likely-hallucinated segments (per-token probability gate) so silence
 *      never comes back as fake words.
 *
 * Degrades gracefully: if the binary/model/ffmpeg is missing, returns
 * `{success:false, error}` and the caller falls back to treating the voice
 * attachment as a plain file (the long-standing behaviour) — transcription is
 * strictly additive and never breaks attachment handling.
 */

export interface WhisperConfig {
  binary: string;
  model: string;
  language: string; // 'auto' or an ISO-639-1 code
  timeoutMs: number;
  ffmpegPath: string;
  enabled: boolean;
  /** Drop a segment when its mean per-token probability is below this. */
  minTokenProb: number;
}

const NATIVE_WAV_EXTS = new Set(['.wav', '.flac', '.mp3', '.m4a']);

/**
 * Cap on concurrent whisper-cli subprocesses. Each spawn loads the ~150 MB
 * GGML model into memory, so a voice-message burst must not spawn an unbounded
 * number of them. Jobs beyond the cap skip transcription (degrade to file)
 * rather than queue, so a busy-burst never starves other messages.
 */
const MAX_CONCURRENT_STT = 2;
let activeSttJobs = 0;

function tryAcquireSttSlot(): boolean {
  if (activeSttJobs >= MAX_CONCURRENT_STT) return false;
  activeSttJobs++;
  return true;
}
function releaseSttSlot(): void {
  activeSttJobs = Math.max(0, activeSttJobs - 1);
}

export function hasWhisperPrereqs(cfg: WhisperConfig): boolean {
  return cfg.enabled && executableExists(cfg.binary) && fileExists(cfg.model);
}

function executableExists(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export interface TranscriptionResult {
  success: boolean;
  transcript: string;
  error?: string;
}

function runToJson(bin: string, args: string[], timeoutMs: number): Promise<{code: number | null; stderr: string}> {
  return new Promise((resolve) => {
    let proc: ChildProcess;
    let stderr = '';
    let settled = false;
    const settle = (code: number | null, msg: string) => {
      if (settled) return;
      settled = true;
      resolve({code, stderr: msg});
    };
    // Deterministic timeout: SIGKILL the child and resolve immediately. The
    // pending 'close' event still fires later and calls settle() again, which
    // is idempotent. Never allow the promise to depend on 'close' firing.
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already reaped
      }
      settle(null, `timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    try {
      proc = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      clearTimeout(timer);
      settle(-1, error instanceof Error ? error.message : String(error));
      return;
    }
    proc.stderr?.on('data', (chunk: Buffer) => {stderr += chunk.toString();});
    proc.on('error', (error) => {
      clearTimeout(timer);
      settle(-1, error.message);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      settle(code != null ? code : null, stderr.trim());
    });
    // Ensure a timeout actually terminates the child.
    if (timeoutMs > 0) {
      timer.unref?.();
    }
  });
}

/** Transcode any audio container to 16kHz mono WAV with ffmpeg. */
async function transcodeToWav(ffmpeg: string, input: string, output: string, timeoutMs: number): Promise<boolean> {
  const {code} = await runToJson(ffmpeg, [
    '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output,
  ], timeoutMs);
  return code === 0;
}

interface WhisperSegment {text: string; tokens?: Array<{p?: number; text?: string}>}

function meanTokenProb(segment: WhisperSegment): number | null {
  if (!segment.tokens || segment.tokens.length === 0) return null;
  const probs = segment.tokens.map(t => t.p).filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (!probs.length) return null;
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

/** Join whisper-cli segments, dropping likely-hallucinated low-confidence ones. */
function joinConfidentSegments(json: {transcription?: WhisperSegment[]}, minTokenProb: number): string {
  const segments = json.transcription || [];
  const kept: string[] = [];
  for (const segment of segments) {
    const text = (segment.text || '').trim();
    if (!text) continue;
    const meanP = meanTokenProb(segment);
    // Drop segments whose tokens are uniformly low-confidence (silence/static
    // hallucination), but keep quiet-but-real speech where ONE side suffices.
    if (meanP !== null && meanP < minTokenProb) continue;
    kept.push(text);
  }
  return kept.join(' ').trim();
}

/**
 * Transcribe a voice file to text. Returns success with an empty transcript
 * for inaudible audio (caller decides how to represent that), or an error
 * when the STT stack is unavailable or the run failed.
 */
export async function transcribeVoiceFile(inputPath: string, cfg: WhisperConfig): Promise<TranscriptionResult> {
  if (!cfg.enabled) return {success: false, transcript: '', error: 'voice transcription disabled'};
  if (!hasWhisperPrereqs(cfg)) {
    return {success: false, transcript: '', error: 'whisper binary/model not configured'};
  }
  if (!fileExists(inputPath)) return {success: false, transcript: '', error: `audio file not found: ${inputPath}`};
  // Bounded concurrency: skip (degrade to file) when at the STT subprocess cap
  // rather than queue, so a voice burst can't spawn unbounded model loads.
  if (!tryAcquireSttSlot()) {
    return {success: false, transcript: '', error: `transcription skipped: at concurrency cap (${MAX_CONCURRENT_STT})`};
  }

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'cc-whisper-'));
    let wavInput = inputPath;
    const ext = extname(inputPath).toLowerCase();
    // Prefer a direct WAV/FLAC/MP3/M4A pass; otherwise transcode with ffmpeg.
    // whisper-cli's miniaudio cannot decode Opus/OGG, so Discord voice notes
    // (Opus) go through ffmpeg to 16kHz mono WAV.
    if (!NATIVE_WAV_EXTS.has(ext)) {
      const ffmpeg = cfg.ffmpegPath || 'ffmpeg';
      const outWav = join(workDir, 'input.wav');
      const ok = await transcodeToWav(ffmpeg, inputPath, outWav, cfg.timeoutMs);
      if (!ok) {
        // Skip the no-speech/native-decode fallback: if ffmpeg failed, we can't
        // normalise the container, so treat the note as unreadable.
        return {success: false, transcript: '', error: 'ffmpeg failed to transcode the audio container'};
      }
      wavInput = outWav;
    }

    const outPrefix = join(workDir, 'result');
    const args = [
      '-m', cfg.model,
      '-f', wavInput,
      '-l', cfg.language || 'auto',
      '-nt', '-np', '-ojf', '-of', outPrefix,
      '-t', String(Math.max(1, Math.min(8, availableParallelism?.() || 4))),
    ];
    const {code, stderr} = await runToJson(cfg.binary, args, cfg.timeoutMs);
    if (code !== 0) {
      return {success: false, transcript: '', error: `whisper-cli exited ${code}: ${stderr.slice(0, 300)}`};
    }

    const jsonPath = `${outPrefix}.json`;
    let raw: string;
    try {
      raw = await readFile(jsonPath, 'utf8');
    } catch (error) {
      return {success: false, transcript: '', error: `whisper-cli produced no JSON output: ${error instanceof Error ? error.message : String(error)}`};
    }
    let parsed: {transcription?: WhisperSegment[]};
    try {
      parsed = JSON.parse(raw) as {transcription?: WhisperSegment[]};
    } catch (error) {
      return {success: false, transcript: '', error: `whisper output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`};
    }
    return {success: true, transcript: joinConfidentSegments(parsed, cfg.minTokenProb)};
  } catch (error) {
    return {success: false, transcript: '', error: `transcription failed: ${error instanceof Error ? error.message : String(error)}`};
  } finally {
    releaseSttSlot();
    if (workDir) {
      await rm(workDir, {recursive: true, force: true}).catch(() => undefined);
    }
  }
}
