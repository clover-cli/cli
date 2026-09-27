import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import { createFunction, invokeFunction, updateFunction } from '../../../src/provider/aws-services/lambda';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/lambda');

const role = 'arn:aws:iam::123456789012:role/lambda';

describe('clover aws lambda', () => {
    it('creates a function with defaults', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createFunction).mockResolvedValue({ name: 'hello' });

        await runCli(`aws lambda create hello --code index.mjs --role ${role} --env STAGE=prod --env DEBUG=`);

        expect(createFunction).toHaveBeenCalledWith(undefined, 'hello', expect.objectContaining({
            code: 'index.mjs', role, runtime: 'nodejs22.x', handler: 'index.handler', environment: { STAGE: 'prod', DEBUG: '' },
        }));
    });

    it('requires code and a role', async () => {
        await expect(runCli('aws lambda create hello')).rejects.toThrow('Missing required arguments: code, role');
    });

    it('updates code and configuration together', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(updateFunction).mockResolvedValue({ name: 'api' });

        await runCli('aws lambda update api --code ./build --memory 512 --remove-env OLD');

        expect(updateFunction).toHaveBeenCalledWith(undefined, 'api', expect.objectContaining({
            code: './build', memory: 512, environment: undefined, removeEnvironment: ['OLD'],
        }));
    });

    it('invokes with a payload and prints the result', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(invokeFunction).mockResolvedValue({ statusCode: 200, payload: { ok: true }, logs: 'END' });

        await runCli(['aws', 'lambda', 'invoke', 'hello', '--payload', '{"name": "Ada"}', '--logs']);

        expect(invokeFunction).toHaveBeenCalledWith(undefined, 'hello', { payload: { name: 'Ada' }, logs: true, async: false });
        expect(JSON.parse(logged())).toEqual({ ok: true });
        expect(errored()).toContain('END');
    });

    it('fails when the function throws', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(invokeFunction).mockResolvedValue({ statusCode: 200, error: 'Unhandled', payload: { errorMessage: 'boom' } });

        await runCli('aws lambda invoke hello');

        expect(errored()).toContain('Function error: Unhandled');
        expect(logged()).toContain('boom');
        expect(process.exitCode).toBe(1);
    });
});
