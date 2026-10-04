import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, deleteProject, getProject, loadProjects, projectsFile, useProject } from '../src/projects';

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'clover-')), 'clover', 'projects.json');

describe('projectsFile', () => {
    it('uses XDG_CONFIG_HOME, then ~/.config', () => {
        expect(projectsFile({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/clover/projects.json');
        expect(projectsFile({})).toMatch(/\.config\/clover\/projects\.json$/);
    });
});

describe('project store', () => {
    it('starts empty when the file does not exist', () => {
        expect(loadProjects(tempFile())).toEqual({ projects: [] });
    });

    it('saves created projects to disk', () => {
        const file = tempFile();

        createProject('shop', file);

        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projects: [{ name: 'shop', created: expect.any(String) }] });
        expect(getProject('shop', file).name).toBe('shop');
    });

    it('rejects invalid and duplicate names', () => {
        const file = tempFile();
        createProject('shop', file);

        expect(() => createProject('Shop App', file)).toThrow('Invalid project name');
        expect(() => createProject('shop', file)).toThrow('already exists');
    });

    it('switches the current project and clears it when that project is deleted', () => {
        const file = tempFile();
        createProject('shop', file);
        createProject('blog', file);

        useProject('shop', file);
        expect(loadProjects(file).current).toBe('shop');

        deleteProject('shop', file);
        expect(loadProjects(file)).toEqual({ projects: [expect.objectContaining({ name: 'blog' })] });
    });

    it('refuses to use or delete an unknown project', () => {
        const file = tempFile();

        expect(() => useProject('nope', file)).toThrow('Unknown project "nope"');
        expect(() => deleteProject('nope', file)).toThrow('Unknown project "nope"');
    });

    it('clears the current project', () => {
        const file = tempFile();
        createProject('shop', file);
        useProject('shop', file);

        useProject(undefined, file);

        expect(loadProjects(file).current).toBeUndefined();
    });
});
