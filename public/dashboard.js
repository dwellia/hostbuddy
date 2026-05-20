var allIssues = [];
var charts = {};
var activeRange = 'all';

// All categories that should NEVER appear in the dashboard
var EXCLUDED_CATEGORIES = ['RESERVATION CHANGES'];

var CATEGORY_COLORS = {
  'CLEANLINESS':        '#1179EB',
  'GUEST REQUESTS':     '#F38B2B',
  'MAINTENANCE':        '#dc2626',
  'SUPPLY':             '#0d9488',
  'OTHER':              '#9ca3af'
};

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || '#9ca3af';
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadData() {
  fetch('/api/issues')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      allIssues = (data.issues || []).filter(function(i) {
        return !EXCLUDED_CATEGORIES.includes(i.category);
      });
      document.getElementById('lastUpdated').textContent =
        new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
      render();
    })
    .catch(function(err) {
      document.getElementById('statsGrid').innerHTML =
        '<div class="loading-state c12">Failed to load: ' + err.message + '</div>';
    });
}

function deleteIssue(id, event) {
  event.stopPropagation();
  if (!confirm('Delete this issue?')) return;
  fetch('/api/delete-issue?id=' + id, { method: 'DELETE' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.status === 'ok') {
        allIssues = allIssues.filter(function(i) { return i.id !== id; });
        render();
      } else {
        alert('Delete failed: ' + (data.error || 'unknown error'));
      }
    })
    .catch(function(err) { alert('Delete failed: ' + err.message); });
}

// ── Time toggle ───────────────────────────────────────────────────────────────

function buildTimeToggle() {
  var thisYear = new Date().getFullYear();
  var yr1 = thisYear - 1;
  var yr2 = thisYear - 2;
  var buttons = [
    { range: '3mo',       label: '3 Mo' },
    { range: '6mo',       label: '6 Mo' },
    { range: 'ytd',       label: 'YTD' },
    { range: String(yr1), label: String(yr1) },
    { range: String(yr2), label: String(yr2) },
    { range: 'all',       label: 'All Time', active: true },
  ];
  var toggle = document.getElementById('timeToggle');
  if (!toggle) return;
  toggle.innerHTML = buttons.map(function(b) {
    return '<button class="tt-btn' + (b.active ? ' active' : '') + '" data-range="' + b.range + '">' + b.label + '</button>';
  }).join('');
  toggle.querySelectorAll('.tt-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      toggle.querySelectorAll('.tt-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeRange = btn.getAttribute('data-range');
      render();
    });
  });
}

