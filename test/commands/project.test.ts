import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, loadProjects, useProject } from '../../src/projects';
import { errored, logged, runCli } from '../helpers';

beforeEach(() => {
    vi.stubEnv('XDG_CONFIG_HOME', mkdtempSync(path.join(tmpdir(), 'clover-')));
});

describe('clover project', () => {
    it('creates a project', async () => {
        await runCli('project create shop --output json');

        expect(JSON.parse(logged())).toMatchObject({ name: 'shop' });
        expect(loadProjects().projects.map((p) => p.name)).toEqual(['shop']);
    });

    it('lists projects and marks the current one', async () => {
        createProject('shop');
        createProject('blog');
        useProject('blog');

        await runCli('project list --output json');

        expect(JSON.parse(logged())).toEqual([
            expect.objectContaining({ name: 'shop', current: false }),
            expect.objectContaining({ name: 'blog', current: true }),
        ]);
    });

    it('sets and clears the current project', async () => {
        createProject('shop');

        await runCli('project use shop');
        expect(loadProjects().current).toBe('shop');

        await runCli('project use --none');
        expect(loadProjects().current).toBeUndefined();
    });

    it('needs a name or --none to switch projects', async () => {
        await runCli('project use');

        expect(errored()).toContain('--none');
        expect(process.exitCode).toBe(1);
    });

    it('deletes a project with --yes', async () => {
        createProject('shop');

        await runCli('project delete shop --yes');

        expect(loadProjects().projects).toEqual([]);
    });

    it('reports unknown projects', async () => {
        await runCli('project get nope');

        expect(errored()).toContain('Unknown project "nope"');
        expect(process.exitCode).toBe(1);
    });
});
