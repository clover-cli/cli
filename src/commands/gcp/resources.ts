import { listGcpResources } from '../../provider/gcp';
import { errorMessage } from '../../utils';
import { gcpContext } from './shared';

/** clover gcp list-resources: everything in the project, from Cloud Asset Inventory. */
export async function listResources(argv: { project?: string }) {
    try {
        const { client, project } = gcpContext(argv);
        const inventory = await listGcpResources(client, project);

        console.log(`Resources in project ${inventory.project}:`);
        console.table(inventory.services.map((s) => ({ service: s.service, count: s.count })));

        for (const s of inventory.services) {
            console.log(`\n${s.service} (${s.count})`);
            console.table(s.resources);
        }

        console.log(`\n${inventory.total} resource(s) across ${inventory.services.length} service(s).`);
    } catch (err) {
        console.error(errorMessage(err));
        process.exitCode = 1;
    }
}
