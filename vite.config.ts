import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/naming-things/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'worker/test/**/*.test.ts'],
  },
})
