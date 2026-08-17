/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * SuiteQL Dashboard — UI Suitelet.
 *
 * Renders a self-contained, responsive single-page dashboard inline.
 * Endpoints are all this same Suitelet, dispatched by the `action` parameter:
 *
 *   GET  (no action)               → render dashboard HTML
 *   GET  ?action=templates         → JSON list of templates + limits
 *   POST ?action=execute           → run SQL { sql, page, pageSize } → JSON
 *   POST ?action=download          → run SQL { sql } → CSV file response
 *
 * Why same-Suitelet AJAX (not Restlet from browser):
 *   - Avoids CORS and TBA-from-browser complications
 *   - Reuses the user's authenticated NetSuite session
 *   - The Restlet remains available for *external* API callers
 *
 * SETUP:
 *   1. Deploy via SDF: `suitecloud project:deploy`
 *   2. Open: /app/site/hosting/scriptlet.nl?script=customscript_sl_mt_sql_dash&deploy=customdeploy_sl_mt_sql_dash
 *   3. (Optional) Add to NetSuite tab navigation:
 *        Customization → Centers and Tabs → Center Tabs → New
 *        Add a new tab pointing to the Suitelet URL above.
 *   4. Restrict access via ALLOWED_ROLES in suiteql_config.js, OR via the
 *      script deployment's audience settings in NetSuite UI.
 */
