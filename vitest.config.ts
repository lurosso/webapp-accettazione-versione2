// Vitest: test unitari e di contratto in `tests/`, ambiente Node, alias "@/" come in tsconfig.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.contract.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**', 'src/services/**', 'src/repositories/**'],
      reporter: ['text', 'html'],
    },
  },
});
