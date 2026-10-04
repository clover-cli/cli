import path from 'node:path';
import type { Argv, CommandModule, Options } from 'yargs';
import {
    createBucket,
    deleteBucket,
    deleteObject,
    downloadObject,
    getBucket,
    listBuckets,
    listObjects,
    updateBucket,
    uploadObject,
} from '../../provider/gcp-services/storage';
import { action, confirm, info, parseKeyValues, print, yesOption } from '../aws/shared';
import { gcpCommonOptions, gcpContext, gcpServiceBuilder } from './shared';

const bucketPositional = { bucket: { type: 'string', describe: 'Bucket name' } } as const;

const labelsOption = {
    labels: { type: 'string', array: true, describe: 'Labels as Key=Value (repeatable)' },
} as const satisfies Record<string, Options>;

function labelsArg(list: readonly (string | number)[] | undefined): Record<string, string> | undefined {
    const labels = parseKeyValues(list, 'label');
    return Object.keys(labels).length > 0 ? labels : undefined;
}

const create = action({
    command: 'create <bucket>',
    describe: 'Create a Cloud Storage bucket',
    positionals: bucketPositional,
    options: {
        ...gcpCommonOptions,
        versioning: { type: 'boolean', default: false, describe: 'Keep every version of every object' },
        ...labelsOption,
    },
    examples: [['$0 gcp storage create my-app-assets --region europe-west1 --versioning --labels env=prod', 'A versioned, labeled bucket in Belgium']],
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const bucket = await createBucket(client, project, argv.bucket, {
            location: argv.region,
            versioning: argv.versioning,
            labels: labelsArg(argv.labels),
        });
        info(`Created bucket ${argv.bucket} in ${bucket.location ?? argv.region}.`);
        print(argv, bucket);
    },
});

const list = action({
    command: 'list',
    describe: 'List the project\'s buckets (all locations)',
    options: gcpCommonOptions,
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        print(argv, await listBuckets(client, project), 'No buckets found.');
    },
});

const get = action({
    command: 'get <bucket>',
    describe: 'Show one bucket (location, versioning, labels)',
    positionals: bucketPositional,
    options: gcpCommonOptions,
    handler: async (argv) => {
        print(argv, await getBucket(gcpContext(argv).client, argv.bucket));
    },
});

const update = action({
    command: 'update <bucket>',
    describe: 'Change a bucket (versioning, labels)',
    positionals: bucketPositional,
    options: {
        ...gcpCommonOptions,
        versioning: { type: 'boolean', describe: 'Enable versioning, or turn it off with --no-versioning' },
        ...labelsOption,
        'remove-labels': { type: 'string', array: true, describe: 'Label keys to remove' },
    },
    handler: async (argv) => {
        const bucket = await updateBucket(gcpContext(argv).client, argv.bucket, {
            versioning: argv.versioning,
            labels: labelsArg(argv.labels),
            removeLabels: argv.removeLabels?.map(String),
        });
        print(argv, bucket);
    },
});

const remove = action({
    command: 'delete <bucket>',
    describe: 'Delete a bucket',
    positionals: bucketPositional,
    options: {
        ...gcpCommonOptions,
        force: { type: 'boolean', default: false, describe: 'Delete every object (and version) in it first' },
        ...yesOption,
    },
    handler: async (argv) => {
        const what = argv.force ? `bucket ${argv.bucket} and EVERY object in it` : `bucket ${argv.bucket}`;
        if (!await confirm(argv, `Delete ${what}?`)) return;
        const result = await deleteBucket(gcpContext(argv).client, argv.bucket, { force: argv.force });
        info(`Deleted ${argv.bucket}${argv.force ? ` and ${result.objectsDeleted} object(s)` : ''}.`);
        if (argv.output === 'json') print(argv, result);
    },
});

// ---- Objects ----

const objects = action({
    command: 'objects <bucket>',
    describe: 'List objects in a bucket',
    positionals: bucketPositional,
    options: {
        ...gcpCommonOptions,
        prefix: { type: 'string', describe: 'Only names starting with this' },
    },
    handler: async (argv) => {
        print(argv, await listObjects(gcpContext(argv).client, argv.bucket, { prefix: argv.prefix }), 'No objects found.');
    },
});

const upload = action({
    command: 'upload <bucket> <file>',
    describe: 'Upload a file',
    positionals: { ...bucketPositional, file: { type: 'string', describe: 'Local file' } },
    options: {
        ...gcpCommonOptions,
        key: { type: 'string', describe: 'Object name (default: the file name)' },
        'content-type': { type: 'string', describe: 'Content-Type, e.g. text/html (default: application/octet-stream)' },
    },
    handler: async (argv) => {
        const key = argv.key ?? path.basename(argv.file);
        const result = await uploadObject(gcpContext(argv).client, argv.bucket, key, argv.file, { contentType: argv.contentType });
        info(`Uploaded ${argv.file} to gs://${argv.bucket}/${key}.`);
        if (argv.output === 'json') print(argv, result);
    },
});

const download = action({
    command: 'download <bucket> <key>',
    describe: 'Download an object',
    positionals: { ...bucketPositional, key: { type: 'string', describe: 'Object name' } },
    options: {
        ...gcpCommonOptions,
        file: { type: 'string', describe: 'Where to save it (default: the object\'s file name)' },
    },
    handler: async (argv) => {
        const file = argv.file ?? path.basename(argv.key);
        await downloadObject(gcpContext(argv).client, argv.bucket, argv.key, file);
        info(`Downloaded gs://${argv.bucket}/${argv.key} to ${file}.`);
    },
});

const removeObject = action({
    command: 'delete-object <bucket> <key>',
    describe: 'Delete an object',
    positionals: { ...bucketPositional, key: { type: 'string', describe: 'Object name' } },
    options: { ...gcpCommonOptions, ...yesOption },
    handler: async (argv) => {
        if (!await confirm(argv, `Delete gs://${argv.bucket}/${argv.key}?`)) return;
        await deleteObject(gcpContext(argv).client, argv.bucket, argv.key);
        info(`Deleted gs://${argv.bucket}/${argv.key}.`);
    },
});

/**
 * clover gcp storage <create|list|get|update|delete|objects|upload|download|delete-object>
 */
const storageCommand: CommandModule = {
    command: 'storage',
    describe: 'Create, list, update and delete Cloud Storage buckets and objects',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(create)
        .command(list)
        .command(get)
        .command(update)
        .command(remove)
        .command(objects)
        .command(upload)
        .command(download)
        .command(removeObject)
        .demandCommand(1, 'Choose an action: create, list, get, update, delete, objects, upload, download or delete-object'),
    handler: () => {},
};

export default storageCommand;
