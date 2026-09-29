import type { LambdaClient } from '@aws-sdk/client-lambda';
import { waitUntilFunctionUpdatedV2 } from '@aws-sdk/client-lambda';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { invokeFunction, updateFunction } from '../../../src/provider/aws-services/lambda';
import { fakeClient } from '../../helpers';

vi.mock('@aws-sdk/client-lambda', async (importOriginal) => ({
    ...await importOriginal<typeof import('@aws-sdk/client-lambda')>(),
    waitUntilFunctionActiveV2: vi.fn(),
    waitUntilFunctionUpdatedV2: vi.fn(),
}));

const fn = { Configuration: { FunctionName: 'api', FunctionArn: 'arn:fn', Environment: { Variables: { A: '1', B: '2' } } } };

describe('updateFunction', () => {
    it('merges environment variables with the current ones', async () => {
        const { client, sent } = fakeClient<LambdaClient>({ GetFunctionCommand: fn });

        await updateFunction(client, 'api', { environment: { C: '3' }, removeEnvironment: ['A'] });

        expect(sent().find((c) => c.name === 'UpdateFunctionConfigurationCommand')?.input).toMatchObject({
            Environment: { Variables: { B: '2', C: '3' } },
        });
    });

    it('waits for the configuration update before uploading code', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        writeFileSync(path.join(dir, 'index.mjs'), 'export const handler = () => 1;');
        const { client, sent } = fakeClient<LambdaClient>({ GetFunctionCommand: fn });

        await updateFunction(client, 'api', { memory: 512, code: dir });

        expect(sent().map((c) => c.name)).toEqual([
            'UpdateFunctionConfigurationCommand', 'UpdateFunctionCodeCommand', 'GetFunctionCommand',
        ]);
        expect(waitUntilFunctionUpdatedV2).toHaveBeenCalledOnce();
        const zip = sent()[1].input.ZipFile;
        expect(Buffer.isBuffer(zip) && zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    });

    it('only uploads code when no configuration changes', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        const file = path.join(dir, 'index.mjs');
        writeFileSync(file, 'x');
        const { client, sent } = fakeClient<LambdaClient>({ GetFunctionCommand: fn });

        await updateFunction(client, 'api', { code: file });

        expect(sent().map((c) => c.name)).toEqual(['UpdateFunctionCodeCommand', 'GetFunctionCommand']);
        expect(waitUntilFunctionUpdatedV2).not.toHaveBeenCalled();
    });
});

describe('invokeFunction', () => {
    it('sends the payload as JSON and decodes the result and logs', async () => {
        const { client, sent } = fakeClient<LambdaClient>({
            InvokeCommand: {
                StatusCode: 200,
                Payload: new TextEncoder().encode('{"ok":true}'),
                LogResult: Buffer.from('START\nEND').toString('base64'),
            },
        });

        const result = await invokeFunction(client, 'api', { payload: { name: 'Ada' }, logs: true });

        expect(sent()[0].input).toMatchObject({ InvocationType: 'RequestResponse', LogType: 'Tail' });
        const payload = sent()[0].input.Payload;
        expect(payload instanceof Uint8Array && Buffer.from(payload).toString()).toBe('{"name":"Ada"}');
        expect(result).toEqual({ statusCode: 200, error: undefined, payload: { ok: true }, logs: 'START\nEND' });
    });

    it('keeps a non-JSON result as text', async () => {
        const { client } = fakeClient<LambdaClient>({ InvokeCommand: { Payload: new TextEncoder().encode('plain') } });

        expect((await invokeFunction(client, 'api')).payload).toBe('plain');
    });
});
