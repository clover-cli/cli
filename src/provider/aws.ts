// Connection from the user to AWS
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { getAwsCredentials } from '../db';

export interface AwsLogin {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
}

/**
 * Checks the credentials against AWS (STS GetCallerIdentity).
 * This call needs no special IAM permissions, so it works for any valid key.
 * Throws if the credentials are invalid.
 */
export async function verifyAwsCredentials(login: AwsLogin) {
    const sts = new STSClient({
        region: login.region,
        credentials: {
            accessKeyId: login.accessKeyId,
            secretAccessKey: login.secretAccessKey,
            sessionToken: login.sessionToken,
        },
    });

    const identity = await sts.send(new GetCallerIdentityCommand({}));
    return { accountId: identity.Account ?? null, arn: identity.Arn ?? null };
}

/**
 * Returns a config object ready to pass to any AWS SDK client, built from a stored profile.
 *
 * Example:
 *   const s3 = new S3Client(getAwsClientConfig('default'));
 */
export function getAwsClientConfig(profile = 'default') {
    const row = getAwsCredentials(profile);
    if (!row) {
        throw new Error(`No AWS credentials stored for profile "${profile}". Run: clover aws login --profile ${profile}`);
    }
    return {
        region: row.region,
        credentials: {
            accessKeyId: row.access_key_id,
            secretAccessKey: row.secret_access_key,
            sessionToken: row.session_token ?? undefined,
        },
    };
}
