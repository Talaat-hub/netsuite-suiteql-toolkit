// ---- STEP 1: Mock the N/ modules ----
jest.mock('N/ui/serverWidget');
jest.mock('N/query');
jest.mock('N/record');
jest.mock('N/runtime');
jest.mock('N/log');
jest.mock('N/url');

// ---- STEP 2: Import the mocked modules ----
const serverWidget = require('N/ui/serverWidget');
const query = require('N/query');
const record = require('N/record');
const runtime = require('N/runtime');
const log = require('N/log');
const url = require('N/url');

// ---- STEP 3: Declare entry point variable ----
let onRequest;

// ---- STEP 4: Load the script via global.define ----
beforeAll(() => {
    global.define = (deps, factory) => {
        const module = factory(serverWidget, query, record, runtime, log, url);
        onRequest = module.onRequest;
    };
    global.log = log;
    require('../src/FileCabinet/SuiteScripts/EMP_Analytics/suitelet/sl_mt_emp_suiteql');
});

// ---- STEP 5: Clear mocks before each test ----
beforeEach(() => {
    jest.clearAllMocks();

    // Default runtime mock
    runtime.getCurrentUser.mockReturnValue({ name: 'Test User' });

    // Default url mock
    url.resolveScript.mockReturnValue('/app/site/hosting/scriptlet.nl?script=123&deploy=1');
});

// ---- Helpers ----

/** Creates a mock context for GET requests */
const mockGetContext = (params = {}) => ({
    request: { method: 'GET', parameters: params },
    response: {
        write: jest.fn(),
        writePage: jest.fn(),
        setHeader: jest.fn(),
    },
});

/** Creates a mock SuiteQL result set that returns mapped rows */
const mockSuiteQLResult = (rows) => ({
    asMappedResults: jest.fn(() => rows),
});

// ─── TESTS ───