function getTimeRangeCutoff(range) {
  var now = new Date();
  if (range === '3mo') { var d = new Date(now); d.setMonth(d.getMonth() - 3); return d; }
  if (range === '6mo') { var d = new Date(now); d.setMonth(d.getMonth() - 6); return d; }
  if (range === 'ytd') { return new Date(now.getFullYear(), 0, 1); }
  if (/^\d{4}$/.test(range)) {
    var yr = parseInt(range);
    return { start: new Date(yr, 0, 1), end: new Date(yr + 1, 0, 1) };
  }
  return null;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function getFiltered() {
  var prop = document.getElementById('filterProperty').value;
  var cat  = document.getElementById('filterCategory').value;
  var type = document.getElementById('filterType').value;
  var cutoff = getTimeRangeCutoff(activeRange);

  return allIssues.filter(function(issue) {
    if (prop !== 'all' && issue.property_id !== prop) return false;
    if (cat  !== 'all' && issue.category   !== cat)  return false;
    if (type !== 'all' && issue.task_type  !== type)  return false;
    if (cutoff) {
      var ts = new Date(issue.timestamp);
      if (cutoff.start) {
        if (ts < cutoff.start || ts >= cutoff.end) return false;
      } else {
        if (ts < cutoff) return false;
      }
    }
    return true;
  });
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function buildMetrics(issues) {
  var total        = issues.length;
  var urgent       = issues.filter(function(i) { return i.task_type === 'urgent'; }).length;
  var nextClean    = issues.filter(function(i) { return i.task_type === 'next_clean'; }).length;
  var tasksCreated = issues.filter(function(i) { return i.task_created; }).length;
  var byProperty = {}, byCategory = {};

  issues.forEach(function(i) {
    byProperty[i.property] = (byProperty[i.property] || 0) + 1;
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
  });

  return { total: total, urgent: urgent, nextClean: nextClean, tasksCreated: tasksCreated, byProperty: byProperty, byCategory: byCategory };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function typeBadge(type) {
  if (type === 'urgent')     return '<span class="badge red">Urgent</span>';
  if (type === 'next_clean') return '<span class="badge green">Next Clean</span>';
  return '<span class="badge gray">—</span>';
}

function catBadge(cat) {
  var colorMap = { 'CLEANLINESS': 'blue', 'GUEST REQUESTS': 'orange', 'MAINTENANCE': 'red', 'SUPPLY': 'teal', 'OTHER': 'gray' };
  return '<span class="badge ' + (colorMap[cat] || 'gray') + '">' + cat + '</span>';
}

function statCard(label, value, sub, colorClass) {
  return '<div class="card c3"><div class="clabel">' + label + '</div>' +
    '<div class="cvalue ' + colorClass + '">' + value + '</div>' +
    '<div class="csub">' + sub + '</div></div>';
}

function detailRow(label, value) {
  return '<div class="detail-row"><span class="dlabel">' + label + '</span><span class="dval">' + value + '</span></div>';
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  var issues = getFiltered();
  var m = buildMetrics(issues);

  // Stats
  document.getElementById('statsGrid').innerHTML =
    statCard('Total Issues',  m.total,       'All flagged action items', 'blue') +
    statCard('Urgent',        m.urgent,      'Visit requested',          'red')  +
    statCard('Next Clean',    m.nextClean,   'Fix at turnover',          'green') +
    statCard('Tasks Created', m.tasksCreated,'In Asana',                 '');

  // Issue count
  document.getElementById('issueCount').textContent =
    issues.length + ' issue' + (issues.length !== 1 ? 's' : '');

  // Table
  if (issues.length === 0) {
    document.getElementById('tableContent').innerHTML =
      '<div class="empty-state"><div class="icon">📋</div><p>No issues yet.</p></div>';
  } else {
    var rows = '';
    issues.forEach(function(issue, i) {
      var isDelta  = issue.property_id === 'delta-dawn';
      var propTag  = '<span class="tprop ' + (isDelta ? 'dd' : 'lg') + '">' + (isDelta ? 'Delta Dawn' : 'LeGobi') + '</span>';
      var smsColor = issue.sms_sent     ? 'var(--green)' : 'var(--text-3)';
      var tskColor = issue.task_created ? 'var(--green)' : 'var(--text-3)';
      rows +=
        '<tr data-index="' + i + '" data-id="' + issue.id + '">' +
        '<td><span class="td-date">'  + formatDate(issue.timestamp) + '</span></td>' +
        '<td>' + propTag + '</td>' +
        '<td style="font-size:12.5px;font-weight:500;color:var(--text-2)">' + (issue.guest_name || '—') + '</td>' +
        '<td>' + catBadge(issue.category) + '</td>' +
        '<td><span class="truncate">' + issue.action_item + '</span></td>' +
        '<td>' + typeBadge(issue.task_type) + '</td>' +
        '<td style="text-align:center;font-size:13px;color:' + smsColor + '">' + (issue.sms_sent     ? '✓' : '—') + '</td>' +
        '<td style="text-align:center;font-size:13px;color:' + tskColor + '">' + (issue.task_created ? '✓' : '—') + '</td>' +
        '<td><button class="del-btn" data-id="' + issue.id + '">✕</button></td>' +
        '</tr>';
    });
    document.getElementById('tableContent').innerHTML =
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>Date (ET)</th><th>Property</th><th>Guest</th><th>Category</th><th>Action Item</th><th>Type</th>' +
      '<th style="text-align:center">SMS</th><th style="text-align:center">Task</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // Row + delete listeners
  document.querySelectorAll('tbody tr').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('del-btn')) return;
      openModal(parseInt(row.getAttribute('data-index')));
    });
  });
  document.querySelectorAll('.del-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { deleteIssue(btn.getAttribute('data-id'), e); });
  });

  // Destroy old charts
  Object.keys(charts).forEach(function(k) { charts[k].destroy(); });
  charts = {};

  // ── Category doughnut ─────────────────────────────────────────────────────
  var catLabels = Object.keys(m.byCategory);
  var catEl = document.getElementById('chartCategory');
  if (catLabels.length && catEl) {
    var catTotal = catLabels.reduce(function(s, l) { return s + m.byCategory[l]; }, 0);
    charts.category = new Chart(catEl, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{ data: catLabels.map(function(l) { return m.byCategory[l]; }), backgroundColor: catLabels.map(categoryColor), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } },
          tooltip: { callbacks: { label: function(ctx) {
            var count = ctx.raw;
            var pct = catTotal > 0 ? Math.round(count / catTotal * 100) : 0;
            return '  ' + ctx.label + ': ' + count + ' (' + pct + '%)';
          }}}
        }
      }
    });
  }

  // ── Property doughnut ─────────────────────────────────────────────────────
  var propLabels = Object.keys(m.byProperty);
  var propEl = document.getElementById('chartProperty');
  if (propLabels.length && propEl) {
    var propTotal = propLabels.reduce(function(s, l) { return s + m.byProperty[l]; }, 0);
    charts.property = new Chart(propEl, {
      type: 'doughnut',
      data: {
        labels: propLabels,
        datasets: [{ data: propLabels.map(function(l) { return m.byProperty[l]; }), backgroundColor: propLabels.map(function(l) { return l.toLowerCase().includes('delta') ? '#1179EB' : '#F38B2B'; }), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } },
          tooltip: { callbacks: { label: function(ctx) {
            var count = ctx.raw;
            var pct = propTotal > 0 ? Math.round(count / propTotal * 100) : 0;
            return '  ' + ctx.label + ': ' + count + ' (' + pct + '%)';
          }}}
        }
      }
    });
  }

  // ── Repeat issues ─────────────────────────────────────────────────────────
  renderRepeatIssues(issues);
}

