(function (global) {
    'use strict';

    let state = {
        studentId: null,
        data: null,
        catalog: [],
        roster: null,
        searchList: [],
        focusAssignmentId: null,
    };

    function role() {
        return (global.currentUser && global.currentUser.role) || '';
    }

    function isStaff() {
        return role() === 'staff' || role() === 'admin';
    }

    function money(n) {
        const v = Number(n);
        if (isNaN(v)) return '$0.00';
        return '$' + v.toFixed(2);
    }

    function esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function studentQuery() {
        if (isStaff() && state.studentId) return '?student_id=' + encodeURIComponent(state.studentId);
        return '';
    }

    function currentOpenAssignment() {
        const assignments = (state.data && state.data.assignments) || [];
        if (state.focusAssignmentId) {
            const focused = assignments.find(function (a) { return a.id === state.focusAssignmentId; });
            if (focused) return focused;
        }
        return assignments.find(function (a) {
            return a.status === 'assigned' || a.status === 'in_progress' || a.status === 'needs_help';
        }) || null;
    }

    async function fetchJson(url, opts) {
        const res = await fetch(url, opts);
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (!res.ok) {
            const err = new Error((body && body.error) || 'Request failed');
            err.body = body;
            throw err;
        }
        return body;
    }

    async function loadCatalog() {
        if (!state.studentId && role() !== 'student') {
            state.catalog = [];
            return;
        }
        const sid = state.studentId || (global.currentUser && global.currentUser.studentId);
        if (!sid) {
            state.catalog = [];
            return;
        }
        try {
            state.catalog = await fetchJson('/api/marketplace/catalog?student_id=' + encodeURIComponent(sid));
        } catch (e) {
            state.catalog = [];
        }
    }

    function renderStory() {
        const el = document.getElementById('curriculum-money-story');
        if (!el || !state.data) return;
        const s = state.data.money_story || {};
        const change = s.pay_change || {};
        let changeHint = 'No prior paycheck yet — compare to pay with zero citations.';
        if (change.direction === 'up') changeHint = 'Up ' + money(change.delta) + ' from last week.';
        if (change.direction === 'down') changeHint = 'Down ' + money(Math.abs(change.delta)) + ' from last week.';
        if (change.direction === 'same') changeHint = 'Same take-home as last week.';
        const pay = s.this_paycheck;
        el.innerHTML =
            '<div class="curriculum-stat"><p class="label">Balance</p><p class="value">' + money(s.balance) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">This week’s pay</p><p class="value">' + money(pay ? pay.final_pay : 0) + '</p><p class="hint">' + esc(changeHint) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">Citations</p><p class="value">' + (pay ? pay.citation_count : 0) + '</p><p class="hint">Deduction ' + money(pay ? pay.citation_deduction : 0) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">Spent (30 days)</p><p class="value">' + money(s.spent_30d) + '</p></div>';
    }

    function renderGoal() {
        const el = document.getElementById('curriculum-goal-card');
        if (!el || !state.data) return;
        const s = state.data.money_story || {};
        const goal = s.goal;
        let inner = '<h3>Savings goal</h3>';
        if (!goal) {
            inner += '<p class="muted">No active goal. Set one in the savings lesson, or add one here.</p>';
        } else {
            const pct = Math.round((goal.progress || 0) * 100);
            inner += '<p class="muted">' + esc(goal.custom_label || goal.item_name || 'Goal') + ' — ' + money(s.balance) + ' of ' + money(goal.target_amount);
            if (s.weeks_to_goal != null) inner += '. About ' + s.weeks_to_goal + ' paycheck' + (s.weeks_to_goal === 1 ? '' : 's') + ' at last week’s take-home.';
            inner += '</p>';
            inner += '<div class="curriculum-progress"><span style="width:' + pct + '%"></span></div>';
            inner += '<div class="curriculum-actions"><button type="button" class="btn-secondary" id="curriculum-goal-complete-btn">I reached this goal</button></div>';
        }
        inner += '<div class="curriculum-lesson-form" style="margin-top:12px;">' +
            '<label>New target amount</label>' +
            '<input type="number" step="0.01" min="0.01" id="curriculum-goal-amount" placeholder="0.00">' +
            '<label>Label (optional)</label>' +
            '<input type="text" id="curriculum-goal-label" placeholder="What are you saving for?">' +
            '<div class="curriculum-actions"><button type="button" class="btn-primary" id="curriculum-goal-save-btn">Save goal</button></div>' +
            '<div class="curriculum-error" id="curriculum-goal-error"></div>' +
            '</div>';
        el.innerHTML = inner;

        const saveBtn = document.getElementById('curriculum-goal-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async function () {
                const errEl = document.getElementById('curriculum-goal-error');
                try {
                    await fetchJson('/api/curriculum/goals' + studentQuery(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            student_id: state.studentId,
                            target_amount: document.getElementById('curriculum-goal-amount').value,
                            custom_label: document.getElementById('curriculum-goal-label').value,
                        }),
                    });
                    await refreshStudent();
                } catch (e) {
                    if (errEl) errEl.textContent = e.message;
                }
            });
        }
        const doneBtn = document.getElementById('curriculum-goal-complete-btn');
        if (doneBtn) {
            doneBtn.addEventListener('click', async function () {
                try {
                    await fetchJson('/api/curriculum/goals' + studentQuery(), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ student_id: state.studentId, complete: true }),
                    });
                    await refreshStudent();
                } catch (e) { /* ignore */ }
            });
        }
    }

    function itemOptions(selectedId) {
        const items = state.catalog || [];
        if (!items.length) return '<option value="">No marketplace items visible</option>';
        return '<option value="">Select an item</option>' + items.map(function (item) {
            const sel = String(item.id) === String(selectedId) ? ' selected' : '';
            return '<option value="' + item.id + '" data-price="' + item.price + '"' + sel + '>' +
                esc(item.name) + ' — ' + money(item.price) + '</option>';
        }).join('');
    }

    function lessonFormHtml(assignment) {
        const slug = assignment.lesson && assignment.lesson.slug;
        const story = state.data.money_story || {};
        const thisPay = story.this_paycheck;
        const prevPay = story.previous_paycheck;
        const change = story.pay_change || {};
        const staff = isStaff() && assignment.lesson && assignment.lesson.staff_script
            ? '<div class="curriculum-staff-script"><strong>Staff:</strong> ' + esc(assignment.lesson.staff_script) + '</div>'
            : '';
        const prompt = assignment.lesson ? '<p class="muted">' + esc(assignment.lesson.student_prompt) + '</p>' : '';

        if (slug === 'read_paycheck') {
            const deposited = thisPay && (thisPay.deposited_at || thisPay.is_verified);
            return staff + prompt +
                '<p>Period: ' + esc(thisPay ? thisPay.pay_period_start + ' to ' + thisPay.pay_period_end : 'no paycheck yet') + '</p>' +
                (deposited
                    ? '<p>This paycheck is already deposited. You can mark the lesson done.</p>'
                    : '<p>Open Bank Account and complete the paycheck worksheet. Come back here after it deposits.</p>') +
                '<div class="curriculum-actions">' +
                '<button type="button" class="btn-secondary" id="curriculum-open-bank-btn">Open paycheck worksheet</button>' +
                (deposited ? '<button type="button" class="btn-primary" id="curriculum-complete-btn">Mark done</button>' : '') +
                '</div>';
        }

        if (slug === 'why_pay_changed') {
            const compareLabel = prevPay
                ? 'Last week’s take-home (' + prevPay.pay_period_start + ' to ' + prevPay.pay_period_end + ')'
                : 'Pay this week with zero citations';
            const directionNote = change.direction === 'up'
                ? 'Pay went up from last week.'
                : change.direction === 'down'
                    ? 'Pay went down from last week.'
                    : change.direction === 'same'
                        ? 'Pay matched last week.'
                        : 'This looks like a first paycheck. Compare to pay with no citations.';
            return staff + prompt +
                '<p class="muted">' + esc(directionNote) + '</p>' +
                '<div class="curriculum-lesson-form">' +
                '<label>This week’s take-home</label>' +
                '<input type="number" step="0.01" id="cl-this-take-home" placeholder="0.00">' +
                '<label>' + esc(compareLabel) + '</label>' +
                '<input type="number" step="0.01" id="cl-compare-take-home" placeholder="0.00">' +
                '<label>Difference (this week minus comparison)</label>' +
                '<input type="number" step="0.01" id="cl-difference" placeholder="0.00">' +
                '<label>Why did it change — or why did it stay the same?</label>' +
                '<textarea id="cl-why"></textarea>' +
                '</div>';
        }

        if (slug === 'save_or_buy') {
            return staff + prompt +
                '<p class="muted">Balance ' + money(story.balance) + '</p>' +
                '<div class="curriculum-lesson-form">' +
                '<label>Item</label>' +
                '<select id="cl-item">' + itemOptions() + '</select>' +
                '<label>Decision</label>' +
                '<div class="curriculum-radio-row">' +
                '<label><input type="radio" name="cl-decision" value="buy"> Buy now</label>' +
                '<label><input type="radio" name="cl-decision" value="wait"> Wait</label>' +
                '<label><input type="radio" name="cl-decision" value="goal"> Set as a goal</label>' +
                '</div></div>';
        }

        if (slug === 'opportunity_cost') {
            return staff + prompt +
                '<p class="muted">Balance ' + money(story.balance) + '</p>' +
                '<div class="curriculum-lesson-form">' +
                '<label>Item A</label><select id="cl-item-a">' + itemOptions() + '</select>' +
                '<label>Item B</label><select id="cl-item-b">' + itemOptions() + '</select>' +
                '<label class="curriculum-managed-label"><input type="checkbox" id="cl-can-both"> I can buy both with my balance</label>' +
                '<label>If you cannot buy both, which would you choose?</label>' +
                '<select id="cl-choice"><option value="">Choose</option></select>' +
                '<label>What are you giving up?</label>' +
                '<textarea id="cl-reason"></textarea>' +
                '</div>';
        }

        if (slug === 'needs_vs_wants') {
            const purchases = story.recent_purchases || [];
            const rows = purchases.length
                ? purchases
                : (state.catalog || []).slice(0, 6).map(function (item) {
                    return { id: 'item-' + item.id, amount: item.price, description: item.name };
                });
            if (!rows.length) {
                return staff + prompt + '<p class="muted">No purchases or catalog items to tag yet.</p>';
            }
            const list = rows.map(function (row, idx) {
                return '<div class="curriculum-tag-row" data-tag-id="' + esc(row.id) + '" data-label="' + esc(row.description) + '">' +
                    '<span>' + esc(row.description) + ' — ' + money(row.amount) + '</span>' +
                    '<span class="curriculum-radio-row">' +
                    '<label><input type="radio" name="cl-tag-' + idx + '" value="need"> Need</label>' +
                    '<label><input type="radio" name="cl-tag-' + idx + '" value="want"> Want</label>' +
                    '</span></div>';
            }).join('');
            return staff + prompt + '<div class="curriculum-lesson-form">' + list + '</div>';
        }

        if (slug === 'savings_goal') {
            const takeHome = thisPay ? thisPay.final_pay : 0;
            return staff + prompt +
                '<p class="muted">Last take-home ' + money(takeHome) + '. Balance ' + money(story.balance) + '.</p>' +
                '<div class="curriculum-lesson-form">' +
                '<label>Marketplace item (optional)</label>' +
                '<select id="cl-goal-item">' + itemOptions() + '</select>' +
                '<label>Target amount</label>' +
                '<input type="number" step="0.01" id="cl-goal-amount" placeholder="0.00">' +
                '<label>Label</label>' +
                '<input type="text" id="cl-goal-label" placeholder="What are you saving for?">' +
                '</div>';
        }

        return staff + prompt;
    }

    function collectResponses(assignment) {
        const slug = assignment.lesson && assignment.lesson.slug;
        if (slug === 'read_paycheck') return {};
        if (slug === 'why_pay_changed') {
            return {
                this_take_home: document.getElementById('cl-this-take-home').value,
                compare_take_home: document.getElementById('cl-compare-take-home').value,
                difference: document.getElementById('cl-difference').value,
                why: document.getElementById('cl-why').value,
            };
        }
        if (slug === 'save_or_buy') {
            const sel = document.getElementById('cl-item');
            const opt = sel && sel.options[sel.selectedIndex];
            const decisionEl = document.querySelector('input[name="cl-decision"]:checked');
            return {
                item_id: sel && sel.value,
                item_price: opt && opt.getAttribute('data-price'),
                decision: decisionEl && decisionEl.value,
            };
        }
        if (slug === 'opportunity_cost') {
            const a = document.getElementById('cl-item-a');
            const b = document.getElementById('cl-item-b');
            const choice = document.getElementById('cl-choice');
            return {
                item_id_a: a && a.value,
                item_id_b: b && b.value,
                can_buy_both: !!(document.getElementById('cl-can-both') && document.getElementById('cl-can-both').checked),
                choice: choice && choice.value,
                reason: (document.getElementById('cl-reason') && document.getElementById('cl-reason').value) || '',
            };
        }
        if (slug === 'needs_vs_wants') {
            const tags = [];
            document.querySelectorAll('.curriculum-tag-row').forEach(function (row) {
                const checked = row.querySelector('input[type="radio"]:checked');
                tags.push({
                    id: row.getAttribute('data-tag-id'),
                    label: row.getAttribute('data-label'),
                    kind: checked ? checked.value : '',
                });
            });
            return { tags: tags };
        }
        if (slug === 'savings_goal') {
            const sel = document.getElementById('cl-goal-item');
            return {
                item_id: sel && sel.value ? sel.value : null,
                target_amount: document.getElementById('cl-goal-amount').value,
                custom_label: document.getElementById('cl-goal-label').value,
            };
        }
        return {};
    }

    function wireOpportunitySelects() {
        const a = document.getElementById('cl-item-a');
        const b = document.getElementById('cl-item-b');
        const choice = document.getElementById('cl-choice');
        if (!a || !b || !choice) return;
        function refresh() {
            const opts = [];
            [a, b].forEach(function (sel) {
                const opt = sel.options[sel.selectedIndex];
                if (sel.value) opts.push({ id: sel.value, label: opt ? opt.textContent : sel.value });
            });
            choice.innerHTML = '<option value="">Choose</option>' + opts.map(function (o) {
                return '<option value="' + o.id + '">' + esc(o.label) + '</option>';
            }).join('');
        }
        a.addEventListener('change', refresh);
        b.addEventListener('change', refresh);
    }

    function wireGoalItemFill() {
        const sel = document.getElementById('cl-goal-item');
        const amount = document.getElementById('cl-goal-amount');
        const label = document.getElementById('cl-goal-label');
        if (!sel || !amount) return;
        sel.addEventListener('change', function () {
            const opt = sel.options[sel.selectedIndex];
            if (!opt || !sel.value) return;
            amount.value = opt.getAttribute('data-price') || '';
            if (label && !label.value) {
                label.value = (opt.textContent || '').split(' — ')[0];
            }
        });
    }

    async function startIfNeeded(assignment) {
        if (assignment.status === 'assigned') {
            try {
                await fetchJson('/api/curriculum/assignments/' + assignment.id + '/start', { method: 'POST' });
                assignment.status = 'in_progress';
            } catch (e) { /* ignore */ }
        }
    }

    function renderCurrentLesson() {
        const el = document.getElementById('curriculum-current-lesson');
        if (!el || !state.data) return;
        const assignment = currentOpenAssignment();
        if (!assignment) {
            el.innerHTML = '<h3>Current lesson</h3><p class="muted">No open lesson. Staff can assign one, and payday assigns the paycheck lesson automatically.</p>';
            return;
        }
        const title = assignment.lesson ? assignment.lesson.title : 'Lesson';
        const slug = assignment.lesson && assignment.lesson.slug;
        const actions = slug === 'read_paycheck'
            ? '<div class="curriculum-actions"><button type="button" class="btn-secondary" id="curriculum-help-btn">I need help</button></div>'
            : '<div class="curriculum-actions">' +
                '<button type="button" class="btn-primary" id="curriculum-complete-btn">Submit</button>' +
                '<button type="button" class="btn-secondary" id="curriculum-help-btn">I need help</button>' +
                '</div>';
        el.innerHTML = '<h3>' + esc(title) + '</h3>' + lessonFormHtml(assignment) +
            actions +
            '<div class="curriculum-error" id="curriculum-lesson-error"></div>';

        startIfNeeded(assignment);
        wireOpportunitySelects();
        wireGoalItemFill();

        const bankBtn = document.getElementById('curriculum-open-bank-btn');
        if (bankBtn) {
            bankBtn.addEventListener('click', function () {
                if (typeof switchView === 'function') switchView('bank-account');
            });
        }
        const completeBtn = document.getElementById('curriculum-complete-btn');
        if (completeBtn) {
            completeBtn.addEventListener('click', async function () {
                const errEl = document.getElementById('curriculum-lesson-error');
                try {
                    await fetchJson('/api/curriculum/assignments/' + assignment.id + '/complete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ responses: collectResponses(assignment) }),
                    });
                    state.focusAssignmentId = null;
                    await refreshStudent();
                } catch (e) {
                    if (errEl) errEl.textContent = e.message;
                }
            });
        }
        const helpBtn = document.getElementById('curriculum-help-btn');
        if (helpBtn) {
            helpBtn.addEventListener('click', async function () {
                try {
                    await fetchJson('/api/curriculum/assignments/' + assignment.id + '/needs-help', { method: 'POST' });
                    await refreshStudent();
                } catch (e) { /* ignore */ }
            });
        }
    }

    function renderHistory() {
        const el = document.getElementById('curriculum-history');
        if (!el || !state.data) return;
        const done = ((state.data.assignments) || []).filter(function (a) { return a.status === 'completed'; });
        if (!done.length) {
            el.innerHTML = '<h3>Finished lessons</h3><p class="muted">Nothing completed yet.</p>';
            return;
        }
        el.innerHTML = '<h3>Finished lessons</h3><ul class="curriculum-history-list">' + done.map(function (a) {
            const title = a.lesson ? a.lesson.title : 'Lesson';
            const when = a.completed_at ? a.completed_at.slice(0, 10) : '';
            return '<li><span>' + esc(title) + '</span><span class="muted">' + esc(when) + '</span></li>';
        }).join('') + '</ul>';
    }

    function statusClass(status) {
        if (status === 'completed') return 'is-done';
        if (status === 'needs_help') return 'is-help';
        if (status === 'assigned' || status === 'in_progress') return 'is-open';
        return '';
    }

    function statusLabel(status) {
        if (status === 'completed') return 'Done';
        if (status === 'needs_help') return 'Needs help';
        if (status === 'in_progress') return 'In progress';
        if (status === 'assigned') return 'Assigned';
        return '—';
    }

    function renderRoster() {
        const wrap = document.getElementById('curriculum-roster-wrap');
        if (!wrap || !state.roster) return;
        const lessons = state.roster.lessons || [];
        const students = state.roster.students || [];
        if (!students.length) {
            wrap.innerHTML = '<p class="muted">No students in this list.</p>';
            return;
        }
        let html = '<table class="curriculum-roster"><thead><tr><th>Student</th>';
        lessons.forEach(function (l) { html += '<th>' + esc(l.title) + '</th>'; });
        html += '</tr></thead><tbody>';
        students.forEach(function (row) {
            html += '<tr data-student-id="' + row.student_id + '"><td>' + esc(row.student_name) + '</td>';
            lessons.forEach(function (l) {
                const cell = (row.lessons && row.lessons[l.slug]) || {};
                html += '<td><span class="curriculum-status-pill ' + statusClass(cell.status) + '">' +
                    esc(statusLabel(cell.status)) + '</span></td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        wrap.innerHTML = html;
        wrap.querySelectorAll('tr[data-student-id]').forEach(function (tr) {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', function () {
                const sid = parseInt(tr.getAttribute('data-student-id'), 10);
                const name = tr.querySelector('td').textContent;
                selectStudent(sid, name);
            });
        });
    }

    function fillLessonSelect() {
        const sel = document.getElementById('curriculum-assign-lesson');
        if (!sel) return;
        const lessons = (state.roster && state.roster.lessons) || (state.data && state.data.lessons) || [];
        sel.innerHTML = lessons.map(function (l) {
            return '<option value="' + esc(l.slug) + '">' + esc(l.title) + '</option>';
        }).join('');
    }

    async function loadRoster() {
        if (!isStaff()) return;
        const managed = document.getElementById('curriculum-managed-by-me-checkbox');
        const params = new URLSearchParams();
        if (managed && managed.checked) params.set('managed_by_me', 'true');
        try {
            state.roster = await fetchJson('/api/curriculum/roster?' + params.toString());
        } catch (e) {
            state.roster = { lessons: [], students: [] };
        }
        fillLessonSelect();
        renderRoster();
    }

    async function refreshStudent() {
        if (role() === 'student') {
            state.studentId = global.currentUser && global.currentUser.studentId;
        }
        const body = document.getElementById('curriculum-student-body');
        const noMsg = document.getElementById('curriculum-no-student-msg');
        if (isStaff() && !state.studentId) {
            if (body) body.style.display = 'none';
            if (noMsg) noMsg.style.display = 'block';
            return;
        }
        if (noMsg) noMsg.style.display = 'none';
        if (body) body.style.display = 'block';
        try {
            await loadCatalog();
            state.data = await fetchJson('/api/curriculum/me' + studentQuery());
        } catch (e) {
            state.data = null;
            return;
        }
        if (global.curriculumFocusAssignmentId) {
            state.focusAssignmentId = global.curriculumFocusAssignmentId;
            global.curriculumFocusAssignmentId = null;
        }
        renderStory();
        renderGoal();
        renderCurrentLesson();
        renderHistory();
    }

    function selectStudent(studentId, name) {
        state.studentId = studentId;
        const input = document.getElementById('curriculum-student-search-input');
        if (input && name) input.value = name;
        refreshStudent();
    }

    function setupStaffSearch() {
        const searchInput = document.getElementById('curriculum-student-search-input');
        const wrapper = searchInput && searchInput.closest('.bank-search-autocomplete-wrapper');
        const dropdown = wrapper && wrapper.querySelector('.curriculum-student-autocomplete-dropdown');
        const managedByMe = document.getElementById('curriculum-managed-by-me-checkbox');
        if (!searchInput || !dropdown || searchInput._curriculumBound) return;
        searchInput._curriculumBound = true;

        function showDropdown(items) {
            dropdown.innerHTML = '';
            (items || []).slice(0, 15).forEach(function (s) {
                const div = document.createElement('div');
                div.className = 'bank-search-autocomplete-item';
                div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
                div.textContent = s.student_name || '';
                div.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    dropdown.innerHTML = '';
                    selectStudent(s.student_id, s.student_name);
                });
                dropdown.appendChild(div);
            });
        }

        function loadList() {
            const params = new URLSearchParams();
            if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
            const q = searchInput.value.trim();
            if (q) params.set('q', q);
            fetch('/api/bank-account/search?' + params.toString()).then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
                state.searchList = data || [];
                showDropdown(state.searchList);
            });
        }

        searchInput.addEventListener('input', loadList);
        searchInput.addEventListener('focus', function () { if (state.searchList.length) showDropdown(state.searchList); else loadList(); });
        document.addEventListener('click', function (e) {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.innerHTML = '';
        });
        if (managedByMe) {
            managedByMe.addEventListener('change', function () {
                loadList();
                loadRoster();
            });
        }
    }

    async function assignLessons(studentIds) {
        const sel = document.getElementById('curriculum-assign-lesson');
        const status = document.getElementById('curriculum-staff-status');
        if (!sel || !studentIds.length) {
            if (status) status.textContent = 'Pick a lesson and at least one student.';
            return;
        }
        try {
            const result = await fetchJson('/api/curriculum/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lesson_slug: sel.value, student_ids: studentIds }),
            });
            if (status) status.textContent = 'Assigned to ' + (result.count || studentIds.length) + ' student(s).';
            await loadRoster();
            if (state.studentId) await refreshStudent();
        } catch (e) {
            if (status) status.textContent = e.message;
        }
    }

    function setupStaffAssign() {
        const oneBtn = document.getElementById('curriculum-assign-one-btn');
        const listBtn = document.getElementById('curriculum-assign-list-btn');
        if (oneBtn) {
            oneBtn.addEventListener('click', function () {
                if (!state.studentId) {
                    const status = document.getElementById('curriculum-staff-status');
                    if (status) status.textContent = 'Select a student first.';
                    return;
                }
                assignLessons([state.studentId]);
            });
        }
        if (listBtn) {
            listBtn.addEventListener('click', function () {
                const ids = ((state.roster && state.roster.students) || []).map(function (s) { return s.student_id; });
                assignLessons(ids);
            });
        }
    }

    async function loadCurriculumView() {
        if (global.curriculumFocusAssignmentId) {
            state.focusAssignmentId = global.curriculumFocusAssignmentId;
        }
        if (isStaff()) {
            setupStaffSearch();
            setupStaffAssign();
            await loadRoster();
            if (state.studentId) await refreshStudent();
        } else {
            await refreshStudent();
        }
    }

    global.loadCurriculumView = loadCurriculumView;
})(window);
