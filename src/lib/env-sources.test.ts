import { afterEach, describe, expect, it } from 'vitest';
import { getEnvSources } from './env-sources';

describe('getEnvSources', () => {
  afterEach(() => {
    delete process.env.DEFAULT_SOURCES;
    delete process.env.EXTRA_SOURCES;
  });

  const src = (extra: Record<string, unknown> = {}) => ({ name: '源', url: 'https://a.example/api.php/provide/vod', ...extra });

  it('keys by position when no key is given', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([src(), src()]);
    expect(getEnvSources().map((s) => s.key)).toEqual(['env_0', 'env_1']);
  });

  it('keeps explicit keys, so removing an entry does not shift the others', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([src({ key: 'env_0' }), src({ key: 'env_5' }), src()]);
    expect(getEnvSources().map((s) => s.key)).toEqual(['env_0', 'env_5', 'env_2']);
  });

  it('rejects malformed or duplicate keys', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([src({ key: 'custom_1' })]);
    expect(getEnvSources()).toEqual([]);
    process.env.DEFAULT_SOURCES = JSON.stringify([src({ key: 'env_1' }), src({ key: 'env_1' })]);
    expect(getEnvSources()).toEqual([]);
  });

  it('appends EXTRA_SOURCES after the defaults and skips key clashes', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([src({ key: 'env_0' })]);
    process.env.EXTRA_SOURCES = JSON.stringify([src({ key: 'env_28', isAdult: true }), src({ key: 'env_0' }), src()]);
    const list = getEnvSources();
    expect(list.map((s) => s.key)).toEqual(['env_0', 'env_28', 'env_x2']);
    expect(list[1].isAdult).toBe(true);
  });

  it('keeps the defaults when EXTRA_SOURCES is malformed', () => {
    process.env.DEFAULT_SOURCES = JSON.stringify([src()]);
    process.env.EXTRA_SOURCES = '{oops';
    expect(getEnvSources().map((s) => s.key)).toEqual(['env_0']);
  });
});