// ── Repeat Issues ─────────────────────────────────────────────────────────────

function renderRepeatIssues(issues) {
  var card = document.getElementById('repeatIssuesCard');
  if (!card) return;

  var STOPWORDS = /\b(the|a|an|is|are|was|not|and|or|in|at|to|of|for|it|that|this|with|has|have|been|guest|said|says|asking|asked|please|would|could|can|need|needs|check|working|didnt|isnt|wont|doesnt|there|they|them|their|from|out|up|on|we|us|our|you|your|he|she|reported|flagged|noted|issue|issues|problem|problems|about|also|just|very|some|more|been|were|when|then|but|all|its)\b/gi;

  var OPERATIONAL = ['MAINTENANCE', 'SUPPLY', 'CLEANLINESS'];
  var operational = issues.filter(function(i) { return OPERATIONAL.includes(i.category); });

  if (!operational.length) {
    card.innerHTML =
      '<div style="display:flex;align-items:center;margin-bottom:12px;"><span class="clabel blue" style="margin-bottom:0;">Repeat Issues</span></div>' +
      '<div style="padding:28px 0;text-align:center;color:var(--text-3);font-size:12px;font-weight:500;">No operational issues in this time range</div>';
    return;
  }

  // Build keyword fingerprints
  var fingerprints = operational.map(function(issue) {
    var words = issue.action_item.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(STOPWORDS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(function(w) { return w.length > 3; });
    return { issue: issue, words: words };
  });

  // Cluster by shared keywords
  var clusters = [];
  var used = {};

  fingerprints.forEach(function(fp, i) {
    if (used[i]) return;
    var group = [fp.issue];
    used[i] = true;
    fingerprints.forEach(function(fp2, j) {
      if (used[j] || i === j) return;
      var shared = fp.words.filter(function(w) { return fp2.words.indexOf(w) !== -1; }).length;
      var denom = Math.max(fp.words.length, fp2.words.length, 1);
      if (shared >= 1 && (shared / denom) >= 0.2) {
        group.push(fp2.issue);
        used[j] = true;
      }
    });
    // Placeholder label — will be replaced by Claude summary
    clusters.push({ label: '…', count: group.length, issues: group, category: group[0].category });
  });

  clusters.sort(function(a, b) { return b.count - a.count; });

  // Show loading state while Claude summarizes
  renderRepeatRows(clusters, card);

  // Ask Claude (via server endpoint) to summarize each cluster
  var groups = clusters.slice(0, 10).map(function(c) {
    return c.issues.map(function(i) { return i.action_item; });
  });

  fetch('/api/summarize-issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups: groups })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var labels = data.labels || [];
    clusters.forEach(function(c, i) { if (labels[i]) c.label = labels[i]; });
    renderRepeatRows(clusters, card);
  })
  .catch(function() {
    // Fallback — use the raw action_item text trimmed
    clusters.forEach(function(c) {
      if (c.label === '…') {
        c.label = c.issues[0].action_item.slice(0, 55) + (c.issues[0].action_item.length > 55 ? '…' : '');
      }
    });
    renderRepeatRows(clusters, card);
  });
}

