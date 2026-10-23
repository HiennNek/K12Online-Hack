// ==UserScript==
// @name         K12Online Examination Hack (cho bài kiểm tra)
// @namespace    https://github.com/HiennNek/K12Online-Hack
// @version      1.0.0
// @description  Tìm đáp án bài kiểm tra K12Online
// @author       dev
// @match        *://*.k12online.vn/*
// @updateURL    https://raw.githubusercontent.com/HiennNek/K12Online-Hack/refs/heads/main/main.js
// @downloadURL  https://raw.githubusercontent.com/HiennNek/K12Online-Hack/refs/heads/main/main.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Extract payload
    const MARKER = /['"]LMS\.Learning\.Courseware\.Exam['"]\s*,/;

    // Ignore brackets inside strings
    function sliceBalanced(text, start, open, close) {
        let depth = 0;
        let quote = null;
        let escaped = false;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];

            if (quote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === quote) quote = null;
                continue;
            }

            if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
                continue;
            }

            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return null;
    }

    function parseJsonLoose(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            const cleaned = text.replace(/,\s*([}\]])/g, '$1');
            return JSON.parse(cleaned);
        }
    }

    // Find K12's secret stuff hehe
    function extractItems(html) {
        let from = 0;

        while (from < html.length) {
            const rel = MARKER.exec(html.slice(from));
            if (!rel) return null;

            const at = from + rel.index;
            const after = html.slice(at);
            const relItems = /\bitems\s*:\s*\[/.exec(after);

            if (relItems) {
                const arrStart = at + relItems.index + relItems[0].length - 1;
                const arrText = sliceBalanced(html, arrStart, '[', ']');

                if (arrText) {
                    try {
                        const arr = parseJsonLoose(arrText);
                        if (Array.isArray(arr)) return { items: arr };
                    } catch (e) {
                        // Keep looking for another marker occurrence
                    }
                }
            }

            from = at + rel[0].length;
        }
        return null;
    }

    // Normalisation
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';

    const raw = (v) => (v == null ? '' : String(v).trim());

    // HTML formatter so it wont break
    const BLOCKS = new Set([
        'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DD', 'DT', 'TR', 'TD', 'TH', 'TABLE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION',
        'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'HR', 'ADDRESS',
    ]);
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'IFRAME', 'SVG', 'MATH']);

    function htmlToText(html) {
        if (!/[<&]/.test(html)) return html;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const out = [];

        const walk = (node) => {
            for (const child of node.childNodes) {
                if (child.nodeType === 3) {
                    out.push(child.nodeValue);
                } else if (child.nodeType === 1) {
                    if (child.tagName === 'BR') out.push('\n');
                    else if (!SKIP.has(child.tagName)) {
                        const block = BLOCKS.has(child.tagName);
                        if (block) out.push('\n');
                        walk(child);
                        if (block) out.push('\n');
                    }
                }
            }
        };

        walk(doc.body);

        return out
            .join('')
            .replace(/[ \t\u00a0]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    const txt = (v) => htmlToText(raw(v));

    const esc = (v) =>
        String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[c]));

    function labelUpper(i) {
        return UPPER[i] || String(i + 1);
    }

    function labelLower(i) {
        return (LOWER[i] || String(i + 1)) + '.';
    }

    function markedPoint(point) {
        const s = txt(point).replace(',', '.');
        if (!s) return false;
        const n = Number(s);
        return Number.isFinite(n) ? n > 0 : false;
    }

    const isTrueValue = (v) => /^(true|1|đúng|dung|yes|t|đ)$/i.test(txt(v));
    const isFalseValue = (v) => /^(false|0|sai|no|f|s)$/i.test(txt(v));

    function choiceEntries(choices) {
        if (!choices || typeof choices !== 'object') return [];
        return Object.keys(choices)
            .sort((a, b) => {
                const na = parseInt(a, 10);
                const nb = parseInt(b, 10);
                if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
                return a.localeCompare(b);
            })
            .map((key) => ({ value: choices[key] || {} }));
    }

    function classify(item) {
        const type = txt(item && item.elementType);
        const keys = Object.keys(item || {});

        // Fill in the blank
        if (keys.some((k) => /^answerText\d+$/i.test(k))) return 'short';

        // Dung nhan sai cai
        const entries = choiceEntries(item && item.choices);
        if (/truefalse|true_false|^tf/i.test(type)) return 'truefalse';
        if (
            entries.length > 0 &&
            entries.every((e) => isTrueValue(e.value.answerTitle) || isFalseValue(e.value.answerTitle))
        ) {
            return 'truefalse';
        }

        if (entries.length > 0) return 'choice';
        return 'unknown';
    }

    function describeItem(item, li) {
        const kind = classify(item);
        const out = {
            index: Number(item.questionIndex) || 0,
            kind,
            title: txt(item.textTitle) || txt(item.title),
            note: txt(item.answerDescription),
            domNumber: li ? txt(li.querySelector('.choice-question-number')?.textContent) : '',
            answer: '—',
            options: [],
            statements: [],
            parts: [],
        };

        if (kind === 'choice') {
            out.options = choiceEntries(item.choices).map((e, i) => ({
                label: txt(e.value.answerTitle) || labelUpper(i),
                marked: markedPoint(e.value.point),
            }));
            const marked = out.options.filter((o) => o.marked).map((o) => o.label);
            out.answer = marked.length ? marked.join(', ') : '—';
        } else if (kind === 'truefalse') {
            const entries = choiceEntries(item.choices);
            const usePoint = entries.some((e) => txt(e.value.point) !== '');

            out.statements = entries.map((e, i) => {
                const raw = txt(e.value.answerTitle);
                let truth = null;

                if (usePoint) truth = markedPoint(e.value.point);
                else if (isTrueValue(raw)) truth = true;
                else if (isFalseValue(raw)) truth = false;

                return { label: labelLower(i), truth };
            });

            out.answer = out.statements
                .map((s) => `${s.label} ${s.truth === true ? 'Đ' : s.truth === false ? 'S' : '?'}`)
                .join('  ');
        } else if (kind === 'short') {
            out.parts = Object.keys(item)
                .filter((k) => /^answerText\d+$/i.test(k))
                .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
                .map((k) => ({ key: k, value: txt(item[k]) }));

            out.answer = out.parts.map((p) => p.value).join('');
        }

        return out;
    }

    
    // Make the extracted data human-readable
    function readMeta(doc) {
        const fields = {};

        doc.querySelectorAll('.header-detail-courseResultPDF .mb-5').forEach((el) => {
            const t = el.textContent.replace(/\s+/g, ' ').trim();
            const i = t.indexOf(':');
            if (i > 0 && i < 40) {
                const k = t.slice(0, i).trim();
                const v = t.slice(i + 1).trim();
                if (k && v) fields[k] = v;
            }
        });

        const title = txt(
            doc.querySelector('.title-courseResultPDF')?.textContent ||
            doc.querySelector('.title-course')?.textContent
        );

        let code = txt(doc.querySelector('.code-courseResultPDF b')?.textContent);
        if (!code) {
            const m = /Mã đề\s*:\s*([^\s]+)/i.exec(
                doc.querySelector('.header-detail-courseResultPDF')?.textContent || ''
            );
            if (m) code = m[1];
        }

        const student = Array.from(doc.querySelectorAll('.header-detail-courseResultPDF p'))
            .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
            .find((t) => /học sinh/i.test(t));

        if (student) fields['Học sinh'] = student.replace(/^Học sinh\s*:\s*/i, '');

        return { title, code, fields };
    }

    function buildReport(html) {
        const found = extractItems(html);
        if (!found) {
            throw new Error('Không tìm thấy nội dung bài kiểm tra trong URL này.');
        }

        const items = found.items;
        const byId = new Map();
        for (const item of items) byId.set(txt(item.id || item._id), item);

        let doc = null;
        try {
            doc = new DOMParser().parseFromString(html, 'text/html');
        } catch (e) {
            doc = null;
        }

        const meta = doc
            ? readMeta(doc)
            : { title: '', code: '', fields: {} };

        const groups = [];
        const used = new Set();

        if (doc) {
            // Follow the page's own order + part headers, whatever they are
            const lis = doc.querySelectorAll('li[id]');

            for (const li of lis) {
                const id = byId.has(li.id) ? li.id : li.id.replace(/^question/, '');
                const item = byId.get(id);
                if (!item) continue;

                used.add(id);

                const partName =
                    txt(li.closest('.part-content')?.querySelector('.part-header')?.textContent) || 'Câu hỏi';

                let group = groups.find((g) => g.name === partName);
                if (!group) {
                    group = { name: partName, questions: [] };
                    groups.push(group);
                }

                group.questions.push(describeItem(item, li));
            }
        }

        // Anything not present in the DOM (or no DOM at all) > keep it, grouped by type.
        const leftovers = items.filter((item) => !used.has(txt(item.id || item._id)));

        if (leftovers.length) {
            if (!groups.length) {
                const byType = new Map();

                for (const item of leftovers) {
                    const key = txt(item.elementTypeTitle) || txt(item.elementType) || 'Khác';
                    if (!byType.has(key)) byType.set(key, { name: key, questions: [] });
                    byType.get(key).questions.push(describeItem(item, null));
                }

                groups.push(...byType.values());
            } else {
                groups.push({
                    name: 'Không có trên trang',
                    questions: leftovers.map((item) => describeItem(item, null)),
                });
            }
        }

        const questions = groups.reduce((acc, g) => acc.concat(g.questions), []);
        return { meta, groups, questions, itemCount: items.length };
    }

    // Plain-text rendering (for Copy)
    function reportText(report) {
        const lines = [];
        const m = report.meta || {};

        if (m.title) lines.push(m.title + (m.code ? ` — Mã đề ${m.code}` : ''));
        if (m.fields && Object.keys(m.fields).length) {
            lines.push(
                Object.entries(m.fields)
                    .filter(([k]) => !(m.code && /mã đề/i.test(k)))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')
            );
        }

        for (const g of report.groups) {
            lines.push('', `[${g.name}]`);

            for (const q of g.questions) {
                const n = q.domNumber || q.index || '?';
                let answer = '?';

                if (q.kind === 'choice') answer = q.answer;
                else if (q.kind === 'truefalse') answer = q.statements
                    .map((s) => `${s.label} ${s.truth === true ? 'Đ' : s.truth === false ? 'S' : '?'}`)
                    .join('  ');
                else if (q.kind === 'short') {
                    answer = q.parts.map((p) => p.value).join('');
                    if (q.parts.length > 1) {
                        answer += `   (${q.parts.map((p) => (p.value === '' ? '∅' : p.value)).join(' | ')})`;
                    }
                }

                lines.push(`${n}. ${answer}`);
            }
        }

        return lines.join('\n');
    }


    // HTTP request/respond repeater and parser (for testing btw)
    function shellTokens(input) {
        const tokens = [];
        let current = '';
        let quote = null;

        for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (quote) {
                if (ch === quote) {
                    quote = null;
                } else if (ch === '\\' && quote === '"' && i + 1 < input.length) {
                    current += input[++i];
                } else {
                    current += ch;
                }
                continue;
            }

            if (ch === "'" || ch === '"') {
                quote = ch;
            } else if (/\s/.test(ch)) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
            } else if (ch === '\\' && i + 1 < input.length) {
                current += input[++i];
            } else {
                current += ch;
            }
        }

        if (current) tokens.push(current);
        return tokens;
    }

    function parseCurl(text) {
        const tokens = shellTokens(text);
        tokens.shift(); // "curl"

        let url = '';
        let method = '';
        let body = '';
        const headers = {};

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];

            if (t === '-H' || t === '--header') {
                const h = tokens[++i] || '';
                const p = h.indexOf(':');
                if (p > 0) headers[h.slice(0, p).trim().toLowerCase()] = h.slice(p + 1).trim();
            } else if (t === '-X' || t === '--request') {
                method = (tokens[++i] || '').toUpperCase();
            } else if (
                t === '-d' || t === '--data' || t === '--data-raw' ||
                t === '--data-binary' || t === '--data-urlencode'
            ) {
                body = tokens[++i] || '';
                if (!method) method = 'POST';
            } else if (
                t === '-b' || t === '--cookie' || t === '-A' || t === '--user-agent' ||
                t === '-e' || t === '--referer'
            ) {
                i++; // the browser supplies these, sendRequest drops them anyway
            } else if (t === '--url') {
                url = tokens[++i] || '';
            } else if (!t.startsWith('-') && !url) {
                url = t;
            }
        }

        if (!url) throw new Error('Không tìm thấy URL trong lệnh cURL');
        if (!/^https?:\/\//i.test(url)) url = new URL(url, location.href).href;

        return { method: method || (body ? 'POST' : 'GET'), url, headers, body };
    }

    function parseRawRequest(raw) {
        const text = String(raw).replace(/\r\n/g, '\n').trim();

        // Also accept a DevTools "Copy as cURL" command.
        if (/^curl(\.exe)?\s/i.test(text)) return parseCurl(text);

        const split = text.indexOf('\n\n');
        const head = split === -1 ? text : text.slice(0, split);
        const body = split === -1 ? '' : text.slice(split + 2);

        const lines = head.split('\n').filter((l) => l.trim() !== '');
        const first = lines.shift() || '';
        const m = /^([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+$/i.exec(first.trim());

        if (!m) {
            throw new Error('Đây không phải là dữ liệu HTTP request. Cấu trúc: "GET /path HTTP/1.1".');
        }

        const headers = {};
        for (const line of lines) {
            const i = line.indexOf(':');
            if (i < 1) continue;
            const key = line.slice(0, i).trim().toLowerCase();
            const value = line.slice(i + 1).trim();
            headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
        }

        const host = headers.host;
        if (!host) throw new Error('Thiếu host header');

        let url = m[2];
        if (!/^https?:\/\//i.test(url)) {
            const scheme = host.endsWith(':80')
                ? 'http'
                : (location.protocol === 'http:' && !host.endsWith(':443') ? 'http' : 'https');
            url = `${scheme}://${host}${url.startsWith('/') ? '' : '/'}${url}`;
        }

        return { method: m[1].toUpperCase(), url, headers, body };
    }

    // Headers a browser refuses to let JS set, or that must come from the live session
    const SKIP_HEADER = /^(host|cookie|content-length|connection|accept-encoding|upgrade-insecure-requests|priority|referer|origin|user-agent|sec-.*)$/i;

    async function sendRequest(req) {
        const headers = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (SKIP_HEADER.test(key)) continue;
            headers[key] = value;
        }

        const init = {
            method: req.method,
            headers,
            credentials: 'include', // use the browser's current session cookies
            redirect: 'follow',
            cache: 'no-store',
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body || '';

        return fetch(req.url, init);
    }

    // If the pasted blob already contains an HTTP response (or raw HTML), use it
    function extractInlineResponse(raw) {
        const text = String(raw).replace(/\r\n/g, '\n');
        const status = /(?:^|\n)HTTP\/\d(?:\.\d)?\s+\d{3}[^\n]*\n/.exec(text);

        let section = text;

        if (status) {
            const rest = text.slice(status.index + status[0].length);
            const headersEnd = rest.indexOf('\n\n');
            section = headersEnd === -1 ? rest : rest.slice(headersEnd + 2);
        } else if (/^\s*</.test(text)) {
            section = text;
        } else {
            return null;
        }

        return MARKER.test(section) || /<html[\s>]/i.test(section) ? section : null;
    }

    // The beautifier ✨✨
    const DEV = /[?&]__lmsdev=1\b/.test(location.search);

    const RID = () => Math.random().toString(36).slice(2, 10);
    const HOST_ID = 'x' + RID();
    const FAB_ID = 'y' + RID();
    const FONT_ID = 'lms-payload-reader-font';
    const THEME_ATTR = 'data-' + RID();
    const HUE_KEY = 'hue';
    const THEME_KEY = 'theme';

    const STORE_KEY =
        '_' +
        [...location.hostname].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

    function readStore() {
        for (const store of [localStorage, sessionStorage]) {
            try {
                const raw = store.getItem(STORE_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) {
            }
        }
        return null;
    }

    function load(key) {
        const prefs = readStore();
        return prefs && key in prefs ? prefs[key] : null;
    }

    // Material 3 color stuff
    const SCHEME = {
        light: {
            'primary': [0.44, 0.155, 0],
            'on-primary': [1, 0, 0],
            'primary-container': [0.92, 0.055, 0],
            'on-primary-container': [0.30, 0.095, 0],
            'secondary-container': [0.93, 0.03, 0],
            'on-secondary-container': [0.33, 0.04, 0],
            'error': [0.50, 0.19, 27],
            'error-container': [0.92, 0.06, 27],
            'on-error-container': [0.35, 0.12, 27],
            'on-surface': [0.23, 0.012, 0],
            'on-surface-variant': [0.44, 0.02, 0],
            'surface-container-lowest': [1, 0, 0],
            'surface-container-low': [0.97, 0.008, 0],
            'surface-container': [0.955, 0.012, 0],
            'surface-container-high': [0.93, 0.015, 0],
            'surface-container-highest': [0.90, 0.018, 0],
            'outline': [0.55, 0.02, 0],
            'outline-variant': [0.83, 0.02, 0],
        },
        dark: {
            'primary': [0.80, 0.12, 0],
            'on-primary': [0.28, 0.08, 0],
            'primary-container': [0.36, 0.11, 0],
            'on-primary-container': [0.92, 0.05, 0],
            'secondary-container': [0.33, 0.03, 0],
            'on-secondary-container': [0.90, 0.03, 0],
            'error': [0.78, 0.14, 27],
            'error-container': [0.37, 0.12, 27],
            'on-error-container': [0.92, 0.06, 27],
            'on-surface': [0.91, 0.012, 0],
            'on-surface-variant': [0.78, 0.02, 0],
            'surface-container-lowest': [0.12, 0.01, 0],
            'surface-container-low': [0.185, 0.013, 0],
            'surface-container': [0.215, 0.015, 0],
            'surface-container-high': [0.255, 0.017, 0],
            'surface-container-highest': [0.30, 0.019, 0],
            'outline': [0.66, 0.02, 0],
            'outline-variant': [0.42, 0.02, 0],
        },
    };

    let hue = 265;
    let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    try {
        const savedHue = load(HUE_KEY);
        const hueValue = savedHue === null ? NaN : Number(savedHue);
        if (Number.isFinite(hueValue) && hueValue >= 0 && hueValue < 360) hue = Math.round(hueValue);

        const savedTheme = load(THEME_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme;
    } catch (e) {

    }

    function themeCss() {
        const block = (mode) =>
            Object.entries(SCHEME[mode])
                .map(([role, [l, c, offset]]) => `--md-sys-color-${role}: oklch(${l} ${c} ${(hue + offset) % 360});`)
                .join(' ');

        return `:host([${THEME_ATTR}="light"]) { color-scheme: light; ${block('light')} }
      :host([${THEME_ATTR}="dark"]) { color-scheme: dark; ${block('dark')} }`;
    }

    function save(key, value) {
        const prefs = readStore() || {};
        prefs[key] = value;

        for (const store of [localStorage, sessionStorage]) {
            try {
                store.setItem(STORE_KEY, JSON.stringify(prefs));
            } catch (e) {

            }
        }
    }

    function paint() {
        const fabHost = document.getElementById(FAB_ID);
        if (fabHost) fabHost.setAttribute(THEME_ATTR, theme);

        const host = document.getElementById(HOST_ID);
        if (!host) return;

        host.setAttribute(THEME_ATTR, theme);
        const root = host.__shadowRoot;
        root.querySelector('#theme').textContent = themeCss();

        const wheel = root.querySelector('.wheel');
        wheel.style.setProperty('--hue', hue);
        wheel.setAttribute('aria-valuenow', String(hue));
    }

    function setHue(value, persist) {
        const next = Math.round((value + 360) % 360);
        if (next === hue) return;

        hue = next;
        paint();
        if (persist) save(HUE_KEY, hue);
    }

    function setTheme(next) {
        theme = next;
        paint();
        save(THEME_KEY, theme);
    }

    // Shape, spacing, type and motion tokens
    const TOKENS = `
    :host {
      --md-font: "Google Sans Flex", "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      font-variation-settings: 'ROND' 100;
      font-optical-sizing: auto;

      --sp-1: 4px;
      --sp-2: 8px;
      --sp-3: 12px;
      --sp-4: 16px;
      --sp-8: 32px;

      --md-sys-shape-corner-extra-small: 4px;
      --md-sys-shape-corner-small: 8px;
      --md-sys-shape-corner-medium: 12px;
      --md-sys-shape-corner-large: 16px;
      --md-sys-shape-corner-extra-large: 28px;
      --md-sys-shape-corner-full: 999px;

      --md-sys-elevation-2: 0 1px 2px rgba(0,0,0,.3), 0 2px 6px 2px rgba(0,0,0,.15);
      --md-sys-elevation-3: 0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15);
      --md-sys-elevation-4: 0 2px 3px rgba(0,0,0,.3), 0 6px 10px 4px rgba(0,0,0,.15);

      --md-sys-motion-standard: cubic-bezier(.2, 0, 0, 1);
      --md-sys-motion-decelerate: cubic-bezier(.05, .7, .1, 1);
      --md-sys-motion-spring: cubic-bezier(.34, 1.4, .64, 1);
      --md-sys-motion-short: 150ms;
      --md-sys-motion-medium: 220ms;
      --md-sys-motion-long: 400ms;

      --md-sys-typescale-label-small: 500 12px/18px var(--md-font);
      --md-sys-typescale-label-medium: 500 13px/18px var(--md-font);
      --md-sys-typescale-label-large: 500 15px/22px var(--md-font);
      --md-sys-typescale-body-small: 400 13px/18px var(--md-font);
      --md-sys-typescale-body-medium: 400 15px/22px var(--md-font);
      --md-sys-typescale-title-medium: 500 18px/26px var(--md-font);
      --md-sys-typescale-title-large: 400 24px/30px var(--md-font);
    }
  `;

    const FAB_CSS = `
    * { box-sizing: border-box; }
    .fab {
      width: 56px; height: 56px; padding: 0;
      display: grid; place-items: center;
      border: none; border-radius: var(--md-sys-shape-corner-large);
      background: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      box-shadow: var(--md-sys-elevation-3);
      font: var(--md-sys-typescale-title-large); font-weight: 600;
      font-variation-settings: 'ROND' 100;
      cursor: pointer;
      animation: fab-in var(--md-sys-motion-medium) var(--md-sys-motion-spring) both;
      transition: box-shadow var(--md-sys-motion-short) var(--md-sys-motion-standard),
                  transform var(--md-sys-motion-short) var(--md-sys-motion-spring);
    }
    .fab:hover { box-shadow: var(--md-sys-elevation-4); }
    .fab:active { transform: scale(.94); }
    .fab:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 3px; }
    @keyframes fab-in { from { opacity: 0; transform: scale(.6); } }
    @media (prefers-reduced-motion: reduce) { .fab { transition: none; animation: none; } }
  `;

    const CSS = `
    * { box-sizing: border-box; }
    ::selection {
      background: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
    }

    .panel {
      width: 456px; max-width: calc(100vw - var(--sp-8));
      padding: 6px 0 var(--sp-4);
      background: var(--md-sys-color-surface-container);
      color: var(--md-sys-color-on-surface);
      border-radius: var(--md-sys-shape-corner-extra-large);
      box-shadow: var(--md-sys-elevation-3);
      font: var(--md-sys-typescale-body-small);
      font-variation-settings: 'ROND' 100;
      animation: panel-in var(--md-sys-motion-long) var(--md-sys-motion-spring) both;
    }
    @keyframes panel-in {
      from { opacity: 0; transform: scale(.94) translateY(8px); }
    }
    .panel.testing { width: 688px; }
    .panel.min .body { display: none; }
    .panel.min { padding-bottom: 0; }
    .panel.min .actions { padding-bottom: var(--sp-4); }

    .bar {
      display: flex; align-items: center; gap: var(--sp-2);
      height: 64px; padding: 0 var(--sp-4);
      cursor: move; user-select: none;
    }
    .brand {
      flex: 0 0 auto; width: 44px; height: 44px;
      display: grid; place-items: center;
      border-radius: var(--md-sys-shape-corner-full);
      background: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      font: var(--md-sys-typescale-label-large); font-weight: 700;
    }
    .bar .title {
      flex: 1; min-width: 0;
      font: var(--md-sys-typescale-title-medium); letter-spacing: -.1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .icon-btn {
      all: unset; flex: 0 0 auto;
      width: 44px; height: 44px; display: grid; place-items: center;
      border-radius: var(--md-sys-shape-corner-full);
      color: var(--md-sys-color-on-surface-variant);
      font: var(--md-sys-typescale-title-medium);
      cursor: pointer;
      transition: background-color var(--md-sys-motion-short) var(--md-sys-motion-standard);
    }
    .icon-btn:hover { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
    .icon-btn:active { background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent); }
    .icon-btn:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }

    .btn {
      flex: 0 0 auto; min-height: 44px; padding: 0 var(--sp-4);
      display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
      border: 1px solid transparent; border-radius: var(--md-sys-shape-corner-full);
      background: transparent; color: var(--md-sys-color-primary);
      font: var(--md-sys-typescale-label-large);
      cursor: pointer;
      transition: background-color var(--md-sys-motion-short) var(--md-sys-motion-standard),
                  transform var(--md-sys-motion-short) var(--md-sys-motion-spring);
    }
    .btn:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent); }
    .btn:active { background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent); transform: scale(.96); }
    .btn:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }
    .btn.tonal { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
    .btn.tonal:hover { background: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 8%, var(--md-sys-color-secondary-container)); }
    .btn.outlined { border-color: var(--md-sys-color-outline); }
    .btn.filled { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
    .btn.filled:hover { background: color-mix(in srgb, var(--md-sys-color-on-primary) 8%, var(--md-sys-color-primary)); }

    .actions {
      display: flex; align-items: center; gap: var(--sp-2);
      padding: 0 var(--sp-4) var(--sp-2);
    }

    .menu-wrap { position: relative; flex: 0 0 auto; }
    .menu {
      position: absolute; top: calc(100% + var(--sp-2)); left: 0; z-index: 5;
      width: 248px; max-width: calc(100vw - var(--sp-8));
      padding: var(--sp-2);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-corner-medium);
      background: var(--md-sys-color-surface-container-high);
      box-shadow: var(--md-sys-elevation-2);
      transform-origin: top left;
      animation: menu-in var(--md-sys-motion-medium) var(--md-sys-motion-spring);
    }
    @keyframes menu-in {
      from { opacity: 0; transform: scale(.9); }
    }
    .menu-item {
      width: 100%; min-height: 44px; padding: 0 var(--sp-3);
      display: flex; align-items: center; gap: var(--sp-3);
      border: none; border-radius: var(--md-sys-shape-corner-small);
      background: transparent; color: var(--md-sys-color-on-surface);
      font: var(--md-sys-typescale-label-large); text-align: left;
      cursor: pointer;
    }
    .menu-item:hover { background: var(--md-sys-color-surface-container-highest); }
    .menu-item:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: -2px; }
    .menu-sep { height: 1px; margin: var(--sp-2) 0; background: var(--md-sys-color-outline-variant); }
    .menu-block { position: relative; padding: var(--sp-1) var(--sp-3) var(--sp-2); }
    .menu-label {
      display: block;
      font: var(--md-sys-typescale-label-small);
      color: var(--md-sys-color-on-surface-variant);
    }

    .wheel {
      --hue: 265;
      position: relative; width: 112px; height: 112px;
      margin: var(--sp-2) auto var(--sp-1);
      border-radius: var(--md-sys-shape-corner-full);
      background:
        radial-gradient(circle, var(--md-sys-color-surface-container-high) 0 23px, transparent 24px),
        conic-gradient(from 0deg,
          oklch(.70 .16 0), oklch(.70 .16 60), oklch(.70 .16 120),
          oklch(.70 .16 180), oklch(.70 .16 240), oklch(.70 .16 300), oklch(.70 .16 360));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
      cursor: crosshair;
      touch-action: none;
    }
    .wheel:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 3px; }
    .wheel-thumb {
      position: absolute; left: 50%; top: 50%;
      width: 18px; height: 18px; margin: -9px;
      border-radius: var(--md-sys-shape-corner-full);
      background: oklch(.66 .16 calc(var(--hue) * 1deg));
      box-shadow: 0 0 0 2px var(--md-sys-color-surface-container-high),
                  0 0 0 3px var(--md-sys-color-outline);
      transform: rotate(calc(var(--hue) * 1deg)) translateY(-41px);
      pointer-events: none;
    }

    .theme-btn {
      position: absolute; right: var(--sp-3); bottom: var(--sp-3);
      width: 34px; height: 34px; padding: 0;
      display: grid; place-items: center;
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-corner-full);
      background: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface-variant);
      cursor: pointer;
      transition: background-color var(--md-sys-motion-short) var(--md-sys-motion-standard),
                  transform var(--md-sys-motion-short) var(--md-sys-motion-spring);
    }
    .theme-btn:hover { background: var(--md-sys-color-surface-container-high); }
    .theme-btn:active { transform: scale(.92); }
    .theme-btn:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }
    .theme-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .theme-btn .i-sun { display: none; }
    :host([${THEME_ATTR}="dark"]) .theme-btn .i-sun { display: block; }
    :host([${THEME_ATTR}="dark"]) .theme-btn .i-moon { display: none; }

    .body {
      max-height: min(72vh, 720px);
      overflow: auto;
      padding: 0 var(--sp-4);
      scrollbar-width: thin;
      scrollbar-color: var(--md-sys-color-outline-variant) transparent;
    }

    .part { margin-top: var(--sp-4); }
    .part-head {
      display: flex; align-items: center; gap: var(--sp-2);
      padding: 0 0 var(--sp-2);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      font: var(--md-sys-typescale-label-large);
      color: var(--md-sys-color-on-surface-variant);
    }
    .part-head em {
      margin-left: auto; min-height: 28px; padding: 0 var(--sp-2);
      display: inline-flex; align-items: center;
      border-radius: var(--md-sys-shape-corner-small);
      background: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface-variant);
      font: var(--md-sys-typescale-label-medium); font-style: normal;
    }

    .q {
      margin-top: var(--sp-1);
      padding: var(--sp-3);
      border-radius: var(--md-sys-shape-corner-medium);
      animation: q-in var(--md-sys-motion-medium) var(--md-sys-motion-decelerate) both;
      animation-delay: calc(var(--i, 0) * 18ms);
    }
    @keyframes q-in {
      from { opacity: 0; transform: translateY(6px); }
    }
    .q:nth-child(even) { background: var(--md-sys-color-surface-container-low); }
    .q-top { display: flex; align-items: center; gap: var(--sp-2); }
    .num {
      flex: 0 0 auto; min-width: 28px; height: 28px; padding: 0 var(--sp-2);
      display: grid; place-items: center;
      border-radius: var(--md-sys-shape-corner-small);
      background: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface-variant);
      font: var(--md-sys-typescale-label-medium); font-weight: 700;
    }
    .qtitle {
      flex: 1; min-width: 0;
      font: var(--md-sys-typescale-body-medium);
      color: var(--md-sys-color-on-surface);
      overflow-wrap: anywhere;
    }
    .opts { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-2); }
    .opt {
      display: inline-flex; align-items: center; gap: var(--sp-1);
      padding: var(--sp-2);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-corner-small);
      background: var(--md-sys-color-surface-container-lowest);
      color: var(--md-sys-color-on-surface-variant);
      font: var(--md-sys-typescale-label-medium);
      white-space: pre-line;
    }
    .opt.on {
      border-color: transparent;
      background: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
    }
    .opt.on i { font-style: normal; font-size: 12px; }
    .opt.off {
      border-color: transparent;
      background: var(--md-sys-color-error-container);
      color: var(--md-sys-color-on-error-container);
    }
    .opt.blank {
      justify-content: center; min-width: 34px;
      border-color: transparent;
      background: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .note {
      margin-top: var(--sp-1);
      font: var(--md-sys-typescale-label-small);
      color: var(--md-sys-color-on-surface-variant);
      white-space: pre-line;
    }
    .empty {
      padding: var(--sp-4);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
      font: var(--md-sys-typescale-body-medium);
    }
    .empty b { color: var(--md-sys-color-on-surface); font-weight: 600; }

    .test .hint {
      margin-bottom: var(--sp-3);
      font: var(--md-sys-typescale-body-small);
      color: var(--md-sys-color-on-surface-variant);
    }
    .test .hint b { color: var(--md-sys-color-on-surface); font-weight: 600; }
    textarea {
      width: 100%; height: 210px; resize: vertical;
      padding: var(--sp-3) var(--sp-4);
      border: 1px solid var(--md-sys-color-outline);
      border-radius: var(--md-sys-shape-corner-extra-small);
      background: var(--md-sys-color-surface-container-lowest);
      color: var(--md-sys-color-on-surface);
      font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace;
      outline: none;
      transition: border-color var(--md-sys-motion-short) var(--md-sys-motion-standard);
    }
    textarea::placeholder { color: var(--md-sys-color-on-surface-variant); opacity: .7; }
    textarea:focus {
      border-color: var(--md-sys-color-primary);
      outline: 1px solid var(--md-sys-color-primary);
      outline-offset: -1px;
    }
    .row { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-4); }
    .result { animation: q-in var(--md-sys-motion-medium) var(--md-sys-motion-decelerate) both; }

    .spinner { flex: 0 0 auto; width: 18px; height: 18px; display: inline-block; }
    .spinner svg { display: block; width: 100%; height: 100%; animation: spin 1.4s linear infinite; }
    .spinner circle {
      fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round;
      stroke-dasharray: 1 200;
      animation: dash 1.4s ease-in-out infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes dash {
      0% { stroke-dasharray: 1 200; stroke-dashoffset: 0; }
      50% { stroke-dasharray: 90 200; stroke-dashoffset: -35px; }
      100% { stroke-dasharray: 90 200; stroke-dashoffset: -124px; }
    }
    .status.loading {
      display: flex; align-items: center; gap: var(--sp-2);
      color: var(--md-sys-color-primary);
    }
    .btn:disabled { opacity: .38; cursor: default; transform: none; }

    .status {
      margin-top: var(--sp-2);
      font: var(--md-sys-typescale-body-small);
      color: var(--md-sys-color-on-surface-variant);
      word-break: break-word;
    }
    .status.err { color: var(--md-sys-color-error); }
    .status:empty { margin-top: 0; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
      .spinner svg { animation: spin 3s linear infinite !important; }
      .spinner circle { animation: dash 3s ease-in-out infinite !important; }
    }
  `;

    function ensureFont() {
        if (document.getElementById(FONT_ID)) return;

        const head = document.head || document.documentElement;
        const links = [
            { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
            { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
            {
                rel: 'stylesheet',
                id: FONT_ID,
                href: 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght,ROND@100..1000,100&display=swap',
            },
        ];

        for (const attrs of links) {
            const link = document.createElement('link');
            Object.assign(link, attrs);
            head.appendChild(link);
        }
    }

    let booted = false;

    function ensurePanel() {
        let host = document.getElementById(HOST_ID);
        if (host) return host.__shadowRoot;

        document.getElementById(FAB_ID)?.remove();
        ensureFont();

        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute(THEME_ATTR, theme);
        host.style.cssText = 'position:fixed;top:72px;right:24px;z-index:2147483647;';

        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
      <style>${TOKENS}${CSS}</style>
      <style id="theme">${themeCss()}</style>
      <div class="panel">
        <header class="bar">
          <span class="brand" aria-hidden="true">K12</span>
          <span class="title">K12Online Hack - bài kiểm tra</span>
          <button class="icon-btn" type="button" data-act="min" title="Thu nhỏ" aria-label="Thu nhỏ">&#8211;</button>
          <button class="icon-btn" type="button" data-act="close" title="Đóng" aria-label="Đóng">&#215;</button>
        </header>
        <div class="actions">
          <button class="btn tonal" type="button" data-act="scan" title="Scan lại trang này">&#8635; Scan lại</button>
          <div class="menu-wrap">
            <button class="icon-btn" type="button" data-act="menu" title="Tùy chọn" aria-label="Tùy chọn" aria-haspopup="true" aria-expanded="false">&#8943;</button>
            <div class="menu" hidden>
              <button class="menu-item" type="button" data-act="test" title="Gửi HTTP request">Replay request</button>
              <div class="menu-sep"></div>
              <div class="menu-block">
                <span class="menu-label">Giao diện</span>
                <div class="wheel" role="slider" tabindex="0" aria-label="Giao diện" aria-valuemin="0" aria-valuemax="360" aria-valuenow="${hue}" style="--hue:${hue}">
                  <span class="wheel-thumb"></span>
                </div>
                <button class="theme-btn" type="button" data-act="theme" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
                  <svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-12.37l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0zM7.05 18.36l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0z"/></svg>
                  <svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="body" role="region" aria-label="Exam answers"></div>
      </div>`;

        (document.body || document.documentElement).appendChild(host);

        host.__shadowRoot = root;
        wirePanel(host, root);
        makeDraggable(host, root);
        return root;
    }

    function makeDraggable(host, root) {
        const bar = root.querySelector('.bar');
        const panel = root.querySelector('.panel');

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;

        bar.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;

            const rect = panel.getBoundingClientRect();
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            originX = rect.left;
            originY = rect.top;

            host.style.left = `${rect.left}px`;
            host.style.top = `${rect.top}px`;
            host.style.right = 'auto';

            bar.setPointerCapture(e.pointerId);
        });

        bar.addEventListener('pointermove', (e) => {
            if (!dragging) return;

            const x = Math.min(Math.max(0, originX + e.clientX - startX), window.innerWidth - 90);
            const y = Math.min(Math.max(0, originY + e.clientY - startY), window.innerHeight - 40);
            host.style.left = `${x}px`;
            host.style.top = `${y}px`;
        });

        const stop = () => { dragging = false; };
        bar.addEventListener('pointerup', stop);
        bar.addEventListener('pointercancel', stop);
    }

    function wirePanel(host, root) {
        const menu = root.querySelector('.menu');
        const trigger = root.querySelector('[data-act="menu"]');

        let outside = null;

        const closeMenu = () => {
            if (menu.hidden) return;

            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            outside = null;
        };

        const openMenu = () => {
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            outside = (e) => {
                if (!e.composedPath().includes(host)) closeMenu();
            };
            document.addEventListener('pointerdown', outside, true);
        };

        const setMenu = (open) => (open ? openMenu() : closeMenu());

        root.addEventListener('click', async (e) => {
            const actBtn = e.target.closest('button[data-act]');
            if (actBtn) {
                const act = actBtn.dataset.act;

                if (act === 'menu') setMenu(menu.hidden);
                else if (act === 'scan') { closeMenu(); scanAndRender(); }
                else if (act === 'test') { closeMenu(); showTest(); }
                else if (act === 'theme') setTheme(theme === 'light' ? 'dark' : 'light');
                else if (act === 'min') root.querySelector('.panel').classList.toggle('min');
                else if (act === 'close') {
                    closeMenu();
                    host.remove();
                    showFab();
                }
                return;
            }

            const testBtn = e.target.closest('button[data-test]');
            if (testBtn) {
                const act = testBtn.dataset.test;
                if (act === 'send') doTest(false);
                else if (act === 'parse') doTest(true);
                else if (act === 'clear') showTest();
            }
        });

        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeMenu();
        });

        const wheel = root.querySelector('.wheel');
        let dragging = false;

        const pick = (e) => {
            const rect = wheel.getBoundingClientRect();
            const x = e.clientX - (rect.left + rect.width / 2);
            const y = e.clientY - (rect.top + rect.height / 2);
            setHue((Math.atan2(y, x) * 180) / Math.PI + 90, false);
        };

        wheel.addEventListener('pointerdown', (e) => {
            dragging = true;
            wheel.setPointerCapture(e.pointerId);
            pick(e);
            e.preventDefault();
        });
        wheel.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
        wheel.addEventListener('pointerup', () => { dragging = false; save(HUE_KEY, hue); });
        wheel.addEventListener('pointercancel', () => { dragging = false; save(HUE_KEY, hue); });

        wheel.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 15 : 5;

            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setHue(hue - step, true);
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setHue(hue + step, true);
            else return;

            e.preventDefault();
        });
    }

    function showFab() {
        if (document.getElementById(FAB_ID)) return;

        ensureFont();

        const host = document.createElement('div');
        host.id = FAB_ID;
        host.setAttribute(THEME_ATTR, theme);
        host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;';

        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${TOKENS}${themeCss()}${FAB_CSS}</style>
      <button class="fab" type="button" title="Mở K12Online Hack" aria-label="Mở K12Online Hack">K12</button>`;

        root.querySelector('.fab').addEventListener('click', () => {
            host.remove();
            ensurePanel();
            scanAndRender();
        });

        (document.body || document.documentElement).appendChild(host);
    }

    function scanAndRender() {
        const root = ensurePanel();
        root.querySelector('.panel').classList.remove('testing');

        try {
            root.querySelector('.body').innerHTML =
                reportHtml(buildReport(document.documentElement.outerHTML));
        } catch (e) {
            root.querySelector('.body').innerHTML =
                `<div class="empty"><b>Không tìm thấy dữ liệu bài kiểm tra trên trang</b><br>${esc(e.message)}`
        }
    }

    function showTest() {
        const root = ensurePanel();
        const body = root.querySelector('.body');
        const previous = body.querySelector('textarea')?.value || '';

        root.querySelector('.panel').classList.add('testing');
        body.innerHTML = `
      <div class="test">
        <div class="hint">
          Paste a raw HTTP request (DevTools &rarr; Copy as cURL also works), or a raw HTTP response / HTML.
          <b>Cookie headers are ignored</b> &mdash; the browser sends the current session cookies.
        </div>
        <textarea spellcheck="false" aria-label="Raw HTTP request, response, or cURL command" placeholder="GET /79000820/page/Courseware/Exam/doExam?... HTTP/1.1&#10;Host: hcm.k12online.vn&#10;..."></textarea>
        <div class="row">
          <button class="btn filled" type="button" data-test="send">Send &amp; parse</button>
          <button class="btn outlined" type="button" data-test="parse">Parse pasted response</button>
          <button class="btn" type="button" data-test="clear">Clear</button>
        </div>
        <div class="status" role="status" aria-live="polite"></div>
      </div>`;

        const ta = root.querySelector('textarea');
        ta.value = previous;
        ta.focus();
    }

    async function doTest(parseOnly) {
        const root = ensurePanel();
        const body = root.querySelector('.body');
        const ta = body.querySelector('textarea');
        const status = body.querySelector('.status');

        if (!ta || !status) return;

        const raw = ta.value.trim();
        body.querySelector('.result')?.remove();

        const controls = Array.from(body.querySelectorAll('[data-test="send"], [data-test="parse"]'));

        const say = (message, isError) => {
            status.className = `status${isError ? ' err' : ''}`;
            status.removeAttribute('aria-busy');
            status.textContent = message;
            controls.forEach((btn) => { btn.disabled = false; });
        };

        const working = (label) => {
            status.className = 'status loading';
            status.setAttribute('aria-busy', 'true');
            status.innerHTML =
                '<span class="spinner" aria-hidden="true">' +
                '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18"/></svg></span>' +
                `<span>${esc(label)}</span>`;
            controls.forEach((btn) => { btn.disabled = true; });
        };

        if (!raw) {
            say('Paste a request or response first.', true);
            return;
        }

        working('Working\u2026');

        try {
            let html;
            let note;
            const inline = extractInlineResponse(raw);

            if (parseOnly || inline) {
                if (!inline) throw new Error('Không tìm thấy HTTP respond hay mã HTML.');
                html = inline;
                note = 'Parsed the pasted response locally.';
            } else {
                const req = parseRawRequest(raw);
                const started = Date.now();
                const res = await sendRequest(req);
                html = await res.text();
                note = `${req.method} ${res.url} · HTTP ${res.status} ${res.statusText} · ` +
                    `${html.length.toLocaleString()} bytes · ${Date.now() - started} ms`;

                if (!res.ok) throw new Error(`${note} — request failed.`);

                if (!MARKER.test(html)) {
                    const looksLikeLogin = /login|đăng nhập|sign in/i.test(html);
                    throw new Error(
                        `${note} - không thấy nội dung bài kiểm tra` +
                        (looksLikeLogin ? ' Có vẻ như tài khoản đã bị đăng xuất.' : '')
                    );
                }
            }

            const report = buildReport(html);

            say(`${note} · ${report.itemCount} câu`);

            const result = document.createElement('div');
            result.className = 'result';
            result.innerHTML = reportHtml(report);
            body.appendChild(result);
        } catch (e) {
            say(e && e.message ? e.message : String(e), true);
        }
    }

    function renderReport(report) {
        const root = ensurePanel();
        root.querySelector('.panel').classList.remove('testing');
        root.querySelector('.body').innerHTML = reportHtml(report);
    }

    
    // Render html
    function questionHtml(q, i) {
        const num = q.domNumber || q.index || '';
        let opts = '';

        if (q.kind === 'choice') {
            opts = q.options
                .map((o) => `<span class="opt${o.marked ? ' on' : ''}">${esc(o.label)}${o.marked ? '<i>&#10003;</i>' : ''}</span>`)
                .join('');
        } else if (q.kind === 'truefalse') {
            opts = q.statements
                .map((s) => {
                    const cls = s.truth === true ? ' on' : s.truth === false ? ' off' : '';
                    const val = s.truth === true ? 'Đ' : s.truth === false ? 'S' : '?';
                    return `<span class="opt${cls}">${esc(s.label)} <b>${val}</b></span>`;
                })
                .join('');
        } else if (q.kind === 'short') {
            opts = q.parts
                .map((p) => `<span class="opt blank" title="${esc(p.key)}">${p.value === '' ? '&empty;' : esc(p.value)}</span>`)
                .join('');
        }

        return `<div class="q" style="--i:${Math.min(i || 0, 12)}">
      <div class="q-top">
        <span class="num">${esc(num)}</span>
        <span class="qtitle" title="${esc(q.title)}">${esc(q.title)}</span>
      </div>
      ${opts ? `<div class="opts">${opts}</div>` : ''}
      ${q.note ? `<div class="note">${esc(q.note)}</div>` : ''}
    </div>`;
    }

    function reportHtml(report) {
        const groups = report.groups
            .map(
                (g) => `<section class="part">
          <div class="part-head">${esc(g.name)} <em>${g.questions.length}</em></div>
          ${g.questions.map((q, i) => questionHtml(q, i)).join('')}
        </section>`
            )
            .join('');

        return groups || '<div class="empty">No questions found.</div>';
    }

    // Bootloader (not grub)
    function boot() {
        if (booted) return;
        booted = true;

        ensureFont();
        showFab();

        const onExamPage = /Courseware\/Exam\/doExam/i.test(location.pathname + location.search);

        try {
            const report = buildReport(document.documentElement.outerHTML);
            renderReport(report);
            return;
        } catch (e) {

        }

        if (onExamPage) {
            ensurePanel();
            showTest();
        }
    }

    // Make sure nothing broke
    function selfCheck() {
        const before = document.cookie;

        save(THEME_KEY, theme);

        if (document.cookie !== before) throw new Error('stealth: a cookie was written');
        if (load(THEME_KEY) !== theme) throw new Error('stealth: prefs did not persist');
        if (/payload|reader|lms/i.test(STORE_KEY)) throw new Error('stealth: storage key is recognisable');

        return true;
    }

    // Ctrl + Shift + U to open the menu
    window.addEventListener(
        'keydown',
        (e) => {
            if (!e.ctrlKey || !e.shiftKey) return;
            if (String(e.key).toLowerCase() !== 'u') return;

            e.preventDefault();
            e.stopPropagation();
            ensurePanel();
            scanAndRender();
        },
        true
    );

    // Console/test API
    if (DEV) {
        const API = { extractItems, extractInlineResponse, buildReport, describeItem, parseRawRequest, sendRequest, reportText };
        try {
            (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).LMSDevAnswers = API;
        } catch (e) {

        }

        try {
            selfCheck();
            console.info('[K12Hack] self-check ok');
        } catch (e) {
            console.error('[K12Hack]', e.message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 500), { once: true });
    } else {
        setTimeout(boot, 500);
    }
})();
