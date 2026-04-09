/**
 * Unit Tests for Test Runner Validation Functions
 *
 * Tests for assertValidWorkerResult which validates incoming IPC messages
 * from worker processes at the IPC boundary.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { assertValidWorkerResult } from '../test-runner.js';

describe('assertValidWorkerResult', () => {
  describe('Valid Messages', () => {
    it('should accept valid WorkerResult with empty results array', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: 'test output',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
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

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
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

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });

    it('should accept valid message with empty string output', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: '',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });

    it('should accept valid message with workerId 0', () => {
      const validMsg = {
        workerId: 0,
        results: [],
        output: 'output',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });

    it('should accept valid message with large workerId', () => {
      const validMsg = {
        workerId: 999999,
        results: [],
        output: 'output',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });
  });

  describe('Invalid Messages - Null/Undefined', () => {
    it('should reject null message', () => {
      assert.throws(
        () => assertValidWorkerResult(null),
        /not an object/
      );
    });

    it('should reject undefined message', () => {
      assert.throws(
        () => assertValidWorkerResult(undefined),
        /not an object/
      );
    });

    it('should reject false', () => {
      assert.throws(
        () => assertValidWorkerResult(false),
        /not an object/
      );
    });

    it('should reject string', () => {
      assert.throws(
        () => assertValidWorkerResult('invalid'),
        /not an object/
      );
    });

    it('should reject number', () => {
      assert.throws(
        () => assertValidWorkerResult(123),
        /not an object/
      );
    });

    it('should reject empty string', () => {
      assert.throws(
        () => assertValidWorkerResult(''),
        /not an object/
      );
    });

    it('should reject zero', () => {
      assert.throws(
        () => assertValidWorkerResult(0),
        /not an object/
      );
    });
  });

  describe('Invalid Messages - workerId', () => {
    it('should reject message with missing workerId', () => {
      const invalidMsg = {
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should reject message with string workerId', () => {
      const invalidMsg = {
        workerId: '0',
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should reject message with null workerId', () => {
      const invalidMsg = {
        workerId: null,
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should reject message with boolean workerId', () => {
      const invalidMsg = {
        workerId: true,
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should reject message with object workerId', () => {
      const invalidMsg = {
        workerId: {},
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should accept message with NaN workerId (typeof NaN === "number")', () => {
      const msg = {
        workerId: NaN,
        results: [],
        output: 'output',
      };

      // NaN is technically type 'number' in JavaScript, so it passes validation
      // In practice, NaN would be invalid, but type checking alone can't distinguish it
      assert.doesNotThrow(() => assertValidWorkerResult(msg));
    });

    it('should reject message with undefined workerId', () => {
      const invalidMsg = {
        workerId: undefined,
        results: [],
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /workerId must be a number/
      );
    });

    it('should accept message with floating point workerId (still valid number)', () => {
      const validMsg = {
        workerId: 1.5,
        results: [],
        output: 'output',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });
  });

  describe('Invalid Messages - results', () => {
    it('should reject message with missing results', () => {
      const invalidMsg = {
        workerId: 0,
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });

    it('should reject message with string results', () => {
      const invalidMsg = {
        workerId: 0,
        results: 'not an array',
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });

    it('should reject message with null results', () => {
      const invalidMsg = {
        workerId: 0,
        results: null,
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });

    it('should reject message with object results', () => {
      const invalidMsg = {
        workerId: 0,
        results: { data: [] },
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });

    it('should reject message with number results', () => {
      const invalidMsg = {
        workerId: 0,
        results: 123,
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });

    it('should reject message with undefined results', () => {
      const invalidMsg = {
        workerId: 0,
        results: undefined,
        output: 'output',
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /results must be an array/
      );
    });
  });

  describe('Invalid Messages - output', () => {
    it('should reject message with missing output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with number output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: 123,
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with array output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: [],
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with null output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: null,
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with undefined output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: undefined,
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with object output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: { message: 'output' },
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });

    it('should reject message with boolean output', () => {
      const invalidMsg = {
        workerId: 0,
        results: [],
        output: true,
      };

      assert.throws(
        () => assertValidWorkerResult(invalidMsg),
        /output must be a string/
      );
    });
  });

  describe('Edge Cases', () => {
    it('should accept message with extra properties (but valid structure)', () => {
      const msgWithExtra = {
        workerId: 0,
        results: [],
        output: 'output',
        extraField: 'should be ignored',
        anotherExtra: 123,
      };

      assert.doesNotThrow(() => assertValidWorkerResult(msgWithExtra));
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

      assert.doesNotThrow(() => assertValidWorkerResult(complexMsg));
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
      assert.throws(
        () => assertValidWorkerResult(arrayMsg),
        /workerId must be a number/
      );
    });

    it('should handle message with whitespace-only output', () => {
      const msgWithWhitespace = {
        workerId: 0,
        results: [],
        output: '   \n\t  ',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(msgWithWhitespace));
    });

    it('should handle message with special characters in output', () => {
      const msgWithSpecialChars = {
        workerId: 0,
        results: [],
        output: 'output with \n newlines \t tabs \r carriage returns',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(msgWithSpecialChars));
    });

    it('should handle message with unicode in output', () => {
      const msgWithUnicode = {
        workerId: 0,
        results: [],
        output: '✓ ✗ 🎉 Unicode characters 中文',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(msgWithUnicode));
    });

    it('should accept negative workerId', () => {
      const validMsg = {
        workerId: -1,
        results: [],
        output: 'output',
      };

      assert.doesNotThrow(() => assertValidWorkerResult(validMsg));
    });

    it('should accept Infinity as workerId (typeof Infinity === "number")', () => {
      const msg = {
        workerId: Infinity,
        results: [],
        output: 'output',
      };

      // Infinity is technically type 'number' in JavaScript, so it passes validation
      assert.doesNotThrow(() => assertValidWorkerResult(msg));
    });

    it('should accept -Infinity as workerId (typeof -Infinity === "number")', () => {
      const msg = {
        workerId: -Infinity,
        results: [],
        output: 'output',
      };

      // -Infinity is technically type 'number' in JavaScript, so it passes validation
      assert.doesNotThrow(() => assertValidWorkerResult(msg));
    });
  });

  describe('Type Narrowing', () => {
    it('should narrow unknown to WorkerResult after validation', () => {
      const unknownMsg: unknown = {
        workerId: 1,
        results: [],
        output: 'test',
      };

      // After assertion, TypeScript narrows unknownMsg to WorkerResult
      assertValidWorkerResult(unknownMsg);

      // Now we can access properties without type assertions
      const id: number = unknownMsg.workerId;
      const results = unknownMsg.results;
      const output: string = unknownMsg.output;

      // Verify runtime types
      assert.equal(typeof id, 'number');
      assert(Array.isArray(results));
      assert.equal(typeof output, 'string');
    });
  });
});
