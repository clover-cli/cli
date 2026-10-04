// Connection from the user to GCP
import { GoogleAuth } from 'google-auth-library';
import { readGcpEnv, type GcpLogin } from '../credentials';

/**
 * Auth for the GCP REST APIs, from a service account key file or, without one,
 * the Application Default Credentials.
 */
export function gcpAuth(login: GcpLogin): GoogleAuth {
    return new GoogleAuth({
        keyFile: login.keyFile,
        projectId: login.project,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
}

/**
 * Checks the credentials by getting an access token, which needs no IAM permissions.
 * Returns who they belong to; user ADC credentials have no email, so that is null.
 * Throws if the credentials are invalid or missing.
 */
export async function verifyGcpCredentials(login: GcpLogin) {
    const auth = gcpAuth(login);
    await auth.getAccessToken();
    const { client_email: email } = await auth.getCredentials();
    return { email: email ?? null, project: login.project };
}

/** The GCP login from the GOOGLE_* environment variables (see src/credentials.ts). */
export function getGcpConfig(env: NodeJS.ProcessEnv = process.env): GcpLogin {
    const login = readGcpEnv(env);
    if (!login) {
        throw new Error('No GCP project found. Set GOOGLE_CLOUD_PROJECT, or run: eval "$(clover gcp login)"');
    }
    return login;
}
