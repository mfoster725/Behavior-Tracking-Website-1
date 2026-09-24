"""Manny's Market economy: 2026 seeds and paycheck math helpers (weekly bills live in bills_lib)."""

from __future__ import annotations

import json
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

# Weekly earnings record (classroom paystub worksheet)
VALID_POINT_CARD_COLORS = frozenset({'yellow', 'green', 'blue'})
STUB_DAILY_RATES = {
    'yellow': Decimal('74.16'),
    'green': Decimal('129.16'),
    'blue': Decimal('162.76'),
}
STARBUCKS_BONUS_RATE = Decimal('2.00')
STAR_STUDENT_BONUS_RATE = Decimal('50.00')
STAR_CLASSROOM_BONUS_RATE = Decimal('50.00')
STUB_FEDERAL_RATE = Decimal('0.03')
STUB_SS_RATE = Decimal('0.062')
STUB_MEDICARE_RATE = Decimal('0.015')
STUB_STATE_RATE = Decimal('0.0535')  # Minnesota flat classroom rate
MONEY_TOLERANCE = Decimal('0.01')
PERCENT_RATE_TOLERANCE = Decimal('0.0005')


class MissingCardColorError(ValueError):
    """Student must have a yellow, green, or blue point card color."""


def require_point_card_color(card_color, student_label=None):
    """Return normalized yellow/green/blue, or raise MissingCardColorError."""
    key = (card_color or '').strip().lower()
    if key in VALID_POINT_CARD_COLORS:
        return key
    who = f' for {student_label}' if student_label else ''
    if not key or key == 'white':
        raise MissingCardColorError(
            f'Student must have a card color (yellow, green, or blue){who}.'
        )
    raise MissingCardColorError(
        f'Invalid card color "{card_color}"{who}; must be yellow, green, or blue.'
    )


