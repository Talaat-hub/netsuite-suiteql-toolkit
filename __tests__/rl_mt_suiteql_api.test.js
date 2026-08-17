jest.mock('N/query');
jest.mock('N/runtime');
jest.mock('N/log');
jest.mock('N/error');

const query = require('N/query');
const runtime = require('N/runtime');
const log = require('N/log');
const error = require('N/error');

let restlet;
let cfg;

beforeAll(() => {
    // Load the real config first via define intercept
    global.define = (deps, factory) => { cfg = factory(); };
    require('../src/FileCabinet/SuiteScripts/SuiteQL_Dashboard/suiteql_config');

    // Now intercept again for the Restlet load, passing cfg as the last dep
    global.define = (deps, factory) => {
        restlet = factory(query, runtime, log, error, cfg);
    };
    require('../src/FileCabinet/SuiteScripts/SuiteQL_Dashboard/rl_mt_suiteql_api');
});

beforeEach(() => {
    jest.clearAllMocks();

    // Default runtime user — empty role allow-list means anyone passes
    runtime.getCurrentUser.mockReturnValue({ role: 3, name: 'Test User' });

    // Default error.create mock
    error.create.mockImplementation((opts) => {
        const e = new Error(opts.message);
        e.name = opts.name;
        return e;
    });
});

const mockResultSet = (rows) => ({
    asMappedResults: () => rows,
    columns: rows[0] ? Object.keys(rows[0]).map(k => ({ alias: k })) : [],
});

// ─── GET endpoint ───

describe('Restlet — GET', () => {
    it('returns templates and limits with action=templates', () => {
        const result = restlet.get({ action: 'templates' });

        expect(result.ok).toBe(true);
        expect(Array.isArray(result.templates)).toBe(true);
        expect(result.templates.length).toBeGreaterThan(0);
        expect(result.limits).toEqual(expect.objectContaining({
            MAX_SQL_LENGTH: expect.any(Number),
        }));
    });

    it('executes a template by id', () => {
        const rows = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
        query.runSuiteQL.mockReturnValue(mockResultSet(rows));

        const tplId = cfg.TEMPLATES[0].id;
        const result = restlet.get({ action: 'execute', template: tplId });

        expect(result.ok).toBe(true);
        expect(query.runSuiteQL).toHaveBeenCalledWith({ query: cfg.TEMPLATES[0].sql });
        expect(result.rows).toEqual(rows);
        expect(result.totalRows).toBe(2);
    });

    it('returns error when template id is unknown', () => {
        const result = restlet.get({ action: 'execute', template: 'does_not_exist' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/template not found/i);
    });

    it('returns error for unknown action', () => {
        const result = restlet.get({ action: 'foobar' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/unknown action/i);
    });
});

// ─── POST endpoint ───

describe('Restlet — POST execute', () => {
    it('runs validated SQL and returns paged results', () => {
        const rows = [];
        for (let i = 1; i <= 25; i++) rows.push({ id: i, name: 'r' + i });
        query.runSuiteQL.mockReturnValue(mockResultSet(rows));

        const result = restlet.post({
            action: 'execute',
            sql: 'SELECT id, name FROM customrecord_emp_mahmoud',
            page: 2,
            pageSize: 10,
        });

        expect(result.ok).toBe(true);
        expect(result.rows.length).toBe(10);
        expect(result.rows[0].id).toBe(11); // page 2 of size 10 starts at index 10
        expect(result.totalRows).toBe(25);
        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(10);
    });

    it('rejects invalid SQL (empty)', () => {
        const result = restlet.post({ action: 'execute', sql: '' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });

    it('rejects banned keywords', () => {
        const result = restlet.post({
            action: 'execute',
            sql: 'DELETE FROM customrecord_emp_mahmoud',
        });

        expect(result.ok).toBe(false);
    });

    it('catches SuiteQL execution errors and returns ok:false', () => {
        query.runSuiteQL.mockImplementation(() => {
            throw new Error('ORA-00942: table or view does not exist');
        });

        const result = restlet.post({
            action: 'execute',
            sql: 'SELECT id FROM bogus_table',
        });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/ORA-00942/);
        expect(log.error).toHaveBeenCalled();
    });

    it('clamps pageSize to MAX_PAGE_SIZE', () => {
        query.runSuiteQL.mockReturnValue(mockResultSet([{ id: 1 }]));

        const result = restlet.post({
            action: 'execute',
            sql: 'SELECT id FROM x',
            page: 1,
            pageSize: 99999,
        });

        expect(result.pageSize).toBeLessThanOrEqual(cfg.LIMITS.MAX_PAGE_SIZE);
    });

    it('rejects non-execute action via POST', () => {
        const result = restlet.post({ action: 'something_else', sql: 'SELECT 1' });
        expect(result.ok).toBe(false);
    });
});

// ─── Role gating ───

describe('Restlet — role gating', () => {
    it('blocks when role is not in ALLOWED_ROLES (when populated)', () => {
        // Force a non-empty allow-list dynamically
        const original = cfg.ALLOWED_ROLES.slice();
        cfg.ALLOWED_ROLES.push(9999);

        runtime.getCurrentUser.mockReturnValue({ role: 3 });

        const result = restlet.get({ action: 'templates' });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not authorized/i);

        // Restore
        cfg.ALLOWED_ROLES.length = 0;
        original.forEach(r => cfg.ALLOWED_ROLES.push(r));
    });
});
