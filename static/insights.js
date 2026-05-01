// Behavioral Insights Dashboard - Live Data & Charts

let insightsData = null;

/* ------------------------------------------------------------
   PULSE HEADER RENDERING
   ------------------------------------------------------------ */
function renderPulseHeader() {
    if (!insightsData || !insightsData.pulse) return;
    const { attendancePercent, starAveragePercent, currentState } = insightsData.pulse;
    const attendanceEl = document.getElementById('pulse-attendance-value');
    const starEl = document.getElementById('pulse-star-value');
    const stateChip = document.getElementById('pulse-state-chip');
    const stateLabel = document.getElementById('pulse-state-label');
    const stateDescription = document.getElementById('pulse-state-description');

    if (attendanceEl) attendanceEl.textContent = `${attendancePercent}%`;
    if (starEl) starEl.textContent = `${starAveragePercent}%`;

    let normalized = (currentState || '').toLowerCase();
    let description = '';
    let chipClass = '';
    let label = currentState;

    if (normalized === 'growth') {
        chipClass = '';
        description = 'STAR scores are climbing while incident volume is stable or falling.';
        label = 'Growth';
    } else if (normalized === 'stagnation') {
        chipClass = 'stagnation';
        description = 'STAR and incident patterns are holding steady. Consider light adjustments or supports.';
        label = 'Stagnation';
    } else {
        chipClass = 'needs-support';
        description = 'STAR scores are softening while incident volume is rising. This is a key window for support.';
        label = 'Needs Support';
    }

    if (stateChip) {
        stateChip.classList.remove('needs-support', 'stagnation');
        if (chipClass) stateChip.classList.add(chipClass);
    }
    if (stateLabel) stateLabel.textContent = label;
    if (stateDescription) stateDescription.textContent = description;
}

/* ------------------------------------------------------------
   HEATMAP RENDERING & TOOLTIP
   ------------------------------------------------------------ */
function densityForCount(count) {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    return 4;
}

function renderHeatmap() {
    const container = document.getElementById('behavior-heatmap');
    if (!container) return;

    if (!insightsData || !insightsData.heatmap) return;
    const { days, timeBlocks, cells } = insightsData.heatmap;

    const inner = document.createElement('div');
    inner.className = 'heatmap-grid-inner';

    // Top-left blank
    const corner = document.createElement('div');
    corner.className = 'heatmap-header-cell';
    inner.appendChild(corner);

    // Time headers
    timeBlocks.forEach((block) => {
        const th = document.createElement('div');
        th.className = 'heatmap-header-cell';
        th.textContent = block;
        inner.appendChild(th);
    });

    days.forEach((day, rowIdx) => {
        const label = document.createElement('div');
        label.className = 'heatmap-row-label';
        label.textContent = day;
        inner.appendChild(label);

        timeBlocks.forEach((block, colIdx) => {
            const cellData = (cells[rowIdx] && cells[rowIdx][colIdx]) || {
                count: 0,
                infractions: [],
                resets: 0,
                frenzies: 0,
            };

            const cell = document.createElement('div');
            const density = densityForCount(cellData.count + cellData.resets + cellData.frenzies * 2);
            cell.className = 'heatmap-cell';
            cell.dataset.day = day;
            cell.dataset.block = block;
            cell.dataset.count = String(cellData.count ?? 0);
            cell.dataset.resets = String(cellData.resets ?? 0);
            cell.dataset.frenzies = String(cellData.frenzies ?? 0);
            cell.dataset.infractions = (cellData.infractions || []).join(', ');
            cell.dataset.density = String(density);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'heatmap-cell-label';
            labelSpan.textContent = density === 0 ? 'Calm' : 'Active';

            const countSpan = document.createElement('span');
            countSpan.className = 'heatmap-cell-count';
            const incidentTotal = cellData.count + cellData.resets + cellData.frenzies;
            countSpan.textContent =
                incidentTotal === 1 ? '1 event' : `${incidentTotal} events`;

            cell.appendChild(labelSpan);
            cell.appendChild(countSpan);

            inner.appendChild(cell);
        });
    });

    container.innerHTML = '';
    container.appendChild(inner);
}

