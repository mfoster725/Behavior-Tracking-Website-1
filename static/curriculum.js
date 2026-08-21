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

    const SAMPLE_STORY = {
        balance: 42.50,
        spent_30d: 18,
        this_paycheck: {
            pay_period_start: '2026-08-10',
            pay_period_end: '2026-08-14',
            average_star_percent: 87.5,
            base_pay: 87.5,
            citation_count: 3,
            citation_list: ['Disruption', 'Language', 'Off task'],
            citation_deduction: 6,
            final_pay: 81.5,
            is_verified: false,
            deposited_at: null,
        },
        previous_paycheck: {
            pay_period_start: '2026-08-03',
            pay_period_end: '2026-08-07',
            average_star_percent: 72,
            base_pay: 72,
            citation_count: 1,
            citation_list: ['Off task'],
            citation_deduction: 2,
            final_pay: 70,
        },
        pay_change: { direction: 'up', delta: 11.5, zero_citation_pay: 87.5 },
        recent_purchases: [
            { id: 'ex-1', amount: 8, description: 'Snack pass' },
            { id: 'ex-2', amount: 15, description: 'Headphones' },
            { id: 'ex-3', amount: 5, description: 'Late start coupon' },
        ],
    };
    const SAMPLE_CATALOG = [
        { id: 101, name: 'Snack pass', price: 5 },
        { id: 102, name: 'Headphones', price: 15 },
        { id: 103, name: 'Late start coupon', price: 8 },
        { id: 104, name: 'Staff lunch', price: 25 },
        { id: 105, name: 'Game time', price: 10 },
    ];

    function walkthroughStory() {
        const live = state.data && state.data.money_story;
        if (live && live.this_paycheck) return live;
        return SAMPLE_STORY;
    }

    function walkthroughCatalog() {
        if (state.catalog && state.catalog.length) return state.catalog;
        return SAMPLE_CATALOG;
    }

    function itemOptions(selectedId, catalog) {
        const items = catalog || state.catalog || [];
        if (!items.length) return '<option value="">No marketplace items visible</option>';
        return '<option value="">Select an item</option>' + items.map(function (item) {
            const sel = String(item.id) === String(selectedId) ? ' selected' : '';
            return '<option value="' + item.id + '" data-price="' + item.price + '"' + sel + '>' +
                esc(item.name) + ' — ' + money(item.price) + '</option>';
        }).join('');
    }

    function paycheckWorksheetHtml(thisPay, idPrefix) {
        const pct = thisPay && thisPay.average_star_percent != null
            ? Number(thisPay.average_star_percent).toFixed(2)
            : '0.00';
        const citations = (thisPay && thisPay.citation_list) || [];
        const listHtml = citations.length ? esc(citations.join('\n')) : 'None';
        return '<div class="curriculum-worksheet">' +
            '<h4>Complete Your Paycheck Worksheet</h4>' +
            '<p class="muted">Calculate your pay based on this week’s data and citations.</p>' +
            '<div class="curriculum-lesson-form">' +
            '<label>Base Pay</label>' +
            '<p class="muted">Calculate your base pay: $100 × ' + esc(pct) + '% =</p>' +
            '<input type="text" inputmode="decimal" id="' + idPrefix + 'base-pay" placeholder="$0.00">' +
            '<label>Number of Citations</label>' +
            '<p class="muted">Citations this week:</p>' +
            '<div class="curriculum-citation-list">' + listHtml + '</div>' +
            '<p class="muted">Count the citations above and enter the number below.</p>' +
            '<input type="number" id="' + idPrefix + 'citations" placeholder="Enter citation count">' +
            '<label>Citation Deduction</label>' +
            '<p class="muted">Citations × $2 =</p>' +
            '<input type="text" inputmode="decimal" id="' + idPrefix + 'deduction" placeholder="$0.00">' +
            '<label>Final Pay</label>' +
            '<p class="muted">Base Pay - Citation Deduction =</p>' +
            '<input type="text" inputmode="decimal" id="' + idPrefix + 'final" placeholder="$0.00">' +
            '</div></div>';
    }

    function periodLabel(pay) {
        if (!pay || !pay.pay_period_start) return 'No paycheck yet';
        return pay.pay_period_start + ' to ' + pay.pay_period_end;
    }

    function citationLine(pay) {
        const count = pay && pay.citation_count != null ? pay.citation_count : 0;
        const list = (pay && pay.citation_list) || [];
        if (!count && !list.length) return '0 — none';
        return count + ' — ' + (list.length ? list.join(', ') : 'see count');
    }

    function paycheckFactsHtml(pay, heading, emptyNote) {
        if (!pay) {
            return '<div class="curriculum-compare-card"><h4>' + esc(heading) + '</h4>' +
                '<p class="muted">' + esc(emptyNote || 'No paycheck to show.') + '</p></div>';
        }
        return '<div class="curriculum-compare-card"><h4>' + esc(heading) + '</h4>' +
            '<p class="muted">' + esc(periodLabel(pay)) + '</p>' +
            '<dl class="curriculum-facts">' +
            '<div><dt>STAR average</dt><dd>' + Number(pay.average_star_percent || 0).toFixed(2) + '%</dd></div>' +
            '<div><dt>Base pay</dt><dd>' + money(pay.base_pay) + '</dd></div>' +
            '<div><dt>Citations</dt><dd>' + esc(citationLine(pay)) + '</dd></div>' +
            '<div><dt>Deduction ($2 each)</dt><dd>' + money(pay.citation_deduction) + '</dd></div>' +
            '<div><dt>Take-home</dt><dd>' + money(pay.final_pay) + '</dd></div>' +
            '</dl></div>';
    }

    const LESSON_TEACHING = {
        read_paycheck:
            'Your paycheck is math from this week. Not a random number.\n\n' +
            'Base pay starts at $100, then gets multiplied by your STAR percent for the week. If the week was 80%, base pay is $80.\n\n' +
            'Citations come off after that. Each citation is $2. Three citations is $6 off.\n\n' +
            'Take-home is what is left: base pay minus that deduction. That is the number that hits your account when you deposit.\n\n' +
            'The worksheet in Bank Account is the same math with this week’s numbers. Run it. Deposit when it is right.',
        why_pay_changed:
            'Pay moves for a reason. Two levers.\n\n' +
            '- The week — STAR percent — sets base pay. A stronger week raises it. A weaker week lowers it.\n' +
            '- Citations come off after. More citations, more money gone. Fewer citations, more of the base pay stays.\n\n' +
            'If both moved, look at which one did more of the work. The two weeks are sitting right here. Read them. Then say what happened.',
        save_or_buy:
            'Cash in your account spends once. Buy the item today and that money is not there for anything else.\n\n' +
            'First question: do you have enough? If the price is bigger than your balance, you cannot buy it today.\n\n' +
            'Second question: even if you have enough, is today the day? Waiting keeps the money. Setting a goal puts a target on it so you do not spend it by accident.\n\n' +
            'There is no trick answer. Pick a real item and make the call.',
        opportunity_cost:
            'Opportunity cost is the thing you do not get because you picked the other thing.\n\n' +
            'If your balance covers both items, there is no trade yet. If it does not, choosing A means B stays on the shelf. B is the cost.\n\n' +
            'Name the thing you are giving up. That is the whole skill.',
        needs_vs_wants:
            'A need gets you through the week. Food. Something required. Something that keeps you from getting stuck.\n\n' +
            'A want is the rest. Headphones. Extra snacks. Nice-to-have. Wants are allowed. They just should not empty the account before needs are covered.\n\n' +
            'Tag each item. Then look at the wants and pick one that could wait.',
        savings_goal:
            'A savings goal is a number you are aiming at — a marketplace item or a dollar amount.\n\n' +
            'Last week’s take-home is the pace. Divide the target by that paycheck and you get a rough count of weeks, if you do not spend it first.\n\n' +
            'You are not locking the money. You are naming the target so you can see if you are getting closer.',
    };

    function teachingHtml(lesson) {
        const text = (lesson && lesson.teaching) || LESSON_TEACHING[lesson && lesson.slug] || '';
        if (!text) return '';
        const blocks = String(text).split(/\n\n+/);
        const inner = blocks.map(function (block) {
            const lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
            if (!lines.length) return '';
            const bullets = lines.every(function (l) { return l.charAt(0) === '-' || l.charAt(0) === '•'; });
            if (bullets) {
                return '<ul>' + lines.map(function (l) {
                    return '<li>' + esc(l.replace(/^[-•]\s*/, '')) + '</li>';
                }).join('') + '</ul>';
            }
            return '<p>' + esc(lines.join(' ')) + '</p>';
        }).join('');
        return '<div class="curriculum-teach"><h4>The lesson</h4>' + inner + '</div>';
    }

    function payChangeSummaryHtml(thisPay, prevPay, change) {
        const thisTake = Number((thisPay && thisPay.final_pay) || 0);
        const compareTake = prevPay
            ? Number(prevPay.final_pay || 0)
            : Number((change && (change.zero_citation_pay || (thisPay && thisPay.base_pay))) || 0);
        const diff = Math.round((thisTake - compareTake) * 100) / 100;
        let moved = 'Take-home matched the comparison: ' + money(thisTake) + '.';
        if (diff > 0.009) moved = 'Take-home went up ' + money(diff) + ' (' + money(compareTake) + ' → ' + money(thisTake) + ').';
        if (diff < -0.009) moved = 'Take-home went down ' + money(Math.abs(diff)) + ' (' + money(compareTake) + ' → ' + money(thisTake) + ').';
        const thisCit = thisPay ? (thisPay.citation_count || 0) : 0;
        const prevCit = prevPay ? (prevPay.citation_count || 0) : 0;
        const thisStar = thisPay ? Number(thisPay.average_star_percent || 0).toFixed(2) : '0.00';
        let starLine = 'STAR this week: ' + thisStar + '%.';
        if (prevPay && prevPay.average_star_percent != null) {
            starLine = 'STAR: ' + thisStar + '% this week vs ' + Number(prevPay.average_star_percent).toFixed(2) + '% last week.';
        }
        const citLine = prevPay
            ? 'Citations: ' + thisCit + ' this week vs ' + prevCit + ' last week.'
            : 'Citations this week: ' + thisCit + '.';
        return '<div class="curriculum-change-summary"><p>' + esc(moved) + '</p>' +
            '<p class="muted">' + esc(starLine) + ' ' + esc(citLine) + '</p></div>';
    }

    function lessonFormHtml(assignment, options) {
        const walkthrough = !!(options && options.walkthrough);
        const slug = assignment.lesson && assignment.lesson.slug;
        const story = (options && options.story) || (state.data && state.data.money_story) || {};
        const catalog = (options && options.catalog) || state.catalog || [];
        const thisPay = story.this_paycheck;
        const prevPay = story.previous_paycheck;
        const change = story.pay_change || {};
        const staff = isStaff() && assignment.lesson && assignment.lesson.staff_script
            ? '<div class="curriculum-staff-script"><strong>Staff:</strong> ' + esc(assignment.lesson.staff_script) + '</div>'
            : '';
        const teach = teachingHtml(assignment.lesson);
        const prompt = assignment.lesson && assignment.lesson.student_prompt
            ? '<p class="curriculum-your-turn"><strong>Your turn.</strong> ' + esc(assignment.lesson.student_prompt) + '</p>'
            : '';
        const idPrefix = walkthrough ? 'walk-cl-' : 'cl-';

        if (slug === 'read_paycheck') {
            let html = staff + teach +
                '<div class="curriculum-compare">' +
                paycheckFactsHtml(thisPay, 'This week', 'No paycheck yet.') +
                '</div>' + prompt;
            if (walkthrough) {
                html += '<p class="muted">Students complete this same worksheet in Bank Account.</p>';
                html += paycheckWorksheetHtml(thisPay, idPrefix);
                html += '<div class="curriculum-actions">' +
                    '<button type="button" class="btn-primary" id="walkthrough-check-btn">Check answers</button>' +
                    '</div><div class="curriculum-error" id="walkthrough-lesson-error"></div>';
                return html;
            }
            const deposited = thisPay && (thisPay.deposited_at || thisPay.is_verified);
            html += (deposited
                    ? '<p>This paycheck is already deposited. You can mark the lesson done.</p>'
                    : '<p>Open Bank Account and complete the paycheck worksheet with the numbers above.</p>') +
                '<div class="curriculum-actions">' +
                '<button type="button" class="btn-secondary" id="curriculum-open-bank-btn">Open paycheck worksheet</button>' +
                (deposited ? '<button type="button" class="btn-primary" id="curriculum-complete-btn">Mark done</button>' : '') +
                '</div>';
            return html;
        }

        if (slug === 'why_pay_changed') {
            const comparePay = prevPay || (thisPay ? {
                pay_period_start: thisPay.pay_period_start,
                pay_period_end: thisPay.pay_period_end,
                average_star_percent: thisPay.average_star_percent,
                base_pay: thisPay.base_pay,
                citation_count: 0,
                citation_list: [],
                citation_deduction: 0,
                final_pay: change.zero_citation_pay != null ? change.zero_citation_pay : thisPay.base_pay,
            } : null);
            const compareHeading = prevPay ? 'Last week' : 'This week with zero citations';
            const compareEmpty = 'No comparison paycheck yet.';
            return staff + teach +
                '<div class="curriculum-compare">' +
                paycheckFactsHtml(thisPay, 'This week', 'No paycheck yet.') +
                paycheckFactsHtml(comparePay, compareHeading, compareEmpty) +
                '</div>' +
                payChangeSummaryHtml(thisPay, prevPay, change) +
                prompt +
                '<div class="curriculum-lesson-form">' +
                '<label>What moved your pay?</label>' +
                '<div class="curriculum-radio-row">' +
                '<label><input type="radio" name="' + idPrefix + 'cause" value="star"> The week (STAR / base pay)</label>' +
                '<label><input type="radio" name="' + idPrefix + 'cause" value="citations"> Citations</label>' +
                '<label><input type="radio" name="' + idPrefix + 'cause" value="both"> Both</label>' +
                '<label><input type="radio" name="' + idPrefix + 'cause" value="same"> It stayed about the same</label>' +
                '</div>' +
                '<label>In your words, why did it change — or why did it stay the same?</label>' +
                '<textarea id="' + idPrefix + 'why" placeholder="Name the lever that did the work."></textarea>' +
                '</div>';
        }

        if (slug === 'save_or_buy') {
            return staff + teach +
                '<p class="curriculum-money-ready">Your balance: <strong>' + money(story.balance) + '</strong></p>' +
                prompt +
                '<div class="curriculum-lesson-form">' +
                '<label>Item</label>' +
                '<select id="' + idPrefix + 'item">' + itemOptions(null, catalog) + '</select>' +
                '<label>Decision</label>' +
                '<div class="curriculum-radio-row">' +
                '<label><input type="radio" name="' + idPrefix + 'decision" value="buy"> Buy now</label>' +
                '<label><input type="radio" name="' + idPrefix + 'decision" value="wait"> Wait</label>' +
                '<label><input type="radio" name="' + idPrefix + 'decision" value="goal"> Set as a goal</label>' +
                '</div></div>';
        }

        if (slug === 'opportunity_cost') {
            return staff + teach +
                '<p class="curriculum-money-ready">Your balance: <strong>' + money(story.balance) + '</strong></p>' +
                prompt +
                '<div class="curriculum-lesson-form">' +
                '<label>Item A</label><select id="' + idPrefix + 'item-a">' + itemOptions(null, catalog) + '</select>' +
                '<label>Item B</label><select id="' + idPrefix + 'item-b">' + itemOptions(null, catalog) + '</select>' +
                '<label class="curriculum-managed-label"><input type="checkbox" id="' + idPrefix + 'can-both"> I can buy both with my balance</label>' +
                '<label>If you cannot buy both, which would you choose?</label>' +
                '<select id="' + idPrefix + 'choice"><option value="">Choose</option></select>' +
                '<label>What are you giving up?</label>' +
                '<textarea id="' + idPrefix + 'reason"></textarea>' +
                '</div>';
        }

        if (slug === 'needs_vs_wants') {
            const purchases = story.recent_purchases || [];
            const rows = purchases.length
                ? purchases
                : (catalog || []).slice(0, 6).map(function (item) {
                    return { id: 'item-' + item.id, amount: item.price, description: item.name };
                });
            if (!rows.length) {
                return staff + teach + prompt + '<p class="muted">No purchases or catalog items to tag yet.</p>';
            }
            const list = rows.map(function (row, idx) {
                return '<div class="curriculum-tag-row" data-tag-id="' + esc(row.id) + '" data-label="' + esc(row.description) + '">' +
                    '<span>' + esc(row.description) + ' — ' + money(row.amount) + '</span>' +
                    '<span class="curriculum-radio-row">' +
                    '<label><input type="radio" name="' + idPrefix + 'tag-' + idx + '" value="need"> Need</label>' +
                    '<label><input type="radio" name="' + idPrefix + 'tag-' + idx + '" value="want"> Want</label>' +
                    '</span></div>';
            }).join('');
            return staff + teach + prompt + '<div class="curriculum-lesson-form">' + list +
                '<label>Which want could wait?</label>' +
                '<textarea id="' + idPrefix + 'wait-want" placeholder="Name one want that does not have to happen this week."></textarea>' +
                '</div>';
        }

        if (slug === 'savings_goal') {
            const takeHome = thisPay ? thisPay.final_pay : 0;
            return staff + teach +
                '<p class="curriculum-money-ready">Balance <strong>' + money(story.balance) +
                '</strong> · last take-home <strong>' + money(takeHome) + '</strong></p>' +
                prompt +
                '<div class="curriculum-lesson-form">' +
                '<label>Marketplace item (optional)</label>' +
                '<select id="' + idPrefix + 'goal-item">' + itemOptions(null, catalog) + '</select>' +
                '<label>Target amount</label>' +
                '<input type="number" step="0.01" id="' + idPrefix + 'goal-amount" placeholder="0.00">' +
                '<p class="muted" id="' + idPrefix + 'goal-weeks"></p>' +
                '<label>Label</label>' +
                '<input type="text" id="' + idPrefix + 'goal-label" placeholder="What are you saving for?">' +
                '</div>';
        }

        return staff + teach + prompt;
    }

    function collectResponses(assignment) {
        const slug = assignment.lesson && assignment.lesson.slug;
        if (slug === 'read_paycheck') return {};
        if (slug === 'why_pay_changed') {
            const story = (state.data && state.data.money_story) || {};
            const thisPay = story.this_paycheck || {};
            const prevPay = story.previous_paycheck;
            const change = story.pay_change || {};
            const thisActual = Number(thisPay.final_pay || 0);
            const compareActual = prevPay
                ? Number(prevPay.final_pay || 0)
                : Number(change.zero_citation_pay || thisPay.base_pay || 0);
            const causeEl = document.querySelector('input[name="cl-cause"]:checked');
            return {
                this_take_home: thisActual,
                compare_take_home: compareActual,
                difference: Math.round((thisActual - compareActual) * 100) / 100,
                cause: causeEl && causeEl.value,
                why: (document.getElementById('cl-why') && document.getElementById('cl-why').value) || '',
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
            return { tags: tags, wait_want: (document.getElementById('cl-wait-want') && document.getElementById('cl-wait-want').value) || '' };
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

    function wireOpportunitySelects(prefix) {
        prefix = prefix || 'cl-';
        const a = document.getElementById(prefix + 'item-a');
        const b = document.getElementById(prefix + 'item-b');
        const choice = document.getElementById(prefix + 'choice');
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

    function wireGoalWeeksHint(prefix, takeHome) {
        prefix = prefix || 'cl-';
        const amount = document.getElementById(prefix + 'goal-amount');
        const hint = document.getElementById(prefix + 'goal-weeks');
        if (!amount || !hint) return;
        function refresh() {
            const t = parseFloat(amount.value);
            if (!(t > 0) || !(takeHome > 0)) {
                hint.textContent = takeHome > 0 ? '' : 'No take-home to count from yet.';
                return;
            }
            const weeks = Math.ceil(t / takeHome);
            hint.textContent = 'At last take-home of ' + money(takeHome) + ', that is about ' +
                weeks + ' paycheck' + (weeks === 1 ? '' : 's') + ' if you do not spend it.';
        }
        amount.addEventListener('input', refresh);
        refresh();
    }

    function wireGoalItemFill(prefix) {
        prefix = prefix || 'cl-';
        const sel = document.getElementById(prefix + 'goal-item');
        const amount = document.getElementById(prefix + 'goal-amount');
        const label = document.getElementById(prefix + 'goal-label');
        if (!sel || !amount) return;
        sel.addEventListener('change', function () {
            const opt = sel.options[sel.selectedIndex];
            if (!opt || !sel.value) return;
            amount.value = opt.getAttribute('data-price') || '';
            if (label && !label.value) {
                label.value = (opt.textContent || '').split(' — ')[0];
            }
            if (typeof amount.dispatchEvent === 'function') {
                amount.dispatchEvent(new Event('input'));
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
        const story = (state.data && state.data.money_story) || {};
        wireGoalWeeksHint('cl-', story.this_paycheck ? story.this_paycheck.final_pay : 0);

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
        lessons.forEach(function (l) {
            html += '<th><button type="button" class="curriculum-lesson-title-btn" data-lesson-slug="' +
                esc(l.slug) + '" title="Open the full lesson">' + esc(l.title) + '</button></th>';
        });
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
        wrap.querySelectorAll('.curriculum-lesson-title-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showFullLesson(btn.getAttribute('data-lesson-slug'));
            });
        });
        wrap.querySelectorAll('tr[data-student-id]').forEach(function (tr) {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', function () {
                const sid = parseInt(tr.getAttribute('data-student-id'), 10);
                const name = tr.querySelector('td').textContent;
                selectStudent(sid, name);
            });
        });
    }

    function parseMoneyField(id) {
        const el = document.getElementById(id);
        if (!el) return NaN;
        return parseFloat(String(el.value).replace(/[^0-9.-]/g, ''));
    }

    function checkWalkthroughAnswers(slug, story) {
        const prefix = 'walk-cl-';
        const thisPay = (story && story.this_paycheck) || {};
        const prevPay = story && story.previous_paycheck;
        const change = (story && story.pay_change) || {};
        const tolerance = 0.05;

        if (slug === 'read_paycheck') {
            const base = parseMoneyField(prefix + 'base-pay');
            const citations = parseInt((document.getElementById(prefix + 'citations') || {}).value, 10);
            const deduction = parseMoneyField(prefix + 'deduction');
            const finalPay = parseMoneyField(prefix + 'final');
            if (Math.abs(base - Number(thisPay.base_pay || 0)) > tolerance) return 'Check the base pay: $100 × this week’s percent.';
            if (citations !== Number(thisPay.citation_count || 0)) return 'Count the citations again.';
            if (Math.abs(deduction - Number(thisPay.citation_deduction || 0)) > tolerance) return 'Deduction is citations × $2.';
            if (Math.abs(finalPay - Number(thisPay.final_pay || 0)) > tolerance) return 'Final pay is base pay minus the deduction.';
            return null;
        }
        if (slug === 'why_pay_changed') {
            const cause = document.querySelector('input[name="' + prefix + 'cause"]:checked');
            if (!cause) return 'Pick what moved your pay.';
            const why = ((document.getElementById(prefix + 'why') || {}).value || '').trim();
            if (why.length < 8) return 'Write why pay changed — or why it stayed the same.';
            return null;
        }
        if (slug === 'save_or_buy') {
            const sel = document.getElementById(prefix + 'item');
            const decision = document.querySelector('input[name="' + prefix + 'decision"]:checked');
            if (!sel || !sel.value) return 'Pick an item.';
            if (!decision) return 'Choose buy, wait, or set as a goal.';
            return null;
        }
        if (slug === 'opportunity_cost') {
            const a = document.getElementById(prefix + 'item-a');
            const b = document.getElementById(prefix + 'item-b');
            if (!a || !b || !a.value || !b.value || a.value === b.value) return 'Pick two different items.';
            return null;
        }
        if (slug === 'needs_vs_wants') {
            const rows = document.querySelectorAll('#curriculum-lesson-view-body .curriculum-tag-row');
            if (!rows.length) return 'Nothing to tag yet.';
            let missing = false;
            rows.forEach(function (row) {
                if (!row.querySelector('input[type="radio"]:checked')) missing = true;
            });
            if (missing) return 'Tag each item as a need or a want.';
            const waitWant = ((document.getElementById(prefix + 'wait-want') || {}).value || '').trim();
            if (waitWant.length < 2) return 'Name one want that could wait.';
            return null;
        }
        if (slug === 'savings_goal') {
            const amount = parseMoneyField(prefix + 'goal-amount');
            if (!(amount > 0)) return 'Enter a savings target greater than zero.';
            return null;
        }
        return null;
    }

    function selectedStudentName() {
        if (!state.studentId) return '';
        const rows = (state.roster && state.roster.students) || [];
        const row = rows.find(function (s) { return s.student_id === state.studentId; });
        if (row && row.student_name) return row.student_name;
        const input = document.getElementById('curriculum-student-search-input');
        return input ? input.value.trim() : '';
    }

    function storyStripHtml(story) {
        const s = story || {};
        const pay = s.this_paycheck || {};
        const change = s.pay_change || {};
        let changeHint = 'No prior paycheck yet — compare to pay with zero citations.';
        if (change.direction === 'up') changeHint = 'Up ' + money(change.delta) + ' from last week.';
        if (change.direction === 'down') changeHint = 'Down ' + money(Math.abs(change.delta)) + ' from last week.';
        if (change.direction === 'same') changeHint = 'Same take-home as last week.';
        return '<div class="curriculum-stat"><p class="label">Balance</p><p class="value">' + money(s.balance) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">This week’s pay</p><p class="value">' + money(pay.final_pay) + '</p><p class="hint">' + esc(changeHint) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">Citations</p><p class="value">' + (pay.citation_count || 0) + '</p><p class="hint">Deduction ' + money(pay.citation_deduction) + '</p></div>' +
            '<div class="curriculum-stat"><p class="label">Spent (30 days)</p><p class="value">' + money(s.spent_30d) + '</p></div>';
    }

    function wireWalkthroughLesson(slug, story) {
        wireOpportunitySelects('walk-cl-');
        wireGoalItemFill('walk-cl-');
        wireGoalWeeksHint('walk-cl-', story && story.this_paycheck ? story.this_paycheck.final_pay : 0);
        const body = document.getElementById('curriculum-lesson-view-body');
        if (body && !document.getElementById('walkthrough-check-btn')) {
            const actions = document.createElement('div');
            actions.className = 'curriculum-actions';
            actions.innerHTML = '<button type="button" class="btn-primary" id="walkthrough-check-btn">Check answers</button>';
            const err = document.createElement('div');
            err.className = 'curriculum-error';
            err.id = 'walkthrough-lesson-error';
            body.appendChild(actions);
            body.appendChild(err);
        }
        const checkBtn = document.getElementById('walkthrough-check-btn');
        const errEl = document.getElementById('walkthrough-lesson-error');
        if (checkBtn) {
            checkBtn.addEventListener('click', function () {
                const problem = checkWalkthroughAnswers(slug, story);
                if (!errEl) return;
                if (problem) {
                    errEl.style.color = '#dc2626';
                    errEl.textContent = problem;
                } else {
                    errEl.style.color = '#047857';
                    errEl.textContent = 'That checks out. Nothing is saved to a student from here.';
                }
            });
        }
    }

    function hideFullLesson() {
        const modal = document.getElementById('curriculum-lesson-view-modal');
        if (modal) modal.style.display = 'none';
    }

    function showFullLesson(slug) {
        const lessons = (state.roster && state.roster.lessons) || [];
        const lesson = lessons.find(function (l) { return l.slug === slug; });
        if (!lesson) return;
        const modal = document.getElementById('curriculum-lesson-view-modal');
        const title = document.getElementById('curriculum-lesson-view-title');
        const skill = document.getElementById('curriculum-lesson-view-skill');
        const storyEl = document.getElementById('curriculum-lesson-view-story');
        const body = document.getElementById('curriculum-lesson-view-body');
        if (!modal || !title || !body) return;
        const story = walkthroughStory();
        const catalog = walkthroughCatalog();
        const usingLive = !!(state.data && state.data.money_story && state.data.money_story.this_paycheck);
        const studentName = selectedStudentName();
        title.textContent = lesson.title;
        if (skill) {
            const skillName = lesson.skill_name || '';
            const numbersNote = usingLive && studentName
                ? 'Using ' + studentName + '’s paycheck and marketplace'
                : 'This is the full lesson students complete';
            skill.textContent = skillName ? (skillName + ' · ' + numbersNote) : numbersNote;
        }
        if (storyEl) storyEl.innerHTML = storyStripHtml(story);
        body.innerHTML = lessonFormHtml({ lesson: lesson }, {
            walkthrough: true,
            story: story,
            catalog: catalog,
        });
        wireWalkthroughLesson(slug, story);
        modal.style.display = 'block';
    }

    function setupLessonViewModal() {
        const modal = document.getElementById('curriculum-lesson-view-modal');
        const closeBtn = document.getElementById('curriculum-lesson-view-close');
        if (!modal || modal._curriculumLessonViewBound) return;
        modal._curriculumLessonViewBound = true;
        if (closeBtn) closeBtn.addEventListener('click', hideFullLesson);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) hideFullLesson();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') hideFullLesson();
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
            setupLessonViewModal();
            await loadRoster();
            if (state.studentId) await refreshStudent();
        } else {
            await refreshStudent();
        }
    }

    global.loadCurriculumView = loadCurriculumView;
})(window);
