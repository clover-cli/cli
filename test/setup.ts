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

// Request helpers stay real; command tests return a fakeGcpClient() from gcpClient.
vi.mock('../src/provider/gcp', async (importOriginal) => ({
    ...await importOriginal<typeof import('../src/provider/gcp')>(),
    verifyGcpCredentials: vi.fn(),
    getGcpConfig: vi.fn(),
    gcpClient: vi.fn(),
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

// Tests may pretend to be (or not be) in a terminal to exercise confirmation prompts.
const stdinIsTTY = process.stdin.isTTY;

afterEach(() => {
    process.exitCode = undefined;
    process.stdin.isTTY = stdinIsTTY;
});
