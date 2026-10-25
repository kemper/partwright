import { describe, it, expect } from 'vitest';
import { sandboxHostAction } from '../../src/sandbox/sandboxHostGuard';

const SANDBOX = 'https://sandbox.example.test';
const PROD_SANDBOX = 'https://partwright-sandbox.pages.dev';
const APPS = 'https://www.partwrightstudio.com,https://partwrightstudio.com';

describe('sandboxHostAction', () => {
  it('boots normally when no sandbox origin is configured', () => {
    expect(sandboxHostAction(`${SANDBOX}/editor`, undefined, APPS)).toBeNull();
    expect(sandboxHostAction(`${SANDBOX}/editor`, '', APPS)).toBeNull();
  });

  it('boots normally on the app origin', () => {
    expect(sandboxHostAction('https://www.partwrightstudio.com/editor', SANDBOX, APPS)).toBeNull();
  });

  it('ignores per-deploy hosts of the sandbox project', () => {
    expect(sandboxHostAction('https://abc123.sandbox.example.test/editor', SANDBOX, APPS)).toBeNull();
  });

  it('redirects the sandbox host to the first app origin, keeping path, query and hash', () => {
    expect(sandboxHostAction(`${SANDBOX}/editor?session=x&v=3#share=abc`, SANDBOX, APPS)).toEqual({
      kind: 'redirect',
      url: 'https://www.partwrightstudio.com/editor?session=x&v=3#share=abc',
    });
    expect(sandboxHostAction(`${SANDBOX}/`, `${SANDBOX}/`, APPS)).toEqual({
      kind: 'redirect',
      url: 'https://www.partwrightstudio.com/',
    });
  });

  it('never redirects to the sandbox itself', () => {
    expect(sandboxHostAction(`${SANDBOX}/editor`, SANDBOX, `${SANDBOX},https://partwrightstudio.com`)).toEqual({
      kind: 'redirect',
      url: 'https://partwrightstudio.com/editor',
    });
  });

  it('blocks when there is no app origin to send the visitor to', () => {
    expect(sandboxHostAction(`${SANDBOX}/editor`, SANDBOX, undefined)).toEqual({ kind: 'block' });
    expect(sandboxHostAction(`${SANDBOX}/editor`, SANDBOX, 'not a url')).toEqual({ kind: 'block' });
    expect(sandboxHostAction(`${SANDBOX}/editor`, SANDBOX, SANDBOX)).toEqual({ kind: 'block' });
  });

  it('fails closed on the production sandbox host even without build env', () => {
    expect(sandboxHostAction(`${PROD_SANDBOX}/editor?x#y`, undefined, undefined)).toEqual({
      kind: 'redirect',
      url: 'https://www.partwrightstudio.com/editor?x#y',
    });
    expect(sandboxHostAction(`${PROD_SANDBOX}/`, undefined, 'https://partwrightstudio.com')).toEqual({
      kind: 'redirect',
      url: 'https://partwrightstudio.com/',
    });
    expect(sandboxHostAction(`https://abc.partwright-sandbox.pages.dev/editor`, undefined, undefined)).toBeNull();
  });
});
