(function () {
    'use strict';

    // Weekly bills: bill pay list, realistic statements with a payment coupon,
    // plan picker, emergency-fund savings, assistance applications, history,
    // plus the staff class overview and the admin economy settings.

    var state = {
        studentId: null,
        economy: null,
        tab: 'week',
        overview: null,
        showOverview: false,
        app: null,
        planDraft: null,
        planDirty: false,
        loading: false
    };
    var bound = false;
    var searchBound = false;
    var adminBound = false;
    var draftTimer = null;

    var currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    var PAYEE_COLORS = {
        rent: '#8a5a2b', electric: '#b7791f', internet: '#1d6fb8', renters: '#0f766e',
        groceries: '#2f7d32', health: '#6d4bb3', savings: '#4b5563', student_loan: '#334155',
        cell: '#4338ca', car_loan: '#b91c1c', car_insurance: '#9a3412', fuel: '#0e7490'
    };
    var STATUS_RANK = { due_tonight: 0, due_soon: 1, due: 2, late: 3, paid: 4, skipped: 5, waived: 6 };

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function fmt(value) {
        var n = Number(value);
        if (!isFinite(n)) n = 0;
        return currency.format(n);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseAmount(value) {
        if (value == null) return NaN;
        var cleaned = String(value).replace(/[$,\s]/g, '');
        if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return NaN;
        return Math.round(parseFloat(cleaned) * 100) / 100;
    }

    function isStaff() {
        return !!(window.currentUser && ['staff', 'admin'].indexOf(window.currentUser.role) !== -1);
    }

    function dateOf(iso) {
        return iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00') : null;
    }

    function shortDate(iso) {
        var d = dateOf(iso);
        return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    }

    function dayDate(iso) {
        var d = dateOf(iso);
        return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    }

    function fullDate(iso) {
        var d = dateOf(iso);
        return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    }

    function dateTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function api(url, options) {
        var opts = Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, options || {});
        return fetch(url, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                return { ok: r.ok, status: r.status, data: data || {} };
            });
        });
    }

    function initials(name) {
        var words = String(name || '').replace(/&/g, ' ').split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[1][0]).toUpperCase();
    }

    function colorFor(slug) {
        return PAYEE_COLORS[slug] || '#57534e';
    }

    function logoHtml(bill) {
        return '<div class="bills2-logo" style="background:' + colorFor(bill.slug) + '">' + esc(initials(bill.payee)) + '</div>';
    }

    function body() {
        return document.getElementById('bills-body');
    }

    function setSubtitle(text) {
        var el = document.getElementById('bills-subtitle');
        if (el) el.textContent = text || '';
    }

    function firstName(name) {
        return String(name || '').split(/\s+/)[0] || '';
    }

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    function loadEconomy(studentId, keepTab) {
        if (!studentId) return Promise.resolve();
        state.studentId = studentId;
        state.showOverview = false;
        if (!keepTab) {
            state.app = null;
            state.planDraft = null;
            state.planDirty = false;
        }
        state.loading = true;
        if (!state.economy || state.economy.student_id !== studentId) {
            body().innerHTML = '<div class="bills2-empty">Loading bills...</div>';
        }
        return api('/api/economy/student/' + studentId).then(function (res) {
            state.loading = false;
            if (!res.ok) {
                body().innerHTML = '<div class="bills2-empty"><h3>Bills could not load</h3>' + esc(res.data.error || 'Try again in a moment.') + '</div>';
                return;
            }
            setEconomy(res.data);
        });
    }

    function setEconomy(data) {
        state.economy = data;
        if (!state.planDirty) state.planDraft = null;
        render();
    }

    function refresh() {
        if (state.studentId) return loadEconomy(state.studentId, true);
        return Promise.resolve();
    }

    // ------------------------------------------------------------------
    // Page frame
    // ------------------------------------------------------------------

    function render() {
        syncTabs();
        var overviewBtn = document.getElementById('bills-overview-btn');
        if (overviewBtn) overviewBtn.classList.toggle('active', !!(state.showOverview || !state.studentId));
        if (isStaff() && (state.showOverview || !state.studentId)) {
            renderOverview();
            return;
        }
        var e = state.economy;
        if (!e) return;
        var who = isStaff() ? e.student_name + ' · ' : '';
        if (!e.enrolled) {
            setSubtitle(who + 'Bills are off');
        } else {
            setSubtitle(who + 'Week of ' + e.week.label + ' · Bills due ' + e.week.due_label + ' at 11:59 PM');
        }
        var html = isStaff() ? staffPanelHtml(e) : '';
        if (!e.enrolled && !isStaff()) {
            body().innerHTML = '<div class="bills2-empty"><h3>Bills aren\'t turned on for you yet</h3>' +
                'Your teacher will turn them on. Then you\'ll get bills every Monday, due the next Monday at 11:59 PM.</div>';
            return;
        }
        if (state.tab === 'plan') html += planHtml(e);
        else if (state.tab === 'savings') html += savingsHtml(e);
        else if (state.tab === 'assistance') html += state.app ? applicationHtml(state.app) : assistanceHtml(e);
        else if (state.tab === 'history') html += historyHtml(e);
        else html += weekHtml(e);
        body().innerHTML = html;
        afterRender();
    }

    function syncTabs() {
        var tabs = document.getElementById('bills-tabs');
        if (!tabs) return;
        var hide = isStaff() && (state.showOverview || !state.studentId);
        tabs.style.visibility = hide ? 'hidden' : 'visible';
        tabs.querySelectorAll('.bills2-tab').forEach(function (btn) {
            var active = btn.getAttribute('data-tab') === state.tab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            var badge = btn.querySelector('.bills2-tab-badge');
            if (badge) badge.remove();
            if (btn.getAttribute('data-tab') === 'week' && state.economy && state.economy.summary) {
                var count = (state.economy.bills || []).filter(function (b) {
                    return b.status_tone === 'due_tonight' || b.status_tone === 'due_soon';
                }).length;
                if (count) {
                    var span = document.createElement('span');
                    span.className = 'bills2-tab-badge';
                    span.textContent = String(count);
                    btn.appendChild(span);
                }
            }
        });
    }

    function afterRender() {
        var root = body();
        if (!root) return;
        if (state.tab === 'assistance' && state.app) bindApplicationInputs(root);
        if (state.tab === 'plan') bindPlanInputs(root);
    }

    // ------------------------------------------------------------------
    // This week
    // ------------------------------------------------------------------

    function serviceText(bill) {
        var lines = bill.lines || [];
        var meta = bill.meta || {};
        var text = bill.service;
        var first = lines.length ? String(lines[0].label || '') : '';
        var paren = first.match(/\(([^)]+)\)\s*$/);
        if (bill.slug === 'rent' && first) text = first.replace(/^Rent:\s*/, '');
        else if (bill.slug === 'renters' && paren) text = 'Renters insurance · ' + paren[1];
        else if (bill.slug === 'electric' && meta.kwh != null) text = 'Electricity · ' + meta.kwh + ' kWh';
        else if (bill.slug === 'groceries') text = 'Groceries receipt' + (meta.plan ? ' · ' + meta.plan : '');
        else if (bill.slug === 'health') text = 'Health insurance' + (meta.plan ? ' · ' + meta.plan : '');
        else if (bill.slug === 'savings') text = 'Emergency fund · pay yourself first';
        else if (bill.slug === 'student_loan') text = meta.loan_label || 'Student loan';
        else if (first) text = bill.service + ' · ' + first.replace(/ (plan|premium)$/i, '');
        if (meta.final_bill) text = bill.service + ' · final bill';
        return text;
    }

    function billRowHtml(bill, options) {
        options = options || {};
        var open = bill.status === 'unpaid' || bill.status === 'partial';
        var amount = open ? bill.remaining : bill.amount_due;
        var note = '';
        if (open && bill.paid_amount > 0) note = '<small>' + fmt(bill.paid_amount) + ' paid</small>';
        else if (open && bill.previous_balance > 0) note = '<small>incl. ' + fmt(bill.previous_balance) + ' past due</small>';
        var action = '';
        if (!options.readOnly && open) {
            action = '<button type="button" class="bills2-btn ' + (bill.kind === 'savings' ? '' : 'bills2-btn-primary') + '" data-open-bill="' + bill.id + '">' +
                (bill.kind === 'savings' ? 'Save' : 'Pay') + '</button>';
        } else {
            action = '<button type="button" class="bills2-btn" data-open-bill="' + bill.id + '">View</button>';
        }
        return '<div class="bills2-row' + (open ? '' : ' is-done') + '" data-open-bill="' + bill.id + '">' +
            logoHtml(bill) +
            '<div style="min-width:0"><div class="bills2-payee">' + esc(bill.payee) + '</div>' +
            '<div class="bills2-service">' + esc(serviceText(bill)) + '</div></div>' +
            '<div class="bills2-service">Week of ' + esc(shortDate(bill.week)) + '</div>' +
            '<div><span class="bills2-chip tone-' + esc(bill.status_tone) + '">' + esc(bill.status_label) + '</span></div>' +
            '<div class="bills2-amount">' + fmt(amount) + note + '</div>' +
            '<div class="bills2-row-action">' + action + '</div>' +
            '</div>';
    }

    function listHtml(bills, options) {
        if (!bills.length) return '';
        return '<div class="bills2-list">' +
            '<div class="bills2-list-head"><span></span><span>Pay to</span><span>Bill for</span><span>Status</span>' +
            '<span style="text-align:right">Amount</span><span></span></div>' +
            bills.map(function (b) { return billRowHtml(b, options); }).join('') +
            '</div>';
    }

    function tilesHtml(e) {
        var s = e.summary;
        var left = s.left_after_bills;
        var goal = e.savings.goal || 0;
        return '<div class="bills2-tiles">' +
            tile('Checking', fmt(e.balances.checking), 'Money you can spend or pay bills with') +
            tile('Due this week', fmt(s.due_now), s.open_count ? (s.open_count + ' open ' + (s.open_count === 1 ? 'bill' : 'bills')) : 'All paid') +
            tile('Left after bills', fmt(left), left < 0 ? 'Not enough yet' : 'For the Marketplace and savings', left < 0 ? 'bills2-bad' : 'bills2-good') +
            tile('Emergency fund', fmt(e.balances.savings), goal ? ('Goal: ' + fmt(goal)) : 'Savings') +
            '</div>';
    }

    function tile(label, value, note, cls) {
        return '<div class="bills2-tile"><p class="bills2-tile-label">' + esc(label) + '</p>' +
            '<p class="bills2-tile-value ' + (cls || '') + '">' + esc(value) + '</p>' +
            (note ? '<p class="bills2-tile-note">' + esc(note) + '</p>' : '') + '</div>';
    }

    function weekHtml(e) {
        if (!e.enrolled) {
            return '<div class="bills2-empty"><h3>Bills are off for ' + esc(e.student_name) + '</h3>Turn them on above to start weekly bills next Monday.</div>';
        }
        var html = tilesHtml(e);
        var bills = e.bills || [];
        if (!bills.length) {
            var start = e.first_week ? dayDate(e.first_week) : 'next Monday';
            return html + '<div class="bills2-empty"><h3>No bills yet</h3>Your first bills arrive ' + esc(start) +
                '. Until then, set up <a href="#" data-go-tab="plan">your plan</a>: where you live, internet, insurance, and more.</div>';
        }
        if (e.summary.left_after_bills < 0 && e.summary.open_count) {
            html += '<div class="bills2-banner is-bad">You don\'t have enough in checking to pay everything yet. ' +
                'Pay what you can now, and the rest after your next paycheck. Anything still unpaid after ' +
                esc(e.week.due_label) + ' at 11:59 PM gets a late fee and moves to next week\'s bill.</div>';
        } else if (!e.summary.open_count) {
            html += '<div class="bills2-banner is-good">Every bill for this week is paid. Nice work.</div>';
        }
        html += listHtml(bills);
        var fees = e.late_fees || {};
        html += '<p class="bills2-note">Late fees: rent ' + Math.round(Number(fees.rent_percent || 0.08) * 100) +
            '% of the late rent (Minnesota\'s legal limit), other bills ' + fmt(fees.other_flat || 5) +
            '. The emergency fund never has a late fee.</p>';
        return html;
    }

    // ------------------------------------------------------------------
    // Statement modal
    // ------------------------------------------------------------------

    function findBill(id) {
        var e = state.economy;
        if (!e) return null;
        var all = (e.bills || []).slice();
        (e.history || []).forEach(function (w) { all = all.concat(w.bills || []); });
        for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
        return null;
    }

    function openModal(html, wide) {
        var modal = document.getElementById('bills-modal');
        var content = document.getElementById('bills-modal-body');
        if (!modal || !content) return;
        content.innerHTML = html;
        modal.classList.toggle('is-wide', !!wide);
        modal.style.display = 'block';
        modal.setAttribute('aria-hidden', 'false');
        var focusable = content.querySelector('input:not([type="radio"]), button.bills2-btn-primary');
        if (focusable) setTimeout(function () { focusable.focus(); }, 30);
    }

    function closeModal() {
        var modal = document.getElementById('bills-modal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }

    function statementHtml(bill) {
        var e = state.economy;
        var open = bill.status === 'unpaid' || bill.status === 'partial';
        var color = colorFor(bill.slug);
        var isSavings = bill.kind === 'savings';
        var isReceipt = bill.slug === 'groceries' || bill.slug === 'fuel';
        var kicker = isSavings ? 'Transfer slip' : (isReceipt ? 'Weekly receipt' : bill.service + ' statement');
        var dueBox = open ? bill.remaining : bill.amount_due;
        var paymentsTotal = (bill.payments || []).reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);

        var html = '<div class="bills2-stmt" style="--stmt-color:' + color + '">';
        html += '<div class="bills2-stmt-head"><div class="bills2-stmt-brand">' + logoHtml(bill) +
            '<div><p class="bills2-stmt-company" id="bills-modal-title">' + esc(bill.payee) + '</p>' +
            '<p class="bills2-stmt-kicker">' + esc(kicker) + ' · Issued ' + esc(fullDate(bill.statement_date)) + '</p></div></div>' +
            '<div class="bills2-stmt-due"><span>' + (open ? 'Amount due' : 'Statement total') + '</span><strong>' + fmt(dueBox) + '</strong>' +
            '<span>' + (open ? 'Due by ' + esc(dayDate(bill.due_date)) + ', 11:59 PM' : esc(bill.status_label)) + '</span></div></div>';

        html += '<div class="bills2-stmt-meta">' +
            meta('Customer', e.student_name) +
            meta('Account number', bill.account_number || '-') +
            meta('Service period', shortDate(bill.period_start) + ' - ' + shortDate(bill.period_end)) +
            meta('Due date', dayDate(bill.due_date)) +
            '</div>';

        html += '<div class="bills2-stmt-cols"><div><h4>Account summary</h4>';
        if (bill.previous_balance > 0) {
            var from = (bill.meta && bill.meta.carried_from) ? bill.meta.carried_from.map(function (c) { return shortDate(c.week); }).join(', ') : '';
            html += ln('Past due from last bill' + (from ? ' (' + from + ')' : ''), bill.previous_balance, 'is-late');
        }
        html += ln(isSavings ? 'Deposit this week' : 'New charges', bill.new_charges);
        if (bill.late_fee > 0) html += ln('Late fee', bill.late_fee, 'is-late');
        if (paymentsTotal > 0) html += ln('Payments received - thank you', -paymentsTotal, 'is-credit');
        html += ln(open ? 'Amount due' : 'Balance', open ? bill.remaining : Math.max(0, bill.amount_due - paymentsTotal), 'is-total');
        (bill.payments || []).forEach(function (p) {
            html += '<div class="bills2-help" style="font-size:11px;color:#666;margin-top:4px">Paid ' + esc(dateTime(p.paid_at)) +
                ' · ' + fmt(p.amount) + ' · Confirmation ' + esc(p.confirmation) + '</div>';
        });
        html += '</div><div><h4>' + (isReceipt ? 'Receipt' : (isSavings ? 'Transfer' : 'This week\'s charges')) + '</h4>';
        var lines = bill.lines || [];
        if (!lines.length) html += '<div class="bills2-ln"><span>No new charges</span><span>' + fmt(0) + '</span></div>';
        lines.forEach(function (line) {
            html += ln(line.label, Number(line.amount), line.kind === 'credit' ? 'is-credit' : '');
        });
        if (lines.length) html += ln('Total new charges', bill.new_charges, 'is-total');
        if (bill.slug === 'electric' && bill.usage_history && bill.usage_history.length) {
            html += usageHtml(bill);
        }
        html += '</div></div>';
        html += '<p class="bills2-stmt-msg">' + esc(statementMessage(bill)) + '</p>';

        if (open && (state.economy.can_edit_plan || isStaff())) {
            html += couponHtml(bill);
        }
        html += '</div>';
        if (isStaff() && open) html += staffBillActionsHtml(bill);
        return html;
    }

    function meta(label, value) {
        return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
    }

    function ln(label, amount, cls) {
        return '<div class="bills2-ln ' + (cls || '') + '"><span>' + esc(label) + '</span><span>' + fmt(amount) + '</span></div>';
    }

    function usageHtml(bill) {
        var hist = bill.usage_history.slice(-6);
        var max = Math.max.apply(null, hist.map(function (h) { return h.kwh; }).concat([1]));
        var bars = hist.map(function (h) {
            var now = h.week === bill.week;
            return '<div class="bills2-usage-bar' + (now ? ' is-now' : '') + '" style="height:' + Math.max(8, Math.round(h.kwh / max * 100)) + '%" title="' + h.kwh + ' kWh"></div>';
        }).join('');
        var labels = hist.map(function (h) { return '<span>' + esc(shortDate(h.week)) + '</span>'; }).join('');
        return '<div style="margin-top:14px;font-size:11px;color:#666">Electricity used (kWh), by week</div>' +
            '<div class="bills2-usage">' + bars + '</div><div class="bills2-usage-labels">' + labels + '</div>';
    }

    function statementMessage(bill) {
        var fees = (state.economy && state.economy.late_fees) || {};
        if (bill.kind === 'savings') {
            return 'This money moves from checking into your emergency fund. It stays yours. If you skip a week, there is no late fee.';
        }
        if (bill.status === 'carried') return 'This bill was not paid in time. A late fee was added and what you owed moved onto the next week\'s bill.';
        if (bill.status === 'waived') return 'Your teacher waived this bill' + (bill.waived_reason ? ': ' + bill.waived_reason : '.');
        if (bill.status === 'paid') return 'Paid in full. Thank you.';
        if (bill.slug === 'rent') {
            return 'Rent is due by ' + dayDate(bill.due_date) + ' at 11:59 PM. Minnesota law limits late fees to 8% of the late rent (' +
                fmt(Math.round(bill.new_charges * Number(fees.rent_percent || 0.08) * 100) / 100) + ' this week). Unpaid rent moves to next week\'s bill.';
        }
        if (bill.slug === 'student_loan') {
            var bal = bill.meta && bill.meta.balance_before;
            return 'Remaining loan balance before this payment: ' + fmt(bal || 0) + '. Paying on time lowers what you owe.';
        }
        return 'Pay by ' + dayDate(bill.due_date) + ' at 11:59 PM to avoid a ' + fmt(fees.other_flat || 5) + ' late fee.';
    }

    function couponHtml(bill) {
        var e = state.economy;
        var isSavings = bill.kind === 'savings';
        return '<form class="bills2-coupon" data-pay-bill="' + bill.id + '" novalidate>' +
            '<span class="bills2-coupon-cut">- - - cut here - - - payment coupon - - -</span>' +
            '<div class="bills2-coupon-head"><span>Pay to <b>' + esc(bill.payee) + '</b></span>' +
            '<span>Account <b>' + esc(bill.account_number || '-') + '</b></span>' +
            '<span>Due <b>' + esc(dayDate(bill.due_date)) + '</b></span>' +
            '<span>Amount due <b>' + fmt(bill.remaining) + '</b></span></div>' +
            '<div class="bills2-radio-row">' +
            '<label><input type="radio" name="pay-mode" value="full" checked> ' + (isSavings ? 'Save the full amount' : 'Pay the full amount due') + '</label>' +
            '<label><input type="radio" name="pay-mode" value="part"> ' + (isSavings ? 'Save part of it' : 'Pay part of it') + '</label>' +
            '</div>' +
            '<div class="bills2-coupon-grid">' +
            '<div class="bills2-field" data-field="amount"><label for="pay-amount">Amount you are ' + (isSavings ? 'saving' : 'paying') + '</label>' +
            '<input type="text" id="pay-amount" inputmode="decimal" autocomplete="off" placeholder="$0.00">' +
            '<div class="bills2-help">Find the amount due on the bill.</div><div class="bills2-error" hidden></div></div>' +
            '<div class="bills2-field" data-field="new_balance"><label for="pay-balance">Checking balance after this payment</label>' +
            '<input type="text" id="pay-balance" inputmode="decimal" autocomplete="off" placeholder="$0.00">' +
            '<div class="bills2-help">Your checking balance right now: <b>' + fmt(e.balances.checking) + '</b></div><div class="bills2-error" hidden></div></div>' +
            '</div>' +
            '<div class="bills2-coupon-actions"><button type="button" class="bills2-btn" data-close-modal>Cancel</button>' +
            '<button type="submit" class="bills2-btn bills2-btn-primary">' + (isSavings ? 'Move to savings' : 'Send payment') + '</button></div>' +
            '</form>';
    }

    function staffBillActionsHtml(bill) {
        return '<div class="bills2-staff-actions"><p>Staff only</p><div class="bills2-inline">' +
            '<button type="button" class="bills2-btn" data-staff-pay="' + bill.id + '">Pay ' + fmt(bill.remaining) + ' from checking (no math)</button>' +
            '<input type="text" id="bills-waive-reason" placeholder="Reason for waiving" maxlength="200">' +
            '<button type="button" class="bills2-btn bills2-btn-danger" data-staff-waive="' + bill.id + '">Waive</button>' +
            '</div><div class="bills2-error" id="bills-staff-error" hidden></div></div>';
    }

    function openStatement(id) {
        var bill = findBill(id);
        if (!bill) return;
        openModal(statementHtml(bill));
    }

    function showFieldError(form, field, message) {
        var box = form.querySelector('[data-field="' + field + '"]');
        if (!box) return;
        box.classList.toggle('has-error', !!message);
        var err = box.querySelector('.bills2-error');
        if (err) {
            err.textContent = message || '';
            err.hidden = !message;
        }
    }

    function submitPayment(form) {
        var billId = Number(form.getAttribute('data-pay-bill'));
        var bill = findBill(billId);
        if (!bill) return;
        var mode = (form.querySelector('input[name="pay-mode"]:checked') || {}).value || 'full';
        var amountRaw = form.querySelector('#pay-amount').value;
        var balanceRaw = form.querySelector('#pay-balance').value;
        showFieldError(form, 'amount', '');
        showFieldError(form, 'new_balance', '');
        var amount = parseAmount(amountRaw);
        var balance = parseAmount(balanceRaw);
        var bad = false;
        if (isNaN(amount) || amount <= 0) {
            showFieldError(form, 'amount', 'Enter how much you are paying, like 25.50.');
            bad = true;
        }
        if (isNaN(balance)) {
            showFieldError(form, 'new_balance', 'Enter your checking balance after this payment.');
            bad = true;
        }
        if (bad) return;
        var button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        api('/api/economy/bills/' + billId + '/pay', {
            method: 'POST',
            body: JSON.stringify({ mode: mode, amount: amount.toFixed(2), new_balance: balance.toFixed(2) })
        }).then(function (res) {
            if (button) button.disabled = false;
            if (!res.ok) {
                var errors = res.data.errors || {};
                if (errors.amount) showFieldError(form, 'amount', errors.amount);
                if (errors.new_balance) showFieldError(form, 'new_balance', errors.new_balance);
                if (!errors.amount && !errors.new_balance) showFieldError(form, 'amount', res.data.error || 'That payment did not go through.');
                return;
            }
            state.economy = res.data.economy;
            render();
            openModal(receiptHtml(res.data.receipt, bill));
        }).catch(function () {
            if (button) button.disabled = false;
            showFieldError(form, 'amount', 'The payment did not go through. Check your connection and try again.');
        });
    }

    function receiptHtml(receipt, bill) {
        var partial = receipt.status === 'partial';
        var savings = bill && bill.kind === 'savings';
        return '<div class="bills2-receipt"><div class="bills2-receipt-check">&#10003;</div>' +
            '<h3 id="bills-modal-title">' + (savings ? 'Moved to savings' : 'Payment sent') + '</h3>' +
            '<p style="margin:0;color:#6b6560">' + esc(receipt.payee) + '</p><dl>' +
            '<div><dt>Confirmation number</dt><dd>' + esc(receipt.confirmation) + '</dd></div>' +
            '<div><dt>Amount</dt><dd>' + fmt(receipt.amount) + '</dd></div>' +
            '<div><dt>Date</dt><dd>' + esc(dateTime(receipt.paid_at)) + '</dd></div>' +
            '<div><dt>Checking balance now</dt><dd>' + fmt(receipt.new_balance) + '</dd></div>' +
            (partial ? '<div><dt>Still owed on this bill</dt><dd style="color:#b91c1c">' + fmt(receipt.remaining) + '</dd></div>' : '') +
            '</dl>' +
            (partial ? '<p class="bills2-note" style="margin-bottom:14px">Pay the rest before the due date to avoid a late fee.</p>' : '') +
            '<button type="button" class="bills2-btn bills2-btn-primary" data-close-modal>Done</button></div>';
    }

    function staffPay(billId) {
        var err = document.getElementById('bills-staff-error');
        api('/api/economy/bills/' + billId + '/staff-pay', { method: 'POST', body: JSON.stringify({ action: 'pay' }) }).then(function (res) {
            if (!res.ok) {
                if (err) { err.textContent = res.data.error || 'Could not pay this bill.'; err.hidden = false; }
                return;
            }
            closeModal();
            state.economy = res.data.economy;
            render();
        });
    }

    function staffWaive(billId) {
        var err = document.getElementById('bills-staff-error');
        var reason = (document.getElementById('bills-waive-reason') || {}).value || '';
        if (!reason.trim()) {
            if (err) { err.textContent = 'Type a reason before waiving.'; err.hidden = false; }
            return;
        }
        if (!window.confirm('Waive this bill? The student will not have to pay it.')) return;
        api('/api/economy/bills/' + billId + '/staff-pay', { method: 'POST', body: JSON.stringify({ action: 'waive', reason: reason.trim() }) }).then(function (res) {
            if (!res.ok) {
                if (err) { err.textContent = res.data.error || 'Could not waive this bill.'; err.hidden = false; }
                return;
            }
            closeModal();
            state.economy = res.data.economy;
            render();
        });
    }

    // ------------------------------------------------------------------
    // My plan
    // ------------------------------------------------------------------

    function planChoices() {
        var e = state.economy;
        if (!state.planDraft) state.planDraft = Object.assign({}, e.plan.choices);
        return state.planDraft;
    }

    function sectionFor(key) {
        return (state.economy.plan.sections || []).filter(function (s) { return s.key === key; })[0];
    }

    function optionFor(key, id) {
        var sec = sectionFor(key);
        if (!sec) return null;
        return sec.options.filter(function (o) { return o.id === id; })[0] || null;
    }

    function planTotals() {
        var e = state.economy;
        var c = planChoices();
        var est = e.plan.estimates || {};
        var roommate = (est.roommate_ids || []).indexOf(c.housing) !== -1;
        var items = [];
        function add(label, amount) { if (amount > 0) items.push({ label: label, amount: amount }); }
        var housing = optionFor('housing', c.housing);
        add('Rent', housing ? housing.weekly : 0);
        add('Electricity (about)', (est.electric_by_housing || {})[c.housing] || 0);
        var internet = optionFor('internet', c.internet);
        var internetTotal = internet ? internet.weekly + (est.internet_equipment || 0) : 0;
        if (roommate) internetTotal = Math.round(internetTotal / 2 * 100) / 100;
        add('Internet', internetTotal);
        var health = optionFor('health', c.health);
        add('Health insurance', health ? health.weekly : 0);
        var groceries = optionFor('groceries', c.groceries);
        add('Groceries', groceries ? groceries.weekly : 0);
        var renters = optionFor('renters', c.renters);
        add('Renters insurance', renters ? renters.weekly : 0);
        if (e.plan.student_loan) add('Student loan', e.plan.student_loan.weekly);
        var cell = optionFor('cell', c.cell);
        add('Cell phone', cell ? cell.weekly : 0);
        var vehicle = optionFor('vehicle', c.vehicle);
        if (vehicle && c.vehicle !== 'none') {
            add('Car, gas, and repairs', vehicle.weekly);
            var ins = optionFor('car_insurance', c.car_insurance);
            add('Car insurance', ins ? ins.weekly : 0);
        }
        var spending = items.reduce(function (s, i) { return s + i.amount; }, 0);
        var savings = optionFor('savings', c.savings);
        var saving = savings ? savings.weekly : 0;
        return { items: items, spending: spending, saving: saving, total: spending + saving };
    }

    function planHtml(e) {
        if (!e.enrolled && !isStaff()) return '';
        var c = planChoices();
        var html = '<div class="bills2-plan"><div>';
        if (state.planMessage) {
            html += '<div class="bills2-banner ' + (state.planMessage.good ? 'is-good' : 'is-bad') + '">' + esc(state.planMessage.text) + '</div>';
        }
        html += '<p class="bills2-note" style="margin:0 0 14px">Pick how you want to live. Every choice shows what it costs each week. ' +
            'Changes start with next week\'s bills (' + esc(e.plan.applies_label) + ').</p>';
        (e.plan.sections || []).forEach(function (sec) {
            if (sec.key === 'car_insurance' && (!c.vehicle || c.vehicle === 'none')) return;
            html += planSectionHtml(sec, c);
            if (sec.key === 'savings' && e.plan.student_loan) {
                html += '<div class="bills2-plan-section"><h3>Student loan</h3><p>Required. You borrowed to earn your degree, so you pay it back every week.</p>' +
                    '<div class="bills2-options"><div class="bills2-option is-selected" style="cursor:default"><span class="bills2-option-name">' + esc(e.plan.student_loan.label) + '</span>' +
                    '<span class="bills2-option-detail">Balance left: ' + fmt(e.plan.student_loan.balance) + '</span>' +
                    '<span class="bills2-option-price">' + fmt(e.plan.student_loan.weekly) + ' <small>a week</small></span></div></div></div>';
            }
        });
        html += '</div>' + planSideHtml(e) + '</div>' + planBarHtml(e);
        return html;
    }

    function planBarHtml(e) {
        var t = planTotals();
        var inc = e.income || {};
        var left = inc.take_home_90 != null ? inc.take_home_90 - t.total : null;
        return '<div class="bills2-plan-bar"><div class="bills2-plan-bar-inner">' +
            '<span>Weekly bills <b>' + fmt(t.total) + '</b></span>' +
            (left != null ? '<span>Left at 90% <b class="' + (left < 0 ? 'bills2-bad' : 'bills2-good') + '">' + fmt(left) + '</b></span>' : '') +
            (e.can_edit_plan ? '<button type="button" class="bills2-btn bills2-btn-primary" data-save-plan' + (state.planDirty ? '' : ' disabled') + '>' +
                (state.planDirty ? 'Save my plan' : 'Plan saved') + '</button>' : '') +
            '</div></div>';
    }

    function planSectionHtml(sec, choices) {
        var vehicle = optionFor('vehicle', choices.vehicle);
        var needsFull = !!(vehicle && vehicle.breakdown && vehicle.breakdown.loan > 0);
        var tag = sec.key === 'car_insurance' ? 'required with a car' : (sec.required ? '' : 'optional');
        var html = '<div class="bills2-plan-section"><h3>' + esc(sec.title) + (tag ? ' <span style="font-weight:400;font-size:13px;color:#6b6560">(' + tag + ')</span>' : '') + '</h3>';
        if (sec.key === 'housing' && state.economy.plan.housing_note) html += '<p>' + esc(state.economy.plan.housing_note) + '</p>';
        else if (sec.note) html += '<p>' + esc(sec.note) + '</p>';
        html += '<div class="bills2-options" role="radiogroup" aria-label="' + esc(sec.title) + '">';
        sec.options.forEach(function (o) {
            var selected = choices[sec.key] === o.id;
            var disabled = sec.key === 'car_insurance' && o.id === 'liability' && needsFull;
            var detail = o.detail || '';
            if (sec.key === 'housing' && o.payee) detail = o.payee + '. ' + detail;
            if (sec.key === 'vehicle' && o.breakdown && o.id !== 'none') {
                detail += ' Loan ' + fmt(o.breakdown.loan) + ' + gas ' + fmt(o.breakdown.fuel) + ' + repairs ' + fmt(o.breakdown.upkeep) + ' a week, plus insurance.';
            }
            if (disabled) detail = 'Not allowed: a car with a loan needs full coverage.';
            html += '<label class="bills2-option' + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + '">' +
                '<input type="radio" name="plan-' + sec.key + '" value="' + esc(o.id) + '"' + (selected ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
                '<span class="bills2-option-check"></span>' +
                '<span class="bills2-option-name">' + esc(o.label) + '</span>' +
                '<span class="bills2-option-detail">' + esc(detail) + '</span>' +
                '<span class="bills2-option-price">' + (o.weekly > 0 ? fmt(o.weekly) + ' <small>a week' + (o.monthly && sec.key !== 'savings' ? ' · about $' + Math.round(o.monthly).toLocaleString('en-US') + '/mo' : '') + '</small>' : '$0 <small>a week</small>') + '</span>' +
                '</label>';
        });
        html += '</div></div>';
        return html;
    }

    function planSideHtml(e) {
        var t = planTotals();
        var inc = e.income || {};
        var html = '<aside class="bills2-plan-side"><h3>Your weekly bills</h3>';
        t.items.forEach(function (i) { html += ln(i.label, i.amount); });
        html += ln('Emergency fund (you keep it)', t.saving);
        html += ln('Total each week', t.total, 'is-total');
        html += '<p class="bills2-note" style="margin-top:6px">Electricity changes with the weather. Help from an approved application lowers these bills.</p>';
        if (inc.take_home_90 != null) {
            var left = inc.take_home_90 - t.total;
            html += '<div style="margin-top:14px"><h3>Your pay</h3>' +
                ln('Take-home, full week at 100%', inc.take_home_100) +
                ln('Take-home, full week at 90%', inc.take_home_90) +
                (inc.last_paycheck ? ln('Your last paycheck', inc.last_paycheck.final_pay) : '') +
                '<p class="bills2-tile-label" style="margin-top:10px">Left each week at 90%</p>' +
                '<p class="bills2-plan-big ' + (left < 0 ? 'bills2-bad' : 'bills2-good') + '">' + fmt(left) + '</p>' +
                '<p class="bills2-note" style="margin:0">' + (left < 0
                    ? 'Your bills cost more than you take home. A roommate, cheaper choices, or an assistance application can help.'
                    : 'That\'s what you have for the Marketplace and extra savings.') + '</p></div>';
        }
        html += '</aside>';
        return html;
    }

    function bindPlanInputs(root) {
        root.querySelectorAll('input[type="radio"][name^="plan-"]').forEach(function (input) {
            input.addEventListener('change', function () {
                var key = input.name.replace('plan-', '');
                var choices = planChoices();
                choices[key] = input.value;
                if (key === 'vehicle') {
                    var v = optionFor('vehicle', input.value);
                    if (v && v.breakdown && v.breakdown.loan > 0) choices.car_insurance = 'full';
                }
                state.planDirty = true;
                state.planMessage = null;
                render();
            });
        });
    }

    function savePlan() {
        if (!state.studentId) return;
        api('/api/economy/student/' + state.studentId + '/plan', {
            method: 'PUT',
            body: JSON.stringify({ plan: planChoices() })
        }).then(function (res) {
            if (!res.ok) {
                state.planMessage = { good: false, text: res.data.error || 'Your plan did not save.' };
                render();
                return;
            }
            state.planDirty = false;
            state.planDraft = null;
            var problems = (res.data.problems || []).join(' ');
            state.planMessage = { good: true, text: (res.data.message || 'Saved.') + (problems ? ' ' + problems : '') };
            state.economy = res.data;
            render();
        });
    }

    // ------------------------------------------------------------------
    // Savings
    // ------------------------------------------------------------------

    function savingsHtml(e) {
        var s = e.savings;
        var pct = s.goal > 0 ? Math.min(100, Math.round(s.balance / s.goal * 100)) : 0;
        var html = '<div class="bills2-savings"><div class="bills2-card"><h3>Emergency fund</h3>' +
            '<p class="bills2-plan-big">' + fmt(s.balance) + '</p>' +
            '<div class="bills2-progress" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
            '<p class="bills2-note" style="margin:0">' + pct + '% of your goal: ' + fmt(s.goal) + ' (' + s.goal_weeks +
            ' weeks of bills). Experts say to save 3 months of expenses for surprises like a car repair or a medical bill.</p>';
        if (state.savingsMessage) {
            html += '<div class="bills2-banner ' + (state.savingsMessage.good ? 'is-good' : 'is-bad') + '" style="margin:12px 0 0">' + esc(state.savingsMessage.text) + '</div>';
        }
        html += '</div><div class="bills2-card"><h3>Move money</h3>' +
            '<p class="bills2-note" style="margin:0">Checking: ' + fmt(e.balances.checking) + ' · Emergency fund: ' + fmt(s.balance) + '</p>' +
            '<form class="bills2-inline-form" data-savings="to_checking" novalidate><div class="bills2-field" data-field="amount">' +
            '<label for="sav-out">Use my emergency fund</label><input type="text" id="sav-out" inputmode="decimal" placeholder="$0.00">' +
            '<div class="bills2-error" hidden></div></div><button type="submit" class="bills2-btn">Move to checking</button></form>' +
            '<form class="bills2-inline-form" data-savings="to_savings" novalidate><div class="bills2-field" data-field="amount">' +
            '<label for="sav-in">Add extra to savings</label><input type="text" id="sav-in" inputmode="decimal" placeholder="$0.00">' +
            '<div class="bills2-error" hidden></div></div><button type="submit" class="bills2-btn">Move to savings</button></form>' +
            '<p class="bills2-note">Your weekly emergency fund deposit is on your bills list. You pick the amount in My plan.</p></div></div>';
        return html;
    }

    function submitSavings(form) {
        var direction = form.getAttribute('data-savings');
        var input = form.querySelector('input');
        var amount = parseAmount(input && input.value);
        showFieldError(form, 'amount', '');
        if (isNaN(amount) || amount <= 0) {
            showFieldError(form, 'amount', 'Enter an amount, like 20.00.');
            return;
        }
        if (direction === 'to_checking') {
            openModal('<div class="bills2-confirm"><h3 id="bills-modal-title">Use your emergency fund?</h3>' +
                '<p>Your emergency fund is for surprises, like a car repair, a doctor bill, or a week you can\'t work.</p>' +
                '<p>Move <b>' + fmt(amount) + '</b> from your emergency fund to checking?</p>' +
                '<div class="bills2-coupon-actions"><button type="button" class="bills2-btn" data-close-modal>Keep it saved</button>' +
                '<button type="button" class="bills2-btn bills2-btn-primary" data-confirm-savings="' + amount.toFixed(2) + '">Yes, use my emergency fund</button></div></div>');
            return;
        }
        doSavingsTransfer('to_savings', amount, false);
    }

    function doSavingsTransfer(direction, amount, confirmed) {
        api('/api/economy/student/' + state.studentId + '/savings/transfer', {
            method: 'POST',
            body: JSON.stringify({ direction: direction, amount: Number(amount).toFixed(2), confirm: !!confirmed })
        }).then(function (res) {
            closeModal();
            if (!res.ok) {
                state.savingsMessage = { good: false, text: res.data.error || 'That transfer did not go through.' };
                render();
                return;
            }
            state.savingsMessage = { good: true, text: 'Moved ' + fmt(amount) + (direction === 'to_checking' ? ' to checking.' : ' to your emergency fund.') };
            state.economy = res.data.economy;
            render();
        });
    }

    // ------------------------------------------------------------------
    // Assistance
    // ------------------------------------------------------------------

    function assistanceHtml(e) {
        var html = '<p class="bills2-note" style="margin:0 0 14px">Real programs help people pay for food, health care, and housing. ' +
            'To get help, fill out the application for each program. Every answer has to be right before it\'s approved, just like a real caseworker would check.</p>' +
            '<div class="bills2-programs">';
        (e.assistance || []).forEach(function (p) {
            var status = '', button = 'Start application';
            if (p.status === 'approved') {
                status = '<span class="bills2-chip tone-paid">Approved</span> Help starts with bills on ' + esc(dayDate(p.effective_week)) + '.';
                button = 'View notice';
            } else if (p.status === 'revoked') {
                status = '<span class="bills2-chip tone-late">Stopped by your teacher</span>';
                button = 'Open application';
            } else if (p.attempts > 0) {
                status = '<span class="bills2-chip tone-due_soon">Needs fixing</span> Submitted ' + p.attempts + (p.attempts === 1 ? ' time' : ' times') + '.';
                button = 'Fix and resubmit';
            } else if (p.status === 'draft') {
                status = '<span class="bills2-chip">Started</span>';
                button = 'Keep going';
            }
            html += '<div class="bills2-program"><h3>' + esc(p.program_name) + '</h3>' +
                '<div class="bills2-program-form">' + esc(p.title) + ' · ' + esc(p.form_number) + '</div>' +
                '<p>' + esc(p.summary) + '</p>' +
                (status ? '<p>' + status + '</p>' : '') +
                '<button type="button" class="bills2-btn ' + (p.status === 'approved' ? '' : 'bills2-btn-primary') + '" data-open-app="' + p.program + '">' + button + '</button>' +
                (isStaff() && p.status !== 'not_started' ? '<div class="bills2-inline" style="display:flex;gap:6px;margin-top:6px">' +
                    '<button type="button" class="bills2-btn" data-app-staff="reset" data-program="' + p.program + '">Reset</button>' +
                    (p.status === 'approved' ? '<button type="button" class="bills2-btn bills2-btn-danger" data-app-staff="revoke" data-program="' + p.program + '">Stop benefits</button>' : '') +
                    '</div>' : '') +
                '</div>';
        });
        html += '</div>';
        return html;
    }

    function openApplication(program) {
        api('/api/economy/student/' + state.studentId + '/applications/' + program).then(function (res) {
            if (!res.ok) return;
            state.app = {
                program: program,
                form: res.data.form,
                answers: res.data.answers || {},
                results: res.data.results || {},
                status: res.data.status,
                attempts: res.data.attempts || 0,
                notice: res.data.notice || null,
                message: null,
                showNotice: res.data.status === 'approved'
            };
            state.tab = 'assistance';
            render();
            window.scrollTo(0, 0);
        });
    }

    function applicationHtml(app) {
        if (app.showNotice && app.notice) return noticeHtml(app);
        var form = app.form;
        var html = '<button type="button" class="bills2-back" data-close-app>&larr; Back to assistance</button>';
        html += '<div class="gov-form style-' + esc(form.style) + '">';
        html += '<div class="gov-practice">Classroom practice copy of ' + esc(form.form_number) + ' ' + esc(form.revision) +
            ' (' + esc(form.agency) + '). Not a real application. Do not put real personal information on it.</div>';
        html += govHeaderHtml(form);
        html += '<div class="gov-rules"><h4>How to fill this out in class</h4><dl>' +
            (form.class_rules || []).map(function (r) { return '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.text) + '</dd>'; }).join('') +
            '</dl></div>';
        if (app.message) html += '<div class="gov-result ' + (app.message.good ? 'is-good' : 'is-bad') + '">' + esc(app.message.text) + '</div>';
        if (form.intro) html += '<p class="gov-intro">' + esc(form.intro) + '</p>';
        var sections = form.sections || [];
        sections.forEach(function (sec, idx) {
            html += govSectionHtml(sec, app);
            var next = sections[idx + 1];
            if (form.style === 'caf' && (!next || next.page !== sec.page)) {
                html += '<div class="gov-page"><span>Page ' + esc(sec.page) + ' of 12</span><span>' + esc(form.form_number) + ' ' + esc(form.revision) + '</span></div>';
            }
        });
        if (form.style === 'mhcp') {
            html += '<div class="gov-help-footer"><span class="gov-q">?</span><span>NEED HELP? In class, ask your teacher. ' +
                'For a real application, Minnesota\'s Department of Human Services has free help in many languages.</span></div>';
        }
        html += '<div class="gov-submit"><span class="bills2-note" style="margin:0">Your answers save as you type.</span>' +
            '<button type="button" class="bills2-btn bills2-btn-primary" data-submit-app>' + (app.attempts ? 'Resubmit application' : 'Submit application') + '</button></div>';
        html += '</div>';
        return html;
    }

    function govHeaderHtml(form) {
        if (form.style === 'hra') {
            return '<div class="gov-hra-top"><div class="gov-hra-seal">LAKES<br>REGION<br>HRA</div>' +
                '<div class="gov-hra-agency">' + esc(form.agency) + '<small>' + esc(form.agency_address || '') + '</small></div></div>' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div style="flex:1">' +
                '<h1>' + esc(form.title) + '</h1>' +
                (form.warning ? '<div class="gov-warning">' + esc(form.warning) + '</div>' : '') +
                '</div><div class="gov-office">For Office Use Only:<br>Time: ________</div></div>';
        }
        var left = form.style === 'caf'
            ? '<div class="gov-state">MINNESOTA</div><h1>' + esc(form.title) + '</h1>'
            : '<h1>' + esc(form.title) + '</h1>';
        var right = '<div class="gov-formno"><div class="gov-barcode"></div><div style="display:flex;justify-content:space-between"><span>' +
            esc(form.form_number) + '</span><span>' + esc(form.revision) + '</span></div>' +
            (form.style === 'caf' ? '<div style="font-size:12px;margin-top:4px">Apply online at: mnbenefits.mn.gov</div><div class="gov-case">CASE NUMBER</div>' : '') +
            '</div>';
        return '<div class="gov-header"><div>' + left + '</div>' + right + '</div>';
    }

    function govSectionHtml(sec, app) {
        var html = '<div class="gov-section">';
        if (sec.step) {
            html += '<div class="gov-step"><span class="gov-step-tab">' + esc(sec.step) + (sec.step_sub ? '<small>' + esc(sec.step_sub) + '</small>' : '') + '</span>' +
                '<span class="gov-step-title">' + esc(sec.step_title || '') + '</span></div>';
        }
        if (sec.heading) html += '<div class="gov-heading">' + esc(sec.heading) + '</div>';
        if (sec.statement) html += '<div class="gov-statement">' + esc(sec.statement) + '</div>';
        if (sec.note && !sec.box) html += '<p class="gov-note">' + esc(sec.note) + '</p>';
        if (sec.banner) html += '<div class="gov-banner">' + esc(sec.banner) + '</div>';
        var grid = '<div class="gov-grid">' + sec.rows.map(function (row) {
            return '<div class="gov-row">' + row.map(function (field) { return govCellHtml(field, app); }).join('') + '</div>';
        }).join('') + '</div>';
        if (sec.box) {
            html += '<div class="gov-box"><div class="gov-box-title">' + esc(sec.box) + '</div>' +
                (sec.note ? '<p class="gov-note">' + esc(sec.note) + '</p>' : '') + grid + '</div>';
        } else {
            if (sec.bar) html += '<div class="gov-bar">' + esc(sec.bar) + '</div>';
            if (sec.numbered) html += '<div class="gov-bar">' + esc(sec.numbered) + ' Income</div>';
            html += grid;
        }
        if (sec.legend) html += '<div class="gov-legend">' + esc(sec.legend) + '</div>';
        html += '</div>';
        return html;
    }

    function govCellHtml(field, app) {
        var span = Math.max(1, Math.min(12, Number(field.span) || 12));
        var value = app.answers[field.id];
        var result = app.results[field.id];
        var cls = 'gov-cell';
        var head = String(field.label || '').replace(/^\d+[a-z]?\.\s*/, '').split('(')[0];
        if (head !== head.toUpperCase() || app.form.style === 'hra') cls += ' is-question';
        if (field.type === 'disabled') cls += ' is-disabled';
        if (field.type === 'agency') cls += ' is-agency';
        if (result === false) cls += ' is-wrong';
        else if (result === true) cls += ' is-right';
        if (field.sign) cls += ' gov-sign';
        var html = '<div class="' + cls + '" style="grid-column: span ' + span + '" data-cell="' + esc(field.id) + '">';
        var label = '<span class="gov-label">' + esc(field.label) + (field.optional ? ' <em style="text-transform:none;color:#666">(optional)</em>' : '') + '</span>';
        var name = 'gov-' + field.id;
        if (field.type === 'radio') {
            html += label + '<div class="gov-opts">' + (field.options || []).map(function (o) {
                return '<label><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
            }).join('') + '</div>';
        } else if (field.type === 'checkboxes') {
            var picked = Array.isArray(value) ? value : [];
            var column = (field.options || []).length > 5;
            html += label + '<div class="gov-opts' + (column ? ' is-column' : '') + '">' + (field.options || []).map(function (o) {
                return '<label><input type="checkbox" name="' + name + '" value="' + esc(o[0]) + '"' + (picked.indexOf(o[0]) !== -1 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
            }).join('') + '</div>';
        } else if (field.type === 'checkbox') {
            html += '<div class="gov-opts"><label><input type="checkbox" name="' + name + '" value="1"' + (value ? ' checked' : '') + '> ' + esc(field.label) + '</label></div>';
        } else if (field.type === 'disabled') {
            html += label + '<div class="gov-na">' + esc(field.note || 'Not collected in this class') + '</div>';
        } else if (field.type === 'agency') {
            html += label + '<div class="gov-na" style="font-size:11px;color:#888;margin-top:8px">For agency use</div>';
        } else if (field.type === 'fixed') {
            html += label + '<div style="font-weight:700;margin-top:6px">' + esc(field.value || '') + '</div>';
        } else {
            html += label + '<input type="text" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' +
                (field.maxlength ? ' maxlength="' + Number(field.maxlength) + '"' : '') +
                (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
                (field.type === 'money' ? ' inputmode="decimal"' : '') + ' autocomplete="off" spellcheck="false">';
        }
        if (field.hint) html += '<span class="gov-hint">' + esc(field.hint) + '</span>';
        html += '</div>';
        return html;
    }

    function readApplicationAnswers(root) {
        var app = state.app;
        var answers = {};
        (app.form.sections || []).forEach(function (sec) {
            sec.rows.forEach(function (row) {
                row.forEach(function (field) {
                    var name = 'gov-' + field.id;
                    if (field.type === 'radio') {
                        var checked = root.querySelector('input[name="' + name + '"]:checked');
                        if (checked) answers[field.id] = checked.value;
                    } else if (field.type === 'checkboxes') {
                        answers[field.id] = Array.prototype.map.call(root.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; });
                    } else if (field.type === 'checkbox') {
                        var box = root.querySelector('input[name="' + name + '"]');
                        answers[field.id] = !!(box && box.checked);
                    } else if (['disabled', 'agency', 'fixed'].indexOf(field.type) === -1) {
                        var input = root.querySelector('input[name="' + name + '"]');
                        if (input) answers[field.id] = input.value;
                    }
                });
            });
        });
        return answers;
    }

    function bindApplicationInputs(root) {
        root.querySelectorAll('.gov-form input').forEach(function (input) {
            var handler = function () {
                if (!state.app) return;
                state.app.answers = readApplicationAnswers(root);
                var cell = input.closest('.gov-cell');
                if (cell && cell.classList.contains('is-wrong')) {
                    cell.classList.remove('is-wrong');
                    delete state.app.results[cell.getAttribute('data-cell')];
                }
                clearTimeout(draftTimer);
                draftTimer = setTimeout(saveDraft, 1200);
            };
            input.addEventListener(input.type === 'text' ? 'input' : 'change', handler);
        });
    }

    function saveDraft() {
        var app = state.app;
        if (!app || app.status === 'approved') return;
        api('/api/economy/student/' + state.studentId + '/applications/' + app.program + '/draft', {
            method: 'PUT',
            body: JSON.stringify({ answers: app.answers })
        });
    }

    function submitApplication() {
        var app = state.app;
        if (!app) return;
        clearTimeout(draftTimer);
        app.answers = readApplicationAnswers(body());
        api('/api/economy/student/' + state.studentId + '/applications/' + app.program + '/submit', {
            method: 'POST',
            body: JSON.stringify({ answers: app.answers })
        }).then(function (res) {
            if (!res.ok) {
                app.message = { good: false, text: res.data.error || 'Your application did not go through.' };
                render();
                return;
            }
            app.results = res.data.results || {};
            app.attempts = res.data.attempts || app.attempts;
            if (res.data.approved) {
                app.status = 'approved';
                app.notice = res.data.notice;
                app.showNotice = true;
                refresh();
            } else {
                var n = res.data.wrong_count;
                app.message = { good: false, text: n + (n === 1 ? ' answer needs' : ' answers need') + ' fixing. Look for the boxes marked "Check this", fix them, and resubmit. (' + res.data.score + '% correct)' };
            }
            render();
            window.scrollTo(0, 0);
        });
    }

    function noticeHtml(app) {
        var n = app.notice || {};
        var form = app.form;
        var what = { rent: 'your weekly rent', groceries: 'your weekly grocery bill', health: 'your health insurance premium' }[n.applies_to] || 'your bills';
        var html = '<button type="button" class="bills2-back" data-close-app>&larr; Back to assistance</button>' +
            '<div class="gov-notice"><div class="gov-practice">Classroom practice notice</div>' +
            '<p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#666">Notice of action</p>' +
            '<h2>' + (n.weekly > 0 ? 'Approved: ' : 'Processed: ') + esc(form.program_name) + '</h2>' +
            '<p style="margin:0;color:#555">' + esc(form.agency) + ' · Application ' + esc(form.form_number) + '</p>';
        if (n.weekly > 0) {
            html += '<div class="gov-amount">' + fmt(n.weekly) + ' a week</div>' +
                '<p style="margin:0 0 12px">off ' + what + ', starting with the bills issued <b>' + esc(n.effective_label || dayDate(n.effective_week)) + '</b>.</p>';
        } else {
            html += '<div class="gov-amount">$0.00 a week</div><p style="margin:0 0 12px">Your application is complete, but your income is too high for this program to pay anything right now.</p>';
        }
        html += '<h4 style="margin:14px 0 4px">How we figured it</h4><p style="margin:0">' + esc(n.explain || '') + '</p>' +
            '<p class="bills2-note">If your income or where you live changes, the amount on your bills can change too.</p></div>';
        return html;
    }

    function staffApplicationAction(program, action) {
        var label = action === 'revoke' ? 'Stop this student\'s benefits for this program?' : 'Reset this application so the student starts over?';
        if (!window.confirm(label)) return;
        api('/api/economy/student/' + state.studentId + '/applications/' + program + '/staff', {
            method: 'POST', body: JSON.stringify({ action: action })
        }).then(function () { refresh(); });
    }

    // ------------------------------------------------------------------
    // History
    // ------------------------------------------------------------------

    function historyHtml(e) {
        var weeks = e.history || [];
        if (!weeks.length) return '<div class="bills2-empty"><h3>No past weeks yet</h3>Bills from earlier weeks show up here.</div>';
        return weeks.map(function (w) {
            var total = w.bills.filter(function (b) { return b.kind === 'bill'; }).reduce(function (s, b) { return s + Number(b.new_charges || 0); }, 0);
            var late = w.bills.filter(function (b) { return b.status === 'carried'; }).length;
            return '<div class="bills2-week"><div class="bills2-section-title"><h3>Week of ' + esc(shortDate(w.week)) + '</h3>' +
                '<span>' + fmt(total) + ' in bills' + (late ? ' · ' + late + ' late' : ' · all on time') + '</span></div>' +
                listHtml(w.bills, { readOnly: true }) + '</div>';
        }).join('');
    }

    // ------------------------------------------------------------------
    // Staff: panel and class overview
    // ------------------------------------------------------------------

    function staffPanelHtml(e) {
        return '<div class="bills2-staff-panel">' +
            '<label class="bills2-switch"><input type="checkbox" data-toggle-enrolled' + (e.enrolled ? ' checked' : '') + '> <b>Bills on</b></label>' +
            '<span>Card: <b>' + esc(e.card_color || 'none') + '</b></span>' +
            '<span>PTO days left: <b>' + esc(e.pto_days) + '</b></span>' +
            '<span class="bills2-inline"><button type="button" class="bills2-btn" data-pto-grant>Grant 1 PTO day</button></span>' +
            '<span class="bills2-inline"><input type="date" id="bills-pto-date" aria-label="PTO date"><button type="button" class="bills2-btn" data-pto-use>Use PTO on this day</button></span>' +
            '<span id="bills-staff-panel-msg" class="bills2-note" style="margin:0"></span>' +
            '</div>';
    }

    function staffToggleEnrolled(enrolled) {
        if (!enrolled && !window.confirm('Turn bills off for this student? No new bills will be issued.')) {
            render();
            return;
        }
        api('/api/economy/student/' + state.studentId + '/enrollment', { method: 'PUT', body: JSON.stringify({ enrolled: enrolled }) }).then(function (res) {
            if (res.ok) setEconomy(res.data);
        });
    }

    function staffPto(action) {
        var payload = { action: action };
        if (action === 'apply') {
            var d = (document.getElementById('bills-pto-date') || {}).value;
            if (!d) {
                var msg = document.getElementById('bills-staff-panel-msg');
                if (msg) msg.textContent = 'Pick a date first.';
                return;
            }
            payload.date = d;
        } else {
            payload.days = 1;
        }
        api('/api/economy/student/' + state.studentId + '/pto', { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
            if (!res.ok) {
                var msg = document.getElementById('bills-staff-panel-msg');
                if (msg) msg.textContent = res.data.error || 'That did not work.';
                return;
            }
            setEconomy(res.data);
            var done = document.getElementById('bills-staff-panel-msg');
            if (done) done.textContent = action === 'apply' ? 'PTO used. That day is paid on the paycheck.' : 'Granted 1 PTO day.';
        });
    }

    function loadOverview() {
        var managed = document.getElementById('bills-managed-by-me-checkbox');
        var qs = managed && managed.checked ? '?managed_by_me=true' : '';
        body().innerHTML = '<div class="bills2-empty">Loading the class...</div>';
        return api('/api/economy/overview' + qs).then(function (res) {
            state.overview = res.ok ? res.data : { students: [], error: res.data.error };
            if (state.showOverview || !state.studentId) renderOverview();
        });
    }

    function renderOverview() {
        setSubtitle('Class overview');
        syncTabs();
        var data = state.overview;
        if (!data) {
            loadOverview();
            return;
        }
        var rows = data.students || [];
        if (!rows.length) {
            body().innerHTML = '<div class="bills2-empty"><h3>No students here</h3>' +
                (document.getElementById('bills-managed-by-me-checkbox') && document.getElementById('bills-managed-by-me-checkbox').checked
                    ? 'No students list you on their team. Uncheck "Only students managed by me" to see everyone.'
                    : 'Search for a student above.') + '</div>';
            return;
        }
        var enrolled = rows.filter(function (r) { return r.enrolled; });
        var owed = enrolled.reduce(function (s, r) { return s + r.due; }, 0);
        var late = enrolled.filter(function (r) { return r.past_due > 0; }).length;
        var html = '<div class="bills2-tiles">' +
            tile('Students with bills', String(enrolled.length), rows.length - enrolled.length ? (rows.length - enrolled.length) + ' with bills off' : '') +
            tile('Still due this week', fmt(owed), 'Due ' + (data.week_due || 'Monday')) +
            tile('Behind on bills', String(late), late ? 'Have past-due amounts' : 'Nobody is behind', late ? 'bills2-bad' : 'bills2-good') +
            tile('Getting assistance', String(enrolled.filter(function (r) { return r.assistance.length; }).length), 'Approved applications') +
            '</div>';
        html += '<div class="bills2-table-wrap"><table class="bills2-table"><thead><tr>' +
            '<th>Student</th><th class="num">Checking</th><th class="num">Savings</th><th class="num">Due this week</th>' +
            '<th class="num">Past due</th><th class="num">Late (4 wks)</th><th>Assistance</th><th>Last payment</th><th></th></tr></thead><tbody>';
        rows.forEach(function (r) {
            html += '<tr data-open-student="' + r.student_id + '" style="cursor:pointer">' +
                '<td><span class="bills2-dot c-' + esc(r.card_color || 'white') + '"></span>' + esc(r.name) + (r.enrolled ? '' : ' <span class="bills2-chip">Bills off</span>') + '</td>' +
                '<td class="num">' + fmt(r.checking) + '</td><td class="num">' + fmt(r.savings) + '</td>' +
                '<td class="num">' + (r.enrolled ? fmt(r.due) : '-') + '</td>' +
                '<td class="num' + (r.past_due > 0 ? ' bills2-bad' : '') + '">' + (r.enrolled ? fmt(r.past_due) : '-') + '</td>' +
                '<td class="num">' + (r.enrolled ? r.late_last_4_weeks : '-') + '</td>' +
                '<td>' + (r.assistance.length ? r.assistance.map(function (a) { return esc({ snap: 'SNAP', health: 'Health', housing: 'Section 8' }[a] || a); }).join(', ') : '-') + '</td>' +
                '<td>' + (r.last_payment ? esc(dateTime(r.last_payment)) : '-') + '</td>' +
                '<td><button type="button" class="bills2-btn" data-open-student="' + r.student_id + '">Open</button></td></tr>';
        });
        html += '</tbody></table></div>';
        body().innerHTML = html;
    }

    function setupStudentSearch() {
        var input = document.getElementById('bills-student-search-input');
        var dropdown = document.querySelector('.bills-student-autocomplete-dropdown');
        var managed = document.getElementById('bills-managed-by-me-checkbox');
        if (!input || !dropdown || searchBound) return;
        searchBound = true;
        var list = [];
        function hide() {
            if (typeof mountAutocompleteDropdown === 'function') mountAutocompleteDropdown(dropdown, document.createDocumentFragment(), false);
            else dropdown.innerHTML = '';
        }
        function show(items) {
            var frag = document.createDocumentFragment();
            (items || []).slice(0, 15).forEach(function (s) {
                var div = document.createElement('div');
                div.className = 'bank-search-autocomplete-item';
                div.style.cssText = 'padding:10px 12px;cursor:pointer;font-size:14px;';
                div.textContent = s.student_name;
                div.addEventListener('mousedown', function (ev) {
                    ev.preventDefault();
                    input.value = s.student_name;
                    hide();
                    state.tab = 'week';
                    loadEconomy(s.student_id);
                });
                frag.appendChild(div);
            });
            if (typeof mountAutocompleteDropdown === 'function') mountAutocompleteDropdown(dropdown, frag, input);
            else { dropdown.innerHTML = ''; dropdown.appendChild(frag); }
        }
        function search() {
            var params = new URLSearchParams();
            if (managed && managed.checked) params.set('managed_by_me', 'true');
            var q = input.value.trim();
            if (q) params.set('q', q);
            api('/api/bank-account/search?' + params.toString()).then(function (res) {
                list = res.ok && Array.isArray(res.data) ? res.data : [];
                show(list);
            });
        }
        input.addEventListener('input', search);
        input.addEventListener('focus', function () { if (list.length) show(list); else search(); });
        document.addEventListener('click', function (ev) {
            if (!input.contains(ev.target) && !dropdown.contains(ev.target)) hide();
        });
        if (managed) {
            managed.addEventListener('change', function () {
                list = [];
                state.overview = null;
                if (state.showOverview || !state.studentId) loadOverview();
            });
        }
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    function bindUi() {
        if (bound) return;
        bound = true;
        var tabs = document.getElementById('bills-tabs');
        if (tabs) {
            tabs.addEventListener('click', function (ev) {
                var btn = ev.target.closest('.bills2-tab');
                if (!btn) return;
                state.tab = btn.getAttribute('data-tab');
                state.app = null;
                state.planMessage = null;
                state.savingsMessage = null;
                render();
            });
        }
        var overviewBtn = document.getElementById('bills-overview-btn');
        if (overviewBtn) {
            overviewBtn.addEventListener('click', function () {
                state.showOverview = true;
                state.overview = null;
                var input = document.getElementById('bills-student-search-input');
                if (input) input.value = '';
                render();
            });
        }
        var root = document.getElementById('bills-root');
        if (root) {
            root.addEventListener('click', function (ev) {
                var t = ev.target;
                var goTab = t.closest('[data-go-tab]');
                if (goTab) { ev.preventDefault(); state.tab = goTab.getAttribute('data-go-tab'); render(); return; }
                var openStudent = t.closest('[data-open-student]');
                if (openStudent) {
                    var sid = Number(openStudent.getAttribute('data-open-student'));
                    var name = (state.overview && state.overview.students || []).filter(function (s) { return s.student_id === sid; })[0];
                    var input = document.getElementById('bills-student-search-input');
                    if (input && name) input.value = name.name;
                    state.tab = 'week';
                    loadEconomy(sid);
                    return;
                }
                var openBill = t.closest('[data-open-bill]');
                if (openBill) { openStatement(Number(openBill.getAttribute('data-open-bill'))); return; }
                if (t.closest('[data-save-plan]')) { savePlan(); return; }
                var openApp = t.closest('[data-open-app]');
                if (openApp) { openApplication(openApp.getAttribute('data-open-app')); return; }
                if (t.closest('[data-close-app]')) { state.app = null; render(); return; }
                if (t.closest('[data-submit-app]')) { submitApplication(); return; }
                var appStaff = t.closest('[data-app-staff]');
                if (appStaff) { staffApplicationAction(appStaff.getAttribute('data-program'), appStaff.getAttribute('data-app-staff')); return; }
                if (t.closest('[data-pto-grant]')) { staffPto('grant'); return; }
                if (t.closest('[data-pto-use]')) { staffPto('apply'); return; }
            });
            root.addEventListener('change', function (ev) {
                var toggle = ev.target.closest('[data-toggle-enrolled]');
                if (toggle) staffToggleEnrolled(toggle.checked);
            });
            root.addEventListener('submit', function (ev) {
                var form = ev.target.closest('[data-savings]');
                if (form) { ev.preventDefault(); submitSavings(form); }
            });
        }
        var modal = document.getElementById('bills-modal');
        if (modal) {
            modal.addEventListener('click', function (ev) {
                var t = ev.target;
                if (t === modal || t.closest('.bills2-modal-close') || t.closest('[data-close-modal]')) { closeModal(); return; }
                var staffPayBtn = t.closest('[data-staff-pay]');
                if (staffPayBtn) { staffPay(Number(staffPayBtn.getAttribute('data-staff-pay'))); return; }
                var waiveBtn = t.closest('[data-staff-waive]');
                if (waiveBtn) { staffWaive(Number(waiveBtn.getAttribute('data-staff-waive'))); return; }
                var confirmBtn = t.closest('[data-confirm-savings]');
                if (confirmBtn) { doSavingsTransfer('to_checking', confirmBtn.getAttribute('data-confirm-savings'), true); }
            });
            modal.addEventListener('submit', function (ev) {
                var form = ev.target.closest('[data-pay-bill]');
                if (form) { ev.preventDefault(); submitPayment(form); }
            });
            modal.addEventListener('input', function (ev) {
                var field = ev.target.closest('.bills2-field');
                var form = ev.target.closest('form');
                if (field && form) showFieldError(form, field.getAttribute('data-field'), '');
            });
            modal.addEventListener('change', function (ev) {
                if (ev.target.name !== 'pay-mode') return;
                var form = ev.target.closest('form');
                var help = form && form.querySelector('[data-field="amount"] .bills2-help');
                if (help) help.textContent = ev.target.value === 'part' ? 'Enter less than the amount due.' : 'Find the amount due on the bill.';
            });
            document.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape' && modal.style.display === 'block') closeModal();
            });
        }
    }

    function loadBillsView() {
        bindUi();
        if (window.billsFocusTab) {
            state.tab = window.billsFocusTab === 'assistance' ? 'assistance' : 'week';
            window.billsFocusTab = null;
        }
        if (window.currentUser && window.currentUser.role === 'student') {
            if (window.currentUser.studentId) return loadEconomy(window.currentUser.studentId, !!state.economy);
            body().innerHTML = '<div class="bills2-empty"><h3>No student record</h3>Your account is not linked to a student yet.</div>';
            return Promise.resolve();
        }
        setupStudentSearch();
        if (state.studentId && !state.showOverview) return loadEconomy(state.studentId, true);
        state.overview = null;
        render();
        return Promise.resolve();
    }

    // ------------------------------------------------------------------
    // Admin economy settings (Admin Panel)
    // ------------------------------------------------------------------

    function loadEconomyAdminSettings() {
        var wrap = document.getElementById('economy-admin-settings');
        if (!wrap) return;
        api('/api/economy/settings').then(function (res) {
            if (!res.ok) {
                wrap.innerHTML = '<p style="color:#b91c1c">Economy settings could not load.</p>';
                return;
            }
            wrap._economySettings = res.data;
            wrap.innerHTML = adminHtml(res.data);
            bindAdminWrap(wrap);
        });
        bindAdminButtons();
    }

    var PARAM_LABELS = {
        base_kwh_week: 'Typical kWh used per week',
        customer_charge_weekly: 'Basic service charge ($/week)',
        jitter: 'Week-to-week usage change (0.08 = 8%)',
        rate_per_kwh: 'Price per kWh ($)',
        equipment_weekly: 'Equipment fee ($/week)',
        equipment_label: 'Equipment name',
        fuel_price: 'Gas price ($/gallon)',
        rate: 'Loan interest rate (0.0652 = 6.52%)'
    };

    function adminField(label, id, value, suffix) {
        return '<label>' + esc(label) + '<input type="text" id="' + id + '" value="' + esc(value == null ? '' : value) + '"' + '>' +
            (suffix ? '<span style="font-size:11px;color:#78716c">' + esc(suffix) + '</span>' : '') + '</label>';
    }

    function adminHtml(data) {
        var b = data.bills || {};
        var fees = b.late_fees || {};
        var ben = b.benefits || {};
        var snap = ben.snap || {};
        var health = ben.health || {};
        var housing = ben.housing || {};
        var ps = housing.payment_standard_weekly || {};
        var html = '<div class="econ-admin">';
        html += '<fieldset><legend>Students</legend><div class="econ-grid">' +
            '<label>New students start with bills<select id="econ-default-track" style="padding:6px 9px;border:1px solid var(--border-strong);border-radius:6px">' +
            '<option value="simple"' + (data.default_pay_track === 'simple' ? ' selected' : '') + '>Off</option>' +
            '<option value="complex"' + (data.default_pay_track === 'complex' ? ' selected' : '') + '>On</option></select></label>' +
            adminField('Emergency fund goal (weeks of bills)', 'econ-goal-weeks', b.savings_goal_weeks) + '</div></fieldset>';
        html += '<fieldset><legend>Late fees</legend><div class="econ-grid">' +
            adminField('Rent late fee (% of late rent)', 'econ-rent-pct', (Number(fees.rent_percent || 0.08) * 100).toFixed(1), 'Minnesota allows at most 8%.') +
            adminField('Other bills late fee ($)', 'econ-other-fee', fees.other_flat) + '</div></fieldset>';
        html += '<fieldset><legend>Weekly prices</legend>';
        (data.products || []).forEach(function (p) {
            var opts = p.options || [];
            html += '<div class="econ-product" data-product="' + p.id + '"><h4>' + esc(p.name) + (p.payee ? ' <span style="font-weight:400;color:#78716c">· ' + esc(p.payee) + '</span>' : '') + '</h4>';
            if (opts.length) {
                var vehicle = p.slug === 'car_loan';
                html += '<table><thead><tr><th>Option</th>' + (vehicle ? '<th>Loan / week</th><th>Repairs / week</th>' : '<th>Cost / week</th>') + '</tr></thead><tbody>';
                opts.forEach(function (o) {
                    html += '<tr data-option="' + esc(o.id) + '"><td><input type="text" data-k="label" value="' + esc(o.label) + '"></td>' +
                        (vehicle
                            ? '<td><input type="text" data-k="loan_weekly" value="' + esc(o.loan_weekly) + '"></td><td><input type="text" data-k="upkeep_weekly" value="' + esc(o.upkeep_weekly) + '"></td>'
                            : '<td><input type="text" data-k="weekly" value="' + esc(o.weekly) + '"></td>') + '</tr>';
                });
                html += '</tbody></table>';
            }
            var params = p.params || {};
            var simple = Object.keys(params).filter(function (k) { return typeof params[k] !== 'object'; });
            if (simple.length) {
                html += '<div class="econ-grid" style="margin-top:6px">' + simple.map(function (k) {
                    return '<label>' + esc(PARAM_LABELS[k] || k.replace(/_/g, ' ')) + '<input type="text" data-param="' + esc(k) + '" value="' + esc(params[k]) + '"></label>';
                }).join('') + '</div>';
            }
            html += '</div>';
        });
        html += '</fieldset>';
        html += '<fieldset><legend>Assistance rules</legend><div class="econ-grid">' +
            adminField('Federal poverty guideline (1 person, yearly)', 'econ-fpl', ben.fpl_annual) +
            adminField('SNAP most per month (1 person)', 'econ-snap-max', snap.max_allotment_monthly) +
            adminField('SNAP income limit (% of poverty)', 'econ-snap-limit', snap.gross_limit_pct_fpl) +
            adminField('Medical Assistance limit (% of poverty)', 'econ-ma-limit', health.ma_limit_pct_fpl) +
            adminField('Tax credit limit (% of poverty)', 'econ-credit-limit', health.credit_limit_pct_fpl) +
            adminField('Section 8 tenant share (%)', 'econ-tenant-share', (Number(housing.tenant_share || 0.3) * 100).toFixed(0)) +
            adminField('Section 8 payment standard, studio ($/week)', 'econ-ps-0', ps['0']) +
            adminField('Section 8 payment standard, 1 bedroom', 'econ-ps-1', ps['1']) +
            adminField('Section 8 payment standard, 2 bedroom', 'econ-ps-2', ps['2']) +
            '</div></fieldset>';
        html += '<fieldset><legend>No-show shifts (unpaid time off)</legend>' +
            '<p style="margin:0 0 8px;font-size:12px;color:#57534e">If a student\'s schedule has this class and they go to the skip-to location instead, that day is unpaid on their paycheck. PTO covers it.</p>';
        (data.no_show_classes || []).forEach(function (c) {
            html += '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">' +
                '<b>' + esc(c.name) + '</b><span style="color:#78716c">schedule has "' + esc(c.match_text) + '", skipped to ' + esc(c.skip_to_location) + (c.is_active ? '' : ' (off)') + '</span>' +
                (c.is_active ? '<button type="button" class="bills2-btn" data-disable-shift="' + c.id + '" style="margin-left:auto">Turn off</button>' : '') + '</div>';
        });
        html += '<div class="econ-grid" style="margin-top:8px">' +
            adminField('Name', 'econ-shift-name', '') + adminField('Schedule contains', 'econ-shift-match', '') +
            adminField('Skipped to', 'econ-shift-skip', 'Studio') +
            '<label>&nbsp;<button type="button" class="bills2-btn" data-add-shift>Add no-show shift</button></label></div></fieldset>';
        html += '</div>';
        return html;
    }

    function bindAdminWrap(wrap) {
        if (wrap._bound) return;
        wrap._bound = true;
        wrap.addEventListener('click', function (ev) {
            var disable = ev.target.closest('[data-disable-shift]');
            if (disable) {
                api('/api/economy/miss-fee-classes/' + disable.getAttribute('data-disable-shift'), { method: 'DELETE' }).then(loadEconomyAdminSettings);
                return;
            }
            if (ev.target.closest('[data-add-shift]')) {
                var name = (document.getElementById('econ-shift-name') || {}).value || '';
                var match = (document.getElementById('econ-shift-match') || {}).value || '';
                var skip = (document.getElementById('econ-shift-skip') || {}).value || 'Studio';
                api('/api/economy/miss-fee-classes', { method: 'POST', body: JSON.stringify({ name: name, match_text: match || name, skip_to_location: skip }) })
                    .then(function (res) {
                        var msg = document.getElementById('economy-admin-msg');
                        if (!res.ok && msg) { msg.textContent = res.data.error || 'Could not add that shift.'; msg.style.display = 'block'; msg.style.color = '#b91c1c'; }
                        loadEconomyAdminSettings();
                    });
            }
        });
    }

    function readAdminPayload(wrap) {
        var data = wrap._economySettings;
        function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
        var pct = parseFloat(val('econ-rent-pct'));
        var share = parseFloat(val('econ-tenant-share'));
        var bills = {
            late_fees: { rent_percent: isNaN(pct) ? '0.08' : String(pct / 100), other_flat: val('econ-other-fee') },
            savings_goal_weeks: parseInt(val('econ-goal-weeks'), 10) || 13,
            benefits: {
                fpl_annual: val('econ-fpl'),
                snap: { max_allotment_monthly: val('econ-snap-max'), gross_limit_pct_fpl: val('econ-snap-limit') },
                health: { ma_limit_pct_fpl: val('econ-ma-limit'), credit_limit_pct_fpl: val('econ-credit-limit') },
                housing: {
                    tenant_share: isNaN(share) ? '0.30' : String(share / 100),
                    payment_standard_weekly: { '0': val('econ-ps-0'), '1': val('econ-ps-1'), '2': val('econ-ps-2') }
                }
            }
        };
        var products = (data.products || []).map(function (p) {
            var box = wrap.querySelector('[data-product="' + p.id + '"]');
            if (!box) return null;
            var options = Array.prototype.map.call(box.querySelectorAll('tr[data-option]'), function (tr) {
                var o = { id: tr.getAttribute('data-option') };
                tr.querySelectorAll('input[data-k]').forEach(function (input) { o[input.getAttribute('data-k')] = input.value; });
                return o;
            });
            var params = {};
            box.querySelectorAll('input[data-param]').forEach(function (input) { params[input.getAttribute('data-param')] = input.value; });
            return { id: p.id, options: options, params: params };
        }).filter(Boolean);
        return { default_pay_track: val('econ-default-track'), bills: bills, products: products };
    }

    function bindAdminButtons() {
        if (adminBound) return;
        adminBound = true;
        var msg = document.getElementById('economy-admin-msg');
        function say(text, ok) {
            if (!msg) return;
            msg.textContent = text;
            msg.style.display = text ? 'block' : 'none';
            msg.style.color = ok ? '#15803d' : '#b91c1c';
        }
        var save = document.getElementById('economy-admin-save-btn');
        if (save) {
            save.addEventListener('click', function () {
                var wrap = document.getElementById('economy-admin-settings');
                if (!wrap || !wrap._economySettings) return;
                api('/api/economy/settings', { method: 'PUT', body: JSON.stringify(readAdminPayload(wrap)) }).then(function (res) {
                    say(res.ok ? 'Economy settings saved. New prices apply to bills issued next Monday.' : (res.data.error || 'Save failed.'), res.ok);
                    if (res.ok) loadEconomyAdminSettings();
                });
            });
        }
        var gen = document.getElementById('economy-admin-generate-btn');
        if (gen) {
            gen.addEventListener('click', function () {
                api('/api/economy/generate', { method: 'POST', body: '{}' }).then(function (res) {
                    if (!res.ok) { say(res.data.error || 'That did not work.', false); return; }
                    say('Issued ' + (res.data.bills_created || 0) + ' bills. Applied ' + (res.data.late_fees || 0) + ' late fees.', true);
                });
            });
        }
    }

    window.loadBillsView = loadBillsView;
    window.loadEconomyAdminSettings = loadEconomyAdminSettings;
})();
