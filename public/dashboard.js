var allIssues = [];
var charts = {};

var CATEGORY_COLORS = {
  'CLEANLINESS': '#6c8ef5',
  'GUEST REQUESTS': '#a78bfa',
  'MAINTENANCE': '#f5a623',
  'RESERVATION CHANGES': '#4caf7d',
  'SUPPLY': '#e05c5c',
  'OTHER': '#7b82a8'
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

function getFiltered() {
  var prop = document.getElementById('filterProperty').value;
  var cat = document.getElementById('filterCategory').value;
  var visit = document.getElementById('filterVisit').value;
  return allIssues.filter(function(issue) {
    if (prop !== 'all' && issue.property_id !== prop) return false;
    if (cat !== 'all' && issue.category !== cat) return false;
    if (visit === 'yes' && !issue.guest_requested_visit) return false;
    if (visit === 'no' && issue.guest_requested_visit) return false;
    return true;
  });
}

function buildMetrics(issues) {
  var total = issues.length;
  var visitReq = issues.filter(function(i) { return i.guest_requested_visit; }).length;
  var smsSent = issues.filter(function(i) { return i.sms_sent; }).length;
  var tasksCreated = issues.filter(function(i) { return i.task_created; }).length;
  var byProperty = {}, byCategory = {}, byMonth = {};
  issues.forEach(function(i) {
    byProperty[i.property] = (byProperty[i.property] || 0) + 1;
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
    var m = i.timestamp.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  return { total: total, visitReq: visitReq, smsSent: smsSent, tasksCreated: tasksCreated, byProperty: byProperty, byCategory: byCategory, byMonth: byMonth };
}

function formatDate(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function render() {
  var issues = getFiltered();
  var m = buildMetrics(issues);

  var tableRows = '';
  issues.forEach(function(issue, i) {
    var propBadge = issue.property_id === 'delta-dawn' ? 'badge-dd' : 'badge-lg';
    var propLabel = issue.property_id === 'delta-dawn' ? 'Delta Dawn' : 'LeGobi';
    var visitBadge = issue.guest_requested_visit ? 'badge-yes' : 'badge-no';
    var visitLabel = issue.guest_requested_visit ? 'Yes' : 'No';
    var smsColor = issue.sms_sent ? 'color:#4caf7d' : 'color:#7b82a8';
    var taskColor = issue.task_created ? 'color:#4caf7d' : 'color:#7b82a8';
    tableRows += '<tr data-index="' + i + '">' +
      '<td style="white-space:nowrap;color:#7b82a8">' + formatDate(issue.timestamp) + '</td>' +
      '<td><span class="badge ' + propBadge + '">' + propLabel + '</span></td>' +
      '<td>' + (issue.guest_name || '—') + '</td>' +
      '<td><span class="badge badge-cat">' + issue.category + '</span></td>' +
      '<td><span class="truncate">' + issue.action_item + '</span></td>' +
      '<td><span class="badge ' + visitBadge + '">' + visitLabel + '</span></td>' +
      '<td style="' + smsColor + '">' + (issue.sms_sent ? '✓' : '—') + '</td>' +
      '<td style="' + taskColor + '">' + (issue.task_created ? '✓' : '—') + '</td>' +
      '</tr>';
  });

  var tableContent = issues.length === 0
    ? '<div class="empty"><div class="icon">📋</div><p>No issues yet.</p></div>'
    : '<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Property</th><th>Guest</th><th>Category</th><th>Action Item</th><th>Visit?</th><th>SMS</th><th>Task</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';

  var pct = m.total ? Math.round(m.visitReq / m.total * 100) : 0;

  document.getElementById('content').innerHTML =
    '<div class="stats">' +
      '<div class="stat-card accent"><div class="label">Total Issues</div><div class="value">' + m.total + '</div><div class="sub">All flagged action items</div></div>' +
      '<div class="stat-card orange"><div class="label">Visit Requested</div><div class="value">' + m.visitReq + '</div><div class="sub">' + pct + '% of issues</div></div>' +
      '<div class="stat-card green"><div class="label">SMS Sent</div><div class="value">' + m.smsSent + '</div><div class="sub">Team notified</div></div>' +
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

  // Destroy old charts
  Object.keys(charts).forEach(function(k) { charts[k].destroy(); });
  charts = {};

  if (!issues.length) return;

  // Add row click listeners
  document.querySelectorAll('tbody tr').forEach(function(row) {
    row.addEventListener('click', function() {
      openModal(parseInt(row.getAttribute('data-index')));
    });
  });

  var catLabels = Object.keys(m.byCategory);
  charts.category = new Chart(document.getElementById('chartCategory'), {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{ data: catLabels.map(function(l) { return m.byCategory[l]; }), backgroundColor: catLabels.map(categoryColor), borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#7b82a8', font: { size: 11 }, boxWidth: 10, padding: 8 } } } }
  });

  var propLabels = Object.keys(m.byProperty);
  charts.property = new Chart(document.getElementById('chartProperty'), {
    type: 'bar',
    data: {
      labels: propLabels,
      datasets: [{ data: propLabels.map(function(l) { return m.byProperty[l]; }), backgroundColor: propLabels.map(function(l) { return l.toLowerCase().includes('delta') ? 'rgba(108,142,245,0.7)' : 'rgba(167,139,250,0.7)'; }), borderRadius: 6, borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { display: false } }, y: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { color: '#2e3352' } } } }
  });

  var months = Object.keys(m.byMonth).sort();
  charts.time = new Chart(document.getElementById('chartTime'), {
    type: 'line',
    data: {
      labels: months.map(function(mo) { var parts = mo.split('-'); return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1).toLocaleString('default', { month: 'short', year: '2-digit' }); }),
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
    '<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">' + new Date(issue.timestamp).toLocaleString() + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Property</span><span class="detail-value"><span class="badge ' + (issue.property_id === 'delta-dawn' ? 'badge-dd' : 'badge-lg') + '">' + issue.property + '</span></span></div>' +
    '<div class="detail-row"><span class="detail-label">Guest</span><span class="detail-value">' + (issue.guest_name || '—') + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Reservation ID</span><span class="detail-value" style="color:#7b82a8;font-family:monospace">' + issue.reservation_id + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value"><span class="badge badge-cat">' + issue.category + '</span></span></div>' +
    '<div class="detail-row"><span class="detail-label">Visit Requested</span><span class="detail-value"><span class="badge ' + (issue.guest_requested_visit ? 'badge-yes' : 'badge-no') + '">' + (issue.guest_requested_visit ? 'Yes' : 'No') + '</span></span></div>' +
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
  document.getElementById('filterVisit').addEventListener('change', render);

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });

  loadData();
  setInterval(loadData, 60000);
});
