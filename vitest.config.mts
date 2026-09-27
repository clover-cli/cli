import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup.ts'],
        // Every test starts with fresh mocks and no leftover spies.
        mockReset: true,
        restoreMocks: true,
    },
});
