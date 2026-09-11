"""Manny's Market economy: 2026 seeds and paycheck/bill math helpers."""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

TWOPLACES = Decimal('0.01')
SIMPLE_BASE = Decimal('100')
CITATION_RATE = Decimal('2')
SCHOOL_DAY_HOURS = Decimal('6')
SCHOOL_DAYS_PER_WEEK = Decimal('5')
SS_RATE = Decimal('0.062')
MEDICARE_RATE = Decimal('0.0145')
STANDARD_DEDUCTION_2026 = Decimal('16100')
DEFAULT_LATE_FEE_PER_DAY = Decimal('20')
DEFAULT_PAY_TRACK = 'simple'


def money(value):
    return Decimal(str(value or 0)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def parse_money(value):
    if value is None:
        return None
    text = str(value).replace('$', '').replace(',', '').strip()
    if text == '':
        return None
    return money(text)


DEFAULT_TAX_TABLE = {
    'standard_deduction': str(STANDARD_DEDUCTION_2026),
    'ss_rate': str(SS_RATE),
    'medicare_rate': str(MEDICARE_RATE),
    'bands': [
        {'up_to': '12400', 'rate': '0.10'},
        {'up_to': '50400', 'rate': '0.12'},
        {'up_to': None, 'rate': '0.22'},
    ],
}

WAGE_RATE_SEEDS = [
    {'card_color': 'yellow', 'hourly_rate': '20.00', 'education_label': 'No diploma'},
    {'card_color': 'green', 'hourly_rate': '25.00', 'education_label': 'High school diploma'},
    {'card_color': 'blue', 'hourly_rate': '28.00', 'education_label': 'Associate degree'},
    {'card_color': 'white', 'hourly_rate': '41.00', 'education_label': "Bachelor's degree"},
]

MISS_FEE_CLASS_SEEDS = [
    {
        'name': 'Cafe',
        'match_text': 'cafe',
        'amount': '50.00',
        'skip_to_location': 'Studio',
        'is_active': True,
        'sort_order': 1,
    },
]

BILL_PRODUCT_SEEDS = [
    {
        'slug': 'housing',
        'name': 'Housing',
        'category': 'housing',
        'is_base': True,
        'formula_kind': 'housing',
        'sort_order': 10,
        'amount': '0.00',
        'options_json': {
            'kinds': {
                'apt_1br': {
                    'label': 'Apartment 1 bedroom',
                    'staff': '1200.00',
                    'two_choice': '1450.00',
                    'open': '1700.00',
                },
                'apt_2br': {
                    'label': 'Apartment 2 bedroom',
                    'staff': '1500.00',
                    'two_choice': '1800.00',
                    'open': '2200.00',
                },
                'house': {
                    'label': 'House payment',
                    'staff': '1800.00',
                    'two_choice': '1800.00',
                    'open': '1800.00',
                },
                'homeless': {
                    'label': 'Homeless / no housing',
                    'staff': '0.00',
                    'two_choice': '0.00',
                    'open': '0.00',
                },
            }
        },
        'prompt': 'Housing cost depends on the place you picked. If you have a roommate, divide by 2.',
    },
    {
        'slug': 'electricity',
        'name': 'Electricity',
        'category': 'utility',
        'is_base': True,
        'formula_kind': 'flat',
        'sort_order': 20,
        'amount': '155.00',
        'options_json': {},
        'prompt': 'Type the electricity bill amount.',
    },
    {
        'slug': 'trash',
        'name': 'Trash',
        'category': 'utility',
        'is_base': True,
        'formula_kind': 'flat',
        'sort_order': 21,
        'amount': '30.00',
        'options_json': {},
        'prompt': 'Type the trash bill amount.',
    },
    {
        'slug': 'wifi',
        'name': 'Wifi',
        'category': 'utility',
        'is_base': False,
        'formula_kind': 'flat',
        'sort_order': 22,
        'amount': '75.00',
        'options_json': {},
        'prompt': 'Type the wifi bill amount.',
    },
    {
        'slug': 'cell',
        'name': 'Cell phone',
        'category': 'utility',
        'is_base': False,
        'formula_kind': 'flat',
        'sort_order': 23,
        'amount': '80.00',
        'options_json': {},
        'prompt': 'Type the cell phone bill amount.',
    },
    {
        'slug': 'renters_insurance',
        'name': 'Renters insurance',
        'category': 'insurance',
        'is_base': True,
        'formula_kind': 'flat',
        'sort_order': 30,
        'amount': '20.00',
        'options_json': {},
        'prompt': 'Type the renters insurance amount.',
    },
    {
        'slug': 'food',
        'name': 'Food',
        'category': 'food',
        'is_base': True,
        'formula_kind': 'flat',
        'sort_order': 40,
        'amount': '350.00',
        'options_json': {},
        'prompt': 'Type the food budget amount.',
    },
    {
        'slug': 'student_loan',
        'name': 'Student loan',
        'category': 'loan',
        'is_base': True,
        'formula_kind': 'student_loan',
        'sort_order': 50,
        'amount': '0.00',
        'options_json': {'yellow': '0.00', 'green': '0.00', 'blue': '250.00', 'white': '550.00'},
        'prompt': 'Student loan is based on your card color. Type that monthly payment.',
    },
    {
        'slug': 'emergency_fund',
        'name': 'Emergency fund',
        'category': 'savings',
        'is_base': True,
        'formula_kind': 'emergency_fund',
        'sort_order': 60,
        'amount': '0.00',
        'options_json': {'months': 3, 'pay_over_months': 9},
        'prompt': 'Emergency fund is 3 months of your other expenses, paid over 9 months. Divide that total by 9.',
    },
    {
        'slug': 'vehicle',
        'name': 'Vehicle',
        'category': 'vehicle',
        'is_base': False,
        'formula_kind': 'vehicle_sum',
        'sort_order': 70,
        'amount': '0.00',
        'options_json': {
            'none': {'label': 'No vehicle', 'gas': '0.00', 'payment': '0.00', 'maintenance': '0.00'},
            'beater': {'label': 'Beater', 'gas': '140.00', 'payment': '0.00', 'maintenance': '140.00'},
            'average': {'label': 'Average', 'gas': '210.00', 'payment': '385.00', 'maintenance': '70.00'},
            'sports': {'label': 'Sports', 'gas': '210.00', 'payment': '560.00', 'maintenance': '70.00'},
        },
        'prompt': 'Add gas + car payment + maintenance for the vehicle you chose.',
    },
    {
        'slug': 'car_insurance',
        'name': 'Car insurance',
        'category': 'insurance',
        'is_base': False,
        'formula_kind': 'car_insurance',
        'sort_order': 71,
        'amount': '0.00',
        'options_json': {
            'none': {'beater': '0.00', 'average': '0.00', 'sports': '0.00'},
            'liability': {'beater': '60.00', 'average': '85.00', 'sports': '280.00'},
            'full': {'beater': '140.00', 'average': '280.00', 'sports': '425.00'},
        },
        'prompt': 'Type the car insurance premium for your coverage and vehicle.',
    },
    {
        'slug': 'health_insurance',
        'name': 'Health insurance',
        'category': 'insurance',
        'is_base': False,
        'formula_kind': 'health_discount',
        'sort_order': 80,
        'amount': '0.00',
        'options_json': {
            'none': {'label': 'No insurance', 'premium': '0.00', 'discount': '0.10'},
            '0': {'label': '$0 deductible', 'premium': '1400.00', 'discount': '1.00'},
            '1200': {'label': '$1,200 deductible', 'premium': '910.00', 'discount': '0.70'},
            '6000': {'label': '$6,000 deductible', 'premium': '560.00', 'discount': '0.40'},
        },
        'prompt': 'Premium times employment discount. Example: $910 × 0.70.',
    },
    {
        'slug': 'credit_card',
        'name': 'Credit card',
        'category': 'credit',
        'is_base': False,
        'formula_kind': 'credit_card',
        'sort_order': 90,
        'amount': '0.00',
        'options_json': {
            'none': {'label': 'No card', 'statement': '0.00', 'minimum': '0.00', 'interest': '0.00'},
            'pay_full': {'label': 'Pay in full', 'statement': '75.00', 'minimum': '75.00', 'interest': '0.00'},
            'carry': {'label': 'Carry a balance', 'statement': '250.00', 'minimum': '35.00', 'interest': '0.02'},
        },
        'prompt': 'Pay in full: type the statement. Carry a balance: type the minimum plus 2% interest on the leftover.',
    },
    {
        'slug': 'assistance_medicaid',
        'name': 'Medicaid (credit)',
        'category': 'assistance',
        'is_base': False,
        'formula_kind': 'credit',
        'sort_order': 100,
        'amount': '-980.00',
        'options_json': {},
        'prompt': 'This is a credit (negative). Type the Medicaid amount, including the minus sign or as a credit.',
    },
    {
        'slug': 'assistance_snap',
        'name': 'SNAP (credit)',
        'category': 'assistance',
        'is_base': False,
        'formula_kind': 'credit',
        'sort_order': 101,
        'amount': '-210.00',
        'options_json': {},
        'prompt': 'This is a credit (negative). Type the SNAP amount.',
    },
    {
        'slug': 'assistance_section8',
        'name': 'Section 8 (credit)',
        'category': 'assistance',
        'is_base': False,
        'formula_kind': 'credit',
        'sort_order': 102,
        'amount': '0.00',
        'options_json': {
            'yellow': '-330.00',
            'green': '-385.00',
            'blue': '-415.00',
            'white': '-315.00',
        },
        'prompt': 'Section 8 credit depends on card color. Type that credit amount.',
    },
]

DEFAULT_BUDGET_CHOICES = {
    'housing_kind': 'apt_1br',
    'housing_option': 'staff',
    'roommate': False,
    'wifi': True,
    'cell': True,
    'student_loan': True,
    'emergency_fund': True,
    'vehicle': 'none',
    'car_insurance': 'none',
    'health': 'none',
    'credit_card': 'none',
    'assistance': [],
}

MARKETPLACE_TYPE_SEEDS = [
    ('Food', 1),
    ('Activity', 2),
    ('Privilege', 3),
    ('Equipment', 4),
    ('Reward', 5),
]

MARKETPLACE_CATEGORY_SEEDS = [
    ('Snacks', 1),
    ('Experiences', 2),
    ('Privileges', 3),
    ('Supplies', 4),
    ('Rewards', 5),
]

MARKETPLACE_ITEM_SEEDS = [
    {'name': 'Gum', 'description': 'Pack of gum.', 'price': '25.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': '3 Musketeers', 'description': 'One 3 Musketeers bar.', 'price': '150.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Gummi Worms', 'description': 'Bag of gummi worms.', 'price': '100.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Swedish Fish', 'description': 'Bag of Swedish Fish.', 'price': '100.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Chips', 'description': 'Bag of chips.', 'price': '100.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Over Ear Headphones', 'description': 'Over-ear headphones.', 'price': '1000.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'In Ear Headphones', 'description': 'In-ear headphones.', 'price': '0.00', 'type_name': 'Equipment', 'category_name': 'Supplies', 'skip': True},
    {'name': 'Mouse', 'description': 'Computer mouse.', 'price': '550.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Chess Set', 'description': 'Chess set.', 'price': '1300.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Tungsten Ring', 'description': 'Tungsten ring.', 'price': '1600.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gel Pens', 'description': 'Set of gel pens.', 'price': '1000.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Squishmallow', 'description': 'Squishmallow plush.', 'price': '600.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Mini Fridge', 'description': 'Personal mini fridge.', 'price': '500.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Sketch Pad', 'description': 'Sketch pad.', 'price': '1300.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Gift Card $5', 'description': '$5 gift card.', 'price': '500.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $10', 'description': '$10 gift card.', 'price': '1000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $15', 'description': '$15 gift card.', 'price': '1500.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $20', 'description': '$20 gift card.', 'price': '2000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $25', 'description': '$25 gift card.', 'price': '2500.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Free Time Solo 15 min', 'description': '15 minutes of free time, solo.', 'price': '100.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 30 min', 'description': '30 minutes of free time, solo.', 'price': '200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 45 min', 'description': '45 minutes of free time, solo.', 'price': '300.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 60 min', 'description': '60 minutes of free time, solo.', 'price': '400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 15 min', 'description': '15 minutes of free time with one friend.', 'price': '200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 30 min', 'description': '30 minutes of free time with one friend.', 'price': '400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 45 min', 'description': '45 minutes of free time with one friend.', 'price': '600.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 60 min', 'description': '60 minutes of free time with one friend.', 'price': '800.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 15 min', 'description': '15 minutes of free time for the whole class.', 'price': '600.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 30 min', 'description': '30 minutes of free time for the whole class.', 'price': '1200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 45 min', 'description': '45 minutes of free time for the whole class.', 'price': '1800.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 60 min', 'description': '60 minutes of free time for the whole class.', 'price': '2400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': "Teacher's Chair (day rental)", 'description': "Rent the teacher's chair for the day.", 'price': '100.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
]


def dump_json(value):
    return json.dumps(value, separators=(',', ':'))


def load_json(value, default=None):
    if not value:
        return default if default is not None else {}
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default if default is not None else {}


def first_monday_of_month(year, month):
    first = date(year, month, 1)
    return first + timedelta(days=(7 - first.weekday()) % 7)


def period_key_for_date(d):
    monday = first_monday_of_month(d.year, d.month)
    if d < monday:
        if d.month == 1:
            monday = first_monday_of_month(d.year - 1, 12)
        else:
            monday = first_monday_of_month(d.year, d.month - 1)
    return monday.strftime('%Y-%m')


def due_date_for_period_key(key):
    year, month = [int(part) for part in key.split('-')]
    return first_monday_of_month(year, month)


def location_contains(haystack, needle):
    return (needle or '').strip().lower() in (haystack or '').strip().lower()


def card_color_key(student):
    return (getattr(student, 'card_color', None) or 'yellow').strip().lower() or 'yellow'


def student_pay_track(student, school_default=DEFAULT_PAY_TRACK):
    track = (getattr(student, 'pay_track', None) or '').strip().lower()
    if track in ('simple', 'complex'):
        return track
    return (school_default or DEFAULT_PAY_TRACK).strip().lower() or DEFAULT_PAY_TRACK


def weekly_hours():
    return SCHOOL_DAY_HOURS * SCHOOL_DAYS_PER_WEEK


def federal_tax_from_annual(annual_gross, tax_table=None):
    table = tax_table or DEFAULT_TAX_TABLE
    deduction = money(table.get('standard_deduction', STANDARD_DEDUCTION_2026))
    taxable = max(Decimal('0.00'), money(annual_gross) - deduction)
    bands = table.get('bands') or DEFAULT_TAX_TABLE['bands']
    tax = Decimal('0.00')
    previous = Decimal('0.00')
    remaining = taxable
    for band in bands:
        rate = Decimal(str(band.get('rate') or 0))
        up_to = band.get('up_to')
        if up_to is None or str(up_to).lower() in ('', 'none'):
            width = remaining
        else:
            cap = money(up_to)
            width = min(remaining, max(Decimal('0.00'), cap - previous))
            previous = cap
        if width <= 0:
            continue
        tax += width * rate
        remaining -= width
        if remaining <= 0:
            break
    return money(tax)


def compute_complex_paycheck(hourly_rate, star_percent, citation_count, tax_table=None):
    table = tax_table or DEFAULT_TAX_TABLE
    hourly = money(hourly_rate)
    pct = Decimal(str(star_percent or 0))
    gross = money(hourly * weekly_hours() * (pct / Decimal('100')))
    ss = money(gross * Decimal(str(table.get('ss_rate', SS_RATE))))
    medicare = money(gross * Decimal(str(table.get('medicare_rate', MEDICARE_RATE))))
    annual = money(gross * Decimal('52'))
    federal_annual = federal_tax_from_annual(annual, table)
    federal = money(federal_annual / Decimal('52'))
    citations = int(citation_count or 0)
    citation_deduction = money(Decimal(citations) * CITATION_RATE)
    net = money(gross - ss - medicare - federal - citation_deduction)
    return {
        'hourly_rate': hourly,
        'hours': weekly_hours(),
        'gross': gross,
        'ss_tax': ss,
        'medicare_tax': medicare,
        'federal_tax': federal,
        'citation_count': citations,
        'citation_deduction': citation_deduction,
        'final_pay': net,
        'standard_deduction': money(table.get('standard_deduction', STANDARD_DEDUCTION_2026)),
    }


def compute_simple_paycheck(star_percent, citation_count):
    pct = Decimal(str(star_percent or 0))
    base = money((pct / Decimal('100')) * SIMPLE_BASE)
    citations = int(citation_count or 0)
    deduction = money(Decimal(citations) * CITATION_RATE)
    return {
        'base_pay': base,
        'citation_count': citations,
        'citation_deduction': deduction,
        'final_pay': money(base - deduction),
    }


def _opt(product):
    if isinstance(product, dict):
        return load_json(product.get('options_json'), {})
    return load_json(getattr(product, 'options_json', None), {})


def product_field(product, key, default=None):
    if isinstance(product, dict):
        return product.get(key, default)
    return getattr(product, key, default)


def compute_housing_amount(product, choices):
    options = _opt(product)
    kinds = options.get('kinds') or {}
    kind = (choices.get('housing_kind') or 'apt_1br')
    tier = (choices.get('housing_option') or 'staff')
    spec = kinds.get(kind) or {}
    raw = spec.get(tier, spec.get('staff', '0'))
    amount = money(raw)
    if choices.get('roommate'):
        amount = money(amount / Decimal('2'))
    return amount


def compute_vehicle_amount(product, choices):
    options = _opt(product)
    key = (choices.get('vehicle') or 'none')
    spec = options.get(key) or options.get('none') or {}
    return money(
        money(spec.get('gas')) + money(spec.get('payment')) + money(spec.get('maintenance'))
    )


def compute_car_insurance_amount(product, choices):
    options = _opt(product)
    coverage = (choices.get('car_insurance') or 'none')
    vehicle = (choices.get('vehicle') or 'none')
    if vehicle == 'none' or coverage == 'none':
        return money(0)
    row = options.get(coverage) or {}
    return money(row.get(vehicle, 0))


def compute_health_amount(product, choices):
    options = _opt(product)
    key = str(choices.get('health') or 'none')
    spec = options.get(key) or options.get('none') or {}
    premium = money(spec.get('premium'))
    discount = Decimal(str(spec.get('discount') or 0))
    return money(premium * discount)


def compute_credit_card_amount(product, choices):
    options = _opt(product)
    key = (choices.get('credit_card') or 'none')
    spec = options.get(key) or options.get('none') or {}
    if key == 'none':
        return money(0)
    statement = money(spec.get('statement'))
    minimum = money(spec.get('minimum'))
    interest = Decimal(str(spec.get('interest') or 0))
    if key == 'pay_full':
        return statement
    leftover = max(Decimal('0.00'), statement - minimum)
    return money(minimum + leftover * interest)


def compute_student_loan_amount(product, choices, card_color):
    options = _opt(product)
    return money(options.get(card_color, options.get('yellow', 0)))


def compute_section8_amount(product, card_color):
    options = _opt(product)
    return money(options.get(card_color, options.get('yellow', 0)))


def product_is_selected(product, choices):
    slug = product_field(product, 'slug')
    if slug == 'housing':
        return True
    if slug in ('electricity', 'trash', 'renters_insurance', 'food'):
        return True
    if slug == 'wifi':
        return bool(choices.get('wifi', True))
    if slug == 'cell':
        return bool(choices.get('cell', True))
    if slug == 'student_loan':
        return bool(choices.get('student_loan', True))
    if slug == 'emergency_fund':
        return bool(choices.get('emergency_fund', True))
    if slug == 'vehicle':
        return (choices.get('vehicle') or 'none') != 'none'
    if slug == 'car_insurance':
        return (choices.get('car_insurance') or 'none') != 'none' and (choices.get('vehicle') or 'none') != 'none'
    if slug == 'health_insurance':
        return (choices.get('health') or 'none') != 'none'
    if slug == 'credit_card':
        return (choices.get('credit_card') or 'none') != 'none'
    if slug == 'assistance_medicaid':
        return 'medicaid' in (choices.get('assistance') or [])
    if slug == 'assistance_snap':
        return 'snap' in (choices.get('assistance') or [])
    if slug == 'assistance_section8':
        return 'section8' in (choices.get('assistance') or [])
    return False


def compute_product_amount(product, choices, card_color, other_expense_total=None):
    kind = product_field(product, 'formula_kind') or 'flat'
    if kind == 'housing':
        return compute_housing_amount(product, choices)
    if kind == 'vehicle_sum':
        return compute_vehicle_amount(product, choices)
    if kind == 'car_insurance':
        return compute_car_insurance_amount(product, choices)
    if kind == 'health_discount':
        return compute_health_amount(product, choices)
    if kind == 'credit_card':
        return compute_credit_card_amount(product, choices)
    if kind == 'student_loan':
        return compute_student_loan_amount(product, choices, card_color)
    if kind == 'credit' and product_field(product, 'slug') == 'assistance_section8':
        return compute_section8_amount(product, card_color)
    if kind == 'emergency_fund':
        options = _opt(product)
        months = Decimal(str(options.get('months') or 3))
        pay_over = Decimal(str(options.get('pay_over_months') or 9))
        base = money(other_expense_total or 0)
        if pay_over <= 0:
            return money(0)
        return money((base * months) / pay_over)
    return money(product_field(product, 'amount') or 0)


def worksheet_steps(product, choices, card_color, amount, other_expense_total=None):
    slug = product_field(product, 'slug')
    kind = product_field(product, 'formula_kind')
    prompt = product_field(product, 'prompt') or 'Type the amount due.'
    steps = [{'text': prompt}]
    if kind == 'housing' and choices.get('roommate'):
        steps.append({'text': 'Roommate: divide the housing cost by 2.'})
    if kind == 'vehicle_sum':
        options = _opt(product)
        spec = options.get(choices.get('vehicle') or 'none') or {}
        steps.append({
            'text': (
                f"Gas {money(spec.get('gas'))} + payment {money(spec.get('payment'))} "
                f"+ maintenance {money(spec.get('maintenance'))}."
            )
        })
    if kind == 'health_discount':
        options = _opt(product)
        spec = options.get(str(choices.get('health') or 'none')) or {}
        steps.append({
            'text': f"Premium {money(spec.get('premium'))} × discount {spec.get('discount')}."
        })
    if kind == 'credit_card' and (choices.get('credit_card') == 'carry'):
        options = _opt(product)
        spec = options.get('carry') or {}
        steps.append({
            'text': (
                f"Minimum {money(spec.get('minimum'))} + 2% of "
                f"({money(spec.get('statement'))} − {money(spec.get('minimum'))})."
            )
        })
    if kind == 'emergency_fund':
        options = _opt(product)
        steps.append({
            'text': (
                f"Other monthly expenses {money(other_expense_total or 0)} × "
                f"{options.get('months') or 3} months, then divide by "
                f"{options.get('pay_over_months') or 9}."
            )
        })
    if slug == 'student_loan':
        steps.append({'text': f'Card color {card_color} sets this payment.'})
    return steps


def late_days(due_date, today=None):
    today = today or date.today()
    if not due_date or today <= due_date:
        return 0
    return (today - due_date).days


def amount_with_late_fee(base_amount, due_date, per_day, today=None, status='unpaid'):
    base = money(base_amount)
    if status == 'paid':
        return base, money(0)
    days = late_days(due_date, today)
    extra = money(Decimal(days) * money(per_day))
    return money(base + extra), extra
