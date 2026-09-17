import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local tooling (e.g. Trunk) installs plugins with their own test files under dot-directories.
    exclude: [...configDefaults.exclude, '**/.trunk/**'],
  },
});