function attachHeatmapTooltip() {
    const tooltip = document.getElementById('heatmap-tooltip');
    const container = document.getElementById('behavior-heatmap');
    if (!tooltip || !container) return;

    function showTooltip(evt, cell) {
        const rect = cell.getBoundingClientRect();
        const day = cell.dataset.day;
        const block = cell.dataset.block;
        const count = parseInt(cell.dataset.count || '0', 10);
        const resets = parseInt(cell.dataset.resets || '0', 10);
        const frenzies = parseInt(cell.dataset.frenzies || '0', 10);
        const infractionsStr = cell.dataset.infractions || '';
        const infractions = infractionsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        let html = `<h4>${day} · ${block}</h4>`;
        html += '<ul>';
        html += `<li><strong>Infractions:</strong> ${count || 0}</li>`;
        html += `<li><strong>Resets:</strong> ${resets}</li>`;
        html += `<li><strong>Frenzies:</strong> ${frenzies}</li>`;
        if (infractions.length) {
            html += `<li><strong>Behaviors:</strong> ${infractions.join(', ')}</li>`;
        } else {
            html += '<li><strong>Behaviors:</strong> No clustered behaviors recorded.</li>';
        }
        html += '</ul>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');

        const top = rect.top + window.scrollY - tooltip.offsetHeight - 8;
        const left = rect.left + window.scrollX + rect.width / 2 - tooltip.offsetWidth / 2;
        tooltip.style.top = `${Math.max(12, top)}px`;
        tooltip.style.left = `${Math.max(8, left)}px`;
    }

    function hideTooltip() {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
    }

    container.addEventListener('mouseover', (evt) => {
        const cell = evt.target.closest('.heatmap-cell');
        if (!cell) {
            hideTooltip();
            return;
        }
        showTooltip(evt, cell);
    });

    container.addEventListener('mousemove', (evt) => {
        const cell = evt.target.closest('.heatmap-cell');
        if (!cell || !tooltip.classList.contains('visible')) return;
        const rect = cell.getBoundingClientRect();
        const top = rect.top + window.scrollY - tooltip.offsetHeight - 8;
        const left = rect.left + window.scrollX + rect.width / 2 - tooltip.offsetWidth / 2;
        tooltip.style.top = `${Math.max(12, top)}px`;
        tooltip.style.left = `${Math.max(8, left)}px`;
    });

    container.addEventListener('mouseleave', hideTooltip);
}

/* ------------------------------------------------------------
   CHART HELPERS
   ------------------------------------------------------------ */
function baseChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: { size: 11, family: "'Inter', system-ui, sans-serif" },
                    color: '#374151',
                    usePointStyle: true,
                    padding: 12,
                },
            },
            tooltip: {
                backgroundColor: '#0f172a',
                titleFont: { size: 11, family: "'Inter', system-ui, sans-serif" },
                bodyFont: { size: 11, family: "'Inter', system-ui, sans-serif" },
                padding: 8,
                cornerRadius: 8,
            },
            datalabels: {
                color: '#111827',
                font: { size: 9, weight: '600', family: "'Inter', system-ui, sans-serif" },
                padding: 4,
                borderRadius: 6,
                backgroundColor: 'rgba(255,255,255,0.8)',
                formatter: (value) => (typeof value === 'number' ? value : ''),
            },
        },
    };
}

/* ------------------------------------------------------------
   RESPONSE ESCALATION (STEPPED LINE / STACKED AREA)
   ------------------------------------------------------------ */
function initResponseEscalationChart() {
    const ctx = document.getElementById('responseEscalationChart');
    if (!ctx || !window.Chart) return;

    if (!insightsData || !insightsData.escalation) return;
    const { labels, reminders, resets, frenzies } = insightsData.escalation;
    const options = baseChartOptions();
    options.scales = {
        x: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
        },
        y: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.25)' },
            ticks: { stepSize: 1, font: { size: 10 } },
            title: { display: true, text: 'Count', font: { size: 10 } },
        },
    };
    options.plugins.datalabels.anchor = 'end';
    options.plugins.datalabels.align = 'top';

    new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Reminders',
                    data: reminders,
                    borderColor: '#4FB6B0',
                    backgroundColor: 'rgba(79, 182, 176, 0.25)',
                    fill: true,
                    tension: 0.2,
                    stepped: 'before',
                },
                {
                    label: 'Resets',
                    data: resets,
                    borderColor: '#F59E0B',
                    backgroundColor: 'rgba(245, 158, 11, 0.3)',
                    fill: true,
                    tension: 0.2,
                    stepped: 'before',
                },
                {
                    label: 'Frenzies',
                    data: frenzies,
                    borderColor: '#FB6F5A',
                    backgroundColor: 'rgba(251, 111, 90, 0.28)',
                    fill: true,
                    tension: 0.2,
                    stepped: 'before',
                },
            ],
        },
        options,
    });
}

/* ------------------------------------------------------------
   INFRACTION CATEGORY BREAKDOWN (DOUGHNUT)
   ------------------------------------------------------------ */
