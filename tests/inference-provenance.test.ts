import { describe, expect, it } from 'vitest';
import { normalizeAuthenticatedCompose } from '../src/core/inference-provenance.js';
import { sha256 } from '../src/core/crypto.js';

describe('authenticated model compose normalization', () => {
  it('supports a bounded real-world number of repeated aliases and preserves selected images', () => {
    const bytes = Buffer.from('x-env: &env\n  LOG_LEVEL: info\nservices:\n' + Array.from({ length: 250 }, (_, i) => `  model${i}:\n    image: nearaidev/vllm-proxy-rs@sha256:${'a'.repeat(64)}\n    environment: *env\n`).join(''));
    const app = JSON.parse(normalizeAuthenticatedCompose(bytes, sha256(bytes), ['model2']));
    expect(Object.keys(JSON.parse(app.docker_compose_file).services)).toEqual(['model2']);
  });
  it('rejects altered bytes before parsing, absent services and oversized input', () => {
    const b = Buffer.from('services: {model: {image: image}}');
    expect(() => normalizeAuthenticatedCompose(b, '0'.repeat(64))).toThrow('PROVENANCE_COMPOSE_HASH');
    expect(() => normalizeAuthenticatedCompose(b, sha256(b), ['missing'])).toThrow('PROVENANCE_SERVICE_MISSING');
    expect(() => normalizeAuthenticatedCompose(Buffer.alloc(1_000_001), '0'.repeat(64))).toThrow('PROVENANCE_COMPOSE_SIZE');
  });
  it('retains alias exhaustion protection', () => {
    const bytes = Buffer.from('a: &a [a,a,a,a,a,a,a,a,a,a]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\nservices: {model: {environment: *d}}');
    expect(() => normalizeAuthenticatedCompose(bytes, sha256(bytes))).toThrow();
  });
});
