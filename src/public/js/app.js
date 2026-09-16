'use strict';

/* Attachment Runway — dashboard client.
   The server hands us the company list as JSON in a <script> tag; from there
   all edits go through the /api/companies endpoints and we re-render in place.
   DOM is built with createElement (never innerHTML with user data) so company
   names and notes can't inject markup. */

(function () {
  // ---- Constants ----------------------------------------------------------

  var SECTORS = [
    'Cloud & DevOps',
    'Networking & Telecom',
    'Cybersecurity',
    'Fintech & Software',
    'Banking & Finance',
    'Insurance',
    'Government & Parastatal',
    'NGO & Conservation',
    'Other',
  ];

  // Order of the stats strip. 'skip' is intentionally excluded from the count
  // row but stays available as a filter.
  var STAT_STATUSES = [
    { key: 'not-applied', label: 'Not applied' },
    { key: 'applied', label: 'Applied' },
    { key: 'pending', label: 'Pending' },
    { key: 'interview', label: 'Interview' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'rejected', label: 'Rejected' },
  ];

  var STATUS_OPTIONS = [
    { value: 'not-applied', label: 'Not applied' },
    { value: 'applied', label: 'Applied' },
    { value: 'pending', label: 'Pending' },
    { value: 'interview', label: 'Interview' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'skip', label: 'Skip' },
  ];

  // ---- State --------------------------------------------------------------

  var config = readJSON('app-config') || { staleAfterDays: 30, profileComplete: true };
  var companies = readJSON('companies-data') || [];
  var filters = { search: '', sector: '', status: '', priority: '' };

  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  // ---- Element refs -------------------------------------------------------

  var $list = document.getElementById('company-list');
  var $empty = document.getElementById('empty-state');
  var $stats = document.getElementById('stats');
  var $count = document.getElementById('results-count');
  var $search = document.getElementById('search');
  var $fSector = document.getElementById('filter-sector');
  var $fStatus = document.getElementById('filter-status');
  var $fPriority = document.getElementById('filter-priority');
  var $reset = document.getElementById('reset-filters');
  var $toggleAdd = document.getElementById('toggle-add');
  var $addForm = document.getElementById('add-form');
  var $cancelAdd = document.getElementById('cancel-add');
  var $addSector = document.getElementById('add-sector');
  var $addMsg = document.getElementById('add-msg');

  // ---- Small helpers ------------------------------------------------------

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.class) node.className = opts.class;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    if (opts.on) Object.keys(opts.on).forEach(function (evt) { node.addEventListener(evt, opts.on[evt]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function statusClass(status) { return 'status-' + status; }

  function isStale(company) {
    if (!company.last_checked_at) return true;
    var days = (Date.now() - new Date(company.last_checked_at).getTime()) / 86400000;
    return days >= (config.staleAfterDays || 30);
  }

  function daysAgoText(ts) {
    if (!ts) return 'never checked';
    var days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    if (days <= 0) return 'checked today';
    if (days === 1) return 'checked 1 day ago';
    return 'checked ' + days + ' days ago';
  }

  function dateForInput(v) { return v ? String(v).slice(0, 10) : ''; }

  async function api(method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(url, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      var msg = (data && data.error) || ('Request failed (' + res.status + ')');
      throw new Error(msg);
    }
    return data;
  }

  function replaceCompany(updated) {
    for (var i = 0; i < companies.length; i++) {
      if (companies[i].id === updated.id) { companies[i] = updated; return; }
    }
  }

  // ---- Populate selects ---------------------------------------------------

  function fillSelect(select, options, includeAll, allLabel) {
    select.innerHTML = '';
    if (includeAll) select.appendChild(el('option', { text: allLabel, attrs: { value: '' } }));
    options.forEach(function (opt) {
      var value = typeof opt === 'string' ? opt : opt.value;
      var label = typeof opt === 'string' ? opt : opt.label;
      select.appendChild(el('option', { text: label, attrs: { value: value } }));
    });
  }

  fillSelect($fSector, SECTORS, true, 'All sectors');
  fillSelect($fStatus, STATUS_OPTIONS, true, 'All statuses');
  fillSelect($addSector, SECTORS, false);
  $addSector.value = 'Other';

  // ---- Stats --------------------------------------------------------------

  function renderStats() {
    $stats.innerHTML = '';
    STAT_STATUSES.forEach(function (s) {
      var n = companies.filter(function (c) { return c.status === s.key; }).length;
      var stat = el('button', {
        class: 'stat' + (filters.status === s.key ? ' accent' : ''),
        attrs: { type: 'button', 'aria-pressed': String(filters.status === s.key) },
        on: {
          click: function () {
            filters.status = filters.status === s.key ? '' : s.key;
            $fStatus.value = filters.status;
            render();
          },
        },
      }, [
        el('div', { class: 'stat-num', text: String(n) }),
        el('div', { class: 'stat-label', text: s.label }),
      ]);
      $stats.appendChild(stat);
    });
  }

  // ---- Filtering ----------------------------------------------------------

  function applyFilters() {
    var q = filters.search.trim().toLowerCase();
    return companies.filter(function (c) {
      if (filters.sector && c.sector !== filters.sector) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      if (q) {
        var hay = (c.name + ' ' + (c.location || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---- Card rendering -----------------------------------------------------

  function buildCard(c) {
    // Header block: name + meta tags
    var meta = el('div', { class: 'company-meta' });
    if (c.location) meta.appendChild(el('span', { class: 'company-loc', text: c.location }));
    meta.appendChild(el('span', { class: 'tag tag-sector', text: c.sector }));
    meta.appendChild(el('span', { class: 'badge-priority prio-' + c.priority, text: c.priority }));
    if (c.is_exception) meta.appendChild(el('span', { class: 'tag tag-exception', text: 'Exception (outside city)' }));
    if (c.website) {
      if (c.site_status === 'broken') {
        meta.appendChild(el('span', { class: 'tag-flag flag-broken', text: 'Link may be broken' }));
      }
      if (isStale(c)) {
        meta.appendChild(el('span', { class: 'tag-flag flag-stale', text: 'Needs re-verification', attrs: { title: daysAgoText(c.last_checked_at) } }));
      }
    }
    meta.appendChild(el('span', { class: 'tag-source', text: c.source }));

    var head = el('div', { class: 'company-head' }, [
      el('div', { class: 'company-name', text: c.name }),
      meta,
    ]);

    if (c.contact) {
      var contact = el('div', { class: 'company-contact' });
      contact.appendChild(document.createTextNode('Contact: '));
      contact.appendChild(el('span', { text: c.contact }));
      head.appendChild(contact);
    }
    if (c.website) {
      var web = el('div', { class: 'company-contact' });
      web.appendChild(el('a', { text: c.website, attrs: { href: c.website, target: '_blank', rel: 'noopener noreferrer' } }));
      head.appendChild(web);
    }

    // Status select
    var statusSel = el('select', {
      class: 'status-select ' + statusClass(c.status),
      attrs: { 'aria-label': 'Status for ' + c.name },
      on: {
        change: function (e) {
          var val = e.target.value;
          statusSel.className = 'status-select ' + statusClass(val);
          patchField(c, { status: val }, function () { renderStats(); });
        },
      },
    });
    STATUS_OPTIONS.forEach(function (o) {
      var opt = el('option', { text: o.label, attrs: { value: o.value } });
      if (o.value === c.status) opt.selected = true;
      statusSel.appendChild(opt);
    });

    var top = el('div', { class: 'company-top' }, [head, statusSel]);

    // Dates
    var appliedInput = el('input', { attrs: { type: 'date', value: dateForInput(c.date_applied), 'aria-label': 'Date applied for ' + c.name } });
    appliedInput.addEventListener('change', function () { patchField(c, { date_applied: appliedInput.value }); });
    var followInput = el('input', { attrs: { type: 'date', value: dateForInput(c.follow_up_date), 'aria-label': 'Follow-up date for ' + c.name } });
    followInput.addEventListener('change', function () { patchField(c, { follow_up_date: followInput.value }); });

    var dates = el('div', { class: 'company-dates' }, [
      el('div', { class: 'date-field' }, [el('label', { text: 'Date applied' }), appliedInput]),
      el('div', { class: 'date-field' }, [el('label', { text: 'Follow-up' }), followInput]),
    ]);

    // Notes
    var notes = el('textarea', { class: 'input textarea notes-input', attrs: { rows: '2', 'aria-label': 'Notes for ' + c.name, placeholder: 'Notes…' } });
    notes.value = c.notes || '';
    var notesSaved = el('span', { class: 'save-hint', text: 'Saved' });
    var notesDirty = false;
    notes.addEventListener('input', function () { notesDirty = true; });
    notes.addEventListener('blur', function () {
      if (!notesDirty) return;
      notesDirty = false;
      patchField(c, { notes: notes.value }, function () { flash(notesSaved); });
    });
    var notesField = el('div', { class: 'notes-field' }, [
      el('label', {}, [document.createTextNode('Notes '), notesSaved]),
      notes,
    ]);

    // Actions
    var draftArea = el('div', { class: 'draft-area' });
    var draftBtn = el('button', {
      class: 'btn btn-ghost btn-sm', attrs: { type: 'button' },
      text: c.draft_email ? 'View / redraft email' : 'Draft email',
    });
    if (!config.profileComplete) {
      draftBtn.disabled = true;
      draftBtn.title = 'Add your profile details first to enable drafting.';
    }
    draftBtn.addEventListener('click', function () { onDraft(c, draftBtn, draftArea); });

    var removeBtn = el('button', {
      class: 'btn btn-danger btn-sm', attrs: { type: 'button' }, text: 'Remove',
      on: { click: function () { onRemove(c); } },
    });

    var actions = el('div', { class: 'company-actions' }, [draftBtn, removeBtn]);

    // If a draft already exists, pre-populate the (collapsed) draft area.
    if (c.draft_email) buildDraftUI(draftArea, c, c.draft_email, false);

    var body = el('div', { class: 'company-body' }, [dates, notesField, actions, draftArea]);

    return el('div', { class: 'company', attrs: { 'data-id': String(c.id) } }, [top, body]);
  }

  function flash(node) {
    node.classList.add('show');
    setTimeout(function () { node.classList.remove('show'); }, 1400);
  }

  function patchField(company, patch, onOk) {
    api('PATCH', '/api/companies/' + company.id, patch)
      .then(function (updated) {
        replaceCompany(updated);
        if (onOk) onOk(updated);
      })
      .catch(function (err) { alert('Could not save: ' + err.message); });
  }

  // ---- Draft flow ---------------------------------------------------------

  function buildDraftUI(area, company, text, open) {
    area.innerHTML = '';
    var ta = el('textarea', { class: 'input draft-text', attrs: { 'aria-label': 'Drafted email for ' + company.name } });
    ta.value = text;
    // Persist manual edits to the draft on blur.
    ta.addEventListener('blur', function () {
      if (ta.value !== company.draft_email) patchField(company, { draft_email: ta.value });
    });

    var copyBtn = el('button', {
      class: 'btn btn-primary btn-sm', attrs: { type: 'button' }, text: 'Copy',
      on: {
        click: function () {
          copyToClipboard(ta.value).then(function (ok) {
            copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
          });
        },
      },
    });
    var note = el('span', { class: 'draft-status', text: 'Review and edit before sending. Nothing is sent for you.' });

    area.appendChild(el('div', { class: 'draft-toolbar' }, [copyBtn, note]));
    area.appendChild(ta);
    if (open) area.classList.add('show');
  }

  function onDraft(company, btn, area) {
    // If a draft already exists and the area is hidden, just toggle it open.
    if (company.draft_email && !area.classList.contains('show')) {
      area.classList.add('show');
      return;
    }
    if (area.classList.contains('show') && company.draft_email && btn.dataset.mode !== 'regen') {
      area.classList.remove('show');
      return;
    }

    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Drafting…';
    area.classList.add('show');
    area.innerHTML = '';
    area.appendChild(el('div', { class: 'draft-status draft-loading' }, [
      el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'Contacting the AI to write a first draft…' }),
    ]));

    api('POST', '/api/companies/' + company.id + '/draft')
      .then(function (updated) {
        replaceCompany(updated);
        company.draft_email = updated.draft_email;
        buildDraftUI(area, company, updated.draft_email, true);
        btn.textContent = 'View / redraft email';
      })
      .catch(function (err) {
        area.innerHTML = '';
        area.appendChild(el('div', { class: 'draft-status draft-error', text: err.message }));
        btn.textContent = originalLabel;
      })
      .finally(function () { btn.disabled = false; });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // ---- Remove -------------------------------------------------------------

  function onRemove(company) {
    var ask = window.confirmDialog
      ? window.confirmDialog({
          title: 'Remove company?',
          message: 'Remove "' + company.name + '" from your tracker? This cannot be undone.',
          confirmLabel: 'Remove',
          cancelLabel: 'Keep',
          danger: true,
        })
      : Promise.resolve(window.confirm('Remove "' + company.name + '"? This cannot be undone.'));

    ask.then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/companies/' + company.id)
        .then(function () {
          companies = companies.filter(function (c) { return c.id !== company.id; });
          render();
        })
        .catch(function (err) { alert('Could not remove: ' + err.message); });
    });
  }

  // ---- Add ----------------------------------------------------------------

  function onAddSubmit(e) {
    e.preventDefault();
    $addMsg.textContent = '';
    var payload = {
      name: document.getElementById('add-name').value.trim(),
      sector: document.getElementById('add-sector').value,
      location: document.getElementById('add-location').value.trim(),
      priority: document.getElementById('add-priority').value,
      contact: document.getElementById('add-contact').value.trim(),
      website: document.getElementById('add-website').value.trim(),
    };
    if (!payload.name) { $addMsg.textContent = 'Name is required.'; return; }

    var submitBtn = $addForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    api('POST', '/api/companies', payload)
      .then(function (created) {
        companies.push(created);
        $addForm.reset();
        $addSector.value = 'Other';
        $addForm.hidden = true;
        $toggleAdd.setAttribute('aria-expanded', 'false');
        render();
      })
      .catch(function (err) { $addMsg.textContent = err.message; })
      .finally(function () { submitBtn.disabled = false; });
  }

  // ---- Render -------------------------------------------------------------

  function render() {
    renderStats();
    var visible = applyFilters();

    $count.textContent = visible.length + ' of ' + companies.length + ' companies';

    $list.innerHTML = '';
    if (visible.length === 0) {
      $empty.hidden = false;
    } else {
      $empty.hidden = true;
      var frag = document.createDocumentFragment();
      visible.forEach(function (c) { frag.appendChild(buildCard(c)); });
      $list.appendChild(frag);
    }
  }

  // ---- Wire up controls ---------------------------------------------------

  $search.addEventListener('input', function () { filters.search = $search.value; render(); });
  $fSector.addEventListener('change', function () { filters.sector = $fSector.value; render(); });
  $fStatus.addEventListener('change', function () { filters.status = $fStatus.value; render(); });
  $fPriority.addEventListener('change', function () { filters.priority = $fPriority.value; render(); });
  $reset.addEventListener('click', function () {
    filters = { search: '', sector: '', status: '', priority: '' };
    $search.value = ''; $fSector.value = ''; $fStatus.value = ''; $fPriority.value = '';
    render();
  });

  $toggleAdd.addEventListener('click', function () {
    var show = $addForm.hidden;
    $addForm.hidden = !show;
    $toggleAdd.setAttribute('aria-expanded', String(show));
    if (show) document.getElementById('add-name').focus();
  });
  $cancelAdd.addEventListener('click', function () {
    $addForm.hidden = true;
    $addMsg.textContent = '';
    $toggleAdd.setAttribute('aria-expanded', 'false');
  });
  $addForm.addEventListener('submit', onAddSubmit);

  // ---- Go -----------------------------------------------------------------

  render();
})();
