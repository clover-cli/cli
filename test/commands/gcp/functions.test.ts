import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

const base = 'https://cloudfunctions.googleapis.com/v2/projects/other/locations/europe-west1/functions';

function useClient(responses: Record<string, unknown>) {
    const fake = fakeGcpClient(responses);
    vi.mocked(gcpClient).mockReturnValue(fake.client);
    return fake;
}

beforeEach(() => {
    vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('clover gcp functions', () => {
    it('creates a function with defaults, waits and prints it', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        writeFileSync(path.join(dir, 'index.js'), 'x');
        const { sent } = useClient({
            'POST :generateUploadUrl': { uploadUrl: 'https://signed', storageSource: { bucket: 'b', object: 'o' } },
            'POST /functions': { name: 'projects/other/locations/europe-west1/operations/op1' },
            'GET /operations/op1': { done: true },
            'GET /functions/hello': { name: 'x/functions/hello', state: 'ACTIVE', buildConfig: { runtime: 'nodejs22' } },
        });

        await runCli(`gcp functions create hello --source ${dir} --project other --region europe-west1 --env STAGE=prod --labels team=x --wait --output json`);

        expect(gcpClient).toHaveBeenCalledWith({ project: 'other' });
        expect(sent()[1]).toMatchObject({
            url: base,
            params: { functionId: 'hello' },
            data: { labels: { team: 'x' }, buildConfig: { runtime: 'nodejs22', entryPoint: 'hello' }, serviceConfig: { environmentVariables: { STAGE: 'prod' } } },
        });
        expect(JSON.parse(logged())).toMatchObject({ name: 'hello', state: 'ACTIVE', runtime: 'nodejs22' });
    });

    it('requires a source', async () => {
        await expect(runCli('gcp functions create hello')).rejects.toThrow('Missing required argument: source');
    });

    it('fails an update with nothing to change', async () => {
        useClient({});

        await runCli('gcp functions update api');

        expect(errored()).toContain('Nothing to update');
        expect(process.exitCode).toBe(1);
    });

    it('asks for --yes before deleting outside a terminal', async () => {
        process.stdin.isTTY = false;
        const { sent } = useClient({});

        await runCli('gcp functions delete api');

        expect(sent()).toEqual([]);
        expect(errored()).toContain('Pass --yes');
    });

    it('invokes with a payload and prints the result', async () => {
        const { sent } = useClient({
            'GET /functions/hello': { name: 'hello', serviceConfig: { uri: 'https://hello-xyz.a.run.app' } },
            'POST run.app': { ok: true },
        });

        await runCli(['gcp', 'functions', 'invoke', 'hello', '--payload', '{"name": "Ada"}']);

        expect(sent()[1]).toMatchObject({ method: 'POST', data: { name: 'Ada' } });
        expect(JSON.parse(logged())).toEqual({ ok: true });
    });
});
