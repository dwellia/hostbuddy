var allIssues = [];
var charts = {};
var activeRange = 'all';

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

function loadData() {
  fetch('/api/issues')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      allIssues = data.issues || [];
      document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
      render();
    })
    .catch(function(err) {
      document.getElementById('statsGrid').innerHTML = '<div class="loading-state c12">Failed to load: ' + err.message + '</div>';
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

function getTimeRangeCutoff(range) {
  var now = new Date();
  if (range === '3mo') { var d = new Date(now); d.setMonth(d.getMonth() - 3); return d; }
  if (range === '6mo') { var d = new Date(now); d.setMonth(d.getMonth() - 6); return d; }
  if (range === 'ytd') { return new Date(now.getFullYear(), 0, 1); }
  // Year ranges e.g. "2025" or "2024"
  if (/^\d{4}$/.test(range)) {
    var yr = parseInt(range);
    return { start: new Date(yr, 0, 1), end: new Date(yr + 1, 0, 1) };
  }
  return null; // all time
}

function buildTimeToggle() {
  var thisYear = new Date().getFullYear();
  var yr1 = thisYear - 1; // e.g. 2025
  var yr2 = thisYear - 2; // e.g. 2024
  var buttons = [
    { range: '3mo',          label: '3 Mo' },
    { range: '6mo',          label: '6 Mo' },
    { range: 'ytd',          label: 'YTD' },
    { range: String(yr1),    label: String(yr1) },
    { range: String(yr2),    label: String(yr2) },
    { range: 'all',          label: 'All Time', active: true },
  ];
  var toggle = document.getElementById('timeToggle');
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

function getFiltered() {
  var prop = document.getElementById('filterProperty').value;
  var cat = document.getElementById('filterCategory').value;
  var type = document.getElementById('filterType').value;
  var cutoff = getTimeRangeCutoff(activeRange);
  return allIssues.filter(function(issue) {
    if (issue.category === 'RESERVATION CHANGES') return false;
    if (prop !== 'all' && issue.property_id !== prop) return false;
    if (cat !== 'all' && issue.category !== cat) return false;
    if (type !== 'all' && issue.task_type !== type) return false;
    if (cutoff) {
      var ts = new Date(issue.timestamp);
      if (cutoff.start) {
        // specific year range
        if (ts < cutoff.start || ts >= cutoff.end) return false;
      } else {
        // rolling window
        if (ts < cutoff) return false;
      }
    }
    return true;
  });
}

function buildMetrics(issues) {
  var total = issues.length;
  var urgent = issues.filter(function(i) { return i.task_type === 'urgent'; }).length;
  var nextClean = issues.filter(function(i) { return i.task_type === 'next_clean'; }).length;
  var smsSent = issues.filter(function(i) { return i.sms_sent; }).length;
  var tasksCreated = issues.filter(function(i) { return i.task_created; }).length;
  var byProperty = {}, byCategory = {}, byMonth = {};
  issues.forEach(function(i) {
    byProperty[i.property] = (byProperty[i.property] || 0) + 1;
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
    var m = i.timestamp.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  return { total: total, urgent: urgent, nextClean: nextClean, smsSent: smsSent, tasksCreated: tasksCreated, byProperty: byProperty, byCategory: byCategory, byMonth: byMonth };
}

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
  var colorMap = {
    'CLEANLINESS': 'blue', 'GUEST REQUESTS': 'orange',
    'MAINTENANCE': 'red', 'SUPPLY': 'teal', 'OTHER': 'gray'
  };
  var cls = colorMap[cat] || 'gray';
  return '<span class="badge ' + cls + '">' + cat + '</span>';
}

function render() {
  var issues = getFiltered();
  var m = buildMetrics(issues);

  // Stats
  document.getElementById('statsGrid').innerHTML =
    statCard('Total Issues',  m.total,       'All flagged action items', 'blue') +
    statCard('Urgent',        m.urgent,      'Visit requested',          'red') +
    statCard('Next Clean',    m.nextClean,   'Fix at turnover',          'green') +
    statCard('Tasks Created', m.tasksCreated,'In Asana',                 '');

  // Issue count label
  document.getElementById('issueCount').textContent = issues.length + ' issue' + (issues.length !== 1 ? 's' : '');

  // Table
  if (issues.length === 0) {
    document.getElementById('tableContent').innerHTML =
      '<div class="empty-state"><div class="icon">📋</div><p>No issues yet. They\'ll appear here once HostbuddyAI fires its first webhook.</p></div>';
  } else {
    var rows = '';
    issues.forEach(function(issue, i) {
      var isDelta = issue.property_id === 'delta-dawn';
      var propTag = '<span class="tprop ' + (isDelta ? 'dd' : 'lg') + '">' + (isDelta ? 'Delta Dawn' : 'LeGobi') + '</span>';
      rows += '<tr data-index="' + i + '" data-id="' + issue.id + '">' +
        '<td><span class="td-date">' + formatDate(issue.timestamp) + '</span></td>' +
        '<td>' + propTag + '</td>' +
        '<td style="font-size:12.5px;font-weight:500;color:var(--text-2)">' + (issue.guest_name || '—') + '</td>' +
        '<td>' + catBadge(issue.category) + '</td>' +
        '<td><span class="truncate">' + issue.action_item + '</span></td>' +
        '<td>' + typeBadge(issue.task_type) + '</td>' +
        '<td style="text-align:center;font-size:13px;color:' + (issue.sms_sent ? 'var(--green)' : 'var(--text-3)') + '">' + (issue.sms_sent ? '✓' : '—') + '</td>' +
        '<td style="text-align:center;font-size:13px;color:' + (issue.task_created ? 'var(--green)' : 'var(--text-3)') + '">' + (issue.task_created ? '✓' : '—') + '</td>' +
        '<td><button class="del-btn" data-id="' + issue.id + '">✕</button></td>' +
        '</tr>';
    });
    document.getElementById('tableContent').innerHTML =
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>Date (ET)</th><th>Property</th><th>Guest</th><th>Category</th><th>Action Item</th><th>Type</th><th style="text-align:center">SMS</th><th style="text-align:center">Task</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // Destroy old charts
  Object.keys(charts).forEach(function(k) { charts[k].destroy(); });
  charts = {};

  if (!issues.length) return;

  // Row clicks
  document.querySelectorAll('tbody tr').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('del-btn')) return;
      openModal(parseInt(row.getAttribute('data-index')));
    });
  });
  document.querySelectorAll('.del-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { deleteIssue(btn.getAttribute('data-id'), e); });
  });

  // Category chart
  var catLabels = Object.keys(m.byCategory);
  if (catLabels.length && document.getElementById('chartCategory')) {
    var catTotal = catLabels.reduce(function(s, l) { return s + m.byCategory[l]; }, 0);
    charts.category = new Chart(document.getElementById('chartCategory'), {
      type: 'doughnut',
      data: { labels: catLabels, datasets: [{ data: catLabels.map(function(l) { return m.byCategory[l]; }), backgroundColor: catLabels.map(categoryColor), borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } },
          tooltip: { callbacks: { label: function(ctx) {
            var count = ctx.parsed;
            var pct = Math.round(count / catTotal * 100);
            return ' ' + ctx.label + ': ' + count + ' (' + pct + '%)';
          }}}
        }
      }
    });
  }

  // Property chart
  var propLabels = Object.keys(m.byProperty);
  if (propLabels.length && document.getElementById('chartProperty')) {
    var propTotal = propLabels.reduce(function(s, l) { return s + m.byProperty[l]; }, 0);
    charts.property = new Chart(document.getElementById('chartProperty'), {
      type: 'doughnut',
      data: { labels: propLabels, datasets: [{ data: propLabels.map(function(l) { return m.byProperty[l]; }), backgroundColor: propLabels.map(function(l) { return l.toLowerCase().includes('delta') ? '#1179EB' : '#F38B2B'; }), borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } },
          tooltip: { callbacks: { label: function(ctx) {
            var count = ctx.parsed;
            var pct = Math.round(count / propTotal * 100);
            return ' ' + ctx.label + ': ' + count + ' (' + pct + '%)';
          }}}
        }
      }
    });
  }

  // Repeat issues card
  renderRepeatIssues(issues);
}

