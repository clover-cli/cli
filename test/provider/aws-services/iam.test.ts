import type { IAMClient } from '@aws-sdk/client-iam';
import { describe, expect, it } from 'vitest';
import { checkCommands, listPolicies, principalFromArn, type Principal } from '../../../src/provider/aws-services/iam';
import { fakeClient } from '../../helpers';

const user: Principal = { kind: 'user', name: 'clover-cli', account: '123456789012', partition: 'aws' };

describe('principalFromArn', () => {
    it('reads an IAM user, ignoring its path', () => {
        expect(principalFromArn('arn:aws:iam::123456789012:user/team/clover-cli'))
            .toEqual({ kind: 'user', name: 'clover-cli', account: '123456789012', partition: 'aws' });
    });

    it('reads the role behind an assumed-role session', () => {
        expect(principalFromArn('arn:aws:sts::123456789012:assumed-role/Admin/alice@example.com'))
            .toEqual({ kind: 'role', name: 'Admin', account: '123456789012', partition: 'aws' });
    });

    it('explains that the root user has no policies', () => {
        expect(() => principalFromArn('arn:aws:iam::123456789012:root')).toThrow(/root user/);
    });
});

describe('listPolicies', () => {
    it('lists managed and inline policies, directly and through groups', async () => {
        const { client } = fakeClient<IAMClient>({
            ListAttachedUserPoliciesCommand: { AttachedPolicies: [{ PolicyName: 'ReadOnlyAccess', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' }] },
            ListUserPoliciesCommand: { PolicyNames: ['extra'] },
            ListGroupsForUserCommand: { Groups: [{ GroupName: 'devs' }] },
            ListAttachedGroupPoliciesCommand: { AttachedPolicies: [{ PolicyName: 'app', PolicyArn: 'arn:aws:iam::123456789012:policy/app' }] },
            ListGroupPoliciesCommand: { PolicyNames: [] },
        });

        expect(await listPolicies(client, user)).toEqual([
            { name: 'ReadOnlyAccess', type: 'aws-managed', via: 'user', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' },
            { name: 'extra', type: 'inline', via: 'user' },
            { name: 'app', type: 'customer-managed', via: 'group devs', arn: 'arn:aws:iam::123456789012:policy/app' },
        ]);
    });

    it('follows IsTruncated pages', async () => {
        const { client } = fakeClient<IAMClient>({
            ListAttachedUserPoliciesCommand: [
                { AttachedPolicies: [{ PolicyName: 'a' }], IsTruncated: true, Marker: 'm1' },
                { AttachedPolicies: [{ PolicyName: 'b' }] },
            ],
        });

        expect((await listPolicies(client, user)).map((p) => p.name)).toEqual(['a', 'b']);
    });
});

describe('checkCommands', () => {
    it('marks a command allowed only when every action it needs is allowed', async () => {
        const { client, sent } = fakeClient<IAMClient>({
            SimulatePrincipalPolicyCommand: {
                EvaluationResults: [
                    { EvalActionName: 'lambda:ListFunctions', EvalDecision: 'allowed' },
                    { EvalActionName: 'lambda:GetFunction', EvalDecision: 'allowed' },
                    { EvalActionName: 'lambda:CreateFunction', EvalDecision: 'implicitDeny' },
                    { EvalActionName: 'iam:PassRole', EvalDecision: 'explicitDeny' },
                ],
            },
        });

        const results = await checkCommands(client, user, ['lambda']);

        expect(sent()[0].input.PolicySourceArn).toBe('arn:aws:iam::123456789012:user/clover-cli');
        expect(results.find((r) => r.command === 'list')).toMatchObject({ allowed: true, missing: [] });
        expect(results.find((r) => r.command === 'create')).toMatchObject({
            allowed: false, missing: ['lambda:CreateFunction', 'iam:PassRole'],
        });
        // Actions the simulator didn't return count as not allowed.
        expect(results.find((r) => r.command === 'invoke')).toMatchObject({ allowed: false, missing: ['lambda:InvokeFunction'] });
    });

    it('simulates a role by its full ARN, including its path', async () => {
        const { client, sent } = fakeClient<IAMClient>({
            GetRoleCommand: { Role: { Arn: 'arn:aws:iam::123456789012:role/ops/Admin' } },
        });

        await checkCommands(client, { ...user, kind: 'role', name: 'Admin' }, ['s3']);

        expect(sent().find((c) => c.name === 'SimulatePrincipalPolicyCommand')?.input.PolicySourceArn)
            .toBe('arn:aws:iam::123456789012:role/ops/Admin');
    });
});
