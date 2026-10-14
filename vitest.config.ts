import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The server tests run in schemas of the Azure SQL database (TD-AZURE §10): one per worker, made here.
    globalSetup: ['src/server/test/global-setup.ts'],
    maxWorkers: 4,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