function statCard(label, value, sub, colorClass) {
  var valHtml = '<div class="cvalue ' + colorClass + '">' + value + '</div>';
  return '<div class="card c3"><div class="clabel">' + label + '</div>' + valHtml + '<div class="csub">' + sub + '</div></div>';
}

function renderRepeatIssues(issues) {
  var card = document.getElementById('repeatIssuesCard');
  if (!card) return;

  // Only look at maintenance + supply + cleanliness — operational issues
  var operational = issues.filter(function(i) {
    return ['MAINTENANCE', 'SUPPLY', 'CLEANLINESS'].includes(i.category);
  });

  if (!operational.length) {
    card.innerHTML = '<div class="clabel">Repeat Issues</div><div style="padding:24px 0;text-align:center;color:var(--text-3);font-size:12px;font-weight:500;">No repeat patterns yet</div>';
    return;
  }

  // Extract keywords from action_item text — strip common filler words
  var STOPWORDS = /\b(the|a|an|is|are|was|not|and|or|in|at|to|of|for|it|that|this|with|has|have|been|guest|said|says|asking|asked|please|would|could|can|need|needs|check|work|working|working|didn't|isn't|won't|doesn't|there|they|them|their|from|out|up|on|we|us|our|you|your|i|he|she|reported|report|flagged|noted|issue|issues|problem|problems)\b/gi;

  // Build keyword fingerprints per issue
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

  // Cluster by shared significant words
  var clusters = [];
  var used = new Set();

  fingerprints.forEach(function(fp, i) {
    if (used.has(i)) return;
    var group = [fp.issue];
    used.add(i);
    fingerprints.forEach(function(fp2, j) {
      if (used.has(j)) return;
      // Count shared keywords
      var shared = fp.words.filter(function(w) { return fp2.words.includes(w); }).length;
      var similarity = shared / Math.max(fp.words.length, fp2.words.length, 1);
      if (similarity >= 0.3 && shared >= 2) {
        group.push(fp2.issue);
        used.add(j);
      }
    });
    if (group.length >= 2) {
      // Best label: the shortest action_item in the group (most concise)
      var label = group.slice().sort(function(a, b) { return a.action_item.length - b.action_item.length; })[0].action_item;
      // Trim to 60 chars
      if (label.length > 60) label = label.slice(0, 57) + '…';
      clusters.push({ label: label, count: group.length, issues: group });
    }
  });

  // Sort by count descending
  clusters.sort(function(a, b) { return b.count - a.count; });

  if (!clusters.length) {
    card.innerHTML = '<div class="clabel">Repeat Issues</div><div style="padding:24px 0;text-align:center;color:var(--text-3);font-size:12px;font-weight:500;">No repeat patterns detected</div>';
    return;
  }

  var rows = clusters.slice(0, 8).map(function(c) {
    // Property breakdown
    var dd = c.issues.filter(function(i) { return i.property_id === 'delta-dawn'; }).length;
    var lg = c.issues.filter(function(i) { return i.property_id === 'legobii'; }).length;
    var propBits = [];
    if (dd) propBits.push('<span class="tprop dd">DD ×' + dd + '</span>');
    if (lg) propBits.push('<span class="tprop lg">LG ×' + lg + '</span>');

    // Bar fill %
    var maxCount = clusters[0].count;
    var barPct = Math.round(c.count / maxCount * 100);

    return '<div style="padding:9px 0;border-bottom:1px solid rgba(0,0,0,0.05);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">' +
        '<span style="font-size:12px;font-weight:500;color:var(--text);flex:1;padding-right:12px;">' + c.label + '</span>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
          propBits.join('') +
          '<span style="font-family:DM Mono,monospace;font-size:13px;font-weight:600;color:var(--blue);min-width:20px;text-align:right;">×' + c.count + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="background:var(--bg);border-radius:4px;height:4px;overflow:hidden;">' +
        '<div style="background:var(--blue);height:100%;width:' + barPct + '%;border-radius:4px;opacity:0.7;"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  card.innerHTML = '<div class="clabel">Repeat Issues</div>' + rows;
}

function openModal(index) {
  var issues = getFiltered();
  var issue = issues[index];
  if (!issue) return;

  document.getElementById('modalTitle').textContent = issue.action_item;

  var isDelta = issue.property_id === 'delta-dawn';
  var propTag = '<span class="tprop ' + (isDelta ? 'dd' : 'lg') + '">' + issue.property + '</span>';

  var taskLink = issue.asana_task_url
    ? '<a class="asana-link" href="' + issue.asana_task_url + '" target="_blank">View in Asana ↗</a>'
    : (issue.task_created ? '✓ Created' : '—');

  document.getElementById('modalBody').innerHTML =
    '<div class="reasoning-box">' + issue.claude_reasoning + '</div>' +
    detailRow('Date', '<span style="font-family:DM Mono,monospace;font-size:12px">' + new Date(issue.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET</span>') +
    detailRow('Property', propTag) +
    detailRow('Guest', issue.guest_name || '—') +
    detailRow('Reservation', '<span style="font-family:DM Mono,monospace;font-size:12px;color:var(--text-3)">' + issue.reservation_id + '</span>') +
    detailRow('Category', catBadge(issue.category)) +
    detailRow('Type', typeBadge(issue.task_type)) +
    detailRow('SMS Sent', issue.sms_sent ? '<span style="color:var(--green);font-weight:600">✓ Sent to ' + issue.notified_contact + '</span>' : '<span style="color:var(--text-3)">Not sent</span>') +
    detailRow('Asana Task', taskLink) +
    detailRow('Conversation', issue.conversation_length + ' messages from Hospitable');

  document.getElementById('modalOverlay').classList.add('open');
}

function detailRow(label, value) {
  return '<div class="detail-row"><span class="dlabel">' + label + '</span><span class="dval">' + value + '</span></div>';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

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
