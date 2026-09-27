import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Global mocks: tests never call AWS and never wait for terminal input.
 * Configure them per test with vi.mocked(fn).mockReturnValue(...).
 */

vi.mock('../src/provider/aws', () => ({
    verifyAwsCredentials: vi.fn(),
    getAwsClientConfig: vi.fn(),
    listAwsResources: vi.fn(),
}));

vi.mock('../src/utils', async (importOriginal) => ({
    ...await importOriginal<typeof import('../src/utils')>(),
    askUser: vi.fn(),
}));

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
});

afterEach(() => {
    process.exitCode = undefined;
});
