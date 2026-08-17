jest.mock('N/ui/serverWidget');
jest.mock('N/query');
jest.mock('N/runtime');
jest.mock('N/log');
jest.mock('N/url');

const serverWidget = require('N/ui/serverWidget');
const query = require('N/query');
const runtime = require('N/runtime');
const log = require('N/log');
const url = require('N/url');

let suitelet;
let cfg;

beforeAll(() => {
    global.define = (deps, factory) => { cfg = factory(); };
    require('../src/FileCabinet/SuiteScripts/SuiteQL_Dashboard/suiteql_config');

    global.define = (deps, factory) => {
        suitelet = factory(serverWidget, query, runtime, log, url, cfg);
    };
    require('../src/FileCabinet/SuiteScripts/SuiteQL_Dashboard/sl_mt_suiteql_dash');
});

beforeEach(() => {
    jest.clearAllMocks();
    runtime.getCurrentUser.mockReturnValue({ role: 3, name: 'Test User' });
    url.resolveScript.mockReturnValue('/app/site/hosting/scriptlet.nl?script=1&deploy=1');
});

const mockResultSet = (rows) => ({
    asMappedResults: () => rows,
    columns: rows[0] ? Object.keys(rows[0]).map(k => ({ alias: k })) : [],
});

const makeContext = (method, params, body) => {
    const writeMock = jest.fn();
    const addHeaderMock = jest.fn();
    return {
        request: { method, parameters: params || {}, body: body || '' },
        response: {
            write: writeMock,
            writePage: jest.fn(),
            addHeader: addHeaderMock,
            _write: writeMock,
            _addHeader: addHeaderMock,
        },
    };
};

describe('Suitelet — render dashboard (default GET)', () => {
    it('renders the dashboard form with inline HTML', () => {
        const fakeField = { defaultValue: '' };
        const fakeForm = { addField: jest.fn().mockReturnValue(fakeField) };
        serverWidget.createForm.mockReturnValue(fakeForm);

        const ctx = makeContext('GET', {});
        suitelet.onRequest(ctx);

        expect(serverWidget.createForm).toHaveBeenCalledWith({ title: 'SuiteQL Dashboard' });
        expect(fakeForm.addField).toHaveBeenCalledWith(expect.objectContaining({
            id: 'custpage_html',
            type: serverWidget.FieldType.INLINEHTML,
        }));
        expect(fakeField.defaultValue).toContain('SuiteQL Dashboard');
        expect(ctx.response.writePage).toHaveBeenCalledWith(fakeForm);
    });
});

describe('Suitelet — JSON endpoints', () => {
    it('GET ?action=templates returns JSON list', () => {
        const ctx = makeContext('GET', { action: 'templates' });
        suitelet.onRequest(ctx);

        expect(ctx.response.addHeader).toHaveBeenCalledWith({
            name: 'Content-Type',
            value: 'application/json; charset=utf-8',
        });
        const written = ctx.response.write.mock.calls[0][0];
        const payload = JSON.parse(written);
        expect(payload.ok).toBe(true);
        expect(payload.templates.length).toBeGreaterThan(0);
    });

    it('POST ?action=execute runs SQL and returns JSON', () => {
        query.runSuiteQL.mockReturnValue(mockResultSet([{ id: 1, name: 'X' }]));

        const ctx = makeContext('POST', { action: 'execute' }, JSON.stringify({
            sql: 'SELECT id, name FROM customrecord_emp_mahmoud',
            page: 1,
            pageSize: 10,
        }));
        suitelet.onRequest(ctx);

        const payload = JSON.parse(ctx.response.write.mock.calls[0][0]);
        expect(payload.ok).toBe(true);
        expect(payload.rows).toEqual([{ id: 1, name: 'X' }]);
        expect(payload.totalRows).toBe(1);
    });

    it('POST ?action=execute rejects invalid SQL', () => {
        const ctx = makeContext('POST', { action: 'execute' }, JSON.stringify({ sql: '' }));
        suitelet.onRequest(ctx);

        const payload = JSON.parse(ctx.response.write.mock.calls[0][0]);
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/empty/i);
    });

    it('POST ?action=execute catches SuiteQL errors', () => {
        query.runSuiteQL.mockImplementation(() => { throw new Error('Bad column'); });

        const ctx = makeContext('POST', { action: 'execute' }, JSON.stringify({
            sql: 'SELECT bogus FROM x',
        }));
        suitelet.onRequest(ctx);

        const payload = JSON.parse(ctx.response.write.mock.calls[0][0]);
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/bad column/i);
        expect(log.error).toHaveBeenCalled();
    });
});

describe('Suitelet — CSV download', () => {
    it('POST ?action=download returns CSV with proper headers', () => {
        query.runSuiteQL.mockReturnValue(mockResultSet([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
        ]));

        const ctx = makeContext('POST', { action: 'download' }, JSON.stringify({
            sql: 'SELECT id, name FROM x',
        }));
        suitelet.onRequest(ctx);

        expect(ctx.response.addHeader).toHaveBeenCalledWith({
            name: 'Content-Type',
            value: 'text/csv; charset=utf-8',
        });
        expect(ctx.response.addHeader).toHaveBeenCalledWith({
            name: 'Content-Disposition',
            value: 'attachment; filename="suiteql_export.csv"',
        });
        const csv = ctx.response.write.mock.calls[0][0];
        expect(csv).toBe('id,name\n1,Alice\n2,Bob');
    });

    it('escapes commas, quotes, and newlines in CSV', () => {
        query.runSuiteQL.mockReturnValue(mockResultSet([
            { id: 1, note: 'has, comma' },
            { id: 2, note: 'has "quote"' },
            { id: 3, note: 'has\nnewline' },
        ]));

        const ctx = makeContext('POST', { action: 'download' }, JSON.stringify({
            sql: 'SELECT id, note FROM x',
        }));
        suitelet.onRequest(ctx);

        const csv = ctx.response.write.mock.calls[0][0];
        expect(csv).toContain('"has, comma"');
        expect(csv).toContain('"has ""quote"""');
        expect(csv).toContain('"has\nnewline"');
    });

    it('returns JSON error if download SQL is invalid', () => {
        const ctx = makeContext('POST', { action: 'download' }, JSON.stringify({ sql: 'DELETE FROM x' }));
        suitelet.onRequest(ctx);

        const payload = JSON.parse(ctx.response.write.mock.calls[0][0]);
        expect(payload.ok).toBe(false);
    });
});

describe('Suitelet — access control', () => {
    it('rejects user when role not in ALLOWED_ROLES', () => {
        cfg.ALLOWED_ROLES.push(9999);
        runtime.getCurrentUser.mockReturnValue({ role: 3 });

        const ctx = makeContext('GET', { action: 'templates' });
        suitelet.onRequest(ctx);

        const payload = JSON.parse(ctx.response.write.mock.calls[0][0]);
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/not authorized/i);

        cfg.ALLOWED_ROLES.length = 0;
    });
});
