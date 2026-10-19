// Compare Visualizer – zpracování exportu AI porovnávače (studio_results_*.json) v prohlížeči.
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const nf = new Intl.NumberFormat('cs-CZ');
  const nf1 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pf = new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 1 });
  const dtf = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthShort = new Intl.DateTimeFormat('cs-CZ', { month: 'short', timeZone: 'UTC' });
  const SERIES = n => `var(--jk-chart-${(n % 8) + 1})`;
  const PAGE = 50;

  const state = {
    all: [], files: [],
    f: { q: '', status: '', user: '', month: '' },
    sort: { key: 'created', dir: -1 },
    limit: PAGE, view: [], cursor: -1,
    userColors: new Map()
  };

  // ---------- Parsování ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const stripEmoji = s => String(s || '').replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}️‍\s]+/u, '').trim();
  const parseIds = v => Array.isArray(v) ? v.map(String) : String(v || '').replace(/[{}\[\]\s"]/g, '').split(',').filter(Boolean);

  function parseResponse(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function normalize(r) {
    const resp = parseResponse(r.response_content);
    const compare = resp?.compare ?? resp ?? {};
    const products = Array.isArray(compare.products) ? compare.products : [];
    const created = r.compare_created_at ? new Date(r.compare_created_at) : null;
    const feedback = r.feedback_created_at ? new Date(r.feedback_created_at) : null;
    const requestedIds = parseIds(r.product_ids);
    const returnedIds = products.map(p => String(p.id));
    const valid = created && !isNaN(created);
    return {
      id: String(r.compare_id ?? compare.compareId ?? ''),
      userId: String(r.user_id ?? ''),
      type: r.type || compare.type || '',
      userType: r.user_type || compare.userType || '',
      userLabel: r.user_type_label || r.user_type || 'Neznámý',
      created: valid ? created : null,
      feedback: feedback && !isNaN(feedback) ? feedback : null,
      monthKey: valid ? created.toISOString().slice(0, 7) : '',
      requested: toInt(r.requested_count) ?? requestedIds.length,
      returned: toInt(r.returned_count) ?? products.length,
      requestedIds,
      missingIds: requestedIds.filter(id => !returnedIds.includes(id)),
      status: r.status || '',
      parseError: r.response_content && !resp,
      products,
      raw: r,
      text: [r.compare_id, r.user_id, r.user_type_label, ...products.flatMap(p => [p.id, p.name, p.badge, ...(p.highlights || []).map(h => h.name)])].join(' ').toLowerCase()
    };
  }

  function extractRecords(json) {
    if (Array.isArray(json)) return json;
    for (const k of ['data', 'results', 'items', 'rows']) if (Array.isArray(json?.[k])) return json[k];
    throw new Error('Soubor neobsahuje pole záznamů.');
  }

  async function loadFiles(list) {
    const files = [...list].filter(f => /\.json$/i.test(f.name) || f.type === 'application/json');
    if (!files.length) return showError('Vyberte soubor ve formátu .json.');
    const byId = new Map(state.all.map(r => [r.id, r]));
    const errors = [];
    for (const f of files) {
      try {
        const recs = extractRecords(JSON.parse(await f.text()));
        recs.filter(r => r && typeof r === 'object').map(normalize).forEach(r => byId.set(r.id || crypto.randomUUID(), r));
        if (!state.files.includes(f.name)) state.files.push(f.name);
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (!byId.size) return showError(errors.join(' · ') || 'Soubor neobsahuje žádné záznamy.');
    state.all = [...byId.values()];
    const labels = [...new Set(state.all.map(r => r.userLabel))].sort((a, b) => count(b) - count(a));
    function count(l) { return state.all.filter(r => r.userLabel === l).length; }
    state.userColors = new Map(labels.map((l, i) => [l, SERIES(i)]));
    showError('');
    buildFilterOptions();
    $('#empty').hidden = true;
    $('#dash').hidden = false;
    $('#btn-upload').hidden = false;
    $('#ctx').textContent = state.files.join(', ');
    setStatus(errors.length ? `<span class="warn">načteno s chybami</span> · ${esc(errors.join(' · '))}` : `<span class="ok">načteno</span> · ${nf.format(state.all.length)} porovnání`);
    render();
  }

  function showError(msg) {
    const el = $('#err');
    el.textContent = msg;
    el.hidden = !msg;
  }
  const setStatus = html => { $('#status').innerHTML = 'Stav: ' + html; };

  // ---------- Filtry ----------
  function buildFilterOptions() {
    const users = [...state.userColors.keys()];
    $('#f-user').innerHTML = '<option value="">Všichni uživatelé</option>' + users.map(u => `<option>${esc(u)}</option>`).join('');
    const months = [...new Set(state.all.map(r => r.monthKey).filter(Boolean))].sort().reverse();
    $('#f-month').innerHTML = '<option value="">Všechny měsíce</option>' + months.map(m => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('');
    syncControls();
  }

  const monthLabel = key => { const s = monthFmt.format(new Date(key + '-01T00:00:00Z')); return s.charAt(0).toUpperCase() + s.slice(1); };

  function syncControls() {
    $('#q').value = state.f.q;
    $('#f-user').value = state.f.user;
    $('#f-month').value = state.f.month;
    document.querySelectorAll('#f-status button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.f.status));
    $('#btn-reset').hidden = !(state.f.q || state.f.status || state.f.user || state.f.month);
  }

  function setFilter(patch) {
    Object.assign(state.f, patch);
    state.limit = PAGE;
    syncControls();
    render();
  }

  function filtered() {
    const { q, status, user, month } = state.f;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.all.filter(r =>
      (!status || r.status === status) &&
      (!user || r.userLabel === user) &&
      (!month || r.monthKey === month) &&
      terms.every(t => r.text.includes(t)));
  }

  // ---------- Vykreslení ----------
  function render() {
    const rows = filtered();
    const total = state.all.length;
    $('#subtitle').textContent = rows.length === total
      ? `${nf.format(total)} porovnání · ${dateRange(rows)}`
      : `${nf.format(rows.length)} z ${nf.format(total)} porovnání · ${dateRange(rows)}`;
    renderKpis(rows);
    renderMonths(rows);
    renderUsers(rows);
    renderCounts(rows);
    renderBadges(rows);
    renderHighlights(rows);
    renderTable(rows);
  }

  function dateRange(rows) {
    const ts = rows.map(r => r.created).filter(Boolean).map(d => d.getTime());
    if (!ts.length) return 'bez data';
    const d = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
    return `${d.format(Math.min(...ts))} – ${d.format(Math.max(...ts))}`;
  }

  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

  function fmtDuration(sec) {
    if (sec == null) return '–';
    if (sec < 60) return `${Math.round(sec)} s`;
    if (sec < 3600) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return s ? `${m} min ${s} s` : `${m} min`; }
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function renderKpis(rows) {
    const ok = rows.filter(r => r.status === 'OK').length;
    const partial = rows.filter(r => r.status === 'partial').length;
    const req = rows.reduce((s, r) => s + (r.requested || 0), 0);
    const ret = rows.reduce((s, r) => s + (r.returned || 0), 0);
    const delays = rows.filter(r => r.created && r.feedback).map(r => (r.feedback - r.created) / 1000).filter(s => s >= 0);
    const users = new Set(rows.map(r => r.userId).filter(Boolean)).size;
    const ratings = rows.flatMap(r => r.products.map(p => p.rating)).filter(v => typeof v === 'number');
    const kpi = (label, value, note) => `<div class="kpi"><span>${label}</span><b>${value}</b><small>${note}</small></div>`;
    $('#kpis').innerHTML = [
      kpi('Porovnání', nf.format(rows.length), `${nf.format(users)} unikátních uživatelů`),
      kpi('Úspěšnost', rows.length ? pf.format(ok / rows.length) : '–', partial ? `<span class="badge b-warn">${nf.format(partial)} neúplných</span>` : 'všechna kompletní'),
      kpi('Produktů na porovnání', rows.length ? nf1.format(req / rows.length) : '–', `vráceno ${req ? pf.format(ret / req) : '–'} požadovaných`),
      kpi('Medián do zpětné vazby', fmtDuration(median(delays)), `${nf.format(delays.length)} záznamů s časem`),
      kpi('Průměrné hodnocení', ratings.length ? nf1.format(avg(ratings)) : '–', `${nf.format(ratings.length)} produktů v odpovědích`)
    ].join('');
  }

  // Svislý skládaný sloupcový graf v SVG
  function columnChart(groups, seriesKeys, colorOf, opts = {}) {
    const W = 640, H = 220, L = 40, R = 8, T = 14, B = 30;
    const max = Math.max(1, ...groups.map(g => opts.grouped ? Math.max(...seriesKeys.map(k => g.values[k] || 0)) : seriesKeys.reduce((s, k) => s + (g.values[k] || 0), 0)));
    const step = niceStep(max), top = Math.ceil(max / step) * step;
    const y = v => T + (H - T - B) * (1 - v / top);
    const slot = (W - L - R) / Math.max(groups.length, 1);
    const bw = Math.min(56, slot * 0.6);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '')}"><g class="grid-l" stroke-width="1">`;
    for (let v = 0; v <= top; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += '</g><g class="axis-l" text-anchor="end">';
    for (let v = 0; v <= top; v += step) svg += `<text x="${L - 8}" y="${y(v) + 4}">${nf.format(v)}</text>`;
    svg += '</g>';
    groups.forEach((g, i) => {
      const cx = L + slot * i + slot / 2;
      if (opts.grouped) {
        const w = bw / seriesKeys.length;
        seriesKeys.forEach((k, j) => {
          const v = g.values[k] || 0; if (!v) return;
          svg += `<rect x="${cx - bw / 2 + j * w + 1}" y="${y(v)}" width="${w - 2}" height="${y(0) - y(v)}" rx="3" fill="${colorOf(k, j)}"><title>${esc(g.label)} · ${esc(opts.names?.[k] || k)}: ${nf.format(v)}</title></rect>`;
        });
      } else {
        let acc = 0;
        seriesKeys.forEach((k, j) => {
          const v = g.values[k] || 0; if (!v) return;
          svg += `<rect x="${cx - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${colorOf(k, j)}"><title>${esc(g.label)} · ${esc(k)}: ${nf.format(v)}</title></rect>`;
          acc += v;
        });
        if (acc) svg += `<text class="val-l" x="${cx}" y="${y(acc) - 5}" text-anchor="middle">${nf.format(acc)}</text>`;
      }
      svg += `<text class="axis-l" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(g.short ?? g.label)}</text>`;
    });
    return svg + '</svg>';
  }

  function niceStep(max) {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  }

  function renderMonths(rows) {
    const users = [...state.userColors.keys()];
    const map = new Map();
    rows.forEach(r => {
      if (!r.monthKey) return;
      const g = map.get(r.monthKey) || { key: r.monthKey, values: {} };
      g.values[r.userLabel] = (g.values[r.userLabel] || 0) + 1;
      map.set(r.monthKey, g);
    });
    const groups = [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map(g => {
      const d = new Date(g.key + '-01T00:00:00Z');
      return { ...g, label: monthLabel(g.key), short: `${monthShort.format(d)} ${String(d.getUTCFullYear()).slice(2)}` };
    });
    const present = users.filter(u => groups.some(g => g.values[u]));
    $('#legend-month').innerHTML = present.map(u => `<span><i style="background:${state.userColors.get(u)}"></i>${esc(u)}</span>`).join('');
    $('#chart-month').innerHTML = groups.length ? columnChart(groups, present, k => state.userColors.get(k), { label: 'Počet porovnání podle měsíce a typu uživatele' }) : '<p class="empty-note">Žádná data</p>';
  }

  // Vodorovné pruhy; onPick volitelně nastaví filtr
  function barList(items, { color, active, pickAttr } = {}) {
    if (!items.length) return '<p class="empty-note">Žádná data</p>';
    const max = Math.max(...items.map(i => i.value));
    const total = items.reduce((s, i) => s + i.value, 0);
    return `<div class="bars">${items.map((it, n) => {
      const tag = pickAttr ? 'button' : 'div';
      const attrs = pickAttr ? ` type="button" ${pickAttr}="${esc(it.label)}" aria-pressed="${active === it.label}"` : '';
      const segs = it.parts
        ? it.parts.map(p => `<i style="width:${(p.value / max) * 100}%;background:${p.color}" title="${esc(p.name)}: ${nf.format(p.value)}"></i>`).join('')
        : `<i style="width:${(it.value / max) * 100}%;background:${it.color || color || SERIES(0)}"></i>`;
      return `<${tag} class="bar"${attrs}><span class="bar-l" title="${esc(it.label)}">${esc(it.label)}</span><span class="bar-v">${nf.format(it.value)}${it.note ? ' · ' + it.note : ` · ${pf.format(it.value / total)}`}</span><span class="bar-t">${segs}</span></${tag}>`;
    }).join('')}</div>`;
  }

  function tally(values) {
    const m = new Map();
    values.forEach(v => { if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'cs'));
  }

  function renderUsers(rows) {
    const items = tally(rows.map(r => r.userLabel)).map(it => {
      const sub = rows.filter(r => r.userLabel === it.label);
      const ok = sub.filter(r => r.status === 'OK').length;
      return { ...it, color: state.userColors.get(it.label), note: `${pf.format(ok / sub.length)} OK` };
    });
    $('#chart-user').innerHTML = barList(items, { active: state.f.user, pickAttr: 'data-user' });
  }

  function renderCounts(rows) {
    const keys = [...new Set(rows.flatMap(r => [r.requested, r.returned]).filter(n => n != null))].sort((a, b) => a - b);
    const groups = keys.map(k => ({
      label: `${k} produktů`, short: String(k),
      values: { req: rows.filter(r => r.requested === k).length, ret: rows.filter(r => r.returned === k).length }
    }));
    $('#chart-count').innerHTML = groups.length
      ? columnChart(groups, ['req', 'ret'], (k, j) => SERIES(j), { grouped: true, names: { req: 'Požadováno', ret: 'Vráceno' }, label: 'Rozložení počtu požadovaných a vrácených produktů' })
      : '<p class="empty-note">Žádná data</p>';
  }

  function renderBadges(rows) {
    const items = tally(rows.flatMap(r => r.products.map(p => stripEmoji(p.badge)))).slice(0, 10);
    $('#chart-badge').innerHTML = barList(items, { color: SERIES(3), pickAttr: 'data-q', active: state.f.q });
  }

  function renderHighlights(rows) {
    const all = rows.flatMap(r => r.products.flatMap(p => (p.highlights || []).map(h => (h.name || '').trim())));
    const items = tally(all).slice(0, 20);
    $('#hl-meta').textContent = `${nf.format(all.length)} zvýraznění · ${nf.format(new Set(all).size)} různých`;
    const half = Math.ceil(items.length / 2);
    $('#chart-hl').innerHTML = items.length
      ? [items.slice(0, half), items.slice(half)].filter(c => c.length).map(c => barList(c.map(i => ({ ...i, note: pf.format(i.value / all.length) })), { color: SERIES(1), pickAttr: 'data-q', active: state.f.q })).join('')
      : '<p class="empty-note">Žádná data</p>';
  }

  const statusBadge = r => r.parseError ? '<span class="badge b-err">Chyba parsování</span>'
    : r.status === 'OK' ? '<span class="badge b-ok">OK</span>'
    : r.status === 'partial' ? '<span class="badge b-warn">Neúplné</span>'
    : `<span class="badge b-neutral">${esc(r.status || '–')}</span>`;

  const sorters = {
    created: r => r.created?.getTime() ?? 0,
    id: r => toInt(r.id) ?? 0,
    user: r => r.userLabel,
    req: r => r.requested ?? 0,
    ret: r => r.returned ?? 0,
    status: r => r.status
  };

  function renderTable(rows) {
    const { key, dir } = state.sort;
    const get = sorters[key];
    state.view = [...rows].sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y, 'cs') : x - y) * dir; });
    document.querySelectorAll('th[data-sort]').forEach(th => th.setAttribute('aria-sort', th.dataset.sort === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
    const shown = state.view.slice(0, state.limit);
    $('#rows').innerHTML = shown.length ? shown.map((r, i) => {
      const names = r.products.map(p => p.name);
      return `<tr tabindex="0" data-i="${i}">
        <td class="when">${r.created ? dtf.format(r.created) : '–'}</td>
        <td class="mono">${esc(r.id)}</td>
        <td><span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:${state.userColors.get(r.userLabel)}"></i>${esc(r.userLabel)}</span></td>
        <td class="prods">${names.length ? `<div>${esc(names[0])}</div>` + (names.length > 1 ? `<div class="more-p">${esc(names[1])}${names.length > 2 ? ` a ${names.length - 2} další` : ''}</div>` : '') : '<span class="small">bez produktů</span>'}</td>
        <td class="num">${r.requested ?? '–'}</td>
        <td class="num">${r.returned ?? '–'}</td>
        <td>${statusBadge(r)}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-note" style="text-align:center;cursor:default">Filtrům neodpovídá žádné porovnání.</td></tr>';
    $('#tbl-meta').textContent = `${nf.format(shown.length)} z ${nf.format(state.view.length)}`;
    $('#btn-more').hidden = state.view.length <= state.limit;
    state.cursor = -1;
  }

  // ---------- Detail ----------
  function openDetail(r) {
    $('#d-title').textContent = `Porovnání ${r.id}`;
    $('#d-meta').innerHTML = [
      statusBadge(r),
      `<span class="chip">${esc(r.userLabel)}</span>`,
      r.created ? `<span>Vytvořeno ${dtf.format(r.created)}</span>` : '',
      r.feedback && r.created ? `<span>· zpětná vazba za ${fmtDuration((r.feedback - r.created) / 1000)}</span>` : '',
      r.userId ? `<span>· uživatel <span class="mono">${esc(r.userId)}</span></span>` : ''
    ].join(' ');
    const missing = r.missingIds.length
      ? `<div class="missing"><b>Chybí ${r.missingIds.length} z ${r.requested} produktů.</b> Bez odpovědi zůstala ID <span class="mono">${r.missingIds.map(esc).join(', ')}</span>.</div>` : '';
    const cards = r.products.map(p => `
      <article class="prod">
        ${p.badge ? `<span class="p-badge">${esc(p.badge)}</span>` : ''}
        <h4>${esc(p.name || 'Bez názvu')}</h4>
        <div class="p-meta"><span>ID <span class="mono">${esc(p.id)}</span></span>
          ${typeof p.rating === 'number' ? `<span>Hodnocení ${nf1.format(p.rating)} / 5</span>` : ''}
          ${typeof p.reviews === 'number' ? `<span>${nf.format(p.reviews)} recenzí</span>` : ''}</div>
        ${(p.highlights || []).length ? `<ul>${p.highlights.map(h => `<li><b>${esc(h.name)}</b><span>${esc(h.description)}</span></li>`).join('')}</ul>` : ''}
      </article>`).join('');
    $('#d-body').innerHTML = `${missing}<div class="prod-grid">${cards || '<p class="empty-note">Odpověď neobsahuje žádné produkty.</p>'}</div>
      <details class="raw"><summary>Zdrojový záznam</summary><pre>${esc(JSON.stringify({ ...r.raw, response_content: parseResponse(r.raw.response_content) ?? r.raw.response_content }, null, 2))}</pre></details>`;
    const dlg = $('#detail');
    if (!dlg.open) dlg.showModal();
    $('#d-body').scrollTop = 0;
  }

  // ---------- Export ----------
  function exportCsv() {
    const head = ['compare_id', 'vytvoreno', 'typ_uzivatele', 'stav', 'pozadovano', 'vraceno', 'chybejici_id', 'produkty', 'stitky'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = state.view.map(r => [r.id, r.created?.toISOString() ?? '', r.userLabel, r.status, r.requested, r.returned, r.missingIds.join(' '),
      r.products.map(p => p.name).join(' | '), r.products.map(p => stripEmoji(p.badge)).join(' | ')].map(q).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `porovnani_${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Události ----------
  const pick = () => $('#file').click();
  $('#btn-pick').addEventListener('click', pick);
  $('#btn-upload').addEventListener('click', pick);
  $('#file').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });

  let dragDepth = 0;
  const drop = $('#drop');
  document.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; drop.classList.add('over'); });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('over'); } });
  document.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; drop.classList.remove('over'); if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files); });

  let qTimer;
  $('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => setFilter({ q: e.target.value.trim() }), 150); });
  $('#f-status').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFilter({ status: b.dataset.v }); });
  $('#f-user').addEventListener('change', e => setFilter({ user: e.target.value }));
  $('#f-month').addEventListener('change', e => setFilter({ month: e.target.value }));
  $('#btn-reset').addEventListener('click', () => setFilter({ q: '', status: '', user: '', month: '' }));
  $('#btn-export').addEventListener('click', exportCsv);
  $('#btn-more').addEventListener('click', () => { state.limit = Infinity; renderTable(filtered()); });

  $('#dash').addEventListener('click', e => {
    const u = e.target.closest('[data-user]');
    if (u) return setFilter({ user: state.f.user === u.dataset.user ? '' : u.dataset.user });
    const q = e.target.closest('[data-q]');
    if (q) return setFilter({ q: state.f.q === q.dataset.q ? '' : q.dataset.q });
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'user' || k === 'status' ? 1 : -1) };
      return renderTable(filtered());
    }
    const tr = e.target.closest('tr[data-i]');
    if (tr) { state.cursor = +tr.dataset.i; openDetail(state.view[state.cursor]); }
  });

  const dlg = $('#detail');
  $('#d-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    const tr = document.querySelector(`tr[data-i="${state.cursor}"]`);
    if (tr) tr.focus();
  });

  function focusRow(i) {
    const trs = document.querySelectorAll('#rows tr[data-i]');
    if (!trs.length) return;
    state.cursor = Math.max(0, Math.min(trs.length - 1, i));
    trs.forEach(t => t.classList.toggle('sel', +t.dataset.i === state.cursor));
    trs[state.cursor].focus();
    if (dlg.open) openDetail(state.view[state.cursor]);
  }

  document.addEventListener('keydown', e => {
    if ($('#dash').hidden) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' || (e.key === '/' && !typing && !dlg.open)) {
      e.preventDefault(); if (dlg.open) dlg.close(); $('#q').focus(); $('#q').select(); return;
    }
    if (e.key === 'Escape' && document.activeElement === $('#q') && $('#q').value) { setFilter({ q: '' }); return; }
    if (typing && document.activeElement !== $('#q')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(state.cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(state.cursor - 1); }
    else if (e.key === 'Enter' && !dlg.open && document.activeElement?.matches('tr[data-i]')) { openDetail(state.view[+document.activeElement.dataset.i]); }
  });
})();
