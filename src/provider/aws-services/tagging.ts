import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { PROJECT_TAG } from '../../projects';
import type { AwsClientConfig } from '../aws';

export function taggingClient(config: AwsClientConfig): ResourceGroupsTaggingAPIClient {
    return new ResourceGroupsTaggingAPIClient(config);
}

export interface ProjectResource {
    arn: string;
    /** The name or ID the service commands use, e.g. i-0abc, my-bucket, my-function. */
    id: string;
    service: string;
    project: string;
}

/** arn:aws:service:region:account:type/id, type:id or just id (S3) -> id */
function idFromArn(arn: string): string {
    const resource = arn.split(':').slice(5).join(':');
    return resource.split(/[/:]/).pop() ?? resource;
}

/**
 * Resources tagged with a Clover project (any project when `project` is undefined), in the client's
 * region. The tagging API only sees resources in that region, like the service list commands.
 */
export async function listProjectResources(client: ResourceGroupsTaggingAPIClient, project?: string): Promise<ProjectResource[]> {
    const resources: ProjectResource[] = [];
    let token: string | undefined;
    do {
        const page = await client.send(new GetResourcesCommand({
            TagFilters: [{ Key: PROJECT_TAG, Values: project ? [project] : undefined }],
            PaginationToken: token || undefined,
        }));
        for (const mapping of page.ResourceTagMappingList ?? []) {
            if (!mapping.ResourceARN) continue;
            resources.push({
                arn: mapping.ResourceARN,
                id: idFromArn(mapping.ResourceARN),
                service: mapping.ResourceARN.split(':')[2],
                project: mapping.Tags?.find((t) => t.Key === PROJECT_TAG)?.Value ?? '',
            });
        }
        token = page.PaginationToken;
    } while (token);
    return resources;
}