function renderRepeatRows(clusters, card) {
  var repeatCount = clusters.filter(function(c) { return c.count >= 2; }).length;
  var subtitle = repeatCount > 0
    ? '<span style="font-size:10px;color:var(--red);font-weight:600;margin-left:8px;">' + repeatCount + ' repeat' + (repeatCount > 1 ? 's' : '') + '</span>'
    : '<span style="font-size:10px;color:var(--text-3);font-weight:500;margin-left:8px;">No repeats yet</span>';

  var maxCount = clusters.length ? clusters[0].count : 1;

  var rows = clusters.slice(0, 10).map(function(c) {
    var dd = c.issues.filter(function(i) { return i.property_id === 'delta-dawn'; }).length;
    var lg = c.issues.filter(function(i) { return i.property_id === 'legobii'; }).length;
    var propBits = [];
    if (dd) propBits.push('<span class="tprop dd">DD' + (c.count > 1 ? ' ×' + dd : '') + '</span>');
    if (lg) propBits.push('<span class="tprop lg">LG' + (c.count > 1 ? ' ×' + lg : '') + '</span>');

    var barPct = Math.round(c.count / maxCount * 100);
    var countColor = c.count >= 2 ? 'var(--red)' : 'var(--text-3)';
    var countLabel = c.count >= 2 ? '×' + c.count + ' 🔁' : '×1';

    return '<div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.05);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<span style="font-size:12px;font-weight:500;color:var(--text);flex:1;padding-right:10px;line-height:1.4;">' + c.label + '</span>' +
        '<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">' +
          propBits.join('') +
          '<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:' + countColor + ';min-width:28px;text-align:right;">' + countLabel + '</span>' +
        '</div>' +
      '</div>' +
      (c.count >= 2 ?
        '<div style="background:var(--bg);border-radius:4px;height:3px;overflow:hidden;">' +
          '<div style="background:' + countColor + ';height:100%;width:' + barPct + '%;border-radius:4px;opacity:0.6;"></div>' +
        '</div>' : '') +
    '</div>';
  }).join('');

  card.innerHTML =
    '<div style="display:flex;align-items:center;margin-bottom:12px;">' +
      '<span class="clabel blue" style="margin-bottom:0;">Repeat Issues</span>' + subtitle +
    '</div>' + rows;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(index) {
  var issues = getFiltered();
  var issue = issues[index];
  if (!issue) return;

  document.getElementById('modalTitle').textContent = issue.action_item;

  var isDelta  = issue.property_id === 'delta-dawn';
  var propTag  = '<span class="tprop ' + (isDelta ? 'dd' : 'lg') + '">' + issue.property + '</span>';
  var taskLink = issue.asana_task_url
    ? '<a class="asana-link" href="' + issue.asana_task_url + '" target="_blank">View in Asana ↗</a>'
    : (issue.task_created ? '✓ Created' : '—');

  document.getElementById('modalBody').innerHTML =
    '<div class="reasoning-box">' + issue.claude_reasoning + '</div>' +
    detailRow('Date',        '<span style="font-family:DM Mono,monospace;font-size:12px">' + new Date(issue.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET</span>') +
    detailRow('Property',    propTag) +
    detailRow('Guest',       issue.guest_name || '—') +
    detailRow('Reservation', '<span style="font-family:DM Mono,monospace;font-size:12px;color:var(--text-3)">' + issue.reservation_id + '</span>') +
    detailRow('Category',    catBadge(issue.category)) +
    detailRow('Type',        typeBadge(issue.task_type)) +
    detailRow('SMS Sent',    issue.sms_sent ? '<span style="color:var(--green);font-weight:600">✓ Sent to ' + issue.notified_contact + '</span>' : '<span style="color:var(--text-3)">Not sent</span>') +
    detailRow('Asana Task',  taskLink) +
    detailRow('Conversation', issue.conversation_length + ' messages from Hospitable');

  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  buildTimeToggle();
  document.getElementById('filterProperty').addEventListener('change', render);
  document.getElementById('filterCategory').addEventListener('change', render);
  document.getElementById('filterType').addEventListener('change', render);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  loadData();
  setInterval(loadData, 60000);
});
