(function () {
    var currentBillsStudentId = null;
    var currentEconomy = null;
    var billsSearchBound = false;
    var adminBound = false;
    var billsUiBound = false;

    function moneyText(value) {
        var n = Number(value);
        if (isNaN(n)) n = 0;
        var sign = n < 0 ? '-' : '';
        return sign + '$' + Math.abs(n).toFixed(2);
    }

    function parseMoneyInput(str) {
        if (typeof parseCurrency === 'function') return parseCurrency(str);
        if (str == null || str === '') return NaN;
        var cleaned = String(str).replace(/[$,]/g, '').trim();
        return cleaned === '' ? NaN : parseFloat(cleaned);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isStaffUser() {
        return window.currentUser && ['staff', 'admin'].includes(window.currentUser.role);
    }

    function showMsg(el, text, ok) {
        if (!el) return;
        el.textContent = text || '';
        el.style.display = text ? 'block' : 'none';
        el.style.color = ok ? '#0f766e' : '#dc2626';
    }

    function readChoicesFromForm() {
        var assistance = [];
        if (document.getElementById('budget-assist-medicaid') && document.getElementById('budget-assist-medicaid').checked) assistance.push('medicaid');
        if (document.getElementById('budget-assist-snap') && document.getElementById('budget-assist-snap').checked) assistance.push('snap');
        if (document.getElementById('budget-assist-section8') && document.getElementById('budget-assist-section8').checked) assistance.push('section8');
        return {
            housing_kind: (document.getElementById('budget-housing-kind') || {}).value || 'apt_1br',
            housing_option: (document.getElementById('budget-housing-option') || {}).value || 'staff',
            roommate: !!(document.getElementById('budget-roommate') && document.getElementById('budget-roommate').checked),
            wifi: !!(document.getElementById('budget-wifi') && document.getElementById('budget-wifi').checked),
            cell: !!(document.getElementById('budget-cell') && document.getElementById('budget-cell').checked),
            student_loan: !!(document.getElementById('budget-student-loan') && document.getElementById('budget-student-loan').checked),
            emergency_fund: !!(document.getElementById('budget-emergency') && document.getElementById('budget-emergency').checked),
            vehicle: (document.getElementById('budget-vehicle') || {}).value || 'none',
            car_insurance: (document.getElementById('budget-car-insurance') || {}).value || 'none',
            health: (document.getElementById('budget-health') || {}).value || 'none',
            credit_card: (document.getElementById('budget-credit') || {}).value || 'none',
            assistance: assistance
        };
    }

    function renderBudgetForm(choices) {
        var wrap = document.getElementById('bills-budget-form');
        if (!wrap) return;
        choices = choices || {};
        var assistance = choices.assistance || [];
        wrap.innerHTML =
            '<label>Housing kind<select id="budget-housing-kind">' +
            option('apt_1br', 'Apartment 1 bedroom', choices.housing_kind) +
            option('apt_2br', 'Apartment 2 bedroom', choices.housing_kind) +
            option('house', 'House payment', choices.housing_kind) +
            option('homeless', 'Homeless / no housing', choices.housing_kind) +
            '</select></label>' +
            '<label>Housing tier<select id="budget-housing-option">' +
            option('staff', 'Staff choice', choices.housing_option) +
            option('two_choice', '2-choice', choices.housing_option) +
            option('open', 'Open choice', choices.housing_option) +
            '</select></label>' +
            check('budget-roommate', 'Roommate (split housing 50%)', choices.roommate) +
            check('budget-wifi', 'Wifi', choices.wifi !== false) +
            check('budget-cell', 'Cell phone', choices.cell !== false) +
            check('budget-student-loan', 'Student loan (Blue/White)', choices.student_loan !== false) +
            check('budget-emergency', 'Emergency fund', choices.emergency_fund !== false) +
            '<label>Vehicle<select id="budget-vehicle">' +
            option('none', 'None', choices.vehicle) +
            option('beater', 'Beater', choices.vehicle) +
            option('average', 'Average', choices.vehicle) +
            option('sports', 'Sports', choices.vehicle) +
            '</select></label>' +
            '<label>Car insurance<select id="budget-car-insurance">' +
            option('none', 'None', choices.car_insurance) +
            option('liability', 'Liability', choices.car_insurance) +
            option('full', 'Full coverage', choices.car_insurance) +
            '</select></label>' +
            '<label>Health insurance<select id="budget-health">' +
            option('none', 'None', choices.health) +
            option('0', '$0 deductible', choices.health) +
            option('1200', '$1,200 deductible', choices.health) +
            option('6000', '$6,000 deductible', choices.health) +
            '</select></label>' +
            '<label>Credit card<select id="budget-credit">' +
            option('none', 'None', choices.credit_card) +
            option('pay_full', 'Pay in full', choices.credit_card) +
            option('carry', 'Carry a balance', choices.credit_card) +
            '</select></label>' +
            '<div>' +
            '<p style="margin:0 0 8px 0;font-weight:600;font-size:13px;">Government assistance (credits)</p>' +
            check('budget-assist-medicaid', 'Medicaid', assistance.indexOf('medicaid') !== -1) +
            check('budget-assist-snap', 'SNAP', assistance.indexOf('snap') !== -1) +
            check('budget-assist-section8', 'Section 8', assistance.indexOf('section8') !== -1) +
            '</div>';
        wrap.querySelectorAll('label').forEach(function (label) {
            if (label.querySelector('select')) {
                label.style.display = 'grid';
                label.style.gap = '6px';
                label.style.fontSize = '13px';
                label.style.color = '#475569';
                var sel = label.querySelector('select');
                sel.style.padding = '8px 12px';
                sel.style.border = '1px solid var(--border)';
                sel.style.borderRadius = '8px';
                sel.style.fontSize = '14px';
            }
        });
    }

    function option(value, label, selected) {
        var sel = String(selected || '') === String(value) ? ' selected' : '';
        return '<option value="' + escapeHtml(value) + '"' + sel + '>' + escapeHtml(label) + '</option>';
    }

    function check(id, label, checked) {
        return '<label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#334155;">' +
            '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(label) + '</span></label>';
    }

    function renderBillsList(data) {
        var list = document.getElementById('bills-list');
        if (!list) return;
        var bills = (data && data.bills) || [];
        if (!bills.length) {
            list.innerHTML = '<p style="margin:0;color:#94a3b8;">No bills yet.</p>';
            return;
        }
        list.innerHTML = bills.map(function (bill) {
            var unpaid = bill.status === 'unpaid';
            var steps = (bill.steps || []).map(function (step) {
                var text = typeof step === 'string' ? step : (step.text || '');
                return '<li>' + escapeHtml(text) + '</li>';
            }).join('');
            var late = Number(bill.late_fee_amount || 0);
            var staffBtns = isStaffUser() && unpaid
                ? '<button type="button" class="btn-secondary bills-staff-pay" data-bill-id="' + bill.id + '">Staff pay</button>' +
                  '<button type="button" class="btn-secondary bills-staff-waive" data-bill-id="' + bill.id + '">Waive</button>'
                : '';
            var payRow = unpaid
                ? '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-top:12px;">' +
                  '<label style="font-size:13px;color:#475569;">Type the amount due' +
                  '<input type="text" class="bills-pay-amount" data-bill-id="' + bill.id + '" inputmode="decimal" placeholder="$0.00" style="display:block;margin-top:6px;width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;">' +
                  '</label>' +
                  '<button type="button" class="btn-primary bills-pay-btn" data-bill-id="' + bill.id + '">Pay</button>' +
                  staffBtns +
                  '</div>' +
                  '<p class="bills-pay-error" data-bill-id="' + bill.id + '" style="display:none;margin:8px 0 0 0;color:#dc2626;font-size:13px;"></p>'
                : '<p style="margin:12px 0 0 0;font-size:13px;color:#0f766e;">' + escapeHtml((bill.status || '').toUpperCase()) +
                  (bill.paid_amount != null ? ' · ' + moneyText(bill.paid_amount) : '') + '</p>';
            return '<div class="bills-card" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:16px;">' +
                '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
                '<div><h4 style="margin:0 0 4px 0;">' + escapeHtml(bill.description || 'Bill') + '</h4>' +
                '<p style="margin:0;font-size:13px;color:#64748b;">Due ' + escapeHtml(bill.due_date || '') +
                (bill.is_base ? ' · Base' : ' · Enhanced') +
                (bill.kind === 'fee' ? ' · Miss fee' : '') +
                '</p></div>' +
                '<div style="text-align:right;"><p style="margin:0;font-weight:700;">' + moneyText(bill.amount_due) + '</p>' +
                (late > 0 && unpaid ? '<p style="margin:4px 0 0 0;font-size:12px;color:#b45309;">Includes ' + moneyText(late) + ' late fee</p>' : '') +
                '</div></div>' +
                (bill.prompt ? '<p style="margin:10px 0 0 0;font-size:13px;color:#334155;">' + escapeHtml(bill.prompt) + '</p>' : '') +
                (steps ? '<ul style="margin:8px 0 0 18px;padding:0;font-size:13px;color:#475569;">' + steps + '</ul>' : '') +
                payRow +
                '</div>';
        }).join('');

        list.querySelectorAll('.bills-pay-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { payBill(Number(btn.dataset.billId), false); });
        });
        list.querySelectorAll('.bills-staff-pay').forEach(function (btn) {
            btn.addEventListener('click', function () { staffBillAction(Number(btn.dataset.billId), 'pay'); });
        });
        list.querySelectorAll('.bills-staff-waive').forEach(function (btn) {
            btn.addEventListener('click', function () { staffBillAction(Number(btn.dataset.billId), 'waive'); });
        });
        list.querySelectorAll('.bills-pay-amount').forEach(function (input) {
            input.addEventListener('blur', function () {
                var parsed = parseMoneyInput(input.value);
                if (!isNaN(parsed) && typeof formatCurrency === 'function') input.value = formatCurrency(parsed);
            });
        });
    }

    function renderMissFeeEditor(classes) {
        var wrap = document.getElementById('bills-miss-fee-list');
        if (!wrap) return;
        classes = classes || [];
        if (!classes.length) {
            wrap.innerHTML = '<p style="margin:0;color:#94a3b8;">No miss-fee classes yet.</p>';
            return;
        }
        wrap.innerHTML = '<div style="display:grid;gap:8px;">' + classes.map(function (row) {
            return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
                '<strong>' + escapeHtml(row.name) + '</strong>' +
                '<span style="font-size:13px;color:#64748b;">match “' + escapeHtml(row.match_text) + '” · ' + moneyText(row.amount) +
                ' · skip-to ' + escapeHtml(row.skip_to_location || 'Studio') +
                (row.is_active ? '' : ' · disabled') + '</span>' +
                (row.is_active ? '<button type="button" class="btn-secondary bills-miss-disable" data-id="' + row.id + '">Disable</button>' : '') +
                '</div>';
        }).join('') + '</div>';
        wrap.querySelectorAll('.bills-miss-disable').forEach(function (btn) {
            btn.addEventListener('click', function () {
                fetch('/api/economy/miss-fee-classes/' + btn.dataset.id, { method: 'DELETE' })
                    .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function () { loadBillsView(currentBillsStudentId); loadEconomyAdminSettings(); })
                    .catch(function () { alert('Could not update miss-fee class.'); });
            });
        });
    }

    function applyEconomyToPage(data) {
        currentEconomy = data;
        var content = document.getElementById('bills-content');
        var noMsg = document.getElementById('bills-no-student-msg');
        if (content) content.style.display = 'block';
        if (noMsg) noMsg.style.display = 'none';
        var bal = document.getElementById('bills-balance-amount');
        if (bal) bal.textContent = moneyText(data.balance);
        var unpaid = document.getElementById('bills-unpaid-total');
        if (unpaid) unpaid.textContent = moneyText(data.unpaid_total);
        var meta = document.getElementById('bills-student-meta');
        if (meta) {
            meta.textContent = (data.student_name || '') +
                ' · ' + (data.pay_track === 'complex' ? 'Complex pay' : 'Simple pay') +
                (data.card_color ? ' · ' + String(data.card_color).charAt(0).toUpperCase() + String(data.card_color).slice(1) + ' card' : '') +
                ' · Late fee ' + moneyText(data.late_fee_per_day) + '/day';
        }
        var trackSel = document.getElementById('bills-pay-track-select');
        if (trackSel) trackSel.value = data.pay_track || 'simple';
        var enrolled = document.getElementById('bills-enrolled-checkbox');
        if (enrolled) enrolled.checked = !!data.enrolled;
        var pto = document.getElementById('bills-pto-days');
        if (pto) pto.textContent = 'PTO days: ' + Number(data.pto_days || 0);
        var notEnrolled = document.getElementById('bills-not-enrolled');
        var budget = document.getElementById('bills-budget-section');
        var listSec = document.getElementById('bills-list-section');
        if (!data.enrolled) {
            if (notEnrolled) notEnrolled.style.display = 'block';
            if (budget) budget.style.display = isStaffUser() ? 'block' : 'none';
            if (listSec) listSec.style.display = 'none';
        } else {
            if (notEnrolled) notEnrolled.style.display = 'none';
            if (budget) budget.style.display = 'block';
            if (listSec) listSec.style.display = 'block';
        }
        renderBudgetForm(data.choices || {});
        renderBillsList(data);
        if (isStaffUser()) {
            fetch('/api/economy/settings', { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (settings) {
                    if (settings) renderMissFeeEditor(settings.miss_fee_classes);
                })
                .catch(function () {});
        }
    }

    function loadStudentEconomy(studentId) {
        if (!studentId) return Promise.resolve();
        currentBillsStudentId = studentId;
        return fetch('/api/economy/student/' + studentId, { credentials: 'same-origin' })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
                if (!res.ok) {
                    alert((res.data && res.data.error) || 'Could not load bills.');
                    return;
                }
                applyEconomyToPage(res.data);
            });
    }

    function payBill(billId) {
        var input = document.querySelector('.bills-pay-amount[data-bill-id="' + billId + '"]');
        var err = document.querySelector('.bills-pay-error[data-bill-id="' + billId + '"]');
        var amount = parseMoneyInput(input && input.value);
        if (isNaN(amount)) {
            showMsg(err, 'Type the amount due.', false);
            return;
        }
        fetch('/api/economy/bills/' + billId + '/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ amount: amount })
        }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
                if (!res.ok) {
                    showMsg(err, (res.data && res.data.error) || 'Payment failed.', false);
                    return;
                }
                loadStudentEconomy(currentBillsStudentId);
            })
            .catch(function () { showMsg(err, 'Payment failed.', false); });
    }

    function staffBillAction(billId, action) {
        fetch('/api/economy/bills/' + billId + '/staff-pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: action })
        }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
                if (!res.ok) {
                    alert((res.data && res.data.error) || 'Could not update bill.');
                    return;
                }
                loadStudentEconomy(currentBillsStudentId);
            })
            .catch(function () { alert('Could not update bill.'); });
    }

    function bindBillsUi() {
        if (billsUiBound) return;
        billsUiBound = true;
        var saveBudget = document.getElementById('bills-save-budget-btn');
        if (saveBudget) {
            saveBudget.addEventListener('click', function () {
                if (!currentBillsStudentId) return;
                var msg = document.getElementById('bills-budget-msg');
                var body = { choices: readChoicesFromForm() };
                var enrolled = document.getElementById('bills-enrolled-checkbox');
                if (isStaffUser() && enrolled) body.enrolled = enrolled.checked;
                fetch('/api/economy/student/' + currentBillsStudentId + '/budget', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(body)
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            showMsg(msg, (res.data && res.data.error) || 'Could not save budget.', false);
                            return;
                        }
                        showMsg(msg, 'Budget saved.', true);
                        applyEconomyToPage(res.data);
                    })
                    .catch(function () { showMsg(msg, 'Could not save budget.', false); });
            });
        }
        var saveTrack = document.getElementById('bills-save-track-btn');
        var trackSel = document.getElementById('bills-pay-track-select');
        if (trackSel) {
            trackSel.addEventListener('change', function () {
                var enrolledBox = document.getElementById('bills-enrolled-checkbox');
                if (enrolledBox && trackSel.value === 'complex') enrolledBox.checked = true;
            });
        }
        if (saveTrack) {
            saveTrack.addEventListener('click', function () {
                if (!currentBillsStudentId) return;
                var track = (document.getElementById('bills-pay-track-select') || {}).value || 'simple';
                var enrolled = document.getElementById('bills-enrolled-checkbox');
                fetch('/api/economy/student/' + currentBillsStudentId + '/pay-track', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        pay_track: track,
                        enrolled: enrolled ? enrolled.checked : (track === 'complex')
                    })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            alert((res.data && res.data.error) || 'Could not save pay track.');
                            return;
                        }
                        loadStudentEconomy(currentBillsStudentId);
                    })
                    .catch(function () { alert('Could not save pay track.'); });
            });
        }
        var grantBtn = document.getElementById('bills-pto-grant-btn');
        if (grantBtn) {
            grantBtn.addEventListener('click', function () {
                if (!currentBillsStudentId) return;
                var days = Number((document.getElementById('bills-pto-grant-days') || {}).value || 1);
                fetch('/api/economy/student/' + currentBillsStudentId + '/pto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ action: 'grant', days: days })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            alert((res.data && res.data.error) || 'Could not grant PTO.');
                            return;
                        }
                        loadStudentEconomy(currentBillsStudentId);
                    });
            });
        }
        var applyBtn = document.getElementById('bills-pto-apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function () {
                if (!currentBillsStudentId) return;
                var dateVal = (document.getElementById('bills-pto-apply-date') || {}).value;
                fetch('/api/economy/student/' + currentBillsStudentId + '/pto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ action: 'apply', date: dateVal })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            alert((res.data && res.data.error) || 'Could not apply PTO.');
                            return;
                        }
                        loadStudentEconomy(currentBillsStudentId);
                    });
            });
        }
        var addMiss = document.getElementById('bills-miss-add-btn');
        if (addMiss) {
            addMiss.addEventListener('click', function () {
                var name = ((document.getElementById('bills-miss-name') || {}).value || '').trim();
                var matchText = ((document.getElementById('bills-miss-match') || {}).value || '').trim();
                var amount = (document.getElementById('bills-miss-amount') || {}).value;
                var skip = ((document.getElementById('bills-miss-skip') || {}).value || '').trim();
                fetch('/api/economy/miss-fee-classes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        name: name,
                        match_text: matchText || name,
                        amount: amount || 50,
                        skip_to_location: skip || 'Studio'
                    })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            alert((res.data && res.data.error) || 'Could not add class.');
                            return;
                        }
                        if (document.getElementById('bills-miss-name')) document.getElementById('bills-miss-name').value = '';
                        if (document.getElementById('bills-miss-match')) document.getElementById('bills-miss-match').value = '';
                        loadBillsView(currentBillsStudentId);
                        loadEconomyAdminSettings();
                    });
            });
        }
    }

    function setupBillsStudentSearch() {
        var searchInput = document.getElementById('bills-student-search-input');
        var dropdown = document.querySelector('.bills-student-autocomplete-dropdown');
        var managedByMe = document.getElementById('bills-managed-by-me-checkbox');
        if (!searchInput || !dropdown || billsSearchBound) return;
        billsSearchBound = true;
        var list = [];
        function showDropdown(items) {
            var frag = document.createDocumentFragment();
            (items || []).slice(0, 15).forEach(function (s) {
                var div = document.createElement('div');
                div.className = 'bank-search-autocomplete-item';
                div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
                div.textContent = s.student_name + ' ($' + (s.balance != null ? Number(s.balance).toFixed(2) : '0.00') + ')';
                div.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    searchInput.value = div.textContent;
                    if (typeof mountAutocompleteDropdown === 'function') {
                        mountAutocompleteDropdown(dropdown, document.createDocumentFragment(), false);
                    } else {
                        dropdown.innerHTML = '';
                    }
                    loadStudentEconomy(s.student_id);
                });
                frag.appendChild(div);
            });
            if (typeof mountAutocompleteDropdown === 'function') {
                mountAutocompleteDropdown(dropdown, frag, searchInput);
            } else {
                dropdown.innerHTML = '';
                dropdown.appendChild(frag);
            }
        }
        function loadList() {
            var params = new URLSearchParams();
            if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
            var q = searchInput.value.trim();
            if (q) params.set('q', q);
            fetch('/api/bank-account/search?' + params.toString(), { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (data) {
                    list = data;
                    showDropdown(list);
                });
        }
        searchInput.addEventListener('input', loadList);
        searchInput.addEventListener('focus', function () { if (list.length) showDropdown(list); else loadList(); });
        document.addEventListener('click', function (e) {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                if (typeof mountAutocompleteDropdown === 'function') {
                    mountAutocompleteDropdown(dropdown, document.createDocumentFragment(), false);
                } else {
                    dropdown.innerHTML = '';
                }
            }
        });
        if (managedByMe) managedByMe.addEventListener('change', loadList);
    }

    function loadBillsView(studentId) {
        bindBillsUi();
        if (window.currentUser && window.currentUser.role === 'student') {
            currentBillsStudentId = window.currentUser.studentId;
            if (currentBillsStudentId) return loadStudentEconomy(currentBillsStudentId);
            return Promise.resolve();
        }
        setupBillsStudentSearch();
        var wrap = document.getElementById('bills-student-select-wrap');
        if (wrap) wrap.style.display = 'block';
        var managed = document.getElementById('bills-managed-by-me-checkbox');
        if (managed && window.currentUser && window.currentUser.role === 'staff' && !managed.checked) {
            managed.checked = true;
        }
        var id = studentId || currentBillsStudentId;
        if (id) return loadStudentEconomy(id);
        return Promise.resolve();
    }

    function fieldRow(label, id, value) {
        return '<label style="display:grid;gap:4px;font-size:13px;color:#475569;">' + escapeHtml(label) +
            '<input type="text" id="' + id + '" value="' + escapeHtml(value == null ? '' : String(value)) +
            '" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;"></label>';
    }

    function loadEconomyAdminSettings() {
        var wrap = document.getElementById('economy-admin-settings');
        if (!wrap) return;
        fetch('/api/economy/settings', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) {
                    wrap.innerHTML = '<p style="color:#dc2626;">Could not load economy settings.</p>';
                    return;
                }
                var wages = (data.wage_rates || []).map(function (w) {
                    return fieldRow((w.education_label || w.card_color) + ' hourly', 'econ-wage-' + w.id, w.hourly_rate);
                }).join('');
                var products = (data.bill_products || []).filter(function (p) {
                    return p.formula_kind === 'flat' || p.formula_kind === 'credit';
                }).map(function (p) {
                    return fieldRow(p.name + ' amount', 'econ-bill-' + p.id, p.amount);
                }).join('');
                var nested = (data.bill_products || []).filter(function (p) {
                    return p.formula_kind !== 'flat' && p.formula_kind !== 'credit';
                }).map(function (p) {
                    return '<label style="display:grid;gap:4px;font-size:13px;color:#475569;">' + escapeHtml(p.name) + ' options' +
                        '<textarea id="econ-bill-opt-' + p.id + '" rows="6" style="font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:8px;">' +
                        escapeHtml(JSON.stringify(p.options || {}, null, 2)) + '</textarea></label>';
                }).join('');
                wrap.innerHTML =
                    '<div style="display:grid;gap:10px;max-width:640px;">' +
                    '<label style="display:grid;gap:4px;font-size:13px;color:#475569;">Default pay track' +
                    '<select id="econ-default-track" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;">' +
                    option('simple', 'Simple', data.default_pay_track) +
                    option('complex', 'Complex', data.default_pay_track) +
                    '</select></label>' +
                    fieldRow('Late fee per day', 'econ-late-fee', data.late_fee_per_day) +
                    '<p style="margin:8px 0 0 0;font-weight:600;">Wages</p>' + wages +
                    '<p style="margin:8px 0 0 0;font-weight:600;">Flat bill amounts</p>' + products +
                    '<p style="margin:8px 0 0 0;font-weight:600;">Housing, vehicle, insurance, and other option prices</p>' + nested +
                    '</div>';
                wrap.dataset.loaded = '1';
                wrap._economySettings = data;
            })
            .catch(function () {
                wrap.innerHTML = '<p style="color:#dc2626;">Could not load economy settings.</p>';
            });
        bindAdminButtons();
    }

    function bindAdminButtons() {
        if (adminBound) return;
        adminBound = true;
        var saveBtn = document.getElementById('economy-admin-save-btn');
        var msg = document.getElementById('economy-admin-msg');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var wrap = document.getElementById('economy-admin-settings');
                var data = wrap && wrap._economySettings;
                if (!data) return;
                var wageRates = (data.wage_rates || []).map(function (w) {
                    var el = document.getElementById('econ-wage-' + w.id);
                    return { id: w.id, hourly_rate: el ? el.value : w.hourly_rate };
                });
                var invalidJson = false;
                var billProducts = (data.bill_products || []).map(function (p) {
                    var amountEl = document.getElementById('econ-bill-' + p.id);
                    var optEl = document.getElementById('econ-bill-opt-' + p.id);
                    var spec = { id: p.id };
                    var has = false;
                    if (amountEl) {
                        spec.amount = amountEl.value;
                        has = true;
                    }
                    if (optEl) {
                        try {
                            spec.options = JSON.parse(optEl.value || '{}');
                            has = true;
                        } catch (err) {
                            invalidJson = true;
                            showMsg(msg, 'Invalid JSON for ' + p.name, false);
                            return null;
                        }
                    }
                    return has ? spec : null;
                }).filter(Boolean);
                if (invalidJson) return;
                fetch('/api/economy/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        default_pay_track: (document.getElementById('econ-default-track') || {}).value,
                        late_fee_per_day: (document.getElementById('econ-late-fee') || {}).value,
                        wage_rates: wageRates,
                        bill_products: billProducts
                    })
                }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, data: body }; }); })
                    .then(function (res) {
                        showMsg(msg, res.ok ? 'Economy settings saved.' : ((res.data && res.data.error) || 'Save failed.'), res.ok);
                        if (res.ok) loadEconomyAdminSettings();
                    })
                    .catch(function () { showMsg(msg, 'Save failed.', false); });
            });
        }
        var genBtn = document.getElementById('economy-admin-generate-btn');
        if (genBtn) {
            genBtn.addEventListener('click', function () {
                fetch('/api/economy/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: '{}'
                }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, data: body }; }); })
                    .then(function (res) {
                        if (!res.ok) {
                            showMsg(msg, (res.data && res.data.error) || 'Generate failed.', false);
                            return;
                        }
                        showMsg(msg, 'Created ' + (res.data.bills_created || 0) + ' bills and ' + (res.data.fees_created || 0) + ' miss fees.', true);
                    })
                    .catch(function () { showMsg(msg, 'Generate failed.', false); });
            });
        }
    }

    window.loadBillsView = loadBillsView;
    window.loadEconomyAdminSettings = loadEconomyAdminSettings;
})();
