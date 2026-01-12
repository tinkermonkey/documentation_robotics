import { describe, it, expect } from 'bun:test';
describe('CWD Check', () => {
  it('prints current working directory', () => {
    console.log('CWD:', process.cwd());
    expect(true).toBe(true);
  });
});
