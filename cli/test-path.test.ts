import { describe, it, expect } from 'bun:test';
import path from 'path';
import { fileExists } from './src/utils/file-io.js';

describe('Path Test', () => {
  it('checks path resolution', async () => {
    const testRulesPath = path.join(
      process.cwd(),
      '..',
      'cli-validation',
      'test-project',
      'projection-rules.yaml'
    );
    console.log('Resolved path:', testRulesPath);
    console.log('File exists:', await fileExists(testRulesPath));
  });
});