def money(value):
    return Decimal(str(value or 0)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def parse_money(value):
    if value is None:
        return None
    text = str(value).replace('$', '').replace(',', '').strip()
    if text == '':
        return None
    return money(text)


def amounts_close(left, right, tolerance=MONEY_TOLERANCE):
    if left is None or right is None:
        return False
    return abs(money(left) - money(right)) <= tolerance


def parse_percent_rate(value):
    """Parse a student-entered percent as a fraction of 1.

    Accepts 3, 3%, or 0.03 as 3%. A bare 1 is treated as 1% (not 100%),
    matching the worksheet prompt to subtract STAR% from 100.
    """
    if value is None:
        return None
    text = str(value).replace(',', '').strip()
    if text == '':
        return None
    has_pct = '%' in text
    text = text.replace('%', '').replace('$', '').strip()
    if text == '':
        return None
    try:
        parsed = Decimal(text)
    except (ArithmeticError, ValueError):
        return None
    if has_pct or parsed >= 1:
        return parsed / Decimal('100')
    return parsed


def percent_rates_close(entered, expected_percent, tolerance=PERCENT_RATE_TOLERANCE):
    parsed = parse_percent_rate(entered)
    if parsed is None:
        return False
    expected_frac = max(Decimal('0'), Decimal(str(expected_percent or 0))) / Decimal('100')
    return abs(parsed - expected_frac) <= tolerance


def daily_rate_for_color(card_color, student_label=None):
    key = require_point_card_color(card_color, student_label=student_label)
    return money(STUB_DAILY_RATES[key])


def point_card_gap_percent(star_percent):
    pct = Decimal(str(star_percent or 0))
    return max(Decimal('0.00'), (Decimal('100') - pct)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def compute_stub_paycheck(
    daily_rate,
    days_worked,
    star_percent,
    starbucks_count=0,
    star_student_count=0,
    star_classroom_count=0,
    excused_days=0,
    citation_count=0,
):
    """Classroom weekly earnings record: days x rate, bonuses, then % of gross + citations."""
    days = int(days_worked or 0)
    excused = int(excused_days or 0)
    rate = money(daily_rate)
    gap_percent = point_card_gap_percent(star_percent)
    gap_rate = gap_percent / Decimal('100')

    sb_count = int(starbucks_count or 0)
    star_student = int(star_student_count or 0)
    star_classroom = int(star_classroom_count or 0)
    citations = int(citation_count or 0)

    regular_pay = money(Decimal(days) * rate)
    starbucks_pay = money(Decimal(sb_count) * STARBUCKS_BONUS_RATE)
    star_student_pay = money(Decimal(star_student) * STAR_STUDENT_BONUS_RATE)
    star_classroom_pay = money(Decimal(star_classroom) * STAR_CLASSROOM_BONUS_RATE)
    gross = money(regular_pay + starbucks_pay + star_student_pay + star_classroom_pay)

    point_card_deduction = money(gross * gap_rate)
    citation_deduction = money(Decimal(citations) * CITATION_RATE)
    federal_tax = money(gross * STUB_FEDERAL_RATE)
    ss_tax = money(gross * STUB_SS_RATE)
    medicare_tax = money(gross * STUB_MEDICARE_RATE)
    state_tax = money(gross * STUB_STATE_RATE)
    total_deductions = money(
        point_card_deduction
        + citation_deduction
        + federal_tax
        + ss_tax
        + medicare_tax
        + state_tax
    )
    net = money(gross - total_deductions)

    return {
        'daily_rate': rate,
        'days_worked': days,
        'excused_days': excused,
        'starbucks_count': sb_count,
        'star_student_count': star_student,
        'star_classroom_count': star_classroom,
        'starbucks_rate': money(STARBUCKS_BONUS_RATE),
        'star_student_rate': money(STAR_STUDENT_BONUS_RATE),
        'star_classroom_rate': money(STAR_CLASSROOM_BONUS_RATE),
        'citation_rate': money(CITATION_RATE),
        'regular_pay': regular_pay,
        'starbucks_pay': starbucks_pay,
        'star_student_pay': star_student_pay,
        'star_classroom_pay': star_classroom_pay,
        'gross': gross,
        'base_pay': gross,
        'star_percent': Decimal(str(star_percent or 0)),
        'point_card_gap_percent': gap_percent,
        'point_card_gap_rate': gap_rate,
        'point_card_deduction': point_card_deduction,
        'federal_rate': STUB_FEDERAL_RATE,
        'ss_rate': STUB_SS_RATE,
        'medicare_rate': STUB_MEDICARE_RATE,
        'state_rate': STUB_STATE_RATE,
        'federal_tax': federal_tax,
        'ss_tax': ss_tax,
        'medicare_tax': medicare_tax,
        'state_tax': state_tax,
        'total_deductions': total_deductions,
        'final_pay': net,
        'citation_count': citations,
        'citation_deduction': citation_deduction,
        'hourly_rate': rate,
        'hours': Decimal(days),
    }


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

# Prices scaled 4x when weekly student pay moved from ~$100 to ~$400 (same affordability ratio).
MARKETPLACE_ITEM_SEEDS = [
    {'name': 'Gum', 'description': 'Pack of gum.', 'price': '100.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': '3 Musketeers', 'description': 'One 3 Musketeers bar.', 'price': '600.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Gummi Worms', 'description': 'Bag of gummi worms.', 'price': '400.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Swedish Fish', 'description': 'Bag of Swedish Fish.', 'price': '400.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Chips', 'description': 'Bag of chips.', 'price': '400.00', 'type_name': 'Food', 'category_name': 'Snacks'},
    {'name': 'Over Ear Headphones', 'description': 'Over-ear headphones.', 'price': '4000.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'In Ear Headphones', 'description': 'In-ear headphones.', 'price': '0.00', 'type_name': 'Equipment', 'category_name': 'Supplies', 'skip': True},
    {'name': 'Mouse', 'description': 'Computer mouse.', 'price': '2200.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Chess Set', 'description': 'Chess set.', 'price': '5200.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Tungsten Ring', 'description': 'Tungsten ring.', 'price': '6400.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gel Pens', 'description': 'Set of gel pens.', 'price': '4000.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Squishmallow', 'description': 'Squishmallow plush.', 'price': '2400.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Mini Fridge', 'description': 'Personal mini fridge.', 'price': '2000.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Sketch Pad', 'description': 'Sketch pad.', 'price': '5200.00', 'type_name': 'Equipment', 'category_name': 'Supplies'},
    {'name': 'Gift Card $5', 'description': '$5 gift card.', 'price': '2000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $10', 'description': '$10 gift card.', 'price': '4000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $15', 'description': '$15 gift card.', 'price': '6000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $20', 'description': '$20 gift card.', 'price': '8000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Gift Card $25', 'description': '$25 gift card.', 'price': '10000.00', 'type_name': 'Reward', 'category_name': 'Rewards'},
    {'name': 'Free Time Solo 15 min', 'description': '15 minutes of free time, solo.', 'price': '400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 30 min', 'description': '30 minutes of free time, solo.', 'price': '800.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 45 min', 'description': '45 minutes of free time, solo.', 'price': '1200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo 60 min', 'description': '60 minutes of free time, solo.', 'price': '1600.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 15 min', 'description': '15 minutes of free time with one friend.', 'price': '800.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 30 min', 'description': '30 minutes of free time with one friend.', 'price': '1600.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 45 min', 'description': '45 minutes of free time with one friend.', 'price': '2400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Solo +1 60 min', 'description': '60 minutes of free time with one friend.', 'price': '3200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 15 min', 'description': '15 minutes of free time for the whole class.', 'price': '2400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 30 min', 'description': '30 minutes of free time for the whole class.', 'price': '4800.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 45 min', 'description': '45 minutes of free time for the whole class.', 'price': '7200.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': 'Free Time Whole Class 60 min', 'description': '60 minutes of free time for the whole class.', 'price': '9600.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
    {'name': "Teacher's Chair (day rental)", 'description': "Rent the teacher's chair for the day.", 'price': '400.00', 'type_name': 'Privilege', 'category_name': 'Privileges'},
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


def card_color_key(student):
    label = getattr(student, 'name', None) or getattr(student, 'id', None)
    return require_point_card_color(getattr(student, 'card_color', None), student_label=label)


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
