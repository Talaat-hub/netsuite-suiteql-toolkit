// Tests for SuiteQL_Dashboard/suiteql_config.js
// Pure module — no NetSuite mocks needed.

let cfg;

beforeAll(() => {
    global.define = (deps, factory) => { cfg = factory(); };
    require('../src/FileCabinet/SuiteScripts/SuiteQL_Dashboard/suiteql_config');
});

describe('suiteql_config — TEMPLATES', () => {
    it('exposes a non-empty array of templates', () => {
        expect(Array.isArray(cfg.TEMPLATES)).toBe(true);
        expect(cfg.TEMPLATES.length).toBeGreaterThan(0);
    });

    it('every template has id, title, description, sql', () => {
        cfg.TEMPLATES.forEach(t => {
            expect(t).toEqual(expect.objectContaining({
                id: expect.any(String),
                title: expect.any(String),
                description: expect.any(String),
                sql: expect.any(String),
            }));
        });
    });

    it('template ids are unique', () => {
        const ids = cfg.TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every template SQL is a SELECT statement', () => {
        cfg.TEMPLATES.forEach(t => {
            const first = t.sql.trim().split(/\s+/)[0].toUpperCase();
            expect(['SELECT', 'WITH']).toContain(first);
        });
    });
});

describe('suiteql_config — LIMITS', () => {
    it('exposes positive numeric limits', () => {
        expect(cfg.LIMITS.MAX_SQL_LENGTH).toBeGreaterThan(0);
        expect(cfg.LIMITS.MAX_RESULT_ROWS).toBeGreaterThan(0);
        expect(cfg.LIMITS.DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
        expect(cfg.LIMITS.MAX_PAGE_SIZE).toBeGreaterThanOrEqual(cfg.LIMITS.DEFAULT_PAGE_SIZE);
    });

    it('allows SELECT and WITH as first keywords', () => {
        expect(cfg.LIMITS.ALLOWED_FIRST_KEYWORD).toContain('SELECT');
        expect(cfg.LIMITS.ALLOWED_FIRST_KEYWORD).toContain('WITH');
    });
});

describe('suiteql_config — validateSQL', () => {
    it('rejects non-string', () => {
        expect(cfg.validateSQL(null).ok).toBe(false);
        expect(cfg.validateSQL(123).ok).toBe(false);
    });

    it('rejects empty string', () => {
        expect(cfg.validateSQL('').ok).toBe(false);
        expect(cfg.validateSQL('   ').ok).toBe(false);
    });

    it('rejects SQL exceeding MAX_SQL_LENGTH', () => {
        const longSql = 'SELECT id FROM x WHERE name = \'' + 'a'.repeat(cfg.LIMITS.MAX_SQL_LENGTH) + '\'';
        const result = cfg.validateSQL(longSql);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/maximum length/i);
    });

    it('accepts a basic SELECT', () => {
        expect(cfg.validateSQL('SELECT id FROM customrecord_emp_mahmoud').ok).toBe(true);
    });

    it('accepts a WITH (CTE) statement', () => {
        const sql = 'WITH t AS (SELECT id FROM x) SELECT * FROM t';
        expect(cfg.validateSQL(sql).ok).toBe(true);
    });

    it('rejects when first keyword is not SELECT/WITH', () => {
        const r = cfg.validateSQL('UPDATE foo SET x = 1');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/SELECT/);
    });

    it.each([
        'SELECT id FROM x; INSERT INTO x VALUES (1)',
        'SELECT id FROM x WHERE name IN (SELECT name FROM x); UPDATE',
        'SELECT * FROM x; DELETE FROM x',
    ])('rejects multi-statement: %s', (sql) => {
        expect(cfg.validateSQL(sql).ok).toBe(false);
    });

    it.each([
        ['INSERT', 'SELECT id FROM (INSERT INTO x VALUES (1)) y'],
        ['UPDATE', 'SELECT * FROM (UPDATE x SET y=1) z'],
        ['DELETE', 'SELECT * FROM (DELETE FROM x) z'],
        ['DROP',   'SELECT * FROM x WHERE DROP'],
        ['ALTER',  'SELECT * FROM x WHERE ALTER'],
        ['CREATE', 'SELECT * FROM x WHERE CREATE'],
        ['TRUNCATE', 'SELECT * FROM x WHERE TRUNCATE'],
        ['MERGE',  'SELECT * FROM x WHERE MERGE'],
        ['GRANT',  'SELECT * FROM x WHERE GRANT'],
        ['REVOKE', 'SELECT * FROM x WHERE REVOKE'],
    ])('rejects banned keyword %s', (_kw, sql) => {
        const r = cfg.validateSQL(sql);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/disallowed/i);
    });

    it('is case-insensitive for keywords', () => {
        expect(cfg.validateSQL('select id from x').ok).toBe(true);
        expect(cfg.validateSQL('Select id From x').ok).toBe(true);
    });
});

describe('suiteql_config — isRoleAllowed', () => {
    it('returns true when ALLOWED_ROLES is empty (no restriction)', () => {
        // Default config has empty array
        expect(cfg.isRoleAllowed(3)).toBe(true);
        expect(cfg.isRoleAllowed(999)).toBe(true);
    });
});