function initInfractionCategoryChart() {
    const ctx = document.getElementById('infractionCategoryChart');
    if (!ctx || !window.Chart) return;

    if (!insightsData || !insightsData.infractionCategories) return;
    const { labels, values } = insightsData.infractionCategories;
    const options = baseChartOptions();
    options.plugins.datalabels.formatter = (value, ctx) => {
        const total = ctx.chart._metasets[0].total || values.reduce((a, b) => a + b, 0);
        const pct = total ? Math.round((value / total) * 100) : 0;
        return `${pct}%`;
    };

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [
                {
                    data: values,
                    backgroundColor: ['#FB6F5A', '#F59E0B', '#4FB6B0', '#8CB79A'],
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 4,
                },
            ],
        },
        options: {
            ...options,
            cutout: '58%',
        },
    });
}

/* ------------------------------------------------------------
   STAR PERFORMANCE RADAR
   ------------------------------------------------------------ */
function initStarRadarChart() {
    const ctx = document.getElementById('starRadarChart');
    if (!ctx || !window.Chart) return;

    if (!insightsData || !insightsData.starRadar) return;
    const { labels, currentMonth, previousMonth } = insightsData.starRadar;
    const options = baseChartOptions();
    options.scales = {
        r: {
            beginAtZero: true,
            min: 0,
            max: 4,
            ticks: {
                stepSize: 1,
                display: false,
            },
            grid: { color: 'rgba(148, 163, 184, 0.25)' },
            angleLines: { color: 'rgba(148, 163, 184, 0.3)' },
            pointLabels: {
                font: { size: 11, family: "'Inter', system-ui, sans-serif" },
                color: '#374151',
            },
        },
    };
    options.plugins.datalabels.anchor = 'end';
    options.plugins.datalabels.align = 'end';
    options.plugins.datalabels.formatter = (v) => v.toFixed(1);

    new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Current Month',
                    data: currentMonth,
                    borderColor: '#4FB6B0',
                    backgroundColor: 'rgba(79, 182, 176, 0.25)',
                    pointBackgroundColor: '#4FB6B0',
                },
                {
                    label: 'Previous Month',
                    data: previousMonth,
                    borderColor: '#CBD5F5',
                    backgroundColor: 'rgba(148, 163, 184, 0.25)',
                    pointBackgroundColor: '#9CA3AF',
                },
            ],
        },
        options,
    });
}

/* ------------------------------------------------------------
   GROWTH & STAGNATION TIMELINE (DUAL AXIS)
   ------------------------------------------------------------ */
function initGrowthTimelineChart() {
    const ctx = document.getElementById('growthTimelineChart');
    if (!ctx || !window.Chart) return;

    if (!insightsData || !insightsData.growthTimeline) return;
    const { labels, starPercent, totalIncidents } = insightsData.growthTimeline;
    const options = baseChartOptions();
    options.scales = {
        x: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
        },
        yStar: {
            position: 'left',
            beginAtZero: false,
            min: 0,
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
            ticks: { stepSize: 10, font: { size: 10 } },
            title: { display: true, text: 'STAR %', font: { size: 10 } },
        },
        yIncidents: {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 5, font: { size: 10 } },
            title: { display: true, text: 'Incidents', font: { size: 10 } },
        },
    };
    options.plugins.datalabels.anchor = 'end';
    options.plugins.datalabels.align = 'top';

    new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'STAR %',
                    data: starPercent,
                    yAxisID: 'yStar',
                    borderColor: '#4FB6B0',
                    backgroundColor: 'rgba(79, 182, 176, 0.18)',
                    fill: false,
                    tension: 0.15,
                },
                {
                    label: 'Total Incidents',
                    data: totalIncidents,
                    yAxisID: 'yIncidents',
                    borderColor: '#FB6F5A',
                    backgroundColor: 'rgba(251, 111, 90, 0.22)',
                    fill: true,
                    tension: 0.25,
                },
            ],
        },
        options,
    });
}

/* ------------------------------------------------------------
   INITIALIZATION
   ------------------------------------------------------------ */
async function initInsightsDashboard() {
    try {
        const ctx = window.insightsContext || {};
        const params = [];
        if (ctx.studentId) params.push(`student_id=${encodeURIComponent(ctx.studentId)}`);
        if (ctx.staffId) params.push(`staff_id=${encodeURIComponent(ctx.staffId)}`);
        if (ctx.managedByMe) params.push('managed_by_me=true');
        const qs = params.length ? `?${params.join('&')}` : '';
        const resp = await fetch(`/api/insights${qs}`);
        const data = await resp.json();
        insightsData = data || null;
    } catch (err) {
        console.error('Error loading insights data:', err);
        insightsData = null;
    }

    renderPulseHeader();
    renderHeatmap();
    attachHeatmapTooltip();
    initResponseEscalationChart();
    initInfractionCategoryChart();
    initStarRadarChart();
    initGrowthTimelineChart();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInsightsDashboard);
} else {
    initInsightsDashboard();
}