define([
    'N/ui/serverWidget',
    'N/query',
    'N/runtime',
    'N/log',
    'N/url',
    './suiteql_config'
],
(serverWidget, query, runtime, log, url, cfg) => {

    const SCRIPT_ID = 'customscript_sl_mt_sql_dash';
    const DEPLOY_ID = 'customdeploy_sl_mt_sql_dash';

    // ─── Server-side helpers ───

    const checkAccess = () => {
        const user = runtime.getCurrentUser();
        if (!cfg.isRoleAllowed(user.role)) {
            throw new Error('Your role is not authorized to use the SuiteQL Dashboard.');
        }
    };

    const runSql = (sql, page, pageSize, opts) => {
        const validation = cfg.validateSQL(sql);
        if (!validation.ok) return { ok: false, error: validation.error };

        // For CSV download we allow up to MAX_RESULT_ROWS in one shot;
        // for screen pagination we clamp to MAX_PAGE_SIZE.
        const upperBound = (opts && opts.allowFullCap)
            ? cfg.LIMITS.MAX_RESULT_ROWS
            : cfg.LIMITS.MAX_PAGE_SIZE;
        const safePageSize = Math.min(
            Math.max(parseInt(pageSize, 10) || cfg.LIMITS.DEFAULT_PAGE_SIZE, 1),
            upperBound
        );
        const safePage = Math.max(parseInt(page, 10) || 1, 1);
        const offset = (safePage - 1) * safePageSize;

        try {
            const rs = query.runSuiteQL({ query: sql });
            const all = rs.asMappedResults();
            const truncated = all.length > cfg.LIMITS.MAX_RESULT_ROWS;
            const capped = truncated ? all.slice(0, cfg.LIMITS.MAX_RESULT_ROWS) : all;
            const columns = capped.length > 0 ? Object.keys(capped[0]) : [];
            const slice = capped.slice(offset, offset + safePageSize);

            return {
                ok: true,
                columns,
                rows: slice,
                page: safePage,
                pageSize: safePageSize,
                totalRows: capped.length,
                truncated
            };
        } catch (errRunSql) {
            log.error('errRunSql', errRunSql);
            return {
                ok: false,
                error: errRunSql.message || String(errRunSql),
                code: errRunSql.name || 'SUITEQL_ERROR'
            };
        }
    };

    /** Convert array of mapped result rows + column names to CSV string. */
    const toCsv = (columns, rows) => {
        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const s = String(val);
            if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };
        const header = columns.join(',');
        const body = rows.map(r => columns.map(c => escape(r[c])).join(',')).join('\n');
        return header + '\n' + body;
    };

    // ─── Endpoint dispatch ───

    const onRequest = (context) => {
        try {
            checkAccess();
            const { request, response } = context;
            const action = (request.parameters.action || '').toLowerCase();

            if (request.method === 'GET' && action === 'templates') {
                return jsonResponse(response, {
                    ok: true,
                    templates: cfg.TEMPLATES,
                    limits: cfg.LIMITS
                });
            }

            if (request.method === 'POST' && action === 'execute') {
                const body = JSON.parse(request.body || '{}');
                const result = runSql(body.sql, body.page, body.pageSize);
                return jsonResponse(response, result);
            }

            if (request.method === 'POST' && action === 'download') {
                const body = JSON.parse(request.body || '{}');
                // For download we allow the full MAX_RESULT_ROWS cap in one page.
                const result = runSql(body.sql, 1, cfg.LIMITS.MAX_RESULT_ROWS, { allowFullCap: true });
                if (!result.ok) return jsonResponse(response, result);
                const csv = toCsv(result.columns, result.rows);
                response.addHeader({ name: 'Content-Type', value: 'text/csv; charset=utf-8' });
                response.addHeader({
                    name: 'Content-Disposition',
                    value: 'attachment; filename="suiteql_export.csv"'
                });
                response.write(csv);
                return;
            }

            // Default: render dashboard page
            renderDashboard(response);
        } catch (errOnRequest) {
            // log.error must never throw — wrap defensively.
            try { log.error({ title: 'errOnRequest', details: String(errOnRequest && errOnRequest.message || errOnRequest) }); } catch (ignored) { /* swallow */ }
            // For AJAX endpoints, still return JSON — but never let a secondary write blow up.
            const action = (context.request.parameters.action || '').toLowerCase();
            try {
                if (action) {
                    return jsonResponse(context.response, {
                        ok: false,
                        error: (errOnRequest && errOnRequest.message) || String(errOnRequest)
                    });
                }
                context.response.write('<h2>Error</h2><pre>'
                    + String((errOnRequest && errOnRequest.message) || errOnRequest)
                          .replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))
                    + '</pre>');
            } catch (ignored) { /* response already committed — nothing more we can do */ }
        }
    };

    const jsonResponse = (response, payload) => {
        try {
            response.addHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
        } catch (ignoredHeader) { /* header may already be set or response committed */ }
        response.write(JSON.stringify(payload));
    };

    // ─── HTML page renderer ───

    const renderDashboard = (response) => {
        const suiteletUrl = url.resolveScript({ scriptId: SCRIPT_ID, deploymentId: DEPLOY_ID });
        const form = serverWidget.createForm({ title: 'SuiteQL Dashboard' });
        const html = form.addField({
            id: 'custpage_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        html.defaultValue = buildHtml(suiteletUrl);
        response.writePage(form);
    };

    const buildHtml = (suiteletUrl) => `
<style>
/* Hide NetSuite chrome that pushes content down */
.uir-page-title-secondline, .uir-page-title { display: none !important; }
#main_form .uir-form-pagebanner { display: none !important; }

/* ── Dashboard styles (responsive) ── */
:root {
  --primary: #003a70;
  --accent: #0066cc;
  --success: #28a745;
  --danger:  #dc3545;
  --warning: #d4a017;
  --bg: #f5f7fa;
  --card: #ffffff;
  --border: #e1e4e8;
  --text: #24292e;
  --muted: #6a737d;
}
.sql-app * { box-sizing: border-box; }
.sql-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: var(--bg); color: var(--text); padding: 16px;
  min-height: 100vh; max-width: 1400px; margin: 0 auto;
}
.sql-app h1 { color: var(--primary); margin: 0 0 4px; font-size: 22px; }
.sql-app .subtitle { color: var(--muted); margin-bottom: 16px; font-size: 13px; }

.sql-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px; margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}

.sql-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 900px) {
  .sql-grid.split { grid-template-columns: 1fr 2fr; }
}

label.field { display: block; font-size: 12px; font-weight: 600;
              text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
select, textarea, input[type=number] {
  width: 100%; padding: 8px 10px; font-family: inherit; font-size: 14px;
  border: 1px solid var(--border); border-radius: 4px; background: #fff;
}
textarea {
  font-family: "Courier New", monospace; min-height: 160px; resize: vertical;
  white-space: pre; tab-size: 2;
}
.sql-counter { font-size: 11px; color: var(--muted); text-align: right; margin-top: 4px; }
.sql-counter.over { color: var(--danger); font-weight: 600; }

.sql-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
button.btn {
  padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;
  font-size: 14px; font-weight: 600; color: #fff;
}
button.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); }
.btn-success { background: var(--success); }
.btn-secondary { background: #6c757d; }
.btn-warning { background: var(--warning); }

/* Toasts */
.toast-container {
  position: fixed; top: 12px; right: 12px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px; max-width: 360px;
}
.toast {
  background: #fff; border-left: 4px solid var(--accent);
  border-radius: 4px; padding: 12px 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: slideIn 0.2s ease-out;
}
.toast.success { border-color: var(--success); }
.toast.error   { border-color: var(--danger); }
.toast.warning { border-color: var(--warning); }
.toast strong { display: block; margin-bottom: 2px; font-size: 13px; }
.toast .msg   { font-size: 13px; color: var(--muted); }
@keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* Loading spinner */
.spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid #ffffff80; border-top-color: #fff;
  border-radius: 50%; animation: spin 0.8s linear infinite;
  vertical-align: middle; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Results table — responsive (horizontal scroll on small screens) */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 4px; }
table.results { width: 100%; border-collapse: collapse; font-size: 13px; }
table.results th, table.results td {
  padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
table.results th { background: #f6f8fa; color: var(--muted);
                   font-weight: 600; text-transform: uppercase; font-size: 11px; }
table.results tr:hover td { background: #f9fbfd; }

.pager { display: flex; align-items: center; gap: 8px; margin-top: 12px;
         flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.pager button { padding: 4px 10px; }

.empty { text-align: center; padding: 32px; color: var(--muted); }
.error-box {
  background: #fdecea; color: #722; border: 1px solid #f5c6cb;
  padding: 12px; border-radius: 4px; font-family: "Courier New", monospace;
  font-size: 13px; white-space: pre-wrap; word-break: break-word;
}
.template-meta { font-size: 12px; color: var(--muted); margin-top: 4px; min-height: 16px; }

@media (max-width: 600px) {
  .sql-app { padding: 8px; }
  .sql-card { padding: 12px; }
  .sql-toolbar button { flex: 1 1 auto; }
}
</style>

<div class="sql-app" id="sqlApp">
  <h1>SuiteQL Dashboard</h1>
  <div class="subtitle">Run pre-approved templates or write your own read-only SuiteQL.</div>

  <div class="sql-card">
    <div class="sql-grid split">
      <div>
        <label class="field" for="tplSelect">Template</label>
        <select id="tplSelect">
          <option value="">— Custom Query —</option>
        </select>
        <div id="tplMeta" class="template-meta"></div>

        <div style="margin-top:12px;">
          <label class="field" for="pageSize">Page Size</label>
          <input type="number" id="pageSize" min="1" max="500" value="50" />
        </div>
      </div>
      <div>
        <label class="field" for="sqlInput">SuiteQL</label>
        <textarea id="sqlInput" spellcheck="false"
          placeholder="SELECT id, name FROM customrecord_emp_mahmoud"></textarea>
        <div id="sqlCounter" class="sql-counter">0 / 0 chars</div>
      </div>
    </div>
    <div class="sql-toolbar">
      <button type="button" class="btn btn-primary" id="runBtn">Run Query</button>
      <button type="button" class="btn btn-success" id="csvBtn" disabled>Download CSV</button>
      <button type="button" class="btn btn-secondary" id="clearBtn">Clear</button>
      <span id="statusText" style="color:var(--muted); font-size:13px; margin-left:auto;"></span>
    </div>
  </div>

  <div class="sql-card" id="resultsCard" style="display:none;">
    <div id="resultsContent"></div>
  </div>
</div>

<div class="toast-container" id="toastContainer"></div>

<script>
(function () {
  'use strict';

  // ─── Config injected from server ───
  var SUITELET_URL = ${JSON.stringify(suiteletUrl)};

  // ─── Component-style app with reactive state ───
  var App = {
    state: {
      templates: [],
      limits: { MAX_SQL_LENGTH: 4000, DEFAULT_PAGE_SIZE: 50, MAX_PAGE_SIZE: 500, MAX_RESULT_ROWS: 5000 },
      selectedTemplateId: '',
      sql: '',
      pageSize: 50,
      page: 1,
      results: null,   // { columns, rows, totalRows, page, pageSize, truncated }
      loading: false,
      error: null
    },

    el: {},

    init: function () {
      this.el.tplSelect    = document.getElementById('tplSelect');
      this.el.tplMeta      = document.getElementById('tplMeta');
      this.el.sqlInput     = document.getElementById('sqlInput');
      this.el.sqlCounter   = document.getElementById('sqlCounter');
      this.el.pageSize     = document.getElementById('pageSize');
      this.el.runBtn       = document.getElementById('runBtn');
      this.el.csvBtn       = document.getElementById('csvBtn');
      this.el.clearBtn     = document.getElementById('clearBtn');
      this.el.statusText   = document.getElementById('statusText');
      this.el.resultsCard  = document.getElementById('resultsCard');
      this.el.resultsContent = document.getElementById('resultsContent');
      this.el.toastContainer = document.getElementById('toastContainer');

      var self = this;
      this.el.tplSelect.addEventListener('change', function () { self.onTemplateChange(); });
      this.el.sqlInput.addEventListener('input', function () { self.onSqlInput(); });
      this.el.pageSize.addEventListener('change', function () {
        self.state.pageSize = parseInt(self.el.pageSize.value, 10) || 50;
      });
      this.el.runBtn.addEventListener('click', function () { self.run(1); });
      this.el.csvBtn.addEventListener('click', function () { self.downloadCsv(); });
      this.el.clearBtn.addEventListener('click', function () { self.clear(); });

      this.loadTemplates();
    },

    setStatus: function (text) { this.el.statusText.textContent = text || ''; },
    setLoading: function (flag) {
      this.state.loading = flag;
      this.el.runBtn.disabled = flag;
      this.el.runBtn.innerHTML = flag
        ? '<span class="spinner"></span>Running…'
        : 'Run Query';
    },

    toast: function (kind, title, msg) {
      var el = document.createElement('div');
      el.className = 'toast ' + (kind || 'info');
      el.innerHTML = '<strong>' + escapeHtml(title) + '</strong><div class="msg">' + escapeHtml(msg || '') + '</div>';
      this.el.toastContainer.appendChild(el);
      setTimeout(function () { el.remove(); }, 5000);
    },

    loadTemplates: function () {
      var self = this;
      fetch(SUITELET_URL + '&action=templates', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error);
          self.state.templates = data.templates;
          if (data.limits) self.state.limits = data.limits;
          self.renderTemplateOptions();
          self.updateCounter();
        })
        .catch(function (err) {
          self.toast('error', 'Failed to load templates', err.message || err);
        });
    },

    renderTemplateOptions: function () {
      var sel = this.el.tplSelect;
      this.state.templates.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.title;
        sel.appendChild(opt);
      });
    },

    onTemplateChange: function () {
      var id = this.el.tplSelect.value;
      this.state.selectedTemplateId = id;
      var tpl = this.state.templates.find(function (t) { return t.id === id; });
      if (tpl) {
        this.el.sqlInput.value = tpl.sql.replace(/^\\s+/gm, '  ').trim();
        this.state.sql = this.el.sqlInput.value;
        this.el.tplMeta.textContent = tpl.description || '';
      } else {
        this.el.tplMeta.textContent = '';
      }
      this.updateCounter();
    },

    onSqlInput: function () {
      this.state.sql = this.el.sqlInput.value;
      this.updateCounter();
    },

    updateCounter: function () {
      var len = this.el.sqlInput.value.length;
      var max = this.state.limits.MAX_SQL_LENGTH;
      this.el.sqlCounter.textContent = len + ' / ' + max + ' chars';
      this.el.sqlCounter.className = 'sql-counter' + (len > max ? ' over' : '');
    },

    /** Client-side mirror of server validation (subset). */
    clientValidate: function (sql) {
      if (!sql || !sql.trim()) return 'SQL is empty.';
      if (sql.length > this.state.limits.MAX_SQL_LENGTH)
        return 'SQL exceeds maximum length of ' + this.state.limits.MAX_SQL_LENGTH + ' characters.';
      var first = sql.trim().split(/\\s+/)[0].toUpperCase();
      if (first !== 'SELECT' && first !== 'WITH')
        return 'Only SELECT/WITH statements are allowed.';
      var banned = /\\b(INSERT|UPDATE|DELETE|MERGE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\\b/i;
      if (banned.test(sql)) return 'Query contains a disallowed keyword.';
      return null;
    },

    run: function (page) {
      var self = this;
      var err = this.clientValidate(this.state.sql);
      if (err) { this.toast('error', 'Validation', err); return; }

      this.setLoading(true);
      this.setStatus('Executing…');
      this.el.csvBtn.disabled = true;

      fetch(SUITELET_URL + '&action=execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          sql: self.state.sql,
          page: page || 1,
          pageSize: self.state.pageSize
        })
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        self.setLoading(false);
        if (!data.ok) {
          self.state.results = null;
          self.state.error = data.error;
          self.renderResults();
          self.toast('error', 'Query failed', data.error || 'Unknown error');
          self.setStatus('Failed');
          return;
        }
        self.state.results = data;
        self.state.error = null;
        self.state.page = data.page;
        self.renderResults();
        self.el.csvBtn.disabled = data.totalRows === 0;
        self.setStatus(
          data.totalRows + ' total row(s)' +
          (data.truncated ? ' (truncated to ' + self.state.limits.MAX_RESULT_ROWS + ')' : '')
        );
        if (data.truncated) self.toast('warning', 'Truncated',
          'Result exceeded ' + self.state.limits.MAX_RESULT_ROWS + ' rows; showing capped data.');
      })
      .catch(function (err) {
        self.setLoading(false);
        self.toast('error', 'Network error', err.message || err);
        self.setStatus('Network error');
      });
    },

    renderResults: function () {
      var s = this.state;
      this.el.resultsCard.style.display = '';
      var html;

      if (s.error) {
        html = '<div class="error-box">' + escapeHtml(s.error) + '</div>';
      } else if (!s.results || s.results.totalRows === 0) {
        html = '<div class="empty">No rows returned.</div>';
      } else {
        var cols = s.results.columns;
        var rows = s.results.rows;
        var thead = '<thead><tr>' + cols.map(function (c) {
          return '<th>' + escapeHtml(c) + '</th>';
        }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + rows.map(function (r) {
          return '<tr>' + cols.map(function (c) {
            return '<td>' + escapeHtml(r[c] == null ? '' : String(r[c])) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>';
        var totalPages = Math.max(1, Math.ceil(s.results.totalRows / s.results.pageSize));
        var pager =
          '<div class="pager">' +
          '<button type="button" class="btn btn-secondary" id="prevBtn"' + (s.results.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
          '<span>Page ' + s.results.page + ' / ' + totalPages + '</span>' +
          '<button type="button" class="btn btn-secondary" id="nextBtn"' + (s.results.page >= totalPages ? ' disabled' : '') + '>Next</button>' +
          '<span style="margin-left:auto;">' + s.results.totalRows + ' total rows</span>' +
          '</div>';
        html = '<div class="table-wrap"><table class="results">' + thead + tbody + '</table></div>' + pager;
      }

      this.el.resultsContent.innerHTML = html;

      var prev = document.getElementById('prevBtn');
      var next = document.getElementById('nextBtn');
      var self = this;
      if (prev) prev.addEventListener('click', function () { self.run(s.results.page - 1); });
      if (next) next.addEventListener('click', function () { self.run(s.results.page + 1); });
    },

    downloadCsv: function () {
      // POST to /download endpoint via a hidden form so the browser handles the file save
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = SUITELET_URL + '&action=download';
      form.style.display = 'none';

      // We need to send JSON, but a form posts urlencoded. So submit via fetch and trigger blob download.
      var self = this;
      this.el.csvBtn.disabled = true;
      this.setStatus('Generating CSV…');

      fetch(SUITELET_URL + '&action=download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sql: this.state.sql })
      })
      .then(function (r) {
        var ct = r.headers.get('Content-Type') || '';
        if (ct.indexOf('application/json') !== -1) {
          return r.json().then(function (j) { throw new Error(j.error || 'Download failed'); });
        }
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'suiteql_export.csv';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        self.toast('success', 'Download ready', 'CSV file downloaded.');
        self.setStatus('Downloaded');
      })
      .catch(function (err) {
        self.toast('error', 'Download failed', err.message || err);
        self.setStatus('Failed');
      })
      .finally(function () { self.el.csvBtn.disabled = false; });
    },

    clear: function () {
      this.el.tplSelect.value = '';
      this.el.sqlInput.value = '';
      this.el.tplMeta.textContent = '';
      this.state.sql = '';
      this.state.results = null;
      this.state.error = null;
      this.el.resultsCard.style.display = 'none';
      this.el.csvBtn.disabled = true;
      this.setStatus('');
      this.updateCounter();
    }
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.init(); });
  } else {
    App.init();
  }
})();
</script>
`;

    return { onRequest };
});
