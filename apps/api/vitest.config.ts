import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Resolve the `.js` extensions TypeScript ESM requires in import specifiers.
 *
 * The source compiles to ESM, so every relative import is written as
 * `'./thing.js'` even though the file on disk is `thing.ts`. Node resolves that
 * after compilation; Vite, running the TypeScript directly, does not — it looks
 * for a literal `thing.js` and fails. Rewriting the specifier to be
 * extensionless lets Vite's normal resolution find the `.ts`.
 */
function resolveTsExtensions(): Plugin {
  return {
    name: 'resolve-ts-esm-extensions',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      // Hand the extensionless path back to the resolver chain.
      return this.resolve(source.slice(0, -3), importer, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [resolveTsExtensions()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // `config/env.ts` exits the process on a malformed environment, so the
    // suite has to supply a valid one before any module under test is imported.
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
