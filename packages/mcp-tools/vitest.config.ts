import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mcp-tools',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
