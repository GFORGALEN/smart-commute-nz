import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Unit and component tests never reach real services; weather tests inject their own fetch.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Network access is disabled in tests.');
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
