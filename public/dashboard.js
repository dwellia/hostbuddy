var allIssues = [];
var charts = {};

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

function getFiltered() {
  var prop = document.getElementById('filterProperty').value;
  var cat = document.getElementById('filterCategory').value;
  var type = document.getElementById('filterType').value;
  return allIssues.filter(function(issue) {
    if (prop !== 'all' && issue.property_id !== prop) return false;
    if (cat !== 'all' && issue.category !== cat) return false;
    if (type !== 'all' && issue.task_type !== type) return false;
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
    charts.category = new Chart(document.getElementById('chartCategory'), {
      type: 'doughnut',
      data: { labels: catLabels, datasets: [{ data: catLabels.map(function(l) { return m.byCategory[l]; }), backgroundColor: catLabels.map(categoryColor), borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } } }, cutout: '62%' }
    });
  }

  // Property chart
  var propLabels = Object.keys(m.byProperty);
  if (propLabels.length && document.getElementById('chartProperty')) {
    charts.property = new Chart(document.getElementById('chartProperty'), {
      type: 'doughnut',
      data: { labels: propLabels, datasets: [{ data: propLabels.map(function(l) { return m.byProperty[l]; }), backgroundColor: propLabels.map(function(l) { return l.toLowerCase().includes('delta') ? '#1179EB' : '#F38B2B'; }), borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, boxWidth: 9, padding: 8 } } }, cutout: '62%' }
    });
  }

  // Time chart
  var months = Object.keys(m.byMonth).sort();
  if (months.length && document.getElementById('chartTime')) {
    charts.time = new Chart(document.getElementById('chartTime'), {
      type: 'line',
      data: {
        labels: months.map(function(mo) { var p = mo.split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1).toLocaleString('default', { month: 'short', year: '2-digit' }); }),
        datasets: [{ data: months.map(function(mo) { return m.byMonth[mo]; }), borderColor: '#1179EB', backgroundColor: 'rgba(17,121,235,0.08)', fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#1179EB', pointBorderColor: '#fff', pointBorderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' } }, grid: { display: false }, border: { display: false } },
          y: { ticks: { color: '#9ca3af', font: { size: 10, family: 'DM Sans' }, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' }, border: { display: false } }
        }
      }
    });
  }
}

function statCard(label, value, sub, colorClass) {
  var valHtml = '<div class="cvalue ' + colorClass + '">' + value + '</div>';
  return '<div class="card c3"><div class="clabel">' + label + '</div>' + valHtml + '<div class="csub">' + sub + '</div></div>';
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
