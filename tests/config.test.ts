import {describe, it, expect} from 'vitest';
import {isAuthorized, isUserAllowed, hasAllowedRole, resolveWhisperConfig} from '../src/config.js';

const cfg = (users: string[] = [], roles: string[] = []) => ({allowedUsers: users, allowedRoles: roles});

describe('isAuthorized', () => {
  it('is open by default when no allowlists are configured', () => {
    expect(isAuthorized('123', [], cfg())).toBe(true);
  });
  it('allows only listed users when a user allowlist is set', () => {
    expect(isAuthorized('123', [], cfg(['123']))).toBe(true);
    expect(isAuthorized('456', [], cfg(['123']))).toBe(false);
  });
  it('always allows a wildcard user list', () => {
    expect(isAuthorized('123', [], cfg(['*']))).toBe(true);
  });
  it('allows a matching role by id', () => {
    expect(isAuthorized('123', [{id: 'role1', name: 'x'}], cfg([], ['role1']))).toBe(true);
  });
  it('allows a matching role by name (case-insensitive)', () => {
    expect(isAuthorized('123', [{id: 'r9', name: 'Admins'}], cfg([], ['admins']))).toBe(true);
  });
  it('denies when no role matches', () => {
    expect(isAuthorized('123', [{id: 'r9', name: 'Admins'}], cfg([], ['mods']))).toBe(false);
  });
  it('ORs allowed users and allowed roles', () => {
    expect(isAuthorized('a-user', [{id: 'role1', name: 'x'}], cfg(['some-user'], ['role1']))).toBe(true);
  });
  it('denies when a whitelist is configured and neither user nor role matches', () => {
    expect(isAuthorized('user9', [{id: 'role1', name: 'x'}], cfg(['user1'], ['role2']))).toBe(false);
  });
});

describe('helpers', () => {
  it('isUserAllowed matches id or wildcard', () => {
    expect(isUserAllowed('1', ['*'])).toBe(true);
    expect(isUserAllowed('1', ['1'])).toBe(true);
    expect(isUserAllowed('2', ['1'])).toBe(false);
  });
  it('hasAllowedRole is false for an empty allowlist', () => {
    expect(hasAllowedRole([{id: 'a', name: 'b'}], [])).toBe(false);
  });
});

describe('resolveWhisperConfig', () => {
  const HOME = '/home/user';
  it('defaults to ~/.commandcode/whisper with auto language and enabled', () => {
    const w = resolveWhisperConfig({HOME});
    expect(w.enabled).toBe(true);
    expect(w.binary).toBe('/home/user/.commandcode/whisper/bin/whisper-cli');
    expect(w.model).toBe('/home/user/.commandcode/whisper/models/ggml-base.bin');
    expect(w.language).toBe('auto');
    expect(w.timeoutMs).toBe(120000);
    expect(w.minTokenProb).toBeGreaterThan(0);
  });
  it('honours explicit overrides', () => {
    const w = resolveWhisperConfig({HOME, WHISPER_BINARY: '/x/cli', WHISPER_MODEL: '/x/m.bin', WHISPER_LANGUAGE: 'en', WHISPER_ENABLED: 'false', WHISPER_TIMEOUT_MS: '5000'});
    expect(w.binary).toBe('/x/cli');
    expect(w.model).toBe('/x/m.bin');
    expect(w.language).toBe('en');
    expect(w.enabled).toBe(false);
    expect(w.timeoutMs).toBe(5000);
  });
});
