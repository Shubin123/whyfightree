import { defineConfig } from 'vitest/config';

// Relative asset URLs make the static bundle work both at the root in Vite
// preview and under the /whyfightree/ GitHub Pages project path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~600 kB; warning below that is only noise in CI.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
