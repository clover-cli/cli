import { gcpRequest, type GcpClient } from '../gcp';

/**
 * IAM, read-only: which roles the current credentials have on the project, and which Clover
 * commands they allow. Nothing here changes permissions.
 */

const projectUrl = (project: string) => `https://cloudresourcemanager.googleapis.com/v3/projects/${project}`;

/** The permissions each Clover command needs, per service (same shape as COMMAND_ACTIONS for AWS). */
export const COMMAND_PERMISSIONS: Record<string, Record<string, string[]>> = {
    compute: {
        list: ['compute.instances.list'],
        get: ['compute.instances.get'],
        create: [
            'compute.instances.create', 'compute.instances.setMetadata', 'compute.instances.setLabels', 'compute.disks.create',
            'compute.disks.setLabels', 'compute.images.useReadOnly', 'compute.subnetworks.use', 'compute.subnetworks.useExternalIp',
            'compute.instances.get', 'compute.zoneOperations.get',
        ],
        update: [
            'compute.instances.get', 'compute.instances.setLabels', 'compute.instances.setDeletionProtection',
            'compute.instances.setMachineType', 'compute.instances.stop', 'compute.instances.start', 'compute.zoneOperations.get',
        ],
        delete: ['compute.instances.delete', 'compute.instances.setDeletionProtection', 'compute.zoneOperations.get'],
        start: ['compute.instances.start', 'compute.zoneOperations.get'],
        stop: ['compute.instances.stop', 'compute.zoneOperations.get'],
        reboot: ['compute.instances.reset', 'compute.zoneOperations.get'],
    },
    sql: {
        list: ['cloudsql.instances.list'],
        get: ['cloudsql.instances.get'],
        create: ['cloudsql.instances.create', 'cloudsql.instances.get'],
        update: ['cloudsql.instances.update', 'cloudsql.instances.get'],
        delete: ['cloudsql.instances.delete', 'cloudsql.instances.update'],
        start: ['cloudsql.instances.update', 'cloudsql.instances.get'],
        stop: ['cloudsql.instances.update', 'cloudsql.instances.get'],
        reboot: ['cloudsql.instances.restart', 'cloudsql.instances.get'],
    },
    firestore: {
        list: ['datastore.databases.list'],
        get: ['datastore.databases.get'],
        create: ['datastore.databases.create', 'datastore.databases.get'],
        update: ['datastore.databases.update', 'datastore.databases.get'],
        delete: ['datastore.databases.delete', 'datastore.databases.update'],
        'put-item': ['datastore.entities.create', 'datastore.entities.update'],
        'get-item': ['datastore.entities.get'],
        'delete-item': ['datastore.entities.delete'],
        scan: ['datastore.entities.list'],
    },
    storage: {
        list: ['storage.buckets.list'],
        get: ['storage.buckets.get'],
        create: ['storage.buckets.create'],
        update: ['storage.buckets.update'],
        delete: ['storage.buckets.delete'],
        'delete --force': ['storage.objects.list', 'storage.objects.delete'],
        objects: ['storage.objects.list'],
        upload: ['storage.objects.create'],
        download: ['storage.objects.get'],
        'delete-object': ['storage.objects.delete'],
    },
    functions: {
        list: ['cloudfunctions.functions.list'],
        get: ['cloudfunctions.functions.get'],
        // The function runs as a service account, which needs actAs.
        create: [
            'cloudfunctions.functions.generateUploadUrl', 'cloudfunctions.functions.create', 'cloudfunctions.operations.get',
            'cloudfunctions.functions.get', 'iam.serviceAccounts.actAs',
        ],
        update: [
            'cloudfunctions.functions.get', 'cloudfunctions.functions.update', 'cloudfunctions.functions.generateUploadUrl',
            'cloudfunctions.operations.get', 'iam.serviceAccounts.actAs',
        ],
        delete: ['cloudfunctions.functions.delete'],
        invoke: ['cloudfunctions.functions.get', 'run.routes.invoke'],
    },
};

export const SERVICES = Object.keys(COMMAND_PERMISSIONS);

/** The IAM member for an email: service accounts and users are written differently. */
export function memberFor(email: string): string {
    return email.endsWith('.gserviceaccount.com') ? `serviceAccount:${email}` : `user:${email}`;
}

/** The project roles granted directly to `member`. Roles granted through groups aren't visible here. */
export async function listRoles(client: GcpClient, project: string, member: string): Promise<{ role: string }[]> {
    const policy = await gcpRequest<{ bindings?: { role: string; members?: string[] }[] }>(
        client, `${projectUrl(project)}:getIamPolicy`, { method: 'POST', data: {} });
    return (policy.bindings ?? []).filter((b) => b.members?.includes(member)).map(({ role }) => ({ role }));
}

export interface CommandCheck {
    service: string;
    command: string;
    allowed: boolean;
    permissions: string[];
    /** Permissions that are not granted. */
    missing: string[];
}

/**
 * Asks the project which of the permissions the Clover commands use the caller has
 * (testIamPermissions, which takes at most 100 per call). Checked at the project level, so a
 * grant on a single bucket or instance shows as not allowed.
 */
export async function checkCommands(client: GcpClient, project: string, services: string[] = SERVICES): Promise<CommandCheck[]> {
    const commands = services.flatMap((service) =>
        Object.entries(COMMAND_PERMISSIONS[service] ?? {}).map(([command, permissions]) => ({ service, command, permissions })));
    const all = [...new Set(commands.flatMap((c) => c.permissions))];

    const granted = new Set<string>();
    for (let i = 0; i < all.length; i += 100) {
        const result = await gcpRequest<{ permissions?: string[] }>(
            client, `${projectUrl(project)}:testIamPermissions`, { method: 'POST', data: { permissions: all.slice(i, i + 100) } });
        for (const p of result.permissions ?? []) granted.add(p);
    }

    return commands.map(({ service, command, permissions }) => {
        const missing = permissions.filter((p) => !granted.has(p));
        return { service, command, allowed: missing.length === 0, permissions, missing };
    });
}