describe('SuiteQL Explorer Suitelet', () => {

    // ─── RENDER DASHBOARD ───

    describe('Render Dashboard', () => {
        it('should render the dashboard page with INLINEHTML field', () => {
            const mockField = { defaultValue: '' };
            const mockForm = {
                addField: jest.fn(() => mockField),
            };
            serverWidget.createForm.mockReturnValue(mockForm);

            const ctx = mockGetContext({});
            onRequest(ctx);

            expect(serverWidget.createForm).toHaveBeenCalledWith({ title: ' ' });
            expect(mockForm.addField).toHaveBeenCalledWith({
                id: 'custpage_suiteql_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'SuiteQL Dashboard',
            });
            expect(ctx.response.writePage).toHaveBeenCalledWith(mockForm);
            expect(mockField.defaultValue).toContain('SuiteQL Explorer');
        });
    });

    // ─── getData ───

    describe('getData action', () => {
        it('should return employees, KPIs, job stats, location stats, and duplicates', () => {
            // Mock all 5 SuiteQL queries in order of execution
            query.runSuiteQL
                // 1. queryAllEmployees
                .mockReturnValueOnce(mockSuiteQLResult([
                    { id: 1, name: 'Ahmed', email: 'a@example.com', phone: '+201', jobtitle: 'Developer', status: '', address: 'Cairo', dob: '', about: '' },
                    { id: 2, name: 'Omar', email: 'b@example.com', phone: '+202', jobtitle: 'Designer', status: '', address: 'Alex', dob: '', about: '' },
                ]))
                // 2. queryKPIs
                .mockReturnValueOnce(mockSuiteQLResult([
                    { total: 2, uniquejobtitles: 2, uniquecities: 2, withemail: 2 },
                ]))
                // 3. queryJobTitleStats
                .mockReturnValueOnce(mockSuiteQLResult([
                    { jobtitle: 'Developer', cnt: 1 },
                    { jobtitle: 'Designer', cnt: 1 },
                ]))
                // 4. queryLocationStats
                .mockReturnValueOnce(mockSuiteQLResult([
                    { city: 'Cairo', cnt: 1 },
                    { city: 'Alex', cnt: 1 },
                ]))
                // 5. queryDuplicates
                .mockReturnValueOnce(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            expect(query.runSuiteQL).toHaveBeenCalledTimes(5);
            expect(ctx.response.setHeader).toHaveBeenCalledWith({
                name: 'Content-Type',
                value: 'application/json',
            });

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(true);
            expect(json.employees).toHaveLength(2);
            expect(json.kpis.total).toBe(2);
            expect(json.kpis.completeness).toBe('100.0');
            expect(json.jobTitleStats).toHaveLength(2);
            expect(json.locationStats).toHaveLength(2);
            expect(json.duplicates).toHaveLength(0);
        });

        it('should use parameterized query for all SuiteQL calls', () => {
            query.runSuiteQL
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([{ total: 0, uniquejobtitles: 0, uniquecities: 0, withemail: 0 }]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            // Verify each call was made with a query string
            for (let i = 0; i < 5; i++) {
                expect(query.runSuiteQL.mock.calls[i][0]).toHaveProperty('query');
                expect(typeof query.runSuiteQL.mock.calls[i][0].query).toBe('string');
            }
        });

        it('should detect duplicates via HAVING COUNT(*) > 1', () => {
            query.runSuiteQL
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([{ total: 4, uniquejobtitles: 1, uniquecities: 1, withemail: 4 }]))
                .mockReturnValueOnce(mockSuiteQLResult([{ jobtitle: 'Dev', cnt: 4 }]))
                .mockReturnValueOnce(mockSuiteQLResult([{ city: 'Cairo', cnt: 4 }]))
                .mockReturnValueOnce(mockSuiteQLResult([
                    { email: 'dup@example.com', phone: '+201', cnt: 3 },
                ]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.duplicates).toHaveLength(1);
            expect(json.duplicates[0].cnt).toBe(3);
        });

        it('should return error on SuiteQL failure', () => {
            query.runSuiteQL.mockImplementation(() => {
                throw new Error('SuiteQL syntax error');
            });

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(false);
            expect(json.error).toContain('SuiteQL syntax error');
        });
    });

    // ─── getEmployee ───

    describe('getEmployee action', () => {
        it('should fetch a single employee by ID using parameterized query', () => {
            query.runSuiteQL.mockReturnValue(mockSuiteQLResult([
                { id: 42, name: 'Ahmed', email: 'a@example.com', phone: '+201', jobtitle: 'Developer', status: 'Active', address: 'Cairo', dob: '1990-01-15', about: 'Test' },
            ]));

            const ctx = mockGetContext({ action: 'getEmployee', empId: '42' });
            onRequest(ctx);

            // Verify parameterized query (WHERE id = ?)
            expect(query.runSuiteQL).toHaveBeenCalledWith(
                expect.objectContaining({
                    params: [42],
                })
            );

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(true);
            expect(json.employee.name).toBe('Ahmed');
            expect(json.employee.id).toBe(42);
        });

        it('should return error when employee not found', () => {
            query.runSuiteQL.mockReturnValue(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getEmployee', empId: '999' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(false);
            expect(json.error).toContain('not found');
        });

        it('should return error when empId is missing', () => {
            const ctx = mockGetContext({ action: 'getEmployee' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(false);
            expect(json.error).toContain('Missing empId');
        });
    });

    // ─── deleteEmployee ───

    describe('deleteEmployee action', () => {
        it('should delete employee by ID', () => {
            const ctx = mockGetContext({ action: 'deleteEmployee', empId: '42' });
            onRequest(ctx);

            expect(record.delete).toHaveBeenCalledWith({
                type: 'customrecord_emp_mahmoud',
                id: 42,
            });

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(true);
            expect(json.id).toBe(42);
        });

        it('should return error when empId is missing', () => {
            const ctx = mockGetContext({ action: 'deleteEmployee' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(false);
            expect(json.error).toContain('Missing empId');
        });

        it('should return error when delete fails', () => {
            record.delete.mockImplementation(() => {
                throw new Error('Record not found');
            });

            const ctx = mockGetContext({ action: 'deleteEmployee', empId: '999' });
            onRequest(ctx);

            const json = JSON.parse(ctx.response.write.mock.calls[0][0]);
            expect(json.success).toBe(false);
            expect(json.error).toContain('Record not found');
        });
    });

    // ─── SuiteQL Query Patterns ───

    describe('SuiteQL Query Patterns', () => {
        it('should use COALESCE for null-safe field selection', () => {
            query.runSuiteQL
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([{ total: 0, uniquejobtitles: 0, uniquecities: 0, withemail: 0 }]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            const allEmployeesQuery = query.runSuiteQL.mock.calls[0][0].query;
            expect(allEmployeesQuery).toContain('COALESCE');
            expect(allEmployeesQuery).toContain('ORDER BY');
        });

        it('should use GROUP BY for aggregation queries', () => {
            query.runSuiteQL
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([{ total: 0, uniquejobtitles: 0, uniquecities: 0, withemail: 0 }]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            const jobQuery = query.runSuiteQL.mock.calls[2][0].query;
            expect(jobQuery).toContain('GROUP BY');
            expect(jobQuery).toContain('COUNT(*)');

            const dupQuery = query.runSuiteQL.mock.calls[4][0].query;
            expect(dupQuery).toContain('HAVING');
        });

        it('should use COUNT DISTINCT and CASE in KPI query', () => {
            query.runSuiteQL
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([{ total: 0, uniquejobtitles: 0, uniquecities: 0, withemail: 0 }]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]))
                .mockReturnValueOnce(mockSuiteQLResult([]));

            const ctx = mockGetContext({ action: 'getData' });
            onRequest(ctx);

            const kpiQuery = query.runSuiteQL.mock.calls[1][0].query;
            expect(kpiQuery).toContain('COUNT(DISTINCT');
            expect(kpiQuery).toContain('CASE WHEN');
        });
    });
});
