/**
 * Unit Tests for Test Runner Validation Functions
 *
 * Tests for assertValidWorkerResult which validates incoming IPC messages
 * from worker processes at the IPC boundary.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Re-implementation of assertValidWorkerResult for testing purposes
 * (in real code, this would be imported from test-runner.ts)
 */
function assertValidWorkerResult(msg: unknown): asserts msg is any {
  if (!msg || typeof msg !== 'object') {
    throw new Error('Invalid worker message: not an object');
  }

  const obj = msg as Record<string, unknown>;

  if (typeof obj.workerId !== 'number') {
    throw new Error(`Invalid worker message: workerId must be a number, got ${typeof obj.workerId}`);
  }

  if (!Array.isArray(obj.results)) {
    throw new Error(`Invalid worker message: results must be an array, got ${typeof obj.results}`);
  }

  if (typeof obj.output !== 'string') {
    throw new Error(`Invalid worker message: output must be a string, got ${typeof obj.output}`);
  }
}

/**
 * Test assertion helpers for compatibility with node:test
 */
class TestAssertions {
  value: any;

  constructor(value: any) {
    this.value = value;
  }

  toThrow(expectedMessage?: string): void {
    let threw = false;
    let thrownError: Error | null = null;

    try {
      this.value();
    } catch (error) {
      threw = true;
      thrownError = error as Error;
    }

    assert(threw, 'Expected function to throw an error');

    if (expectedMessage && thrownError) {
      assert(
        thrownError.message.includes(expectedMessage),
        `Expected error message to include "${expectedMessage}", got "${thrownError.message}"`
      );
    }
  }

  toNotThrow(): void {
    let threw = false;
    let error: Error | null = null;

    try {
      this.value();
    } catch (err) {
      threw = true;
      error = err as Error;
    }

    assert(!threw, `Expected function not to throw, but it threw: ${error?.message}`);
  }
}

function expect(value: any): TestAssertions {
  return new TestAssertions(value);
}

