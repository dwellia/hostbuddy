var allIssues = [];
var charts = {};

var CATEGORY_COLORS = {
  'CLEANLINESS': '#4caf7d',
  'GUEST REQUESTS': '#f5a623',
  'MAINTENANCE': '#e05c5c',
  'RESERVATION CHANGES': '#7b82a8',
  'SUPPLY': '#00bcd4',
  'OTHER': '#9c27b0'
};

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || '#7b82a8';
}

function loadData() {
  fetch('/api/issues')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      allIssues = data.issues || [];
      document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      render();
    })
    .catch(function(err) {
      document.getElementById('content').innerHTML = '<div class="loading">Failed to load data: ' + err.message + '</div>';
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function taskTypeBadge(type) {
  if (type === 'urgent') return '<span class="badge badge-urgent">Urgent</span>';
  if (type === 'next_clean') return '<span class="badge badge-nextclean">Next Clean</span>';
  return '<span class="badge badge-no">—</span>';
}

function render() {
  var issues = getFiltered();
  var m = buildMetrics(issues);

  var tableRows = '';
  issues.forEach(function(issue, i) {
    var propBadge = issue.property_id === 'delta-dawn' ? 'badge-dd' : 'badge-lg';
    var propLabel = issue.property_id === 'delta-dawn' ? 'Delta Dawn' : 'LeGobi';
    var smsColor = issue.sms_sent ? 'color:#4caf7d' : 'color:#7b82a8';
    var taskColor = issue.task_created ? 'color:#4caf7d' : 'color:#7b82a8';
    tableRows += '<tr data-index="' + i + '" data-id="' + issue.id + '">' +
      '<td style="white-space:nowrap;color:#7b82a8">' + formatDate(issue.timestamp) + '</td>' +
      '<td><span class="badge ' + propBadge + '">' + propLabel + '</span></td>' +
      '<td>' + (issue.guest_name || '—') + '</td>' +
      '<td><span class="badge badge-cat">' + issue.category + '</span></td>' +
      '<td><span class="truncate">' + issue.action_item + '</span></td>' +
      '<td>' + taskTypeBadge(issue.task_type) + '</td>' +
      '<td style="' + smsColor + '">' + (issue.sms_sent ? '✓' : '—') + '</td>' +
      '<td style="' + taskColor + '">' + (issue.task_created ? '✓' : '—') + '</td>' +
      '<td><button class="delete-btn" data-id="' + issue.id + '">&#x2715;</button></td>' +
      '</tr>';
  });

  var tableContent = issues.length === 0
    ? '<div class="empty"><div class="icon">📋</div><p>No issues yet.</p></div>'
    : '<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Property</th><th>Guest</th><th>Category</th><th>Action Item</th><th>Type</th><th>SMS</th><th>Task</th><th></th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';

  document.getElementById('content').innerHTML =
    '<div class="stats">' +
      '<div class="stat-card accent"><div class="label">Total Issues</div><div class="value">' + m.total + '</div><div class="sub">All flagged action items</div></div>' +
      '<div class="stat-card orange"><div class="label">Urgent</div><div class="value">' + m.urgent + '</div><div class="sub">Visit requested</div></div>' +
      '<div class="stat-card green"><div class="label">Next Clean</div><div class="value">' + m.nextClean + '</div><div class="sub">Fix at turnover</div></div>' +
      '<div class="stat-card"><div class="label">Tasks Created</div><div class="value">' + m.tasksCreated + '</div><div class="sub">In Asana</div></div>' +
    '</div>' +
    '<div class="charts">' +
      '<div class="chart-card"><h3>By Category</h3><div class="chart-wrap"><canvas id="chartCategory"></canvas></div></div>' +
      '<div class="chart-card"><h3>By Property</h3><div class="chart-wrap"><canvas id="chartProperty"></canvas></div></div>' +
      '<div class="chart-card"><h3>Issues Over Time</h3><div class="chart-wrap"><canvas id="chartTime"></canvas></div></div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-header"><h3>Issue Log</h3><span class="count">' + issues.length + ' issues</span></div>' +
      tableContent +
    '</div>';

  Object.keys(charts).forEach(function(k) { charts[k].destroy(); });
  charts = {};

  if (!issues.length) return;

  document.querySelectorAll('tbody tr').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('delete-btn')) return;
      openModal(parseInt(row.getAttribute('data-index')));
    });
  });

  document.querySelectorAll('.delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      deleteIssue(btn.getAttribute('data-id'), e);
    });
  });

  var catLabels = Object.keys(m.byCategory);
  charts.category = new Chart(document.getElementById('chartCategory'), {
    type: 'doughnut',
    data: { labels: catLabels, datasets: [{ data: catLabels.map(function(l) { return m.byCategory[l]; }), backgroundColor: catLabels.map(categoryColor), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#7b82a8', font: { size: 11 }, boxWidth: 10, padding: 8 } } } }
  });

  var propLabels = Object.keys(m.byProperty);
  charts.property = new Chart(document.getElementById('chartProperty'), {
    type: 'doughnut',
    data: { labels: propLabels, datasets: [{ data: propLabels.map(function(l) { return m.byProperty[l]; }), backgroundColor: propLabels.map(function(l) { return l.toLowerCase().includes('delta') ? 'rgba(76,175,125,0.8)' : 'rgba(245,166,35,0.8)'; }), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#7b82a8', font: { size: 11 }, boxWidth: 10, padding: 8 } } } }
  });

  var months = Object.keys(m.byMonth).sort();
  charts.time = new Chart(document.getElementById('chartTime'), {
    type: 'line',
    data: {
      labels: months.map(function(mo) { var p = mo.split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1).toLocaleString('default', { month: 'short', year: '2-digit' }); }),
      datasets: [{ data: months.map(function(mo) { return m.byMonth[mo]; }), borderColor: '#6c8ef5', backgroundColor: 'rgba(108,142,245,0.1)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#6c8ef5' }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { display: false } }, y: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { color: '#2e3352' } } } }
  });
}

function openModal(index) {
  var issues = getFiltered();
  var issue = issues[index];
  if (!issue) return;

  document.getElementById('modalTitle').textContent = issue.action_item;

  var taskLink = issue.asana_task_url
    ? '<a class="asana-link" href="' + issue.asana_task_url + '" target="_blank">View task &#x2197;</a>'
    : (issue.task_created ? '&#x2713; Created' : '&#x2014;');

  document.getElementById('modalBody').innerHTML =
    '<div class="reasoning-box">' + issue.claude_reasoning + '</div>' +
    '<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">' + new Date(issue.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Property</span><span class="detail-value"><span class="badge ' + (issue.property_id === 'delta-dawn' ? 'badge-dd' : 'badge-lg') + '">' + issue.property + '</span></span></div>' +
    '<div class="detail-row"><span class="detail-label">Guest</span><span class="detail-value">' + (issue.guest_name || '—') + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Reservation</span><span class="detail-value" style="color:#7b82a8;font-family:monospace">' + issue.reservation_id + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value"><span class="badge badge-cat">' + issue.category + '</span></span></div>' +
    '<div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">' + taskTypeBadge(issue.task_type) + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">SMS Sent</span><span class="detail-value" style="color:' + (issue.sms_sent ? '#4caf7d' : '#7b82a8') + '">' + (issue.sms_sent ? '&#x2713; Sent to ' + issue.notified_contact : 'Not sent') + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Asana Task</span><span class="detail-value">' + taskLink + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Conversation</span><span class="detail-value">' + issue.conversation_length + ' messages from Hospitable</span></div>';

  document.getElementById('modalOverlay').classList.add('open');
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
