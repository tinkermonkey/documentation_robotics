import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  captureSnapshot,
  captureSnapshotWithContent,
  diffSnapshots,
  generateUnifiedDiff,
  formatChange,
  FileChange,
  FilesystemSnapshot,
  FileSnapshot,
} from './snapshot-engine';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
  const dir = join(tmpdir(), `snapshot-test-${randomBytes(8).toString('hex')}`);
  return dir;
}

/**
 * Clean up temporary directory
 */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Snapshot Engine', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = createTempDir();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('captureSnapshot', () => {
    test('captures empty directory', async () => {
      const snapshot = await captureSnapshot(testDir);
      expect(snapshot.files.size).toBe(0);
    });

    test('captures single file', async () => {
      const content = 'Hello, World!';
      await writeFile(join(testDir, 'file.txt'), content);

      const snapshot = await captureSnapshot(testDir);

      expect(snapshot.files.size).toBe(1);
      expect(snapshot.files.has('file.txt')).toBe(true);

      const file = snapshot.files.get('file.txt')!;
      expect(file.exists).toBe(true);
      expect(file.size).toBe(content.length);
      expect(file.hash).toBeDefined();
      expect(file.hash.length).toBe(64); // SHA-256 hex is 64 chars
      expect(file.mtime).toBeGreaterThan(0);
    });

    test('captures multiple files in nested directories', async () => {
      const structure = {
        'file1.txt': 'content1',
        'dir1/file2.txt': 'content2',
        'dir1/dir2/file3.yaml': 'content3',
        'dir1/dir2/dir3/file4.json': '{"key": "value"}',
      };

      for (const [path, content] of Object.entries(structure)) {
        const fullPath = join(testDir, path);
        await mkdir(join(fullPath, '..'), { recursive: true });
        await writeFile(fullPath, content);
      }

      const snapshot = await captureSnapshot(testDir);

      expect(snapshot.files.size).toBe(4);
      for (const path of Object.keys(structure)) {
        expect(snapshot.files.has(path)).toBe(true);
      }
    });

    test('ignores hidden files and directories', async () => {
      await writeFile(join(testDir, 'visible.txt'), 'visible');
      await mkdir(join(testDir, '.hidden'), { recursive: true });
      await writeFile(join(testDir, '.hidden', 'file.txt'), 'hidden');
      await writeFile(join(testDir, '.env'), 'secret');

      const snapshot = await captureSnapshot(testDir);

      // Should only capture visible.txt
      expect(snapshot.files.size).toBe(1);
      expect(snapshot.files.has('visible.txt')).toBe(true);
      expect(snapshot.files.has('.env')).toBe(false);
      expect(snapshot.files.has('.hidden/file.txt')).toBe(false);
    });

    test('preserves .dr directory', async () => {
      await mkdir(join(testDir, '.dr'), { recursive: true });
      await writeFile(join(testDir, '.dr', 'manifest.json'), '{}');
      await writeFile(join(testDir, 'other.txt'), 'content');

      const snapshot = await captureSnapshot(testDir);

      expect(snapshot.files.size).toBe(2);
      expect(snapshot.files.has('.dr/manifest.json')).toBe(true);
      expect(snapshot.files.has('other.txt')).toBe(true);
    });

    test('normalizes path separators to forward slashes', async () => {
      await mkdir(join(testDir, 'a', 'b'), { recursive: true });
      await writeFile(join(testDir, 'a', 'b', 'file.txt'), 'content');

      const snapshot = await captureSnapshot(testDir);

      // All paths should use forward slashes
      const paths = Array.from(snapshot.files.keys());
      expect(paths.every((p) => !p.includes('\\'))).toBe(true);
      expect(snapshot.files.has('a/b/file.txt')).toBe(true);
    });

    test('stores file metadata without loading content', async () => {
      const largeContent = 'x'.repeat(1000000); // 1MB
      await writeFile(join(testDir, 'large.bin'), largeContent);

      const snapshot = await captureSnapshot(testDir);
      const file = snapshot.files.get('large.bin')!;

      // Metadata should be captured
      expect(file.size).toBe(largeContent.length);
      expect(file.hash).toBeDefined();

      // Content should not be loaded initially
      expect(file.content).toBeUndefined();
    });
  });

  describe('diffSnapshots', () => {
    test('detects added files', async () => {
      const before = { files: new Map() };
      const after = await captureSnapshot(testDir);

      await writeFile(join(testDir, 'new.txt'), 'new content');
      const afterWithNew = await captureSnapshot(testDir);

      const changes = await diffSnapshots(before, afterWithNew, testDir);

      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('added');
      expect(changes[0].path).toBe('new.txt');
      expect(changes[0].afterHash).toBeDefined();
    });

    test('detects deleted files', async () => {
      await writeFile(join(testDir, 'file.txt'), 'content');
      const before = await captureSnapshot(testDir);

      await rm(join(testDir, 'file.txt'));
      const after = await captureSnapshot(testDir);

      const changes = await diffSnapshots(before, after, testDir);

      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('deleted');
      expect(changes[0].path).toBe('file.txt');
      expect(changes[0].beforeHash).toBeDefined();
    });

    test('detects modified files', async () => {
      const filePath = join(testDir, 'file.txt');
      await writeFile(filePath, 'original content');
      const before = await captureSnapshot(testDir);

      await writeFile(filePath, 'modified content');
      const after = await captureSnapshot(testDir);

      const changes = await diffSnapshots(before, after, testDir);

      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('modified');
      expect(changes[0].path).toBe('file.txt');
      expect(changes[0].beforeHash).toBeDefined();
      expect(changes[0].afterHash).toBeDefined();
      expect(changes[0].beforeHash).not.toBe(changes[0].afterHash);
    });

    test('detects unchanged files by default', async () => {
      const filePath = join(testDir, 'file.txt');
      await writeFile(filePath, 'content');
      const before = await captureSnapshot(testDir);
      const after = await captureSnapshot(testDir);

      // By default, unchanged files are excluded
      let changes = await diffSnapshots(before, after, testDir);
      expect(changes.length).toBe(0);

      // With includeUnchanged option
      changes = await diffSnapshots(before, after, testDir, { includeUnchanged: true });
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('unchanged');
    });

    test('filters by path patterns', async () => {
      await mkdir(join(testDir, 'motivation', 'goals'), { recursive: true });
      await mkdir(join(testDir, 'business', 'services'), { recursive: true });

      await writeFile(join(testDir, 'motivation', 'goals', 'goal1.yaml'), 'goal');
      await writeFile(join(testDir, 'business', 'services', 'service1.yaml'), 'service');

      const before = { files: new Map() };

      const after = await captureSnapshot(testDir);

      // Filter to only motivation layer
      const changes = await diffSnapshots(before, after, testDir, {
        filterPaths: ['motivation/'],
      });

      expect(changes.length).toBe(1);
      expect(changes[0].path).toContain('motivation');
      expect(changes.some((c) => c.path.includes('business'))).toBe(false);
    });

    test('supports multiple filter patterns', async () => {
      await mkdir(join(testDir, 'motivation'), { recursive: true });
      await mkdir(join(testDir, 'business'), { recursive: true });
      await mkdir(join(testDir, 'api'), { recursive: true });

      await writeFile(join(testDir, 'motivation', 'goals.yaml'), 'goal');
      await writeFile(join(testDir, 'business', 'services.yaml'), 'service');
      await writeFile(join(testDir, 'api', 'operations.yaml'), 'operation');
      await writeFile(join(testDir, 'manifest.yaml'), 'manifest');

      const before = { files: new Map() };
      const after = await captureSnapshot(testDir);

      // Filter to motivation and business directories, plus manifest file
      const changes = await diffSnapshots(before, after, testDir, {
        filterPaths: ['motivation/', 'business/', 'manifest.yaml'],
      });

      expect(changes.length).toBe(3);
      const paths = changes.map((c) => c.path).sort();
      expect(paths).toContain('business/services.yaml');
      expect(paths).toContain('manifest.yaml');
      expect(paths).toContain('motivation/goals.yaml');
      expect(paths.some((p) => p.includes('api'))).toBe(false);
    });

    test('generates diffs when requested', async () => {
      const beforeContent = 'line1\nline2\nline3\n';
      const afterContent = 'line1\nmodified line2\nline3\nline4\n';

      // Create before state with content captured
      const beforeDir = join(testDir, 'before');
      await mkdir(beforeDir, { recursive: true });
      await writeFile(join(beforeDir, 'file.txt'), beforeContent);
      const before = await captureSnapshotWithContent(beforeDir);

      // Create after state with content captured
      const afterDir = join(testDir, 'after');
      await mkdir(afterDir, { recursive: true });
      await writeFile(join(afterDir, 'file.txt'), afterContent);
      const after = await captureSnapshotWithContent(afterDir);

      const changes = await diffSnapshots(before, after, afterDir, { generateDiffs: true });

      expect(changes.length).toBe(1);
      expect(changes[0].diff).toBeDefined();
      expect(changes[0].diff).toContain('-line2');
      expect(changes[0].diff).toContain('+modified line2');
      expect(changes[0].diff).toContain('+line4');
    });

    test('handles multiple simultaneous changes', async () => {
      // Create initial state
      const file1 = join(testDir, 'file1.txt');
      const file2 = join(testDir, 'file2.txt');
      const file3 = join(testDir, 'file3.txt');

      await writeFile(file1, 'original1');
      await writeFile(file2, 'original2');
      await writeFile(file3, 'original3');

      const before = await captureSnapshot(testDir);

      // Make changes
      await writeFile(file1, 'modified1'); // modify
      await rm(file2); // delete
      await writeFile(join(testDir, 'file4.txt'), 'new4'); // add

      const after = await captureSnapshot(testDir);
      const changes = await diffSnapshots(before, after, testDir);

      // Should detect all changes
      expect(changes.length).toBe(3);

      const types = changes.map((c) => c.type).sort();
      expect(types).toEqual(['added', 'deleted', 'modified']);
    });
  });

  describe('generateUnifiedDiff', () => {
    test('generates unified diff for simple text change', () => {
      const before = 'line1\nline2\nline3\n';
      const after = 'line1\nmodified\nline3\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      expect(diff).toContain('--- test.txt');
      expect(diff).toContain('+++ test.txt');
      expect(diff).toContain('-line2');
      expect(diff).toContain('+modified');
    });

    test('generates diff for added lines', () => {
      const before = 'line1\nline2\n';
      const after = 'line1\nline1.5\nline2\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      expect(diff).toContain('+line1.5');
    });

    test('generates diff for deleted lines', () => {
      const before = 'line1\nline2\nline3\n';
      const after = 'line1\nline3\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      expect(diff).toContain('-line2');
    });

    test('includes hunk headers', () => {
      const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
      const after = 'a\nB\nc\nd\ne\nf\nG\nh\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      // Should have @@ hunk headers
      expect(diff).toMatch(/@@ .* @@/);
    });

    test('handles completely different content', () => {
      const before = 'original content\n';
      const after = 'completely different\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      expect(diff).toContain('-original content');
      expect(diff).toContain('+completely different');
    });

    test('handles empty files', () => {
      const before = '';
      const after = 'new content\n';

      const diff = generateUnifiedDiff('test.txt', before, after);

      expect(diff).toContain('+new content');
    });

    test('handles large diffs', () => {
      const lines = Array(100)
        .fill(0)
        .map((_, i) => `line ${i}`);
      const before = lines.join('\n') + '\n';
      const after = [
        ...lines.slice(0, 50),
        'INSERTED',
        ...lines.slice(50),
      ].join('\n') + '\n';

      const diff = generateUnifiedDiff('large.txt', before, after);

      expect(diff).toContain('+INSERTED');
      expect(diff.length).toBeGreaterThan(100);
    });
  });

  describe('formatChange', () => {
    test('formats added file', () => {
      const change: FileChange = {
        path: 'new.txt',
        type: 'added',
        afterHash: 'abc123def456',
      };

      const formatted = formatChange(change);

      expect(formatted).toContain('✚');
      expect(formatted).toContain('new.txt');
      expect(formatted).toContain('added');
    });

    test('formats deleted file', () => {
      const change: FileChange = {
        path: 'old.txt',
        type: 'deleted',
        beforeHash: 'abc123def456',
      };

      const formatted = formatChange(change);

      expect(formatted).toContain('✖');
      expect(formatted).toContain('old.txt');
      expect(formatted).toContain('deleted');
    });

    test('formats modified file with hashes', () => {
      const change: FileChange = {
        path: 'modified.txt',
        type: 'modified',
        beforeHash: 'before1234567890',
        afterHash: 'after1234567890',
      };

      const formatted = formatChange(change);

      expect(formatted).toContain('◆');
      expect(formatted).toContain('Before:');
      expect(formatted).toContain('After:');
      expect(formatted).toContain('before12'); // First 8 chars
      expect(formatted).toContain('after123'); // First 8 chars
    });

    test('includes diff when available', () => {
      const change: FileChange = {
        path: 'file.txt',
        type: 'modified',
        beforeHash: 'old',
        afterHash: 'new',
        diff: '--- file.txt\n+++ file.txt\n-old\n+new',
      };

      const formatted = formatChange(change);

      expect(formatted).toContain('--- file.txt');
      expect(formatted).toContain('+++ file.txt');
      expect(formatted).toContain('-old');
      expect(formatted).toContain('+new');
    });
  });

  describe('Performance', () => {
    test('captures ~60 files in <2 seconds', async () => {
      const fileCount = 60;
      const startTime = Date.now();

      // Create ~60 files similar to model structure
      for (let i = 0; i < fileCount; i++) {
        const layer = Math.floor(i / 5) + 1;
        const type = ['goals', 'services', 'actors', 'components', 'operations'][i % 5];
        const dir = join(testDir, `0${layer}_layer`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, `${type}.yaml`),
          `item: ${i}\nname: Item ${i}\ndescription: This is item ${i}\n`
        );
      }

      const snapshot = await captureSnapshot(testDir);
      const elapsed = Date.now() - startTime;

      expect(snapshot.files.size).toBe(fileCount);
      expect(elapsed).toBeLessThan(2000);
    });

    test('diffs two snapshots with many files in <2 seconds', async () => {
      const fileCount = 60;

      // Create initial state
      for (let i = 0; i < fileCount; i++) {
        const layer = Math.floor(i / 5) + 1;
        const type = ['goals', 'services', 'actors', 'components', 'operations'][i % 5];
        const dir = join(testDir, `0${layer}_layer`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, `${type}.yaml`),
          `item: ${i}\nname: Item ${i}\ndescription: This is item ${i}\n`
        );
      }

      const before = await captureSnapshot(testDir);

      // Modify some files
      for (let i = 0; i < 10; i++) {
        const layer = Math.floor(i / 5) + 1;
        const type = ['goals', 'services', 'actors', 'components', 'operations'][i % 5];
        const path = join(testDir, `0${layer}_layer`, `${type}.yaml`);
        const content = await readFile(path, 'utf-8');
        await writeFile(path, content + 'modified: true\n');
      }

      const after = await captureSnapshot(testDir);

      const startTime = Date.now();
      const changes = await diffSnapshots(before, after, testDir);
      const elapsed = Date.now() - startTime;

      expect(changes.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
