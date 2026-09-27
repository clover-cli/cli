import path from 'node:path';
import type { Argv, CommandModule } from 'yargs';
import {
    createBucket,
    deleteBucket,
    deleteObject,
    downloadObject,
    getBucket,
    listBuckets,
    listObjects,
    s3Client,
    updateBucket,
    uploadObject,
} from '../../provider/aws-services/s3';
import { action, clientConfig, confirm, info, parseKeyValues, print, serviceBuilder, tagsOption, yesOption } from './shared';

const bucketPositional = { bucket: { type: 'string', describe: 'Bucket name' } } as const;

const create = action({
    command: 'create <bucket>',
    describe: 'Create an S3 bucket',
    positionals: bucketPositional,
    options: {
        versioning: { type: 'boolean', default: false, describe: 'Keep every version of every object' },
        ...tagsOption,
    },
    examples: [['$0 aws s3 create my-app-assets --region eu-west-1 --versioning --tags env=prod', 'A versioned, tagged bucket in Ireland']],
    handler: async (argv) => {
        const config = clientConfig(argv);
        const tags = parseKeyValues(argv.tags);
        const bucket = await createBucket(s3Client(config), argv.bucket, {
            region: config.region,
            versioning: argv.versioning,
            tags: Object.keys(tags).length > 0 ? tags : undefined,
        });
        info(`Created bucket ${argv.bucket} in ${config.region}.`);
        print(argv, bucket);
    },
});

const list = action({
    command: 'list',
    describe: 'List S3 buckets (all regions)',
    handler: async (argv) => {
        print(argv, await listBuckets(s3Client(clientConfig(argv))), 'No buckets found.');
    },
});

const get = action({
    command: 'get <bucket>',
    describe: 'Show one S3 bucket (region, versioning, tags)',
    positionals: bucketPositional,
    handler: async (argv) => {
        print(argv, await getBucket(s3Client(clientConfig(argv)), argv.bucket));
    },
});

const update = action({
    command: 'update <bucket>',
    describe: 'Change an S3 bucket (versioning, tags)',
    positionals: bucketPositional,
    options: {
        versioning: { type: 'boolean', describe: 'Enable versioning, or suspend it with --no-versioning' },
        ...tagsOption,
        'remove-tags': { type: 'string', array: true, describe: 'Tag keys to remove' },
    },
    handler: async (argv) => {
        const tags = parseKeyValues(argv.tags);
        const bucket = await updateBucket(s3Client(clientConfig(argv)), argv.bucket, {
            versioning: argv.versioning,
            tags: Object.keys(tags).length > 0 ? tags : undefined,
            removeTags: argv.removeTags?.map(String),
        });
        print(argv, bucket);
    },
});

const remove = action({
    command: 'delete <bucket>',
    describe: 'Delete an S3 bucket',
    positionals: bucketPositional,
    options: {
        force: { type: 'boolean', default: false, describe: 'Delete every object (and version) in it first' },
        ...yesOption,
    },
    handler: async (argv) => {
        const what = argv.force ? `bucket ${argv.bucket} and EVERY object in it` : `bucket ${argv.bucket}`;
        if (!await confirm(argv, `Delete ${what}?`)) return;
        const result = await deleteBucket(s3Client(clientConfig(argv)), argv.bucket, { force: argv.force });
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
        prefix: { type: 'string', describe: 'Only keys starting with this' },
        limit: { type: 'number', default: 100, describe: 'Maximum objects to list (0 for all)' },
    },
    handler: async (argv) => {
        const found = await listObjects(s3Client(clientConfig(argv)), argv.bucket, { prefix: argv.prefix, limit: argv.limit || undefined });
        print(argv, found, 'No objects found.');
    },
});

const upload = action({
    command: 'upload <bucket> <file>',
    describe: 'Upload a file',
    positionals: { ...bucketPositional, file: { type: 'string', describe: 'Local file' } },
    options: {
        key: { type: 'string', describe: 'Object key (default: the file name)' },
        'content-type': { type: 'string', describe: 'Content-Type header, e.g. text/html' },
    },
    handler: async (argv) => {
        const key = argv.key ?? path.basename(argv.file);
        const result = await uploadObject(s3Client(clientConfig(argv)), argv.bucket, key, argv.file, { contentType: argv.contentType });
        info(`Uploaded ${argv.file} to s3://${argv.bucket}/${key}.`);
        if (argv.output === 'json') print(argv, result);
    },
});

const download = action({
    command: 'download <bucket> <key>',
    describe: 'Download an object',
    positionals: { ...bucketPositional, key: { type: 'string', describe: 'Object key' } },
    options: {
        file: { type: 'string', describe: 'Where to save it (default: the key\'s file name)' },
    },
    handler: async (argv) => {
        const file = argv.file ?? path.basename(argv.key);
        await downloadObject(s3Client(clientConfig(argv)), argv.bucket, argv.key, file);
        info(`Downloaded s3://${argv.bucket}/${argv.key} to ${file}.`);
    },
});

const removeObject = action({
    command: 'delete-object <bucket> <key>',
    describe: 'Delete an object',
    positionals: { ...bucketPositional, key: { type: 'string', describe: 'Object key' } },
    options: yesOption,
    handler: async (argv) => {
        if (!await confirm(argv, `Delete s3://${argv.bucket}/${argv.key}?`)) return;
        await deleteObject(s3Client(clientConfig(argv)), argv.bucket, argv.key);
        info(`Deleted s3://${argv.bucket}/${argv.key}.`);
    },
});

/**
 * clover aws s3 <create|list|get|update|delete|objects|upload|download|delete-object>
 */
const s3Command: CommandModule = {
    command: 's3',
    describe: 'Create, list, update and delete S3 buckets and objects',
    builder: (yargs: Argv) => serviceBuilder(yargs)
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

export default s3Command;
