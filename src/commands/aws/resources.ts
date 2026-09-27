/**
 * This file will help with the methods that
 * will allow us to list the available resources
 * within this project.
 */

import { listAwsResources } from "../../provider/aws";

export async function listResources() {
    try {
        const inventory = await listAwsResources();

        console.log(`Resources in region ${inventory.region}:`);
        console.table(inventory.services.map((s) => ({
            service: s.service,
            count: s.count,
            ...(s.error ? { error: s.error } : {}),
        })));

        for (const s of inventory.services) {
            if (s.resources.length === 0) continue;
            console.log(`\n${s.service} (${s.count})`);
            console.table(s.resources);
        }

        const active = inventory.services.filter((s) => s.count > 0).length;
        console.log(`\n${inventory.total} resource(s) across ${active} active service(s).`);
    } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
    }
}
