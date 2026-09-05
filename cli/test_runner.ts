import { describe, it, expect, setDefaultTimeout } from 'bun:test';

// Increase timeout for long-running tests
setDefaultTimeout(30000); // 30 seconds

// Run the test file
import('./tests/integration/docs-validation.test.ts');
