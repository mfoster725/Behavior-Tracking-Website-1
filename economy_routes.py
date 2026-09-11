"""Manny's Market economy API routes (bills, PTO, miss-fee classes, settings)."""

from datetime import date, datetime, timedelta
from decimal import Decimal

from flask import jsonify, request
from flask_login import current_user, login_required

import economy_lib as eco


def register_economy_routes(app):
    import app as m

    def settings_row():
        return m._economy_settings_row()

    def tax_table():
        row = settings_row()
        table = eco.load_json(row.tax_table_json, eco.DEFAULT_TAX_TABLE)
        if not table:
            table = eco.DEFAULT_TAX_TABLE
        return table

    def late_fee_rate():
        row = settings_row()
        return eco.money(row.late_fee_per_day or eco.DEFAULT_LATE_FEE_PER_DAY)

    def hourly_for_student(student):
        color = eco.card_color_key(student)
        row = m.WageRate.query.filter_by(card_color=color).first()
        if not row:
            row = m.WageRate.query.filter_by(card_color='yellow').first()
        if not row:
            return eco.money('20.00')
        return eco.money(row.hourly_rate)

    def school_default_track():
        row = settings_row()
        return (row.default_pay_track or eco.DEFAULT_PAY_TRACK).strip().lower()

    def track_for(student):
        return eco.student_pay_track(student, school_default_track())

    def require_student_access(student_id):
        if not m.has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied'}), 403
        return None

    def get_or_create_budget(student_id):
        row = m.StudentBudget.query.filter_by(student_id=student_id).first()
        if not row:
            row = m.StudentBudget(
                student_id=student_id,
                enrolled=False,
                choices_json=eco.dump_json(eco.DEFAULT_BUDGET_CHOICES),
            )
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

    def parse_choices(raw):
        choices = dict(eco.DEFAULT_BUDGET_CHOICES)
        incoming = eco.load_json(raw, {})
        if isinstance(incoming, dict):
            choices.update(incoming)
        assistance = choices.get('assistance') or []
        if isinstance(assistance, str):
            assistance = [assistance]
        choices['assistance'] = [str(x).lower() for x in assistance]
        choices['roommate'] = bool(choices.get('roommate'))
        return choices

    def serialize_product(product):
        return {
            'id': product.id,
            'slug': product.slug,
            'name': product.name,
            'category': product.category,
            'is_base': bool(product.is_base),
            'formula_kind': product.formula_kind,
            'amount': float(eco.money(product.amount)),
            'options': eco.load_json(product.options_json, {}),
            'prompt': product.prompt,
            'sort_order': product.sort_order,
            'is_active': bool(product.is_active),
        }

    def refresh_bill_late_fee(bill, today=None):
        if bill.status != 'unpaid':
            return eco.money(bill.base_amount), eco.money(bill.late_fee_amount or 0)
        due_total, extra = eco.amount_with_late_fee(
            bill.base_amount, bill.due_date, late_fee_rate(), today=today, status=bill.status
        )
        bill.late_fee_amount = extra
        return due_total, extra

    def serialize_bill(bill, today=None):
        due_total, extra = refresh_bill_late_fee(bill, today=today)
        return {
            'id': bill.id,
            'kind': bill.kind,
            'period_key': bill.period_key,
            'due_date': bill.due_date.isoformat() if bill.due_date else None,
            'fee_date': bill.fee_date.isoformat() if bill.fee_date else None,
            'description': bill.description,
            'prompt': bill.prompt,
            'steps': eco.load_json(bill.steps_json, []),
            'base_amount': float(eco.money(bill.base_amount)),
            'late_fee_amount': float(extra),
            'amount_due': float(due_total),
            'status': bill.status,
            'paid_at': m.utc_isoformat(bill.paid_at) if bill.paid_at else None,
            'paid_amount': float(bill.paid_amount) if bill.paid_amount is not None else None,
            'slug': bill.product.slug if bill.product else None,
            'is_base': bool(bill.product.is_base) if bill.product else False,
            'miss_fee_class_id': bill.miss_fee_class_id,
        }

    def selected_products(choices, card_color):
        products = m.BillProduct.query.filter_by(is_active=True).order_by(m.BillProduct.sort_order, m.BillProduct.id).all()
        selected = []
        expense_total = Decimal('0.00')
        emergency = None
        for product in products:
            if not eco.product_is_selected(product, choices):
                continue
            if product.formula_kind == 'emergency_fund':
                emergency = product
                continue
            amount = eco.compute_product_amount(product, choices, card_color)
            selected.append((product, amount))
            if amount > 0:
                expense_total += amount
        if emergency and eco.product_is_selected(emergency, choices):
            amount = eco.compute_product_amount(emergency, choices, card_color, other_expense_total=expense_total)
            selected.append((emergency, amount))
        return selected, expense_total

    def generate_monthly_bills(student, when=None):
        when = when or date.today()
        budget = get_or_create_budget(student.id)
        if not budget.enrolled:
            return 0
        choices = parse_choices(budget.choices_json)
        card_color = eco.card_color_key(student)
        period_key = eco.period_key_for_date(when)
        due = eco.due_date_for_period_key(period_key)
        selected, expense_total = selected_products(choices, card_color)
        created = 0
        for product, amount in selected:
            existing = m.StudentBill.query.filter_by(
                student_id=student.id,
                bill_product_id=product.id,
                period_key=period_key,
                kind='bill',
            ).first()
            if existing:
                if existing.status == 'unpaid':
                    existing.base_amount = amount
                    existing.description = product.name
                    existing.prompt = product.prompt
                    existing.steps_json = eco.dump_json(
                        eco.worksheet_steps(product, choices, card_color, amount, expense_total)
                    )
                continue
            bill = m.StudentBill(
                student_id=student.id,
                bill_product_id=product.id,
                kind='bill',
                period_key=period_key,
                due_date=due,
                description=product.name,
                prompt=product.prompt,
                steps_json=eco.dump_json(
                    eco.worksheet_steps(product, choices, card_color, amount, expense_total)
                ),
                base_amount=amount,
                status='unpaid',
            )
            m.db.session.add(bill)
            created += 1
        return created

    def _period_info(period):
        return eco.load_json(getattr(period, 'info', None), {})

    def scan_miss_fees_for_student(student, start_date, end_date):
        budget = get_or_create_budget(student.id)
        if not budget.enrolled:
            return 0
        classes = m.MissFeeClass.query.filter_by(is_active=True).order_by(m.MissFeeClass.sort_order, m.MissFeeClass.id).all()
        if not classes:
            return 0
        created = 0
        day = start_date
        while day <= end_date:
            pto = m.StudentPtoUse.query.filter_by(student_id=student.id, use_date=day).first()
            daily = m.DailyRecord.query.filter_by(student_id=student.id, date=day).first()
            attendance = 'present'
            if daily:
                attendance = m._record_attendance_status_norm(daily)
            if attendance == 'excused' or pto:
                day += timedelta(days=1)
                continue
            schedule_rows = m._student_schedule_rows(student.id)
            periods_by_time = {}
            if daily:
                for period in daily.periods:
                    periods_by_time[(period.time_range or '').strip()] = period
            matched_class_ids = set()
            for time_range, _default in m.POINT_CARD_PERIODS:
                scheduled = m._student_location_for_period(
                    student.id, time_range, schedule_rows=schedule_rows, on_date=day
                )
                period = periods_by_time.get(time_range)
                alt = ''
                if period:
                    info = _period_info(period)
                    alt = str(info.get('alternate_location') or '').strip()
                for fee_class in classes:
                    if fee_class.id in matched_class_ids:
                        continue
                    if not eco.location_contains(scheduled, fee_class.match_text):
                        continue
                    hit = False
                    if attendance == 'unexcused':
                        hit = True
                    elif attendance == 'present' and eco.location_contains(alt, fee_class.skip_to_location or 'Studio'):
                        hit = True
                    if not hit:
                        continue
                    matched_class_ids.add(fee_class.id)
                    period_key = day.isoformat()
                    existing = m.StudentBill.query.filter_by(
                        student_id=student.id,
                        miss_fee_class_id=fee_class.id,
                        period_key=period_key,
                        kind='fee',
                    ).first()
                    if existing:
                        continue
                    amount = eco.money(fee_class.amount)
                    bill = m.StudentBill(
                        student_id=student.id,
                        miss_fee_class_id=fee_class.id,
                        kind='fee',
                        period_key=period_key,
                        due_date=day,
                        fee_date=day,
                        description=f'Miss fee: {fee_class.name}',
                        prompt=f'Type the {fee_class.name} miss fee amount (${amount}).',
                        steps_json=eco.dump_json([{'text': f'{fee_class.name} miss fee is {amount}.'}]),
                        base_amount=amount,
                        status='unpaid',
                    )
                    m.db.session.add(bill)
                    created += 1
            day += timedelta(days=1)
        return created

    def enrolled_students():
        budgets = m.StudentBudget.query.filter_by(enrolled=True).all()
        ids = [b.student_id for b in budgets]
        if not ids:
            return []
        return m.Student.query.filter(m.Student.id.in_(ids)).all()

    def run_economy_maintenance(when=None):
        when = when or date.today()
        bills_created = 0
        fees_created = 0
        start = when - timedelta(days=14)
        for student in enrolled_students():
            bills_created += generate_monthly_bills(student, when=when)
            fees_created += scan_miss_fees_for_student(student, start, when)
        m.db.session.commit()
        return {'bills_created': bills_created, 'fees_created': fees_created}

    @app.route('/api/economy/settings', methods=['GET'])
    @login_required
    def get_economy_settings():
        row = settings_row()
        payload = {
            'default_pay_track': row.default_pay_track,
            'late_fee_per_day': float(eco.money(row.late_fee_per_day)),
            'tax_table': tax_table(),
            'wage_rates': [{
                'id': w.id,
                'card_color': w.card_color,
                'hourly_rate': float(eco.money(w.hourly_rate)),
                'education_label': w.education_label,
            } for w in m.WageRate.query.order_by(m.WageRate.id).all()],
            'bill_products': [serialize_product(p) for p in m.BillProduct.query.order_by(m.BillProduct.sort_order, m.BillProduct.id).all()],
            'miss_fee_classes': [{
                'id': c.id,
                'name': c.name,
                'match_text': c.match_text,
                'amount': float(eco.money(c.amount)),
                'skip_to_location': c.skip_to_location,
                'is_active': bool(c.is_active),
                'sort_order': c.sort_order,
            } for c in m.MissFeeClass.query.order_by(m.MissFeeClass.sort_order, m.MissFeeClass.id).all()],
        }
        return jsonify(payload)

    @app.route('/api/economy/settings', methods=['PUT'])
    @login_required
    @m.admin_required
    def update_economy_settings():
        data = request.get_json(silent=True) or {}
        row = settings_row()
        if 'default_pay_track' in data and data['default_pay_track'] in ('simple', 'complex'):
            row.default_pay_track = data['default_pay_track']
        if 'late_fee_per_day' in data:
            row.late_fee_per_day = eco.money(data['late_fee_per_day'])
        if 'tax_table' in data and isinstance(data['tax_table'], dict):
            row.tax_table_json = eco.dump_json(data['tax_table'])
        for spec in data.get('wage_rates') or []:
            wage = None
            if spec.get('id'):
                wage = m.WageRate.query.get(spec['id'])
            if not wage and spec.get('card_color'):
                wage = m.WageRate.query.filter_by(card_color=spec['card_color']).first()
            if not wage:
                continue
            if 'hourly_rate' in spec:
                wage.hourly_rate = eco.money(spec['hourly_rate'])
            if 'education_label' in spec:
                wage.education_label = spec['education_label']
        for spec in data.get('bill_products') or []:
            product = m.BillProduct.query.get(spec.get('id')) if spec.get('id') else None
            if not product and spec.get('slug'):
                product = m.BillProduct.query.filter_by(slug=spec['slug']).first()
            if not product:
                continue
            if 'name' in spec:
                product.name = spec['name']
            if 'amount' in spec:
                product.amount = eco.money(spec['amount'])
            if 'options' in spec:
                product.options_json = eco.dump_json(spec['options'])
            if 'is_active' in spec:
                product.is_active = bool(spec['is_active'])
            if 'prompt' in spec:
                product.prompt = spec['prompt']
        m.db.session.commit()
        return get_economy_settings()

    @app.route('/api/economy/miss-fee-classes', methods=['POST'])
    @login_required
    @m.staff_required
    def create_miss_fee_class():
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()
        match_text = (data.get('match_text') or name or '').strip()
        if not name or not match_text:
            return jsonify({'error': 'Name and match text are required'}), 400
        row = m.MissFeeClass(
            name=name,
            match_text=match_text,
            amount=eco.money(data.get('amount') or 50),
            skip_to_location=(data.get('skip_to_location') or 'Studio').strip() or 'Studio',
            is_active=bool(data.get('is_active', True)),
            sort_order=int(data.get('sort_order') or 0),
        )
        m.db.session.add(row)
        m.db.session.commit()
        return jsonify({'id': row.id, 'name': row.name}), 201

    @app.route('/api/economy/miss-fee-classes/<int:class_id>', methods=['PUT', 'DELETE'])
    @login_required
    @m.staff_required
    def update_miss_fee_class(class_id):
        row = m.MissFeeClass.query.get_or_404(class_id)
        if request.method == 'DELETE':
            row.is_active = False
            m.db.session.commit()
            return jsonify({'ok': True})
        data = request.get_json(silent=True) or {}
        for field in ('name', 'match_text', 'skip_to_location'):
            if field in data and str(data[field]).strip():
                setattr(row, field, str(data[field]).strip())
        if 'amount' in data:
            row.amount = eco.money(data['amount'])
        if 'is_active' in data:
            row.is_active = bool(data['is_active'])
        if 'sort_order' in data:
            row.sort_order = int(data['sort_order'] or 0)
        m.db.session.commit()
        return jsonify({'ok': True})

    @app.route('/api/economy/student/<int:student_id>', methods=['GET'])
    @login_required
    def get_student_economy(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        budget = get_or_create_budget(student_id)
        pto = get_or_create_pto(student_id)
        generate_monthly_bills(student)
        scan_miss_fees_for_student(student, date.today() - timedelta(days=14), date.today())
        m.db.session.commit()
        bills = m.StudentBill.query.filter_by(student_id=student_id).order_by(
            m.StudentBill.due_date.desc(), m.StudentBill.id.desc()
        ).limit(200).all()
        account = m.get_or_create_bank_account(student_id)
        today = date.today()
        serialized = [serialize_bill(b, today=today) for b in bills]
        unpaid = sum(item['amount_due'] for item in serialized if item['status'] == 'unpaid')
        return jsonify({
            'student_id': student.id,
            'student_name': student.name,
            'card_color': student.card_color,
            'pay_track': track_for(student),
            'enrolled': bool(budget.enrolled),
            'choices': parse_choices(budget.choices_json),
            'products': [serialize_product(p) for p in m.BillProduct.query.filter_by(is_active=True).order_by(m.BillProduct.sort_order).all()],
            'balance': float(account.balance),
            'pto_days': float(pto.days_remaining or 0),
            'bills': serialized,
            'unpaid_total': float(eco.money(unpaid)),
            'late_fee_per_day': float(late_fee_rate()),
            'can_edit_budget': current_user.role in ('staff', 'admin') or current_user.student_id == student_id,
        })

    @app.route('/api/economy/student/<int:student_id>/budget', methods=['PUT'])
    @login_required
    def save_student_budget(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        student = m.Student.query.get_or_404(student_id)
        data = request.get_json(silent=True) or {}
        budget = get_or_create_budget(student_id)
        is_staff = current_user.role in ('staff', 'admin')
        if not is_staff and current_user.student_id != student_id:
            return jsonify({'error': 'Access denied'}), 403
        if is_staff and 'enrolled' in data:
            budget.enrolled = bool(data['enrolled'])
        elif not budget.enrolled and track_for(student) == 'complex':
            budget.enrolled = True
        elif not is_staff and not budget.enrolled:
            return jsonify({'error': 'Staff must enroll this student in bills first'}), 400
        if 'choices' in data:
            if not is_staff:
                period_key = eco.period_key_for_date(date.today())
                locked = m.StudentBill.query.filter_by(
                    student_id=student_id, period_key=period_key, kind='bill'
                ).filter(m.StudentBill.status == 'paid').first()
                if locked:
                    return jsonify({'error': 'This month already has paid bills. Ask staff to change options.'}), 400
            budget.choices_json = eco.dump_json(parse_choices(data['choices']))
        budget.updated_by_user_id = current_user.id
        generate_monthly_bills(student)
        m.db.session.commit()
        return get_student_economy(student_id)

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
        student.pay_track = track
        budget = get_or_create_budget(student_id)
        if track == 'complex' and 'enrolled' not in data:
            budget.enrolled = True
        if 'enrolled' in data:
            budget.enrolled = bool(data['enrolled'])
        m.db.session.commit()
        return jsonify({'pay_track': student.pay_track, 'enrolled': bool(budget.enrolled)})

    @app.route('/api/economy/bills/<int:bill_id>/pay', methods=['POST'])
    @login_required
    def pay_student_bill(bill_id):
        bill = m.StudentBill.query.get_or_404(bill_id)
        denied = require_student_access(bill.student_id)
        if denied:
            return denied
        if bill.status == 'paid':
            return jsonify({'error': 'This bill is already paid'}), 400
        if bill.status == 'waived':
            return jsonify({'error': 'This bill was waived'}), 400
        data = request.get_json(silent=True) or {}
        typed = eco.parse_money(data.get('amount'))
        if typed is None:
            return jsonify({'error': 'Type the amount due'}), 400
        due_total, extra = refresh_bill_late_fee(bill)
        if abs(typed - due_total) > Decimal('0.01'):
            return jsonify({
                'error': 'That amount is not correct. Check the math and try again.',
                'amount_due': float(due_total),
            }), 400
        account = m.get_or_create_bank_account(bill.student_id)
        if account.balance < due_total:
            return jsonify({'error': 'Not enough money in the bank account.', 'balance': float(account.balance)}), 400
        account.balance -= due_total
        account.updated_at = datetime.utcnow()
        bill.status = 'paid'
        bill.paid_at = datetime.utcnow()
        bill.paid_amount = due_total
        bill.late_fee_amount = extra
        tx_type = 'fee' if bill.kind == 'fee' else 'bill'
        m.db.session.add(m.Transaction(
            student_id=bill.student_id,
            bank_account_id=account.id,
            transaction_type=tx_type,
            amount=-due_total,
            student_bill_id=bill.id,
            balance_after=account.balance,
            description=bill.description or 'Bill payment',
        ))
        m.db.session.commit()
        return jsonify({
            'ok': True,
            'balance': float(account.balance),
            'bill': serialize_bill(bill),
        })

    @app.route('/api/economy/bills/<int:bill_id>/staff-pay', methods=['POST'])
    @login_required
    @m.staff_required
    def staff_pay_or_waive_bill(bill_id):
        bill = m.StudentBill.query.get_or_404(bill_id)
        denied = require_student_access(bill.student_id)
        if denied:
            return denied
        data = request.get_json(silent=True) or {}
        action = (data.get('action') or 'pay').strip().lower()
        if action == 'waive':
            bill.status = 'waived'
            bill.waived_reason = (data.get('reason') or 'Staff waived').strip()
            bill.paid_at = datetime.utcnow()
            m.db.session.commit()
            return jsonify({'ok': True, 'bill': serialize_bill(bill)})
        due_total, extra = refresh_bill_late_fee(bill)
        account = m.get_or_create_bank_account(bill.student_id)
        if account.balance < due_total:
            return jsonify({'error': 'Not enough money in the bank account.', 'balance': float(account.balance)}), 400
        account.balance -= due_total
        account.updated_at = datetime.utcnow()
        bill.status = 'paid'
        bill.paid_at = datetime.utcnow()
        bill.paid_amount = due_total
        bill.late_fee_amount = extra
        m.db.session.add(m.Transaction(
            student_id=bill.student_id,
            bank_account_id=account.id,
            transaction_type='fee' if bill.kind == 'fee' else 'bill',
            amount=-due_total,
            student_bill_id=bill.id,
            balance_after=account.balance,
            description=bill.description or 'Bill payment',
        ))
        m.db.session.commit()
        return jsonify({'ok': True, 'bill': serialize_bill(bill), 'balance': float(account.balance)})

    @app.route('/api/economy/student/<int:student_id>/pto', methods=['POST'])
    @login_required
    @m.staff_required
    def grant_or_apply_pto(student_id):
        denied = require_student_access(student_id)
        if denied:
            return denied
        data = request.get_json(silent=True) or {}
        pto = get_or_create_pto(student_id)
        action = (data.get('action') or 'grant').strip().lower()
        if action == 'grant':
            days = eco.money(data.get('days') or 1)
            pto.days_remaining = eco.money((pto.days_remaining or 0) + days)
            m.db.session.commit()
            return jsonify({'pto_days': float(pto.days_remaining)})
        use_date_raw = data.get('date')
        try:
            use_date = datetime.strptime(use_date_raw, '%Y-%m-%d').date() if use_date_raw else date.today()
        except ValueError:
            return jsonify({'error': 'Invalid date'}), 400
        if (pto.days_remaining or 0) < Decimal('1'):
            return jsonify({'error': 'No PTO days remaining'}), 400
        existing = m.StudentPtoUse.query.filter_by(student_id=student_id, use_date=use_date).first()
        if existing:
            return jsonify({'error': 'PTO already applied for that day'}), 400
        pto.days_remaining = eco.money(pto.days_remaining - Decimal('1'))
        m.db.session.add(m.StudentPtoUse(
            student_id=student_id,
            use_date=use_date,
            days=Decimal('1'),
            granted_by_user_id=current_user.id,
        ))
        bills = m.StudentBill.query.filter_by(
            student_id=student_id, kind='fee', fee_date=use_date, status='unpaid'
        ).all()
        for bill in bills:
            bill.status = 'waived'
            bill.waived_reason = 'PTO'
            bill.paid_at = datetime.utcnow()
        m.db.session.commit()
        return jsonify({
            'pto_days': float(pto.days_remaining),
            'waived': len(bills),
            'date': use_date.isoformat(),
        })

    @app.route('/api/economy/generate', methods=['POST'])
    @login_required
    @m.staff_required
    def generate_economy_now():
        result = run_economy_maintenance()
        return jsonify(result)

    app.run_economy_maintenance = run_economy_maintenance
    app.economy_hourly_for_student = hourly_for_student
    app.economy_tax_table = tax_table
    app.economy_track_for = track_for
    return app
