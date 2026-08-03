import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'doffin',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
