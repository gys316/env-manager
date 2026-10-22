import { describe, expect, test } from 'vitest';
import { createTerminalIo, isInteractive } from '../src/io.js';

describe('interactive mode', () => {
  test('--json forces non-interactive even with TTYs', () => {
    expect(isInteractive({ json: true, stdinIsTTY: true, stderrIsTTY: true })).toBe(false);
    expect(createTerminalIo({ json: true, stdinIsTTY: true, stderrIsTTY: true }).interactive).toBe(false);
  });
  test('without --json, TTYs on stdin and stderr are interactive', () => {
    expect(isInteractive({ json: false, stdinIsTTY: true, stderrIsTTY: true })).toBe(true);
    expect(isInteractive({ json: false, stdinIsTTY: false, stderrIsTTY: true })).toBe(false);
  });
});