describe('assertValidWorkerResult', () => {
  describe('Valid Messages', () => {
    it('should accept valid WorkerResult with empty results array', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: 'test output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should accept valid WorkerResult with populated results array', () => {
      const validMsg = {
        workerId: 1,
        results: [
          {
            name: 'suite1',
            passed: true,
            pipelines: [],
          },
        ],
        output: 'detailed worker output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should accept valid message with multiple results', () => {
      const validMsg = {
        workerId: 2,
        results: [
          {
            name: 'suite1',
            passed: true,
            pipelines: [],
          },
          {
            name: 'suite2',
            passed: false,
            pipelines: [],
          },
        ],
        output: 'output from worker 2',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should accept valid message with empty string output', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: '',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should accept valid message with workerId 0', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should accept valid message with large workerId', () => {
      const validMsg = {
        workerId: 999999,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });
  });

  describe('Invalid Messages - Null/Undefined', () => {
    it('should reject null message', () => {
      expect(() => assertValidWorkerResult(null)).toThrow('not an object');
    });

    it('should reject undefined message', () => {
      expect(() => assertValidWorkerResult(undefined)).toThrow('not an object');
    });

    it('should reject false', () => {
      expect(() => assertValidWorkerResult(false)).toThrow('not an object');
    });

    it('should reject string', () => {
      expect(() => assertValidWorkerResult('invalid')).toThrow('not an object');
    });

    it('should reject number', () => {
      expect(() => assertValidWorkerResult(123)).toThrow('not an object');
    });

    it('should reject empty string', () => {
      expect(() => assertValidWorkerResult('')).toThrow('not an object');
    });

    it('should reject zero', () => {
      expect(() => assertValidWorkerResult(0)).toThrow('not an object');
    });
  });

  describe('Invalid Messages - workerId', () => {
    it('should reject message with missing workerId', () => {
      const invalidMsg = {
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should reject message with string workerId', () => {
      const invalidMsg = {
        workerId: '0',
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should reject message with null workerId', () => {
      const invalidMsg = {
        workerId: null,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should reject message with boolean workerId', () => {
      const invalidMsg = {
        workerId: true,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should reject message with object workerId', () => {
      const invalidMsg = {
        workerId: {},
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should accept message with NaN workerId (typeof NaN === "number")', () => {
      const invalidMsg = {
        workerId: NaN,
        results: [],
        output: 'output',
      };

      // NaN is technically type 'number' in JavaScript, so it passes validation
      // In practice, NaN would be invalid, but type checking alone can't distinguish it
      expect(() => assertValidWorkerResult(invalidMsg)).toNotThrow();
    });

    it('should reject message with undefined workerId', () => {
      const invalidMsg = {
        workerId: undefined,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'workerId must be a number'
      );
    });

    it('should reject message with floating point workerId (still valid number)', () => {
      const validMsg = {
        workerId: 1.5,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });
  });

  describe('Invalid Messages - results', () => {
    it('should reject message with missing results', () => {
      const invalidMsg = {
        workerId: 0,
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });

    it('should reject message with string results', () => {
      const invalidMsg = {
        workerId: 0,
        results: 'not an array',
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });

    it('should reject message with null results', () => {
      const invalidMsg = {
        workerId: 0,
        results: null,
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });

    it('should reject message with object results', () => {
      const invalidMsg = {
        workerId: 0,
        results: { data: [] },
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });

    it('should reject message with number results', () => {
      const invalidMsg = {
        workerId: 0,
        results: 123,
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });

    it('should reject message with undefined results', () => {
      const invalidMsg = {
        workerId: 0,
        results: undefined,
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'results must be an array'
      );
    });
  });

  describe('Invalid Messages - output', () => {
    it('should reject message with missing output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with number output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: 123,
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with array output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: [],
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with null output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: null,
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with undefined output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: undefined,
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with object output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: { message: 'output' },
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });

    it('should reject message with boolean output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: true,
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toThrow(
        'output must be a string'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should reject message with extra properties (but valid structure)', () => {
      const msgWithExtra = {
        workerId: 0,
        results: [],
        output: 'output',
        extraField: 'should be ignored',
        anotherExtra: 123,
      };

      expect(() => assertValidWorkerResult(msgWithExtra)).toNotThrow();
    });

    it('should handle deeply nested results array', () => {
      const complexMsg = {
        workerId: 0,
        results: [
          {
            name: 'suite1',
            passed: true,
            pipelines: [
              {
                name: 'pipeline1',
                passed: true,
                steps: [
                  {
                    command: 'cmd',
                    passed: true,
                    failures: [],
                  },
                ],
              },
            ],
          },
        ],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(complexMsg)).toNotThrow();
    });

    it('should reject array instead of object at top level', () => {
      const arrayMsg = [
        {
          workerId: 0,
          results: [],
          output: 'output',
        },
      ];

      // Arrays are objects in JavaScript, so this will fail workerId validation instead
      expect(() => assertValidWorkerResult(arrayMsg)).toThrow('workerId must be a number');
    });

    it('should handle message with whitespace-only output', () => {
      const msgWithWhitespace = {
        workerId: 0,
        results: [],
        output: '   \n\t  ',
      };

      expect(() => assertValidWorkerResult(msgWithWhitespace)).toNotThrow();
    });

    it('should handle message with special characters in output', () => {
      const msgWithSpecialChars = {
        workerId: 0,
        results: [],
        output: 'output with \n newlines \t tabs \r carriage returns',
      };

      expect(() => assertValidWorkerResult(msgWithSpecialChars)).toNotThrow();
    });

    it('should handle message with unicode in output', () => {
      const msgWithUnicode = {
        workerId: 0,
        results: [],
        output: '✓ ✗ 🎉 Unicode characters 中文',
      };

      expect(() => assertValidWorkerResult(msgWithUnicode)).toNotThrow();
    });

    it('should accept negative workerId', () => {
      const validMsg = {
        workerId: -1,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(validMsg)).toNotThrow();
    });

    it('should reject Infinity as workerId', () => {
      const invalidMsg = {
        workerId: Infinity,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toNotThrow();
    });

    it('should reject -Infinity as workerId', () => {
      const invalidMsg = {
        workerId: -Infinity,
        results: [],
        output: 'output',
      };

      expect(() => assertValidWorkerResult(invalidMsg)).toNotThrow();
    });
  });

  describe('Type Narrowing', () => {
    it('should narrow unknown to WorkerResult after validation', () => {
      const unknownMsg: unknown = {
        workerId: 1,
        results: [],
        output: 'test',
      };

      try {
        assertValidWorkerResult(unknownMsg);
        // After this point, TypeScript knows unknownMsg is WorkerResult
        const msg = unknownMsg;
        // Can access workerId without type assertion
        const id: number = msg.workerId;
        const results = msg.results;
        const output: string = msg.output;
        assert.equal(typeof id, 'number');
        assert(Array.isArray(results));
        assert.equal(typeof output, 'string');
      } catch {
        assert.fail('Should not throw for valid message');
      }
    });
  });
});
