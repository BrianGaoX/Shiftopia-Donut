/**
 * Vitest global test setup.
 * Referenced by vitest.config.ts → test.setupFiles.
 */

import '@testing-library/jest-dom';
import { beforeAll, afterAll } from 'vitest';

// Silence console.error in tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Re-throw assertion-level errors so they surface
    if (typeof args[0] === 'string' && args[0].includes('Warning:')) return;
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});
