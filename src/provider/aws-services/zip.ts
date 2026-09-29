import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Minimal zip writer, enough to package Lambda code from a file or a folder
 * without needing the `zip` tool. Files are deflated; timestamps are fixed so
 * the same input always gives the same zip (and the same Lambda CodeSha256).
 */

interface Entry {
    name: string;
    data: Buffer;
}

/** Every file under `source` (or `source` itself if it's a file), with forward-slash names. */
function collect(source: string): Entry[] {
    if (statSync(source).isFile()) {
        return [{ name: path.basename(source), data: readFileSync(source) }];
    }
    const entries: Entry[] = [];
    const walk = (dir: string) => {
        const items = readdirSync(dir, { withFileTypes: true });
        items.sort((a, b) => a.name.localeCompare(b.name));
        for (const item of items) {
            const full = path.join(dir, item.name);
            if (item.isDirectory()) walk(full);
            else if (item.isFile()) entries.push({ name: path.relative(source, full).split(path.sep).join('/'), data: readFileSync(full) });
        }
    };
    walk(source);
    return entries;
}

const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;
/** Unix "made by" plus rw-r--r-- regular file, so Lambda can read the files. */
const MADE_BY_UNIX = (3 << 8) | VERSION;
const FILE_MODE = (0o100644 << 16) >>> 0;

export function zipPath(source: string): Buffer {
    const entries = collect(source);
    if (entries.length === 0) throw new Error(`Nothing to zip in ${source}.`);

    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBytes = Buffer.from(name, 'utf8');
        const compressed = deflateRawSync(data);
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(DEFLATE, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBytes, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(MADE_BY_UNIX, 4);
        central.writeUInt16LE(VERSION, 6);
        central.writeUInt16LE(UTF8_NAMES, 8);
        central.writeUInt16LE(DEFLATE, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        // extra length, comment length, disk number, internal attributes: all 0
        central.writeUInt32LE(FILE_MODE, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBytes);

        offset += local.length + nameBytes.length + compressed.length;
    }

    const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, ...centrals, end]);
}

/** A .zip file is used as-is; anything else (a file or folder) is zipped. */
export function loadCode(source: string): Buffer {
    return source.endsWith('.zip') && statSync(source).isFile() ? readFileSync(source) : zipPath(source);
}
