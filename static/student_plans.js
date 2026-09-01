/**
 * Student If/Then Plans — modal editor, entry-tab stars/menus, delivery history, overview helpers.
 * Swap PLAN_MET_ICON_SRC to change the threshold-met icon above student names.
 */
(function (global) {
    'use strict';

    /** Single place to swap the met-threshold icon. */
    const PLAN_MET_ICON_SRC = '/static/icons/plan-met.svg';

    const THRESHOLD_TYPE_OPTIONS = [
        { value: 'by_time', label: 'By a certain time of day' },
        { value: 'dow_range', label: '% from day-of-week to day-of-week' },
        { value: 'consecutive_days', label: 'Consecutive school days' },
        { value: 'days_in_window', label: 'Days in a window' },
        { value: 'specific_period', label: 'Specific period / class today' },
        { value: 'end_of_day', label: 'End of day (full day %)' },
        { value: 'weekly_average', label: 'Weekly average (Mon–Fri)' },
        { value: 'category_specific', label: 'Single STAR category (end of day)' },
    ];

    const DOW_OPTIONS = [
        { value: 'monday', label: 'Monday' },
        { value: 'tuesday', label: 'Tuesday' },
        { value: 'wednesday', label: 'Wednesday' },
        { value: 'thursday', label: 'Thursday' },
        { value: 'friday', label: 'Friday' },
        { value: 'saturday', label: 'Saturday' },
        { value: 'sunday', label: 'Sunday' },
    ];

    let planModalState = {
        studentId: null,
        studentName: '',
        readOnly: false,
        rows: [],
    };

    let activeMetsByStudent = {}; // studentId -> mets[]
    let openKebabMenu = null;

    function canEditPlans() {
        return typeof isStaff === 'function' && (isStaff() || (typeof isAdmin === 'function' && isAdmin()));
    }

    function loggedInStudentId() {
        if (typeof getLoggedInStudentId === 'function') return getLoggedInStudentId();
        const id = global.currentUser && global.currentUser.studentId;
        return id != null ? id : null;
    }

    function canViewStudentPlan(studentId) {
        if (canEditPlans()) return true;
        if (typeof isStudent === 'function' && isStudent()) {
            return Number(loggedInStudentId()) === Number(studentId);
        }
        return false;
    }

    function escapeHtml(str) {
        if (global.escapeHtml) return global.escapeHtml(String(str ?? ''));
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function emptyRow() {
        return {
            if_text: '',
            then_text: '',
            has_threshold: false,
            threshold_percent: '',
            threshold_type: 'end_of_day',
            cutoff_time: '14:30',
            dow_start: 'monday',
            dow_end: 'friday',
            consecutive_n: 3,
            days_needed: 4,
            window_days: 5,
            period_time_range: '',
            period_location: '',
            star_category: 's',
        };
    }

    async function fetchPlan(studentId) {
        const res = await fetch(`/api/students/${studentId}/plan`);
        if (!res.ok) throw new Error('Failed to load plan');
        return res.json();
    }

    async function savePlan(studentId, rows) {
        const res = await fetch(`/api/students/${studentId}/plan`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to save plan');
        return data;
    }

    async function searchIfLibrary(q) {
        const res = await fetch(`/api/plan-if-library?q=${encodeURIComponent(q || '')}`);
        if (!res.ok) return [];
        return res.json();
    }

    async function refreshActiveMets(studentIds, dateStr) {
        if (!canEditPlans()) return;
        const ids = (studentIds || []).filter(Boolean);
        const dateParam = dateStr || (typeof currentDate !== 'undefined' ? currentDate : null);
        await Promise.all(ids.map(async (sid) => {
            try {
                let url = `/api/students/${sid}/plan/active-mets`;
                if (dateParam) url += `?date=${encodeURIComponent(dateParam)}`;
                const res = await fetch(url);
                if (!res.ok) return;
                const data = await res.json();
                activeMetsByStudent[sid] = data.active_mets || [];
            } catch (e) {
                console.warn('active-mets failed', sid, e);
            }
        }));
        document.querySelectorAll('.plan-met-icons[data-student-id]').forEach((el) => {
            const sid = parseInt(el.dataset.studentId, 10);
            renderMetIconsInto(el, sid);
        });
    }

    function renderMetIconsInto(container, studentId) {
        const mets = activeMetsByStudent[studentId] || [];
        container.innerHTML = '';
        mets.forEach((met) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'plan-met-icon-btn';
            btn.title = 'Plan reward available — click to view';
            btn.dataset.eventId = String(met.event_id);
            btn.innerHTML = `<img src="${PLAN_MET_ICON_SRC}" alt="" class="plan-met-icon-img" width="18" height="18">`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showMetRewardPopover(btn, met);
            });
            container.appendChild(btn);
        });
    }

    function closeMetPopover() {
        const existing = document.getElementById('plan-met-popover');
        if (existing) existing.remove();
    }

    function showMetRewardPopover(anchorBtn, met) {
        closeMetPopover();
        closeKebabMenus();
        const pop = document.createElement('div');
        pop.id = 'plan-met-popover';
        pop.className = 'plan-met-popover';
        pop.innerHTML = `
            <div class="plan-met-popover-title">Reward earned</div>
            <div class="plan-met-popover-if"><strong>If:</strong> ${escapeHtml(met.if_text || '')}</div>
            <div class="plan-met-popover-then"><strong>Then:</strong> ${escapeHtml(met.then_text || '')}</div>
            <div class="plan-met-popover-actions">
                <button type="button" class="btn-primary plan-deliver-btn" style="padding:6px 12px;font-size:12px;">Mark delivered</button>
                <button type="button" class="btn-secondary plan-popover-close" style="padding:6px 12px;font-size:12px;">Close</button>
            </div>
        `;
        document.body.appendChild(pop);
        const rect = anchorBtn.getBoundingClientRect();
        pop.style.top = `${rect.bottom + 6 + window.scrollY}px`;
        pop.style.left = `${Math.max(8, rect.left + window.scrollX - 40)}px`;

        pop.querySelector('.plan-popover-close').addEventListener('click', closeMetPopover);
        pop.querySelector('.plan-deliver-btn').addEventListener('click', async () => {
            try {
                const res = await fetch(`/api/plan-threshold-events/${met.event_id}/deliver`, { method: 'POST' });
                if (!res.ok) throw new Error('Deliver failed');
                closeMetPopover();
                if (typeof showMessage === 'function') showMessage('Reward marked delivered.', 'success');
                const sid = met.student_id || (anchorBtn.closest('[data-student-id]') || {}).dataset?.studentId;
                // Refresh mets for visible students
                const ids = Object.keys(activeMetsByStudent).map(Number);
                if (sid) ids.push(parseInt(sid, 10));
                await refreshActiveMets([...new Set(ids)]);
            } catch (e) {
                alert('Could not mark delivered. Please try again.');
            }
        });
    }

    function closeKebabMenus() {
        document.querySelectorAll('.plan-kebab-menu.open').forEach((m) => m.classList.remove('open'));
        openKebabMenu = null;
    }

    function bindPointCardGridScrollHandlers() {
        if (window.__planGridScrollKebabBound) return;
        window.__planGridScrollKebabBound = true;
        document.querySelectorAll('#daily-grid, #students-grid').forEach((grid) => {
            grid.addEventListener('scroll', closeKebabMenus, { passive: true });
        });
    }

    function buildStudentHeaderPlanControls(student) {
        const wrap = document.createElement('div');
        wrap.className = 'plan-header-controls';
        wrap.dataset.studentId = String(student.id);

        const icons = document.createElement('div');
        icons.className = 'plan-met-icons';
        icons.dataset.studentId = String(student.id);
        renderMetIconsInto(icons, student.id);
        wrap.appendChild(icons);

        const kebabWrap = document.createElement('div');
        kebabWrap.className = 'plan-kebab-wrap';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'plan-kebab-btn';
        btn.setAttribute('aria-label', 'Student card menu');
        btn.textContent = '⋮';
        const menu = document.createElement('div');
        menu.className = 'plan-kebab-menu';
        const menuItems = ['<button type="button" data-action="past-cards">View past point cards</button>'];
        if (canEditPlans()) {
            menuItems.push(
                '<button type="button" data-action="edit">Attach / Edit plan</button>',
                '<button type="button" data-action="show">Show plan</button>',
                '<button type="button" data-action="history">Delivery history</button>'
            );
        } else if (canViewStudentPlan(student.id)) {
            menuItems.push('<button type="button" data-action="show">Show If/Then plan</button>');
        }
        menu.innerHTML = menuItems.join('');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = menu.classList.contains('open');
            closeKebabMenus();
            if (!wasOpen) {
                menu.classList.add('open');
                openKebabMenu = menu;
            }
        });
        menu.addEventListener('click', (e) => {
            const action = e.target && e.target.dataset && e.target.dataset.action;
            if (!action) return;
            e.stopPropagation();
            closeKebabMenus();
            if (action === 'past-cards') {
                if (typeof global.openPastPointCardsModal === 'function') {
                    global.openPastPointCardsModal(student.id, student.name);
                }
            } else if (action === 'edit') openPlanModal(student.id, student.name, false);
            else if (action === 'show') openPlanModal(student.id, student.name, true);
            else if (action === 'history') openDeliveryHistoryModal(student.id, student.name);
        });
        kebabWrap.appendChild(btn);
        kebabWrap.appendChild(menu);
        wrap.appendChild(kebabWrap);
        return wrap;
    }

    function thresholdFieldsHtml(row, idx, readOnly) {
        const dis = readOnly ? 'disabled' : '';
        const typeOpts = THRESHOLD_TYPE_OPTIONS.map(
            (o) => `<option value="${o.value}" ${row.threshold_type === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
        ).join('');
        const dowOpts = (selected) =>
            DOW_OPTIONS.map(
                (o) => `<option value="${o.value}" ${selected === o.value ? 'selected' : ''}>${o.label}</option>`
            ).join('');
        const cat = row.star_category || 's';
        return `
            <div class="plan-threshold-block" data-row-index="${idx}" style="${row.has_threshold ? '' : 'display:none;'}">
                <div class="plan-threshold-grid">
                    <label>% threshold
                        <input type="number" min="0" max="100" step="1" class="plan-thr-percent" value="${escapeHtml(row.threshold_percent ?? '')}" ${dis}>
                    </label>
                    <label>Schedule type
                        <select class="plan-thr-type" ${dis}>${typeOpts}</select>
                    </label>
                    <label class="plan-thr-field plan-thr-by_time">Cutoff time
                        <input type="time" class="plan-thr-cutoff" value="${escapeHtml(row.cutoff_time || '14:30')}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-dow_range">From day
                        <select class="plan-thr-dow-start" ${dis}>${dowOpts(row.dow_start || 'monday')}</select>
                    </label>
                    <label class="plan-thr-field plan-thr-dow_range">To day
                        <select class="plan-thr-dow-end" ${dis}>${dowOpts(row.dow_end || 'friday')}</select>
                    </label>
                    <label class="plan-thr-field plan-thr-consecutive_days">Consecutive days
                        <input type="number" min="1" class="plan-thr-consecutive" value="${escapeHtml(row.consecutive_n ?? 3)}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-days_in_window">Days needed
                        <input type="number" min="1" class="plan-thr-days-needed" value="${escapeHtml(row.days_needed ?? 4)}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-days_in_window">Window (days)
                        <input type="number" min="1" class="plan-thr-window-days" value="${escapeHtml(row.window_days ?? 5)}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-specific_period">Period time (e.g. 7:45-8:30)
                        <input type="text" class="plan-thr-period-time" value="${escapeHtml(row.period_time_range || '')}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-specific_period">Class / location
                        <input type="text" class="plan-thr-period-loc" value="${escapeHtml(row.period_location || '')}" ${dis}>
                    </label>
                    <label class="plan-thr-field plan-thr-category_specific plan-thr-star-cat">STAR category
                        <select class="plan-thr-category" ${dis}>
                            <option value="s" ${cat === 's' || cat === 'safety' ? 'selected' : ''}>Safety (S)</option>
                            <option value="t" ${cat === 't' || cat === 'teamwork' ? 'selected' : ''}>Teamwork (T)</option>
                            <option value="a" ${cat === 'a' || cat === 'accountability' ? 'selected' : ''}>Accountability (A)</option>
                            <option value="r" ${cat === 'r' || cat === 'relationships' ? 'selected' : ''}>Relationships (R)</option>
                        </select>
                    </label>
                </div>
            </div>
        `;
    }

    function updateThresholdFieldVisibility(rowEl) {
        const typeSelect = rowEl.querySelector('.plan-thr-type');
        if (!typeSelect) return;
        const t = typeSelect.value;
        rowEl.querySelectorAll('.plan-thr-field').forEach((el) => {
            const show =
                el.classList.contains(`plan-thr-${t}`) ||
                (t === 'category_specific' && el.classList.contains('plan-thr-star-cat'));
            el.style.display = show ? '' : 'none';
        });
    }

    function renderPlanRows() {
        const tbody = document.getElementById('plan-rows-body');
        if (!tbody) return;
        const readOnly = planModalState.readOnly;
        const studentView = readOnly && !canEditPlans();
        tbody.innerHTML = '';
        if (!planModalState.rows.length) {
            tbody.innerHTML = '<tr><td colspan="3"><p class="info-message" style="margin:12px 0;">No If / Then plan has been set yet.</p></td></tr>';
            return;
        }
        planModalState.rows.forEach((row, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'plan-row';
            tr.dataset.rowIndex = String(idx);
            const thresholdUi = studentView
                ? ''
                : `<label class="plan-threshold-toggle" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;">
                        <input type="checkbox" class="plan-has-threshold" ${row.has_threshold ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
                        Add point-card % threshold
                    </label>
                    ${thresholdFieldsHtml(row, idx, readOnly)}`;
            tr.innerHTML = `
                <td class="plan-if-cell">
                    <div class="plan-if-autocomplete-wrap">
                        <textarea class="plan-if-input" rows="2" ${readOnly ? 'readonly' : ''} placeholder="If…">${escapeHtml(row.if_text || '')}</textarea>
                        <div class="plan-if-dropdown" style="display:none;"></div>
                    </div>
                    ${thresholdUi}
                </td>
                <td>
                    <textarea class="plan-then-input" rows="3" ${readOnly ? 'readonly' : ''} placeholder="Then…">${escapeHtml(row.then_text || '')}</textarea>
                </td>
                <td class="plan-row-actions">
                    ${
                        readOnly && canEditPlans() && row.id
                            ? `<div class="plan-manual-met-actions" style="display:flex;flex-direction:column;gap:6px;">
                                <button type="button" class="btn-secondary plan-manual-met-btn" data-row-id="${row.id}" data-deliver="0" style="padding:4px 10px;font-size:12px;" title="Mark met — shows reward star until delivered">Met</button>
                                <button type="button" class="btn-primary plan-manual-met-btn" data-row-id="${row.id}" data-deliver="1" style="padding:4px 10px;font-size:12px;" title="Mark met and delivered in one step (no star)">Met &amp; delivered</button>
                               </div>`
                            : ''
                    }
                    ${readOnly ? '' : `<button type="button" class="btn-danger plan-remove-row" style="padding:4px 8px;font-size:12px;">Remove</button>`}
                </td>
            `;
            tbody.appendChild(tr);
            updateThresholdFieldVisibility(tr);
            wireRowEvents(tr, idx);
        });
    }

    async function manualMetRow(rowId, deliver, btn) {
        if (!canEditPlans() || !planModalState.studentId || !rowId) return;
        const label = deliver ? 'Met & delivered' : 'Met';
        if (btn) {
            btn.disabled = true;
            btn.textContent = '…';
        }
        try {
            const res = await fetch(
                `/api/students/${planModalState.studentId}/plan/rows/${rowId}/manual-met`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deliver: !!deliver }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to mark met');
            if (typeof showMessage === 'function') {
                showMessage(deliver ? 'Marked met and delivered.' : 'Marked met — star added.', 'success');
            }
            if (btn) {
                btn.textContent = 'Done ✓';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = label;
                }, 1200);
            }
            await refreshActiveMets([planModalState.studentId]);
        } catch (e) {
            alert(e.message || 'Could not mark met.');
            if (btn) {
                btn.disabled = false;
                btn.textContent = label;
            }
        }
    }

    function wireRowEvents(tr, idx) {
        const ifInput = tr.querySelector('.plan-if-input');
        const dropdown = tr.querySelector('.plan-if-dropdown');
        const hasThr = tr.querySelector('.plan-has-threshold');
        const thrBlock = tr.querySelector('.plan-threshold-block');
        const typeSelect = tr.querySelector('.plan-thr-type');

        if (hasThr) {
            hasThr.addEventListener('change', () => {
                planModalState.rows[idx].has_threshold = hasThr.checked;
                if (thrBlock) thrBlock.style.display = hasThr.checked ? '' : 'none';
            });
        }
        if (typeSelect) {
            typeSelect.addEventListener('change', () => updateThresholdFieldVisibility(tr));
        }
        const removeBtn = tr.querySelector('.plan-remove-row');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                planModalState.rows.splice(idx, 1);
                renderPlanRows();
            });
        }

        const metBtns = tr.querySelectorAll('.plan-manual-met-btn');
        metBtns.forEach((metBtn) => {
            metBtn.addEventListener('click', () => {
                const rowId = parseInt(metBtn.dataset.rowId, 10);
                const deliver = metBtn.dataset.deliver === '1';
                manualMetRow(rowId, deliver, metBtn);
            });
        });

        if (ifInput && dropdown && !planModalState.readOnly) {
            let timer = null;
            ifInput.addEventListener('input', () => {
                clearTimeout(timer);
                const q = ifInput.value.trim();
                timer = setTimeout(async () => {
                    const items = await searchIfLibrary(q);
                    if (!items.length) {
                        dropdown.style.display = 'none';
                        dropdown.innerHTML = '';
                        return;
                    }
                    dropdown.innerHTML = items
                        .map((it) => `<button type="button" class="plan-if-option" data-text="${escapeHtml(it.text)}">${escapeHtml(it.text)}</button>`)
                        .join('');
                    dropdown.style.display = 'block';
                    dropdown.querySelectorAll('.plan-if-option').forEach((btn) => {
                        btn.addEventListener('click', () => {
                            ifInput.value = btn.dataset.text || btn.textContent;
                            dropdown.style.display = 'none';
                        });
                    });
                }, 180);
            });
            ifInput.addEventListener('blur', () => {
                setTimeout(() => { dropdown.style.display = 'none'; }, 200);
            });
        }
    }

    function collectRowsFromDom() {
        const tbody = document.getElementById('plan-rows-body');
        const rows = [];
        if (!tbody) return rows;
        tbody.querySelectorAll('tr.plan-row').forEach((tr, idx) => {
            const hasThreshold = !!(tr.querySelector('.plan-has-threshold') || {}).checked;
            const type = (tr.querySelector('.plan-thr-type') || {}).value || 'end_of_day';
            rows.push({
                sort_order: idx,
                if_text: (tr.querySelector('.plan-if-input') || {}).value || '',
                then_text: (tr.querySelector('.plan-then-input') || {}).value || '',
                has_threshold: hasThreshold,
                threshold_percent: hasThreshold ? (tr.querySelector('.plan-thr-percent') || {}).value : null,
                threshold_type: hasThreshold ? type : null,
                cutoff_time: hasThreshold ? (tr.querySelector('.plan-thr-cutoff') || {}).value : null,
                dow_start: hasThreshold ? (tr.querySelector('.plan-thr-dow-start') || {}).value : null,
                dow_end: hasThreshold ? (tr.querySelector('.plan-thr-dow-end') || {}).value : null,
                consecutive_n: hasThreshold ? (tr.querySelector('.plan-thr-consecutive') || {}).value : null,
                days_needed: hasThreshold ? (tr.querySelector('.plan-thr-days-needed') || {}).value : null,
                window_days: hasThreshold ? (tr.querySelector('.plan-thr-window-days') || {}).value : null,
                period_time_range: hasThreshold ? (tr.querySelector('.plan-thr-period-time') || {}).value : null,
                period_location: hasThreshold ? (tr.querySelector('.plan-thr-period-loc') || {}).value : null,
                star_category: hasThreshold ? (tr.querySelector('.plan-thr-category') || {}).value : null,
            });
        });
        return rows;
    }

    async function openPlanModal(studentId, studentName, readOnly) {
        if (!canEditPlans() && !readOnly) {
            alert('Only staff and admin can edit plans.');
            return;
        }
        if (readOnly && !canViewStudentPlan(studentId)) {
            alert('You can only view your own If/Then plan.');
            return;
        }
        const modal = document.getElementById('student-plan-modal');
        if (!modal) return;
        const studentView = !!readOnly && !canEditPlans();
        planModalState.studentId = studentId;
        planModalState.studentName = studentName || '';
        planModalState.readOnly = !!readOnly;
        try {
            const data = await fetchPlan(studentId);
            if (data.rows && data.rows.length) {
                planModalState.rows = data.rows.map((r) => ({
                    ...emptyRow(),
                    ...r,
                    threshold_percent: r.threshold_percent != null ? r.threshold_percent : '',
                }));
            } else {
                planModalState.rows = studentView ? [] : [emptyRow()];
            }
        } catch (e) {
            planModalState.rows = studentView ? [] : [emptyRow()];
        }
        const title = document.getElementById('student-plan-modal-title');
        if (title) {
            title.textContent = studentView
                ? `Your If/Then plan${studentName ? ` — ${studentName}` : ''}`
                : readOnly
                    ? `Plan — ${studentName || 'Student'}`
                    : `Edit plan — ${studentName || 'Student'}`;
        }
        const help = document.getElementById('student-plan-modal-help');
        if (help) {
            help.textContent = studentView
                ? 'These are the If / Then steps on your plan.'
                : 'Add If / Then rows. Optionally attach a structured point-card percent threshold so the system can detect when it is met.';
        }
        const addBtn = document.getElementById('plan-add-row-btn');
        const saveBtn = document.getElementById('plan-save-btn');
        if (addBtn) addBtn.style.display = readOnly ? 'none' : '';
        if (saveBtn) saveBtn.style.display = readOnly ? 'none' : '';
        modal.classList.toggle('plan-student-view', studentView);
        renderPlanRows();
        modal.style.display = 'block';
    }

    function closePlanModal() {
        const modal = document.getElementById('student-plan-modal');
        if (modal) modal.style.display = 'none';
    }

    async function savePlanFromModal() {
        if (!planModalState.studentId) return;
        const rows = collectRowsFromDom();
        try {
            await savePlan(planModalState.studentId, rows);
            if (typeof showButtonStatus === 'function') {
                showButtonStatus('#plan-save-btn', 'Plan saved.', 'success');
            } else if (typeof showMessage === 'function') {
                showMessage('Plan saved.', 'success');
            }
            closePlanModal();
            await refreshActiveMets([planModalState.studentId]);
        } catch (e) {
            if (typeof showButtonStatus === 'function') {
                showButtonStatus('#plan-save-btn', e.message || 'Failed to save plan', 'error');
            } else {
                alert(e.message || 'Failed to save plan');
            }
        }
    }

    async function openDeliveryHistoryModal(studentId, studentName) {
        const modal = document.getElementById('plan-delivery-history-modal');
        const body = document.getElementById('plan-delivery-history-body');
        const title = document.getElementById('plan-delivery-history-title');
        if (!modal || !body) return;
        if (title) title.textContent = `Delivery history — ${studentName || 'Student'}`;
        body.innerHTML = '<p style="color:#64748b;">Loading…</p>';
        modal.style.display = 'block';
        try {
            const res = await fetch(`/api/students/${studentId}/plan/delivery-history`);
            const data = await res.json();
            const hist = data.history || [];
            if (!hist.length) {
                body.innerHTML = '<p style="color:#64748b;">No threshold mets or deliveries yet.</p>';
                return;
            }
            body.innerHTML = `
                <table class="users-table plan-history-table" style="width:100%;">
                    <thead><tr>
                        <th>Met</th><th>If</th><th>Then (reward)</th><th>Delivered</th><th>By</th>
                    </tr></thead>
                    <tbody>
                        ${hist.map((h) => `
                            <tr>
                                <td>${escapeHtml((h.met_at || '').replace('T', ' ').slice(0, 16))}</td>
                                <td>${escapeHtml(h.if_text || '')}</td>
                                <td>${escapeHtml(h.then_text || '')}</td>
                                <td>${h.is_delivered ? escapeHtml((h.delivered_at || '').replace('T', ' ').slice(0, 16)) : '—'}</td>
                                <td>${escapeHtml(h.delivered_by || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            body.innerHTML = '<p style="color:#e53935;">Failed to load history.</p>';
        }
    }

    function closeDeliveryHistoryModal() {
        const modal = document.getElementById('plan-delivery-history-modal');
        if (modal) modal.style.display = 'none';
    }

    async function loadBankPlanDeliveries(studentId) {
        const section = document.getElementById('bank-plan-deliveries-section');
        const list = document.getElementById('bank-plan-deliveries-list');
        if (!section || !list || !studentId) {
            if (section) section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        list.innerHTML = '<p style="margin:0;color:#94a3b8;">Loading…</p>';
        try {
            const res = await fetch(`/api/students/${studentId}/plan/delivery-history`);
            if (!res.ok) throw new Error('fail');
            const data = await res.json();
            const delivered = (data.history || []).filter((h) => h.is_delivered);
            if (!delivered.length) {
                list.innerHTML = '<p style="margin:0;color:#94a3b8;">No plan rewards delivered yet.</p>';
                return;
            }
            list.innerHTML = delivered
                .slice(0, 30)
                .map(
                    (h) => `
                    <div class="bank-plan-delivery-item" style="padding:10px 0;border-bottom:1px solid var(--border);">
                        <div style="font-weight:600;">${escapeHtml(h.then_text || 'Reward')}</div>
                        <div style="font-size:13px;color:#64748b;">If: ${escapeHtml(h.if_text || '')}</div>
                        <div style="font-size:12px;color:#94a3b8;">
                            Delivered ${(h.delivered_at || '').replace('T', ' ').slice(0, 16)}
                            ${h.delivered_by ? ` · ${escapeHtml(h.delivered_by)}` : ''}
                        </div>
                    </div>`
                )
                .join('');
        } catch (e) {
            list.innerHTML = '<p style="margin:0;color:#94a3b8;">Could not load plan deliveries.</p>';
        }
    }

    function buildPlanThresholdsOverviewHtml(stats) {
        const s = stats || emptyStats();
        const overall = s.overall || {};
        const met = overall.met_count || 0;
        const delivered = overall.delivered_count || 0;
        const uniqueIf = overall.unique_if_count || 0;
        return `
            <div class="overview-beige-panel overview-stat overview-gauge-plans" data-overview-key="plan_thresholds">
                <div class="overview-panel-kicker">Plan thresholds</div>
                <div class="overview-plan-stat-body">
                    <div class="overview-gauge-big">${met}</div>
                    <div class="overview-gauge-small">thresholds met</div>
                    <div class="overview-plan-stat-sub">${delivered} delivered · ${uniqueIf} unique Ifs</div>
                </div>
            </div>
        `;
    }

    function emptyStats() {
        return {
            overall: { met_count: 0, delivered_count: 0, student_count: 0, unique_if_count: 0 },
            by_if: [],
            by_student: [],
        };
    }

    function buildPlanThresholdsCard(data) {
        const stats = (data && data.plan_threshold_stats) || emptyStats();
        const card = document.createElement('div');
        card.className = 'dashboard-card overview-extra-card overview-plan-thresholds-card';
        card.dataset.overviewCard = 'plan_thresholds';
        const byIf = stats.by_if || [];
        const byStudent = stats.by_student || [];
        const overall = stats.overall || {};
        card.innerHTML = `
            <h3 class="dashboard-card-title">Plan threshold mets</h3>
            <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
                ${overall.met_count || 0} mets · ${overall.delivered_count || 0} delivered ·
                ${overall.student_count || 0} students · ${overall.unique_if_count || 0} unique Ifs
                (for current selection)
            </p>
            <h4 style="margin:12px 0 8px;font-size:14px;">By unique If</h4>
            ${
                byIf.length
                    ? `<table class="users-table" style="width:100%;font-size:13px;">
                        <thead><tr><th>If</th><th>Mets</th><th>Delivered</th><th>Students</th></tr></thead>
                        <tbody>
                            ${byIf
                                .map(
                                    (r) => `<tr>
                                <td>${escapeHtml(r.if_text || r.if_normalized || '')}</td>
                                <td>${r.met_count}</td>
                                <td>${r.delivered_count}</td>
                                <td>${r.student_count}</td>
                            </tr>`
                                )
                                .join('')}
                        </tbody>
                    </table>`
                    : '<p style="color:#94a3b8;font-size:13px;">No threshold mets in this selection yet.</p>'
            }
            ${
                byStudent.length === 1
                    ? `<h4 style="margin:16px 0 8px;font-size:14px;">Student: ${escapeHtml(byStudent[0].student_name)}</h4>
                       <p style="font-size:13px;">Any If met: <strong>${byStudent[0].any_if_met_count}</strong></p>
                       <table class="users-table" style="width:100%;font-size:13px;">
                         <thead><tr><th>If</th><th>Mets</th><th>Delivered</th></tr></thead>
                         <tbody>
                           ${(byStudent[0].by_if || [])
                               .map(
                                   (r) => `<tr>
                             <td>${escapeHtml(r.if_text || '')}</td>
                             <td>${r.met_count}</td>
                             <td>${r.delivered_count}</td>
                           </tr>`
                               )
                               .join('')}
                         </tbody>
                       </table>`
                    : byStudent.length > 1
                      ? `<h4 style="margin:16px 0 8px;font-size:14px;">By student</h4>
                         <table class="users-table" style="width:100%;font-size:13px;">
                           <thead><tr><th>Student</th><th>Any If mets</th><th>Delivered</th></tr></thead>
                           <tbody>
                             ${byStudent
                                 .map(
                                     (s) => `<tr>
                               <td>${escapeHtml(s.student_name)}</td>
                               <td>${s.any_if_met_count}</td>
                               <td>${s.delivered_count}</td>
                             </tr>`
                                 )
                                 .join('')}
                           </tbody>
                         </table>`
                      : ''
            }
        `;
        return card;
    }

    function bindModalChrome() {
        const addBtn = document.getElementById('plan-add-row-btn');
        if (addBtn && !addBtn._planBound) {
            addBtn._planBound = true;
            addBtn.addEventListener('click', () => {
                planModalState.rows.push(emptyRow());
                renderPlanRows();
            });
        }
        const saveBtn = document.getElementById('plan-save-btn');
        if (saveBtn && !saveBtn._planBound) {
            saveBtn._planBound = true;
            saveBtn.addEventListener('click', savePlanFromModal);
        }
        document.addEventListener('click', (e) => {
            if (openKebabMenu && !e.target.closest('.plan-kebab-wrap')) closeKebabMenus();
            if (document.getElementById('plan-met-popover') && !e.target.closest('.plan-met-popover') && !e.target.closest('.plan-met-icon-btn')) {
                closeMetPopover();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindModalChrome();
        bindPointCardGridScrollHandlers();
    });

    global.StudentPlans = {
        PLAN_MET_ICON_SRC,
        openPlanModal,
        closePlanModal,
        openDeliveryHistoryModal,
        closeDeliveryHistoryModal,
        buildStudentHeaderPlanControls,
        refreshActiveMets,
        loadBankPlanDeliveries,
        buildPlanThresholdsOverviewHtml,
        buildPlanThresholdsCard,
        canEditPlans,
    };
    // Convenience globals used from inline onclick in User Management
    global.openStudentPlanModal = (studentId, studentName, readOnly) =>
        openPlanModal(studentId, studentName, !!readOnly);
    global.openStudentPlanDeliveryHistory = (studentId, studentName) =>
        openDeliveryHistoryModal(studentId, studentName);
    global.closeStudentPlanModal = closePlanModal;
    global.closePlanDeliveryHistoryModal = closeDeliveryHistoryModal;
})(window);
