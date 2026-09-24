"""Manny's Market economy API: weekly bills, savings, assistance applications, PTO, settings."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError

import assistance_forms as af
import bills_lib as bl
import economy_lib as eco

OPEN_STATUSES = ('unpaid', 'partial')
HISTORY_WEEKS = 8


def register_economy_routes(app):
    import app as m

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def settings_row():
        return m._economy_settings_row()

    def bills_settings():
        return bl.merged_settings(eco.load_json(settings_row().bills_config_json, {}))

    def now_local():
        return m.school_now()

    def is_staff():
        return current_user.role in ('staff', 'admin')

    def require_student_access(student_id):
        if not m.has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied'}), 403
        return None

    def active_products():
        return m.BillProduct.query.filter_by(is_active=True).order_by(m.BillProduct.sort_order, m.BillProduct.id).all()

    def load_catalog():
        rows = active_products()
        return {p.slug: eco.load_json(p.options_json, {}) for p in rows}, {p.slug: p for p in rows}

    def get_or_create_budget(student_id):
        row = m.StudentBudget.query.filter_by(student_id=student_id).first()
        if not row:
            row = m.StudentBudget(student_id=student_id, enrolled=False, choices_json=eco.dump_json(bl.DEFAULT_PLAN))
            m.db.session.add(row)
            m.db.session.flush()
        return row

    def get_or_create_pto(student_id):
        row = m.StudentPtoBalance.query.filter_by(student_id=student_id).first()
        if not row:
            row = m.StudentPtoBalance(student_id=student_id, days_remaining=Decimal('0.00'))
            m.db.session.add(row)
            m.db.session.flush()
        return row

    def color_of(student):
        return (getattr(student, 'card_color', None) or '').strip().lower()

    def local_date_from_utc(value):
        if not value:
            return None
        aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return aware.astimezone(now_local().tzinfo).date()

    def first_week_for(budget):
        """Monday of the first weekly statement for this student."""
        start = local_date_from_utc(budget.enrolled_at)
        if not start:
            return None
        monday = bl.week_start(start)
        return monday if monday == start else monday + timedelta(days=7)

    def student_user(student_id):
        return m.User.query.filter_by(role='student', student_id=student_id).first()

    def notify_student(student_id, ntype, title, body):
        user = student_user(student_id)
        if not user:
            return
        m.db.session.add(m.Notification(user_id=user.id, type=ntype, title=title, body=body, student_id=student_id))

    def approved_benefits(student_id, monday):
        out = {}
        for application in m.AssistanceApplication.query.filter_by(student_id=student_id, status='approved').all():
            if application.effective_week and monday and application.effective_week > monday:
                continue
            out[application.program] = {'income_weekly': eco.money(application.income_weekly or 0)}
        return out

    def plan_for(budget, catalog):
        return bl.normalize_plan(eco.load_json(budget.choices_json, {}), catalog)

    def money_f(value):
        return float(eco.money(value or 0))

    def amount_due(bill):
        return eco.money((bill.previous_balance or 0) + (bill.base_amount or 0) + (bill.late_fee_amount or 0))

    def remaining(bill):
        return eco.money(amount_due(bill) - (bill.paid_amount or 0))

    def fmt_day(d):
        return f"{d.strftime('%a')}, {d.strftime('%b')} {d.day}" if d else ''

    # ------------------------------------------------------------------
    # Weekly statements
    # ------------------------------------------------------------------

    def create_statement(student, budget, product, slug, monday, catalog, plan, settings):
        kind = 'savings' if slug == 'savings' else 'bill'
        existing = m.StudentBill.query.filter_by(
            student_id=student.id, bill_product_id=product.id, period_key=bl.week_key(monday), kind=kind,
        ).first()
        if existing:
            return None
        spec = bl.student_loan_spec(catalog, color_of(student))
        loan_balance = budget.loan_balance
        if slug == 'student_loan' and loan_balance is None and spec:
            loan_balance = eco.money(spec.get('principal'))
            budget.loan_balance = loan_balance
        lines, meta = bl.statement_lines(slug, catalog, plan, {
            'student_id': student.id,
            'monday': monday,
            'card_color': color_of(student),
            'benefits': approved_benefits(student.id, monday),
            'loan_balance': loan_balance,
            'settings': settings,
        })
        bill = m.StudentBill(
            student_id=student.id,
            bill_product_id=product.id,
            kind=kind,
            schema_version=bl.BILLS_VERSION,
            period_key=bl.week_key(monday),
            statement_date=monday,
            period_start=monday,
            period_end=monday + timedelta(days=6),
            due_date=bl.due_date_for_week(monday),
            description=product.name,
            payee_name=bl.payee_for(slug, catalog, plan),
            account_number=bl.account_number(slug, student.id),
            lines_json=eco.dump_json(lines),
            meta_json=eco.dump_json(meta),
            base_amount=bl.lines_total(lines),
            previous_balance=Decimal('0.00'),
            late_fee_amount=Decimal('0.00'),
            paid_amount=Decimal('0.00'),
            status='unpaid',
        )
        try:
            with m.db.session.begin_nested():
                m.db.session.add(bill)
        except IntegrityError:
            return None
        return bill

    def ensure_statements(student, now):
        """Issue this week's statements for an enrolled student.

        Only the current week: if a week was ever missed (no cron, no visits), students
        are not handed backdated bills that are already late.
        """
        budget = get_or_create_budget(student.id)
        if not budget.enrolled:
            return 0
        this_monday = bl.week_start(now.date())
        first = first_week_for(budget)
        if first and this_monday < first:
            return 0
        catalog, rows = load_catalog()
        plan = plan_for(budget, catalog)
        settings = bills_settings()
        created = 0
        for slug in bl.selected_slugs(plan, catalog, color_of(student)):
            product = rows.get(slug)
            if product and create_statement(student, budget, product, slug, this_monday, catalog, plan, settings):
                created += 1
        if created:
            notify_student(student.id, 'bills_ready', 'Your bills are here',
                           f'New bills for the week of {this_monday.strftime("%b")} {this_monday.day}. '
                           f'They are due {fmt_day(bl.due_date_for_week(this_monday))} at 11:59 PM.')
        return created

    def carry_target(bill):
        next_monday = bill.due_date
        target = m.StudentBill.query.filter_by(
            student_id=bill.student_id, bill_product_id=bill.bill_product_id,
            period_key=bl.week_key(next_monday), kind='bill',
        ).first()
        if target:
            return target
        target = m.StudentBill(
            student_id=bill.student_id,
            bill_product_id=bill.bill_product_id,
            kind='bill',
            schema_version=bl.BILLS_VERSION,
            period_key=bl.week_key(next_monday),
            statement_date=next_monday,
            period_start=next_monday,
            period_end=next_monday + timedelta(days=6),
            due_date=bl.due_date_for_week(next_monday),
            description=bill.description,
            payee_name=bill.payee_name,
            account_number=bill.account_number,
            lines_json=eco.dump_json([]),
            meta_json=eco.dump_json({'final_bill': True}),
            base_amount=Decimal('0.00'),
            previous_balance=Decimal('0.00'),
            late_fee_amount=Decimal('0.00'),
            paid_amount=Decimal('0.00'),
            status='unpaid',
        )
        m.db.session.add(target)
        m.db.session.flush()
        return target

    def process_overdue(student, now):
        """Past-due statements get one late fee and roll into next week's statement."""
        settings = bills_settings()
        changed = True
        passes = 0
        late_titles = []
        while changed and passes < 12:
            changed = False
            passes += 1
            open_bills = m.StudentBill.query.filter(
                m.StudentBill.student_id == student.id,
                m.StudentBill.schema_version == bl.BILLS_VERSION,
                m.StudentBill.status.in_(OPEN_STATUSES),
            ).order_by(m.StudentBill.due_date, m.StudentBill.id).all()
            for bill in open_bills:
                if not bl.is_past_due(bill.due_date, now):
                    continue
                left = remaining(bill)
                if left <= 0:
                    bill.status = 'paid'
                    continue
                if bill.kind == 'savings':
                    bill.status = 'skipped'
                    continue
                slug = bill.product.slug if bill.product else ''
                if not bill.late_fee_applied_at:
                    fee = bl.late_fee(slug, left, bill.base_amount if slug == 'rent' else None, settings)
                    bill.late_fee_amount = fee
                    bill.late_fee_applied_at = datetime.utcnow()
                    left = remaining(bill)
                    late_titles.append((bill.payee_name or bill.description, fee))
                target = carry_target(bill)
                target.previous_balance = eco.money((target.previous_balance or 0) + left)
                meta = eco.load_json(target.meta_json, {})
                carried = meta.get('carried_from') or []
                carried.append({'bill_id': bill.id, 'week': bill.period_key, 'amount': str(left)})
                meta['carried_from'] = carried
                if slug == 'student_loan':
                    src_meta = eco.load_json(bill.meta_json, {})
                    meta['carried_principal'] = str(eco.money(
                        Decimal(str(meta.get('carried_principal') or 0))
                        + Decimal(str(src_meta.get('principal') or 0))
                        + Decimal(str(src_meta.get('carried_principal') or 0))
                    ))
                target.meta_json = eco.dump_json(meta)
                bill.status = 'carried'
                bill.carried_to_bill_id = target.id
                changed = True
            m.db.session.flush()
        if late_titles:
            listed = ', '.join(f'{payee} (${fee:,.2f} late fee)' for payee, fee in late_titles)
            notify_student(student.id, 'bills_late',
                           'A bill was late' if len(late_titles) == 1 else f'{len(late_titles)} bills were late',
                           f'{listed}. What you still owed moved onto this week\'s bills.')
        return len(late_titles)

    def refresh_student(student, now=None):
        now = now or now_local()
        created = ensure_statements(student, now)
        late = process_overdue(student, now)
        return created, late

    def enrolled_students():
        ids = [b.student_id for b in m.StudentBudget.query.filter_by(enrolled=True).all()]
        if not ids:
            return []
        return m.Student.query.filter(m.Student.id.in_(ids)).all()

    def run_economy_maintenance(when=None):
        now = now_local()
        created = 0
        late = 0
        for student in enrolled_students():
            c, lt = refresh_student(student, now)
            created += c
            late += lt
        m.db.session.commit()
        return {'bills_created': created, 'late_fees': late}

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def bill_payments(bill):
        rows = m.Transaction.query.filter_by(student_bill_id=bill.id).order_by(m.Transaction.created_at).all()
        code = bl.product_code(bill.product.slug, {bill.product.slug: eco.load_json(bill.product.options_json, {})}) if bill.product else 'PMT'
        return [{
            'amount': money_f(-t.amount) if t.amount is not None else 0.0,
            'paid_at': m.utc_isoformat(t.created_at),
            'confirmation': bl.confirmation_number(code, t.id),
        } for t in rows]

    def status_label(bill, now):
        status = bill.status
        if status in OPEN_STATUSES:
            days = (bill.due_date - now.date()).days
            if days <= 0:
                return 'due_tonight', 'Due tonight, 11:59 PM'
            if days == 1:
                return 'due_soon', 'Due tomorrow'
            return 'due', f'Due {fmt_day(bill.due_date)}'
        if status == 'paid':
            paid_on = local_date_from_utc(bill.paid_at)
            return 'paid', f'Paid {fmt_day(paid_on)}' if paid_on else 'Paid'
        if status == 'carried':
            return 'late', 'Late: moved to next bill'
        if status == 'waived':
            return 'waived', 'Waived'
        if status == 'skipped':
            return 'skipped', 'Skipped'
        return status, status.title()

    def serialize_bill(bill, now, history=None):
        slug = bill.product.slug if bill.product else None
        tone, label = status_label(bill, now)
        meta = eco.load_json(bill.meta_json, {})
        payload = {
            'id': bill.id,
            'slug': slug,
            'kind': bill.kind,
            'service': bill.description,
            'payee': bill.payee_name or bill.description,
            'account_number': bill.account_number,
            'week': bill.period_key,
            'statement_date': bill.statement_date.isoformat() if bill.statement_date else None,
            'period_start': bill.period_start.isoformat() if bill.period_start else None,
            'period_end': bill.period_end.isoformat() if bill.period_end else None,
            'due_date': bill.due_date.isoformat() if bill.due_date else None,
            'lines': eco.load_json(bill.lines_json, []),
            'meta': meta,
            'previous_balance': money_f(bill.previous_balance),
            'new_charges': money_f(bill.base_amount),
            'late_fee': money_f(bill.late_fee_amount),
            'amount_due': money_f(amount_due(bill)),
            'paid_amount': money_f(bill.paid_amount),
            'remaining': money_f(remaining(bill)),
            'status': bill.status,
            'status_tone': tone,
            'status_label': label,
            'waived_reason': bill.waived_reason,
            'payments': bill_payments(bill),
            'code': bl.product_code(slug, {slug: eco.load_json(bill.product.options_json, {})}) if bill.product else 'PMT',
        }
        if slug == 'electric' and history is not None:
            payload['usage_history'] = history
        return payload

    def electric_history(student_id, upto_week):
        rows = m.StudentBill.query.join(m.BillProduct).filter(
            m.StudentBill.student_id == student_id,
            m.StudentBill.schema_version == bl.BILLS_VERSION,
            m.BillProduct.slug == 'electric',
            m.StudentBill.period_key <= upto_week,
        ).order_by(m.StudentBill.period_key.desc()).limit(6).all()
        out = []
        for row in reversed(rows):
            kwh = eco.load_json(row.meta_json, {}).get('kwh')
            if kwh is not None:
                out.append({'week': row.period_key, 'kwh': kwh})
        return out

    def sort_key(item):
        tone_rank = {'due_tonight': 0, 'due_soon': 1, 'due': 2, 'late': 3, 'paid': 4, 'skipped': 5, 'waived': 6}
        order = bl.PRODUCT_ORDER.index(item['slug']) if item['slug'] in bl.PRODUCT_ORDER else 99
        return (tone_rank.get(item['status_tone'], 9), order)

    def income_summary(student):
        info = {'daily_rate': None, 'full_week_gross': None, 'take_home_100': None, 'take_home_90': None, 'last_paycheck': None}
        try:
            rate = eco.daily_rate_for_color(getattr(student, 'card_color', None), student_label=student.name)
        except eco.MissingCardColorError:
            rate = None
        if rate is not None:
            full = eco.compute_stub_paycheck(rate, 5, 100)
            ninety = eco.compute_stub_paycheck(rate, 5, 90)
            info.update({
                'daily_rate': money_f(rate),
                'full_week_gross': money_f(full['gross']),
                'take_home_100': money_f(full['final_pay']),
                'take_home_90': money_f(ninety['final_pay']),
            })
        last = m.Paycheck.query.filter_by(student_id=student.id).order_by(m.Paycheck.pay_period_end.desc()).first()
        if last:
            info['last_paycheck'] = {
                'gross': money_f(last.gross_pay if last.gross_pay is not None else last.base_pay),
                'final_pay': money_f(last.final_pay),
                'pay_period_end': last.pay_period_end.isoformat() if last.pay_period_end else None,
                'deposited': last.deposited_at is not None,
            }
        return info

    def plan_payload(budget, student, catalog, settings, now):
        plan = plan_for(budget, catalog)
        total, items = bl.weekly_plan_total(plan, catalog, color_of(student), budget.loan_balance)
        sections = []

        def section(key, title, slug, note=None):
            opts = catalog.get(slug) or {}
            options = []
            for option in bl.product_options(opts):
                weekly = option.get('weekly', option.get('loan_weekly', '0'))
                extra = {}
                if key == 'vehicle':
                    vehicle_weekly = eco.money(Decimal(str(option.get('loan_weekly') or 0))
                                               + Decimal(str(option.get('upkeep_weekly') or 0)))
                    fuel_price = Decimal(str(((catalog.get('fuel') or {}).get('params') or {}).get('fuel_price') or '4.37'))
                    fuel = eco.money(Decimal(str(option.get('gallons_week') or 0)) * fuel_price)
                    weekly = eco.money(vehicle_weekly + fuel)
                    extra = {'breakdown': {
                        'loan': money_f(option.get('loan_weekly')),
                        'upkeep': money_f(option.get('upkeep_weekly')),
                        'fuel': money_f(fuel),
                    }, 'needs_insurance': option.get('id') != 'none'}
                options.append({
                    'id': option.get('id'),
                    'label': option.get('label'),
                    'detail': option.get('detail'),
                    'payee': option.get('payee') or opts.get('payee'),
                    'weekly': money_f(weekly),
                    'monthly': money_f(bl.monthly_from_weekly(weekly)),
                    'roommate': bool(option.get('roommate')),
                    **extra,
                })
            sections.append({'key': key, 'title': title, 'note': note or opts.get('note'), 'selected': plan.get(key), 'options': options,
                             'required': key not in ('cell', 'vehicle', 'car_insurance')})

        section('housing', 'Where you live', 'rent')
        section('internet', 'Internet', 'internet')
        section('health', 'Health insurance', 'health')
        section('groceries', 'Groceries', 'groceries')
        section('renters', 'Renters insurance', 'renters')
        section('savings', 'Emergency fund', 'savings')
        section('cell', 'Cell phone', 'cell')
        section('vehicle', 'Car', 'car_loan')
        section('car_insurance', 'Car insurance', 'car_insurance')
        loan = bl.student_loan_spec(catalog, color_of(student))
        next_monday = bl.week_start(now.date()) + timedelta(days=7)
        return {
            'choices': plan,
            'sections': sections,
            'weekly_total': money_f(total),
            'items': [{'slug': i['slug'], 'amount': money_f(i['amount'])} for i in items],
            'student_loan': {
                'label': loan.get('label'), 'weekly': money_f(loan.get('weekly')),
                'balance': money_f(budget.loan_balance if budget.loan_balance is not None else loan.get('principal')),
            } if loan else None,
            'electric_note': (catalog.get('electric') or {}).get('note'),
            'housing_note': (catalog.get('rent') or {}).get('note'),
            'applies_from': next_monday.isoformat(),
            'applies_label': fmt_day(next_monday),
        }

    def assistance_payload(student_id):
        apps = {a.program: a for a in m.AssistanceApplication.query.filter_by(student_id=student_id).all()}
        out = []
        for program in af.PROGRAM_ORDER:
            spec = af.form_spec(program)
            application = apps.get(program)
            out.append({
                'program': program,
                'title': spec['title'],
                'form_number': f"{spec['form_number']} {spec['revision']}",
                'program_name': spec['program_name'],
                'summary': spec['benefit_summary'],
                'status': application.status if application else 'not_started',
                'attempts': application.attempts if application else 0,
                'approved_at': m.utc_isoformat(application.approved_at) if application and application.approved_at else None,
                'effective_week': application.effective_week.isoformat() if application and application.effective_week else None,
            })
        return out

    def economy_payload(student):
        now = now_local()
        budget = get_or_create_budget(student.id)
        catalog, _rows = load_catalog()
        settings = bills_settings()
        account = m.get_or_create_bank_account(student.id)
        pto = get_or_create_pto(student.id)
        this_monday = bl.week_start(now.date())
        cutoff = bl.week_key(this_monday - timedelta(days=7 * HISTORY_WEEKS))
        bills = m.StudentBill.query.filter(
            m.StudentBill.student_id == student.id,
            m.StudentBill.schema_version == bl.BILLS_VERSION,
            m.StudentBill.period_key >= cutoff,
        ).order_by(m.StudentBill.period_key.desc(), m.StudentBill.id).all()
        current, history = [], {}
        this_key = bl.week_key(this_monday)
        for bill in bills:
            usage = electric_history(student.id, bill.period_key) if bill.product and bill.product.slug == 'electric' else None
            item = serialize_bill(bill, now, usage)
            if bill.status in OPEN_STATUSES or bill.period_key == this_key:
                current.append(item)
            else:
                history.setdefault(bill.period_key, []).append(item)
        current.sort(key=sort_key)
        open_items = [b for b in current if b['status'] in OPEN_STATUSES]
        due_now = eco.money(sum((Decimal(str(b['remaining'])) for b in open_items if b['kind'] == 'bill'), Decimal('0')))
        savings_due = eco.money(sum((Decimal(str(b['remaining'])) for b in open_items if b['kind'] == 'savings'), Decimal('0')))
        checking = eco.money(account.balance)
        savings_balance = eco.money(account.savings_balance or 0)
        goal, goal_weeks = bl.savings_goal(plan_for(budget, catalog), catalog, color_of(student), settings)
        return {
            'student_id': student.id,
            'student_name': student.name,
            'card_color': color_of(student),
            'enrolled': bool(budget.enrolled),
            'first_week': first_week_for(budget).isoformat() if first_week_for(budget) else None,
            'is_staff': is_staff(),
            'can_edit_plan': is_staff() or current_user.student_id == student.id,
            'now': now.isoformat(),
            'week': {
                'start': this_key,
                'end': (this_monday + timedelta(days=6)).isoformat(),
                'due': bl.due_date_for_week(this_monday).isoformat(),
                'due_label': fmt_day(bl.due_date_for_week(this_monday)),
                'label': f"{this_monday.strftime('%b')} {this_monday.day} - {(this_monday + timedelta(days=6)).strftime('%b')} {(this_monday + timedelta(days=6)).day}",
            },
            'balances': {'checking': money_f(checking), 'savings': money_f(savings_balance)},
            'summary': {
                'due_now': money_f(due_now),
                'savings_due': money_f(savings_due),
                'left_after_bills': money_f(checking - due_now - savings_due),
                'open_count': len(open_items),
                'total_count': len(current),
            },
            'bills': current,
            'history': [{'week': week, 'bills': sorted(items, key=sort_key)} for week, items in sorted(history.items(), reverse=True)],
            'plan': plan_payload(budget, student, catalog, settings, now),
            'income': income_summary(student),
            'savings': {'balance': money_f(savings_balance), 'goal': money_f(goal), 'goal_weeks': goal_weeks},
            'assistance': assistance_payload(student.id),
            'pto_days': float(pto.days_remaining or 0),
            'late_fees': settings['late_fees'],
        }

    # ------------------------------------------------------------------
    # Student routes
    # ------------------------------------------------------------------

    @app.route('/api/economy/student/<int:student_id>', methods=['GET'])
    @login_required
    def get_student_economy(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        refresh_student(student)
        m.db.session.commit()
        return jsonify(economy_payload(student))

    @app.route('/api/economy/student/<int:student_id>/plan', methods=['PUT'])
    @login_required
    def save_student_plan(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        if not is_staff() and current_user.student_id != student_id:
            return jsonify({'error': 'Access denied'}), 403
        student = m.Student.query.get_or_404(student_id)
        budget = get_or_create_budget(student_id)
        if not budget.enrolled and not is_staff():
            return jsonify({'error': 'Your teacher needs to turn on bills for you first.'}), 400
        data = request.get_json(silent=True) or {}
        catalog, _rows = load_catalog()
        raw = dict(data.get('plan') or {})
        raw['version'] = 2
        problems = bl.plan_problems(raw, catalog)
        plan = bl.normalize_plan(raw, catalog)
        budget.choices_json = eco.dump_json(plan)
        budget.updated_by_user_id = current_user.id
        m.db.session.commit()
        payload = economy_payload(student)
        payload['message'] = f"Saved. Your changes start with next week's bills ({payload['plan']['applies_label']})."
        payload['problems'] = problems
        return jsonify(payload)

    @app.route('/api/economy/bills/<int:bill_id>/pay', methods=['POST'])
    @login_required
    def pay_student_bill(bill_id):
        bill = m.StudentBill.query.get_or_404(bill_id)
        denied = require_student_access(bill.student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(bill.student_id)
        process_overdue(student, now_local())
        m.db.session.flush()
        if bill.schema_version != bl.BILLS_VERSION:
            return jsonify({'error': 'This is an old bill and can no longer be paid.'}), 400
        if bill.status == 'carried':
            m.db.session.commit()
            return jsonify({'error': 'This bill was late, so it moved onto this week\'s bill. Pay it there.'}), 400
        if bill.status not in OPEN_STATUSES:
            return jsonify({'error': 'This bill is already taken care of.'}), 400
        data = request.get_json(silent=True) or {}
        mode = (data.get('mode') or 'full').strip().lower()
        amount = eco.parse_money(data.get('amount'))
        new_balance = eco.parse_money(data.get('new_balance'))
        owed = remaining(bill)
        account = m.get_or_create_bank_account(bill.student_id)
        checking = eco.money(account.balance)
        errors = {}
        if amount is None or amount <= 0:
            errors['amount'] = 'Enter how much you are paying.'
        elif mode == 'full' and amount != owed:
            errors['amount'] = 'That is not the amount due on this bill. Find "Amount due" on the bill.'
        elif mode != 'full' and amount >= owed:
            errors['amount'] = f'A partial payment has to be less than the amount due. To pay all of it, choose "Pay the full amount".'
        elif amount > checking:
            errors['amount'] = 'You don\'t have enough in checking for that. You can pay part of it.'
        if not errors:
            if new_balance is None:
                errors['new_balance'] = 'Enter your checking balance after this payment.'
            elif new_balance != eco.money(checking - amount):
                errors['new_balance'] = 'Check your math: start with your checking balance and subtract your payment.'
        if errors:
            m.db.session.commit()
            return jsonify({'error': next(iter(errors.values())), 'errors': errors}), 400
        account.balance = eco.money(checking - amount)
        account.updated_at = datetime.utcnow()
        slug = bill.product.slug if bill.product else ''
        is_savings = bill.kind == 'savings'
        if is_savings:
            account.savings_balance = eco.money((account.savings_balance or 0) + amount)
        bill.paid_amount = eco.money((bill.paid_amount or 0) + amount)
        bill.paid_at = datetime.utcnow()
        bill.status = 'paid' if remaining(bill) <= 0 else 'partial'
        tx = m.Transaction(
            student_id=bill.student_id,
            bank_account_id=account.id,
            transaction_type='savings_deposit' if is_savings else 'bill',
            amount=-amount,
            student_bill_id=bill.id,
            balance_after=account.balance,
            description=(f'Transfer to savings (emergency fund)' if is_savings
                         else f'{(bill.payee_name or bill.description).upper()} ONLINE PMT'),
        )
        m.db.session.add(tx)
        m.db.session.flush()
        if bill.status == 'paid' and slug == 'student_loan':
            budget = get_or_create_budget(bill.student_id)
            meta = eco.load_json(bill.meta_json, {})
            principal = Decimal(str(meta.get('principal') or 0)) + Decimal(str(meta.get('carried_principal') or 0))
            if budget.loan_balance is not None:
                budget.loan_balance = eco.money(max(Decimal('0'), budget.loan_balance - principal))
        code = bl.product_code(slug, {slug: eco.load_json(bill.product.options_json, {})}) if bill.product else 'PMT'
        confirmation = bl.confirmation_number(code, tx.id)
        m.db.session.commit()
        return jsonify({
            'ok': True,
            'receipt': {
                'confirmation': confirmation,
                'payee': bill.payee_name or bill.description,
                'amount': money_f(amount),
                'new_balance': money_f(account.balance),
                'remaining': money_f(remaining(bill)),
                'status': bill.status,
                'paid_at': m.utc_isoformat(bill.paid_at),
            },
            'economy': economy_payload(student),
        })

    @app.route('/api/economy/student/<int:student_id>/savings/transfer', methods=['POST'])
    @login_required
    def savings_transfer(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        data = request.get_json(silent=True) or {}
        direction = (data.get('direction') or 'to_checking').strip().lower()
        amount = eco.parse_money(data.get('amount'))
        account = m.get_or_create_bank_account(student_id)
        savings = eco.money(account.savings_balance or 0)
        checking = eco.money(account.balance)
        if amount is None or amount <= 0:
            return jsonify({'error': 'Enter an amount to move.'}), 400
        if direction == 'to_checking':
            if not data.get('confirm'):
                return jsonify({'error': 'Confirm that you want to use your emergency fund.', 'needs_confirm': True}), 400
            if amount > savings:
                return jsonify({'error': 'You don\'t have that much in your emergency fund.'}), 400
            account.savings_balance = eco.money(savings - amount)
            account.balance = eco.money(checking + amount)
            tx_type, tx_amount, desc = 'savings_withdrawal', amount, 'Transfer from savings (emergency fund)'
        elif direction == 'to_savings':
            if amount > checking:
                return jsonify({'error': 'You don\'t have that much in checking.'}), 400
            account.savings_balance = eco.money(savings + amount)
            account.balance = eco.money(checking - amount)
            tx_type, tx_amount, desc = 'savings_deposit', -amount, 'Transfer to savings (emergency fund)'
        else:
            return jsonify({'error': 'Unknown transfer.'}), 400
        account.updated_at = datetime.utcnow()
        m.db.session.add(m.Transaction(
            student_id=student_id, bank_account_id=account.id, transaction_type=tx_type,
            amount=tx_amount, balance_after=account.balance, description=desc,
        ))
        m.db.session.commit()
        return jsonify({'ok': True, 'economy': economy_payload(student)})

    # ------------------------------------------------------------------
    # Assistance applications
    # ------------------------------------------------------------------

    def expected_answers(student, program):
        catalog, _rows = load_catalog()
        budget = get_or_create_budget(student.id)
        plan = plan_for(budget, catalog)
        listing = bl.housing_listing(plan, catalog)
        health = bl.find_option(catalog.get('health') or {}, plan.get('health')) or {}
        parts = [p for p in (student.name or '').replace(',', ' ').split() if p]
        first = parts[0][0] if parts else ''
        last = parts[-1][0] if len(parts) > 1 else ''
        income = income_summary(student)
        last_pay = income.get('last_paycheck')
        weekly_gross = eco.money(last_pay['gross'] if last_pay else (income.get('full_week_gross') or 0))
        housing_app = m.AssistanceApplication.query.filter_by(student_id=student.id, program='housing', status='approved').first()
        expenses = {'rent', 'electricity'}
        if plan.get('cell') and plan['cell'] != 'none':
            expenses.add('phone')
        return {
            'first_initial': first,
            'last_initial': last,
            'initials': first + last,
            'grade': str(student.grade or ''),
            'lunch_number': str(student.lunch_number or ''),
            'street': af.SCHOOL_ADDRESS['street'],
            'city': af.SCHOOL_ADDRESS['city'],
            'state': af.SCHOOL_ADDRESS['state'],
            'zip': af.SCHOOL_ADDRESS['zip'],
            'county': af.SCHOOL_ADDRESS['county'],
            'full_address': '{street} {city} {state} {zip}'.format(**af.SCHOOL_ADDRESS),
            'marital_code': 'N',
            'marital': 'never',
            'language': 'English',
            'programs_snap': {'snap'},
            'buys_food_together': 'no' if listing.get('roommate') else 'yes',
            'income_type': 'job',
            'income_expect': 'continue',
            'employer': "Manny's Market",
            'pay_frequency': 'weekly',
            'hours_per_week': str(int(eco.SCHOOL_DAY_HOURS * eco.SCHOOL_DAYS_PER_WEEK)),
            'weekly_gross': weekly_gross,
            'yearly_income': eco.money(weekly_gross * 52),
            'rent_weekly': eco.money(listing.get('weekly')),
            'landlord': listing.get('payee'),
            'expense_rows': expenses,
            'has_housing_subsidy': 'yes' if housing_app else 'no',
            'has_vehicle': 'yes' if plan.get('vehicle') and plan['vehicle'] != 'none' else 'no',
            'employed_set': {'employed'},
            'coverage_set': {'private'},
            'health_company': (catalog.get('health') or {}).get('payee') or 'Pinewood Health Plan',
            'health_plan': health.get('label') or 'Bronze plan',
            'waitlist_set': {'section8'},
            'today': now_local().date(),
        }

    def get_application(student_id, program, create=True):
        row = m.AssistanceApplication.query.filter_by(student_id=student_id, program=program).first()
        if not row and create:
            row = m.AssistanceApplication(student_id=student_id, program=program, status='draft', attempts=0)
            m.db.session.add(row)
            m.db.session.flush()
        return row

    def benefit_preview(student, program, income_weekly):
        """What the approved benefit is worth right now (shown on the approval notice)."""
        catalog, _rows = load_catalog()
        settings = bills_settings()
        budget = get_or_create_budget(student.id)
        plan = plan_for(budget, catalog)
        listing = bl.housing_listing(plan, catalog)
        if program == 'housing':
            calc = bl.housing_assistance(listing.get('weekly'), listing.get('bedrooms'), income_weekly, settings)
            return {'weekly': money_f(calc['amount']), 'explain': calc['explain'], 'applies_to': 'rent'}
        if program == 'snap':
            calc = bl.snap_benefit(income_weekly, listing.get('weekly'), settings)
            return {'weekly': money_f(calc['amount']), 'explain': calc['explain'], 'applies_to': 'groceries'}
        opts = catalog.get('health') or {}
        bench = bl.find_option(opts, settings['benefits']['health'].get('benchmark_option', 'silver')) or {}
        chosen = bl.find_option(opts, plan.get('health')) or {}
        calc = bl.health_help(income_weekly, eco.money(bench.get('weekly')), settings)
        if calc['kind'] == 'ma':
            weekly = eco.money(chosen.get('weekly'))
        else:
            weekly = min(calc['amount'] or Decimal('0'), eco.money(chosen.get('weekly')))
        return {'weekly': money_f(weekly), 'explain': calc['explain'], 'applies_to': 'health', 'kind': calc['kind']}

    @app.route('/api/economy/student/<int:student_id>/applications/<program>', methods=['GET'])
    @login_required
    def get_application_form(student_id, program):
        denied = require_student_access(student_id)
        if denied:
            return denied
        spec = af.public_spec(program)
        if not spec:
            return jsonify({'error': 'Unknown program'}), 404
        student = m.Student.query.get_or_404(student_id)
        row = get_application(student_id, program, create=False)
        payload = {
            'form': spec,
            'status': row.status if row else 'not_started',
            'answers': eco.load_json(row.answers_json, {}) if row else {},
            'results': eco.load_json(row.results_json, {}) if row else {},
            'attempts': row.attempts if row else 0,
            'student_name': student.name,
        }
        if row and row.status == 'approved':
            payload['notice'] = {
                'approved_at': m.utc_isoformat(row.approved_at),
                'effective_week': row.effective_week.isoformat() if row.effective_week else None,
                'effective_label': fmt_day(row.effective_week),
                **benefit_preview(student, program, eco.money(row.income_weekly or 0)),
            }
        return jsonify(payload)

    @app.route('/api/economy/student/<int:student_id>/applications/<program>/draft', methods=['PUT'])
    @login_required
    def save_application_draft(student_id, program):
        denied = require_student_access(student_id)
        if denied:
            return denied
        if not af.form_spec(program):
            return jsonify({'error': 'Unknown program'}), 404
        row = get_application(student_id, program)
        if row.status == 'approved':
            return jsonify({'ok': True})
        data = request.get_json(silent=True) or {}
        row.answers_json = eco.dump_json(data.get('answers') or {})
        m.db.session.commit()
        return jsonify({'ok': True})

    @app.route('/api/economy/student/<int:student_id>/applications/<program>/submit', methods=['POST'])
    @login_required
    def submit_application(student_id, program):
        denied = require_student_access(student_id)
        if denied:
            return denied
        if not af.form_spec(program):
            return jsonify({'error': 'Unknown program'}), 404
        student = m.Student.query.get_or_404(student_id)
        row = get_application(student_id, program)
        if row.status == 'approved':
            return jsonify({'error': 'This application is already approved.'}), 400
        data = request.get_json(silent=True) or {}
        answers = data.get('answers') or {}
        expected = expected_answers(student, program)
        results, score = af.grade(program, answers, expected)
        row.answers_json = eco.dump_json(answers)
        row.results_json = eco.dump_json(results)
        row.attempts = (row.attempts or 0) + 1
        row.submitted_at = datetime.utcnow()
        wrong = [fid for fid, ok in results.items() if not ok]
        payload = {'score': score, 'results': results, 'wrong_count': len(wrong), 'attempts': row.attempts}
        if not wrong:
            now = now_local()
            row.status = 'approved'
            row.approved_at = datetime.utcnow()
            row.income_weekly = expected['weekly_gross']
            row.effective_week = bl.week_start(now.date()) + timedelta(days=7)
            spec = af.form_spec(program)
            preview = benefit_preview(student, program, expected['weekly_gross'])
            notify_student(student_id, 'assistance_approved', f"Application approved: {spec['program_name']}",
                           f"Your benefits start with the bills issued {fmt_day(row.effective_week)}.")
            payload['approved'] = True
            payload['notice'] = {
                'approved_at': m.utc_isoformat(row.approved_at),
                'effective_week': row.effective_week.isoformat(),
                'effective_label': fmt_day(row.effective_week),
                **preview,
            }
        m.db.session.commit()
        payload['status'] = row.status
        return jsonify(payload)

    @app.route('/api/economy/student/<int:student_id>/applications/<program>/staff', methods=['POST'])
    @login_required
    @m.staff_required
    def staff_application_action(student_id, program):
        denied = require_student_access(student_id)
        if denied:
            return denied
        row = get_application(student_id, program, create=False)
        if not row:
            return jsonify({'error': 'No application yet.'}), 404
        action = ((request.get_json(silent=True) or {}).get('action') or '').strip().lower()
        if action == 'revoke':
            row.status = 'revoked'
        elif action == 'reset':
            row.status = 'draft'
            row.results_json = None
            row.attempts = 0
        else:
            return jsonify({'error': 'Unknown action'}), 400
        row.decided_by_user_id = current_user.id
        m.db.session.commit()
        return jsonify({'ok': True, 'status': row.status})

    # ------------------------------------------------------------------
    # Staff routes
    # ------------------------------------------------------------------

    def managed_student_ids():
        """Students whose support team lists the current user (same rule as the bank account search)."""
        user_name = (current_user.name or current_user.username) or ''
        user_username = (current_user.username or '').strip()
        if not user_name and not user_username:
            return set()
        members = m.TeamMember.query.filter(
            (m.db.func.lower(m.TeamMember.name) == m.db.func.lower(user_name))
            | (m.db.func.lower(m.TeamMember.name) == m.db.func.lower(user_username))
        ).all()
        return {tm.student_id for tm in members if tm.student_id}

    @app.route('/api/economy/overview', methods=['GET'])
    @login_required
    @m.staff_required
    def economy_overview():
        ids = managed_student_ids() if request.args.get('managed_by_me') == 'true' else None
        students = m.Student.query.order_by(m.Student.name).all()
        now = now_local()
        rows = []
        budgets = {b.student_id: b for b in m.StudentBudget.query.all()}
        active_ids = {u.student_id for u in m.User.query.filter_by(role='student').all() if u.student_id}
        for student in students:
            if student.id not in active_ids or not m.has_student_access(current_user, student.id):
                continue
            if ids is not None and student.id not in ids:
                continue
            budget = budgets.get(student.id)
            account = m.get_or_create_bank_account(student.id)
            if not budget or not budget.enrolled:
                rows.append({
                    'student_id': student.id, 'name': student.name, 'card_color': color_of(student),
                    'enrolled': False, 'checking': money_f(account.balance), 'savings': money_f(account.savings_balance or 0),
                    'due': 0.0, 'past_due': 0.0, 'late_last_4_weeks': 0, 'last_payment': None, 'assistance': [],
                })
                continue
            refresh_student(student, now)
            open_bills = m.StudentBill.query.filter(
                m.StudentBill.student_id == student.id,
                m.StudentBill.schema_version == bl.BILLS_VERSION,
                m.StudentBill.status.in_(OPEN_STATUSES),
            ).all()
            due = eco.money(sum((remaining(b) for b in open_bills if b.kind == 'bill'), Decimal('0')))
            past_due = eco.money(sum((b.previous_balance or 0 for b in open_bills), Decimal('0')))
            late_count = m.StudentBill.query.filter(
                m.StudentBill.student_id == student.id,
                m.StudentBill.schema_version == bl.BILLS_VERSION,
                m.StudentBill.status == 'carried',
                m.StudentBill.period_key >= bl.week_key(bl.week_start(now.date()) - timedelta(days=28)),
            ).count()
            last_payment = m.Transaction.query.filter(
                m.Transaction.student_id == student.id,
                m.Transaction.transaction_type.in_(['bill', 'savings_deposit']),
            ).order_by(m.Transaction.created_at.desc()).first()
            approved = [a.program for a in m.AssistanceApplication.query.filter_by(student_id=student.id, status='approved').all()]
            rows.append({
                'student_id': student.id,
                'name': student.name,
                'card_color': color_of(student),
                'enrolled': True,
                'checking': money_f(account.balance),
                'savings': money_f(account.savings_balance or 0),
                'due': money_f(due),
                'past_due': money_f(past_due),
                'late_last_4_weeks': late_count,
                'last_payment': m.utc_isoformat(last_payment.created_at) if last_payment else None,
                'assistance': approved,
            })
        m.db.session.commit()
        return jsonify({'students': rows, 'week_due': fmt_day(bl.due_date_for_week(bl.week_start(now.date())))})

    @app.route('/api/economy/bills/<int:bill_id>/staff-pay', methods=['POST'])
    @login_required
    @m.staff_required
    def staff_pay_or_waive_bill(bill_id):
        bill = m.StudentBill.query.get_or_404(bill_id)
        denied = require_student_access(bill.student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(bill.student_id)
        if bill.status not in OPEN_STATUSES:
            return jsonify({'error': 'This bill is already taken care of.'}), 400
        data = request.get_json(silent=True) or {}
        action = (data.get('action') or 'pay').strip().lower()
        owed = remaining(bill)
        if action == 'waive':
            reason = (data.get('reason') or '').strip()
            if not reason:
                return jsonify({'error': 'Give a reason for waiving this bill.'}), 400
            bill.status = 'waived'
            bill.waived_reason = reason[:200]
            bill.waived_by_user_id = current_user.id
            bill.paid_at = datetime.utcnow()
            m.db.session.commit()
            return jsonify({'ok': True, 'economy': economy_payload(student)})
        account = m.get_or_create_bank_account(bill.student_id)
        if eco.money(account.balance) < owed:
            return jsonify({'error': 'Not enough money in checking.'}), 400
        account.balance = eco.money(account.balance - owed)
        account.updated_at = datetime.utcnow()
        is_savings = bill.kind == 'savings'
        if is_savings:
            account.savings_balance = eco.money((account.savings_balance or 0) + owed)
        bill.paid_amount = eco.money((bill.paid_amount or 0) + owed)
        bill.paid_at = datetime.utcnow()
        bill.status = 'paid'
        m.db.session.add(m.Transaction(
            student_id=bill.student_id, bank_account_id=account.id,
            transaction_type='savings_deposit' if is_savings else 'bill', amount=-owed,
            student_bill_id=bill.id, balance_after=account.balance,
            description=f'{(bill.payee_name or bill.description).upper()} PAYMENT (STAFF)',
        ))
        m.db.session.commit()
        return jsonify({'ok': True, 'economy': economy_payload(student)})

    @app.route('/api/economy/student/<int:student_id>/enrollment', methods=['PUT'])
    @login_required
    @m.staff_required
    def set_student_enrollment(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        budget = get_or_create_budget(student_id)
        enrolled = bool((request.get_json(silent=True) or {}).get('enrolled'))
        if enrolled and not budget.enrolled:
            budget.enrolled_at = datetime.utcnow()
            student.pay_track = 'complex'
        if not enrolled:
            student.pay_track = 'simple'
        budget.enrolled = enrolled
        m.db.session.commit()
        return jsonify(economy_payload(student))

    @app.route('/api/economy/student/<int:student_id>/pay-track', methods=['PUT'])
    @login_required
    @m.staff_required
    def set_student_pay_track(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        data = request.get_json(silent=True) or {}
        track = (data.get('pay_track') or '').strip().lower()
        if track not in ('simple', 'complex'):
            return jsonify({'error': 'pay_track must be simple or complex'}), 400
        m._apply_student_pay_track(student, track)
        m.db.session.commit()
        budget = get_or_create_budget(student_id)
        return jsonify({'pay_track': student.pay_track, 'enrolled': bool(budget.enrolled)})

    @app.route('/api/economy/student/<int:student_id>/pto', methods=['POST'])
    @login_required
    @m.staff_required
    def grant_or_apply_pto(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        data = request.get_json(silent=True) or {}
        pto = get_or_create_pto(student_id)
        action = (data.get('action') or 'grant').strip().lower()
        if action == 'grant':
            days = eco.money(data.get('days') or 1)
            if days <= 0:
                return jsonify({'error': 'Grant at least 1 day.'}), 400
            pto.days_remaining = eco.money((pto.days_remaining or 0) + days)
            m.db.session.commit()
            return jsonify(economy_payload(student))
        use_date_raw = data.get('date')
        try:
            use_date = datetime.strptime(use_date_raw, '%Y-%m-%d').date() if use_date_raw else now_local().date()
        except ValueError:
            return jsonify({'error': 'Invalid date'}), 400
        if (pto.days_remaining or 0) < Decimal('1'):
            return jsonify({'error': 'No PTO days left. Grant a day first.'}), 400
        if m.StudentPtoUse.query.filter_by(student_id=student_id, use_date=use_date).first():
            return jsonify({'error': 'PTO is already used on that day.'}), 400
        pto.days_remaining = eco.money(pto.days_remaining - Decimal('1'))
        m.db.session.add(m.StudentPtoUse(
            student_id=student_id, use_date=use_date, days=Decimal('1'), granted_by_user_id=current_user.id,
        ))
        m.db.session.commit()
        return jsonify(economy_payload(student))

    # ------------------------------------------------------------------
    # Admin settings
    # ------------------------------------------------------------------

    def settings_payload():
        row = settings_row()
        products = []
        for p in active_products():
            opts = eco.load_json(p.options_json, {})
            products.append({
                'id': p.id, 'slug': p.slug, 'name': p.name, 'is_base': bool(p.is_base),
                'payee': opts.get('payee'), 'note': opts.get('note'),
                'options': bl.product_options(opts), 'params': opts.get('params') or {},
            })
        return {
            'default_pay_track': row.default_pay_track,
            'bills': bills_settings(),
            'products': products,
            'no_show_classes': [{
                'id': c.id, 'name': c.name, 'match_text': c.match_text,
                'skip_to_location': c.skip_to_location, 'is_active': bool(c.is_active), 'sort_order': c.sort_order,
            } for c in m.MissFeeClass.query.order_by(m.MissFeeClass.sort_order, m.MissFeeClass.id).all()],
        }

    @app.route('/api/economy/settings', methods=['GET'])
    @login_required
    def get_economy_settings():
        return jsonify(settings_payload())

    @app.route('/api/economy/settings', methods=['PUT'])
    @login_required
    @m.admin_required
    def update_economy_settings():
        data = request.get_json(silent=True) or {}
        row = settings_row()
        if data.get('default_pay_track') in ('simple', 'complex'):
            row.default_pay_track = data['default_pay_track']
        if isinstance(data.get('bills'), dict):
            row.bills_config_json = eco.dump_json(bl.merged_settings(data['bills']))
        for spec in data.get('products') or []:
            product = m.BillProduct.query.get(spec.get('id')) if spec.get('id') else None
            if not product:
                continue
            opts = eco.load_json(product.options_json, {})
            incoming = {str(o.get('id')): o for o in (spec.get('options') or [])}
            for option in opts.get('options') or []:
                edit = incoming.get(str(option.get('id')))
                if not edit:
                    continue
                for key in ('label', 'detail', 'payee'):
                    if key in edit and str(edit[key]).strip():
                        option[key] = str(edit[key]).strip()
                for key in ('weekly', 'loan_weekly', 'upkeep_weekly'):
                    if key in edit and eco.parse_money(edit[key]) is not None:
                        option[key] = str(eco.parse_money(edit[key]))
            if isinstance(spec.get('params'), dict) and opts.get('params') is not None:
                for key, value in spec['params'].items():
                    if key in opts['params'] and not isinstance(opts['params'][key], (dict, list)):
                        opts['params'][key] = str(value)
            if 'payee' in spec and str(spec['payee'] or '').strip():
                opts['payee'] = str(spec['payee']).strip()
            product.options_json = eco.dump_json(opts)
        m.db.session.commit()
        return jsonify(settings_payload())

    @app.route('/api/economy/miss-fee-classes', methods=['POST'])
    @login_required
    @m.staff_required
    def create_no_show_class():
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        match_text = (data.get('match_text') or name or '').strip()
        if not name or not match_text:
            return jsonify({'error': 'Name and schedule match text are required.'}), 400
        row = m.MissFeeClass(
            name=name,
            match_text=match_text,
            amount=Decimal('0.00'),
            skip_to_location=(data.get('skip_to_location') or 'Studio').strip() or 'Studio',
            is_active=True,
            sort_order=int(data.get('sort_order') or 0),
        )
        m.db.session.add(row)
        m.db.session.commit()
        return jsonify({'id': row.id, 'name': row.name}), 201

    @app.route('/api/economy/miss-fee-classes/<int:class_id>', methods=['PUT', 'DELETE'])
    @login_required
    @m.staff_required
    def update_no_show_class(class_id):
        row = m.MissFeeClass.query.get_or_404(class_id)
        if request.method == 'DELETE':
            row.is_active = False
            m.db.session.commit()
            return jsonify({'ok': True})
        data = request.get_json(silent=True) or {}
        for field in ('name', 'match_text', 'skip_to_location'):
            if field in data and str(data[field]).strip():
                setattr(row, field, str(data[field]).strip())
        if 'is_active' in data:
            row.is_active = bool(data['is_active'])
        m.db.session.commit()
        return jsonify({'ok': True})

    @app.route('/api/economy/generate', methods=['POST'])
    @login_required
    @m.staff_required
    def generate_economy_now():
        return jsonify(run_economy_maintenance())

    app.run_economy_maintenance = run_economy_maintenance
    return app
