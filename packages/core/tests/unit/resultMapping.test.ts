import { describe, expect, it } from 'vitest';
import { resultFromCheckerOutcome, resultFromExecutionFailure } from '../../src/application/resultMapping.js';

const testCase = {
  id: 't1',
  stdin: 'input',
  expected: 'expected',
};

describe('result mapping', () => {
  it('maps execution failure fields into JudgeTestResult', () => {
    expect(resultFromExecutionFailure(testCase, {
      success: false,
      status: 'runtime_error',
      stdout: 'out',
      stderr: 'err',
      exitCode: 1,
      elapsedMs: 12,
      memoryBytes: 1024,
      reason: 'boom',
    })).toEqual({
      id: 't1',
      status: 'runtime_error',
      elapsedMs: 12,
      memoryBytes: 1024,
      message: 'boom',
      stdout: 'out',
      stderr: 'err',
      exitCode: 1,
    });
  });

  it('maps checker outcome fields into JudgeTestResult', () => {
    expect(resultFromCheckerOutcome(
      testCase,
      {
        success: true,
        stdout: 'out',
        stderr: '',
        exitCode: 0,
        elapsedMs: 4,
      },
      {
        status: 'wrong_answer',
        message: 'mismatch',
      },
    )).toEqual({
      id: 't1',
      status: 'wrong_answer',
      elapsedMs: 4,
      message: 'mismatch',
      stdout: 'out',
      stderr: '',
      exitCode: 0,
    });
  });
});
