"""Weekly bills for Manny's Market: catalog, statement math, assistance, and late fees.

Everything is weekly. Statements are issued on Monday and are due the following
Monday at 11:59 PM school time. The catalog holds real 2025-26 Pope County, MN costs
(HUD FY2026 Fair Market Rents, EIA electricity prices, USDA food plans, MNsure
premiums, local internet and phone plans) converted from monthly to weekly with
monthly x 12 / 52. Students pay those prices times the class cost-of-living setting
(85% by default, the same for every card). Payee names are fictional.

Class assistance rule: benefits are figured from take-home pay (after taxes and the
point card deduction), averaged over the last few paychecks and refigured every week.
With both rules, a yellow card at a 90% average living alone in the default plan on
all three programs keeps at least $100 a week after every bill.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from economy_lib import amounts_close, money, parse_money

BILLS_VERSION = 2
WEEKS_PER_YEAR = Decimal('52')
MONTHS_PER_YEAR = Decimal('12')
ZERO = Decimal('0.00')


# Students pay catalog prices x this. Admins can change it; it is the same for every card.
DEFAULT_COST_OF_LIVING = '0.85'
_PRICE_KEYS = frozenset({'weekly', 'loan_weekly', 'upkeep_weekly', 'customer_charge_weekly',
                         'equipment_weekly', 'fuel_price', 'principal', 'car_price'})
_RATE_KEYS = frozenset({'rate_per_kwh'})


def weekly_from_monthly(monthly):
    return money(Decimal(str(monthly)) * MONTHS_PER_YEAR / WEEKS_PER_YEAR)


def monthly_from_weekly(weekly):
    return money(Decimal(str(weekly)) * WEEKS_PER_YEAR / MONTHS_PER_YEAR)


# ---------------------------------------------------------------------------
# Week math
# ---------------------------------------------------------------------------

def week_start(day):
    """Monday of the week containing ``day``."""
    return day - timedelta(days=day.weekday())


def week_key(monday):
    return monday.isoformat()


def due_date_for_week(monday):
    """A statement issued Monday is due the next Monday."""
    return monday + timedelta(days=7)


def due_moment(due_date, tzinfo):
    return datetime.combine(due_date, time(23, 59, 59), tzinfo=tzinfo)


def is_past_due(due_date, now_local):
    return now_local > due_moment(due_date, now_local.tzinfo)


def _stable_fraction(*parts):
    """Deterministic 0..1 value so a student's usage looks real but never changes on reload."""
    digest = hashlib.sha256(':'.join(str(p) for p in parts).encode('utf-8')).hexdigest()
    return int(digest[:8], 16) / float(0xFFFFFFFF)


def account_number(slug, student_id):
    digest = hashlib.sha256(f'acct:{slug}:{student_id}'.encode('utf-8')).hexdigest()
    digits = str(int(digest[:12], 16)).zfill(10)[-10:]
    return f'{digits[:4]}-{digits[4:8]}-{digits[8:10]}'


def confirmation_number(code, transaction_id):
    return f'{code}-{int(transaction_id):06d}'


# ---------------------------------------------------------------------------
# Catalog (seeded into bill_products; admins can edit option prices)
# ---------------------------------------------------------------------------

HOUSING_NOTE = 'Heat, water, and sewer are included in rent. You pay electricity, internet, and trash pickup.'

BILL_PRODUCTS_V2 = [
    {
        'slug': 'rent',
        'name': 'Rent',
        'category': 'housing',
        'is_base': True,
        'formula_kind': 'rent',
        'sort_order': 10,
        'options_json': {
            'code': 'RNT',
            'note': HOUSING_NOTE,
            'options': [
                {'id': 'studio', 'label': 'Studio apartment', 'payee': 'Lakeshore Lofts', 'unit': 'Unit 2',
                 'detail': 'One room plus a bathroom, about 450 sq ft.',
                 'impact': 'Your teacher picks your desk and where it sits. You cannot move your desk or choose your chair.',
                 'weekly': '144.23', 'bedrooms': 0, 'kwh_factor': '0.75', 'roommate': False},
                {'id': 'apt_1br', 'label': '1-bedroom apartment', 'payee': 'Maple Street Apartments', 'unit': 'Apt 4',
                 'detail': 'Bedroom, kitchen, and living room, about 650 sq ft.',
                 'impact': 'You choose your desk and can move it anywhere within your assigned zone. You cannot choose your chair.',
                 'weekly': '178.85', 'bedrooms': 1, 'kwh_factor': '1.00', 'roommate': False},
                {'id': 'apt_2br', 'label': '2-bedroom apartment', 'payee': 'Oak Court Apartments', 'unit': 'Apt 9',
                 'detail': 'An extra bedroom for an office or guests.',
                 'impact': 'You choose your desk and can move it anywhere within your assigned zone. You choose between two chairs.',
                 'weekly': '242.31', 'bedrooms': 2, 'kwh_factor': '1.35', 'roommate': False},
                {'id': 'roommate_2br', 'label': '2-bedroom with a roommate', 'payee': 'Oak Court Apartments', 'unit': 'Apt 7',
                 'detail': 'Your half of {full_rent}/month. You also split electricity and internet 50/50.',
                 'impact': 'You choose your desk and can move it anywhere within your assigned zone. You must have a roommate: '
                           'you get two chairs, but you share one desk.',
                 'weekly': '121.15', 'bedrooms': 2, 'kwh_factor': '1.35', 'roommate': True},
                {'id': 'house', 'label': 'Small house', 'payee': 'Cedar Lane Rentals', 'unit': '2-bedroom house',
                 'detail': 'A 2-bedroom house with a yard and a garage.',
                 'impact': "You choose your desk and can put it anywhere in the classroom (your teacher can veto the spot). "
                           "You can choose any chair that isn't already taken by an adult, and you can have as many chairs at "
                           "your desk as you want.",
                 'weekly': '288.46', 'bedrooms': 2, 'kwh_factor': '1.80', 'roommate': False},
            ],
        },
    },
    {
        'slug': 'electric',
        'name': 'Electricity',
        'category': 'utility',
        'is_base': True,
        'formula_kind': 'electric',
        'sort_order': 20,
        'options_json': {
            'code': 'PPL',
            'payee': 'Prairie Power & Light',
            'note': 'Your bill changes every week with how much electricity you use. Summer and winter cost more.',
            'params': {
                'customer_charge_weekly': '2.00',
                'rate_per_kwh': '0.16',
                'base_kwh_week': '105',
                'jitter': '0.08',
                'season': {'1': '1.25', '2': '1.20', '3': '1.05', '4': '0.95', '5': '0.95', '6': '1.30',
                           '7': '1.40', '8': '1.35', '9': '1.05', '10': '0.95', '11': '1.05', '12': '1.25'},
            },
        },
    },
    {
        'slug': 'internet',
        'name': 'Internet',
        'category': 'utility',
        'is_base': False,
        'formula_kind': 'internet',
        'sort_order': 30,
        'options_json': {
            'code': 'LAB',
            'payee': 'Lakes Area Broadband',
            'note': 'Optional. Paying for internet is what lets you use a school computer during free time.',
            'params': {'equipment_weekly': '0.92', 'equipment_label': 'Modem rental'},
            'options': [
                {'id': 'none', 'label': 'No internet', 'detail': 'You skip the internet bill.',
                 'impact': "You can't use a school computer during free time.", 'weekly': '0.00'},
                {'id': 'service', 'label': 'Internet service', 'detail': 'Home internet, fast enough for schoolwork and streaming.',
                 'impact': 'Paying this bill gives you computer access during free time.', 'weekly': '13.83'},
            ],
        },
    },
    {
        'slug': 'trash',
        'name': 'Trash',
        'category': 'utility',
        'is_base': False,
        'formula_kind': 'choice',
        'sort_order': 35,
        'options_json': {
            'code': 'PSW',
            'payee': 'Prairie Sanitation & Waste',
            'note': 'Optional. Weekly curbside pickup of trash and recycling.',
            'options': [
                {'id': 'none', 'label': 'No trash pickup', 'detail': 'You haul your own trash to the dump.', 'weekly': '0.00'},
                {'id': 'service', 'label': 'Trash pickup', 'detail': 'Weekly curbside pickup of trash and recycling.', 'weekly': '4.62'},
            ],
        },
    },
    {
        'slug': 'renters',
        'name': 'Renters insurance',
        'category': 'insurance',
        'is_base': True,
        'formula_kind': 'choice',
        'sort_order': 40,
        'options_json': {
            'code': 'HMI',
            'payee': 'Harbor Mutual Insurance',
            'note': "Renters insurance pays to replace your belongings if they're damaged or stolen, such as in a fire, "
                    "theft, or water damage. Starting soon, a random event each Wednesday may test whether you're covered.",
            'options': [
                {'id': 'basic', 'label': '$15,000 coverage', 'detail': 'Covers your belongings up to $15,000.',
                 'impact': "Covers up to $15,000 to replace your things if Wednesday's event damages or steals them.", 'weekly': '2.77'},
                {'id': 'plus', 'label': '$30,000 coverage', 'detail': 'Covers your belongings up to $30,000.',
                 'impact': "Covers up to $30,000 to replace your things if Wednesday's event damages or steals them.", 'weekly': '3.92'},
            ],
        },
    },
    {
        'slug': 'groceries',
        'name': 'Groceries',
        'category': 'food',
        'is_base': True,
        'formula_kind': 'groceries',
        'sort_order': 50,
        'options_json': {
            'code': 'MSM',
            'payee': 'Main Street Market',
            'note': 'Your weekly grocery receipt, based on USDA food plans for one adult living alone.',
            'params': {
                'categories': [
                    ['Produce', '0.22'], ['Meat, fish, and eggs', '0.24'], ['Dairy', '0.14'],
                    ['Bread, cereal, and grains', '0.12'], ['Pantry and snacks', '0.20'], ['Household basics', '0.08'],
                ],
            },
            'options': [
                {'id': 'thrifty', 'label': 'Thrifty', 'detail': 'Store brands, cooking at home.',
                 'impact': 'No snacks in class.', 'weekly': '80.00'},
                {'id': 'moderate', 'label': 'Moderate', 'detail': 'Some name brands and convenience foods.',
                 'impact': "You can have snacks in class, but only school-provided ones, not from home, and you can't use the fridge.",
                 'weekly': '100.00'},
                {'id': 'liberal', 'label': 'Liberal', 'detail': 'Name brands, snacks, and ready-made meals.',
                 'impact': 'You can bring snacks from home and use the classroom or school fridge.', 'weekly': '125.00'},
            ],
        },
    },
    {
        'slug': 'health',
        'name': 'Health insurance',
        'category': 'insurance',
        'is_base': True,
        'formula_kind': 'choice',
        'sort_order': 60,
        'options_json': {
            'code': 'PHP',
            'payee': 'Pinewood Health Plan',
            'note': 'Health insurance helps pay your medical bills if you get sick or hurt. A lower weekly premium means a '
                    'higher deductible, so you pay more out of pocket when you need care. Starting soon, a random event '
                    'each Wednesday may send you to the doctor, and your plan decides how much of that you pay.',
            'options': [
                {'id': 'bronze', 'label': 'Bronze plan', 'detail': '$7,400 deductible.',
                 'impact': "If Wednesday's health event happens to you, you pay the most out of pocket.", 'weekly': '79.62'},
                {'id': 'silver', 'label': 'Silver plan', 'detail': '$3,600 deductible.',
                 'impact': "If Wednesday's health event happens to you, you pay a moderate amount out of pocket.", 'weekly': '94.62'},
                {'id': 'gold', 'label': 'Gold plan', 'detail': '$1,900 deductible.',
                 'impact': "If Wednesday's health event happens to you, you pay the least out of pocket.", 'weekly': '107.31'},
            ],
        },
    },
    {
        'slug': 'savings',
        'name': 'Emergency fund',
        'category': 'savings',
        'is_base': True,
        'formula_kind': 'savings',
        'sort_order': 70,
        'options_json': {
            'code': 'SAV',
            'payee': 'Your savings account',
            'note': 'Pay yourself first. This money moves to your savings and stays yours. This deposit is required every '
                    'week until your emergency fund reaches its goal; once it does, it pauses automatically.',
            'options': [
                {'id': 's5', 'label': '$5 a week', 'weekly': '5.00'},
                {'id': 's10', 'label': '$10 a week', 'weekly': '10.00'},
                {'id': 's25', 'label': '$25 a week', 'weekly': '25.00'},
                {'id': 's50', 'label': '$50 a week', 'weekly': '50.00'},
            ],
        },
    },
    {
        'slug': 'student_loan',
        'name': 'Student loan',
        'category': 'loan',
        'is_base': True,
        'formula_kind': 'student_loan',
        'sort_order': 80,
        'options_json': {
            'code': 'CLS',
            'payee': 'Cornerstone Loan Servicing',
            'note': 'Standard 10-year federal student loan plan.',
            'params': {
                'rate': '0.0652',
                'by_color': {
                    'blue': {'principal': '19500.00', 'weekly': '51.14', 'label': 'Associate degree loan'},
                    'white': {'principal': '29560.00', 'weekly': '77.54', 'label': "Bachelor's degree loan"},
                },
            },
        },
    },
    {
        'slug': 'cell',
        'name': 'Cell phone',
        'category': 'utility',
        'is_base': False,
        'formula_kind': 'choice',
        'sort_order': 90,
        'options_json': {
            'code': 'LPW',
            'payee': 'Loop Wireless',
            'note': 'Optional. Paying for a cell phone plan is what lets you check email at school.',
            'options': [
                {'id': 'none', 'label': 'No cell phone', 'detail': 'You skip the cell phone bill.',
                 'impact': "You can't check email at school.", 'weekly': '0.00'},
                {'id': 'plan', 'label': 'Cell phone plan', 'detail': 'Talk, text, and data. Taxes included.',
                 'impact': 'Paying this bill lets you check email at school.', 'weekly': '8.08'},
            ],
        },
    },
    {
        'slug': 'car_loan',
        'name': 'Car loan',
        'category': 'vehicle',
        'is_base': False,
        'formula_kind': 'car_loan',
        'sort_order': 100,
        'options_json': {
            'code': 'LAF',
            'payee': 'Lakes Area Auto Finance',
            'note': 'A car also means insurance, gas, and repairs every week.',
            'options': [
                {'id': 'none', 'label': 'No car', 'detail': 'Walk, bike, or get rides.',
                 'impact': 'No extra break in class.', 'loan_weekly': '0.00', 'upkeep_weekly': '0.00', 'gallons_week': '0'},
                {'id': 'car', 'label': 'Car', 'detail': 'About a {car_price} car over 5 years.', 'car_price': '15000.00',
                 'impact': 'You can take an extra 5-minute break in class each day.',
                 'loan_weekly': '75.23', 'upkeep_weekly': '25.00', 'gallons_week': '10.5'},
            ],
        },
    },
    {
        'slug': 'car_insurance',
        'name': 'Car insurance',
        'category': 'vehicle',
        'is_base': False,
        'formula_kind': 'choice',
        'sort_order': 110,
        'options_json': {
            'code': 'GPA',
            'payee': 'Great Plains Auto Insurance',
            'note': 'Minnesota law requires insurance on every car. Lenders require full coverage on a car with a loan.',
            'options': [
                {'id': 'liability', 'label': 'Liability only', 'detail': "Pays for damage you cause to others. Not your own car.", 'weekly': '17.31'},
                {'id': 'full', 'label': 'Full coverage', 'detail': 'Also pays to fix or replace your car.', 'weekly': '40.38'},
            ],
        },
    },
    {
        'slug': 'fuel',
        'name': 'Gas and upkeep',
        'category': 'vehicle',
        'is_base': False,
        'formula_kind': 'fuel',
        'sort_order': 120,
        'options_json': {
            'code': 'CFS',
            'payee': 'Corner Fuel & Service',
            'params': {'fuel_price': '4.37'},
        },
    },
]

PRODUCT_ORDER = [spec['slug'] for spec in BILL_PRODUCTS_V2]

DEFAULT_PLAN = {
    'version': 2,
    'housing': 'apt_1br',
    'internet': 'service',
    'trash': 'none',
    'renters': 'basic',
    'groceries': 'thrifty',
    'health': 'bronze',
    'savings': 's10',
    'cell': 'none',
    'vehicle': 'none',
    'car_insurance': 'liability',
}

# Plan key -> product slug whose options it picks from.
PLAN_KEYS = {
    'housing': 'rent',
    'internet': 'internet',
    'trash': 'trash',
    'renters': 'renters',
    'groceries': 'groceries',
    'health': 'health',
    'savings': 'savings',
    'cell': 'cell',
    'vehicle': 'car_loan',
    'car_insurance': 'car_insurance',
}

LEGACY_HOUSING = {'apt_1br': 'apt_1br', 'apt_2br': 'apt_2br', 'house': 'house', 'homeless': 'studio'}
LEGACY_VEHICLE = {'none': 'none', 'beater': 'car', 'average': 'car', 'sports': 'car'}
LEGACY_HEALTH = {'none': 'bronze', '6000': 'bronze', '1200': 'silver', '0': 'gold'}

DEFAULT_SETTINGS = {
    'cost_of_living': DEFAULT_COST_OF_LIVING,
    'late_fees': {'rent_percent': '0.08', 'other_flat': '5.00'},
    # Charged when a student has a worksheet bill auto-filled instead of working it out.
    'convenience_fee_percent': '0.20',
    # Emergency fund goal in weeks of bills; once it is met, no weekly deposit is billed.
    'savings_goal_weeks': 3,
    'benefits': {
        # Take-home pay from this many recent paychecks is averaged each week.
        'income_weeks': 4,
        'fpl_annual': '15650',
        'snap': {
            'gross_limit_pct_fpl': '200',
            'max_allotment_monthly': '298',
            'earned_income_deduction': '0.20',
            'standard_deduction_monthly': '209',
            'utility_allowance_monthly': '100',
            'shelter_cap_monthly': '744',
            'benefit_reduction': '0.30',
        },
        'health': {
            'ma_limit_pct_fpl': '138',
            'credit_limit_pct_fpl': '400',
            'expected_contribution': '0.085',
            'benchmark_option': 'silver',
        },
        'housing': {
            'tenant_share': '0.30',
            'payment_standard_weekly': {'0': '167.54', '1': '185.31'},
        },
    },
}


def _dec(value, default='0'):
    try:
        return Decimal(str(value if value is not None and value != '' else default))
    except Exception:
        return Decimal(str(default))


def merged_settings(raw):
    """DEFAULT_SETTINGS overlaid with whatever the admin saved."""
    raw = raw if isinstance(raw, dict) else {}
    out = {
        'cost_of_living': DEFAULT_SETTINGS['cost_of_living'],
        'late_fees': dict(DEFAULT_SETTINGS['late_fees']),
        'convenience_fee_percent': DEFAULT_SETTINGS['convenience_fee_percent'],
        'savings_goal_weeks': DEFAULT_SETTINGS['savings_goal_weeks'],
        'benefits': {
            'income_weeks': DEFAULT_SETTINGS['benefits']['income_weeks'],
            'fpl_annual': DEFAULT_SETTINGS['benefits']['fpl_annual'],
            'snap': dict(DEFAULT_SETTINGS['benefits']['snap']),
            'health': dict(DEFAULT_SETTINGS['benefits']['health']),
            'housing': {
                'tenant_share': DEFAULT_SETTINGS['benefits']['housing']['tenant_share'],
                'payment_standard_weekly': dict(DEFAULT_SETTINGS['benefits']['housing']['payment_standard_weekly']),
            },
        },
    }
    if raw.get('cost_of_living') not in (None, ''):
        out['cost_of_living'] = str(cost_of_living(raw))
    out['late_fees'].update({k: v for k, v in (raw.get('late_fees') or {}).items() if v not in (None, '')})
    if raw.get('convenience_fee_percent') not in (None, ''):
        out['convenience_fee_percent'] = str(raw['convenience_fee_percent'])
    if raw.get('savings_goal_weeks'):
        out['savings_goal_weeks'] = int(raw['savings_goal_weeks'])
    benefits = raw.get('benefits') or {}
    if benefits.get('income_weeks'):
        out['benefits']['income_weeks'] = min(12, max(1, int(benefits['income_weeks'])))
    if benefits.get('fpl_annual'):
        out['benefits']['fpl_annual'] = benefits['fpl_annual']
    for program in ('snap', 'health'):
        out['benefits'][program].update({k: v for k, v in (benefits.get(program) or {}).items() if v not in (None, '')})
    housing = benefits.get('housing') or {}
    if housing.get('tenant_share'):
        out['benefits']['housing']['tenant_share'] = housing['tenant_share']
    standards = out['benefits']['housing']['payment_standard_weekly']
    # Older saved settings also have a '2' (2-bedroom) standard; one-person vouchers never use it, so it is dropped.
    standards.update({k: v for k, v in (housing.get('payment_standard_weekly') or {}).items() if k in standards and v not in (None, '')})
    return out


# ---------------------------------------------------------------------------
# Cost of living
# ---------------------------------------------------------------------------

def cost_of_living(settings):
    """Share of the real price students pay (0.85 = 85%). Anything unusable falls back to the default."""
    factor = _dec((settings or {}).get('cost_of_living'), DEFAULT_COST_OF_LIVING)
    if factor <= 0 or factor > 2:
        factor = Decimal(DEFAULT_COST_OF_LIVING)
    return factor


def _scaled(value, factor):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key in _PRICE_KEYS and not isinstance(item, (dict, list)):
                out[key] = str(money(_dec(item) * factor))
            elif key in _RATE_KEYS and not isinstance(item, (dict, list)):
                out[key] = str((_dec(item) * factor).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP))
            else:
                out[key] = _scaled(item, factor)
        return out
    if isinstance(value, list):
        return [_scaled(item, factor) for item in value]
    return value


def adjusted_catalog(catalog, settings):
    """The catalog as students see it: every price times the cost of living. Savings amounts are not prices."""
    factor = cost_of_living(settings)
    return {slug: (opts if slug == 'savings' else _scaled(opts, factor)) for slug, opts in (catalog or {}).items()}


def option_detail(option):
    """Option description with its (adjusted) prices filled in."""
    detail = (option or {}).get('detail') or ''
    if '{car_price}' in detail:
        detail = detail.replace('{car_price}', f"${_dec(option.get('car_price')):,.0f}")
    if '{full_rent}' in detail:
        detail = detail.replace('{full_rent}', f"${monthly_from_weekly(_dec(option.get('weekly')) * 2):,.0f}")
    return detail


def rate_text(rate):
    """$/kWh the way a utility prints it: at least two decimals, up to four."""
    whole, _, frac = f'{_dec(rate):.4f}'.rstrip('0').partition('.')
    return f"{whole}.{frac.ljust(2, '0')}"


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

def product_options(product_opts):
    return list((product_opts or {}).get('options') or [])


def find_option(product_opts, option_id):
    for opt in product_options(product_opts):
        if str(opt.get('id')) == str(option_id):
            return opt
    return None


def normalize_plan(raw, catalog):
    """Return a valid v2 plan. Accepts old v1 budget choices and maps them over.

    ``catalog`` maps product slug -> options dict (from bill_products.options_json).
    """
    raw = raw if isinstance(raw, dict) else {}
    plan = dict(DEFAULT_PLAN)
    if raw.get('version') != 2:
        if raw.get('housing_kind'):
            housing = LEGACY_HOUSING.get(raw.get('housing_kind'), 'apt_1br')
            if housing == 'apt_2br' and raw.get('roommate'):
                housing = 'roommate_2br'
            plan['housing'] = housing
        if 'cell' in raw:
            plan['cell'] = 'plan' if raw.get('cell') else 'none'
        if raw.get('vehicle'):
            plan['vehicle'] = LEGACY_VEHICLE.get(raw.get('vehicle'), 'none')
        if raw.get('car_insurance') in ('liability', 'full'):
            plan['car_insurance'] = raw['car_insurance']
        if raw.get('health') is not None:
            plan['health'] = LEGACY_HEALTH.get(str(raw.get('health')), 'bronze')
        if raw.get('emergency_fund') is False:
            plan['savings'] = 's5'
    else:
        for key in PLAN_KEYS:
            if raw.get(key) is not None:
                plan[key] = str(raw[key])
    for key, slug in PLAN_KEYS.items():
        opts = catalog.get(slug)
        if opts is None:
            continue
        if find_option(opts, plan[key]) is None:
            fallback = DEFAULT_PLAN[key]
            if find_option(opts, fallback) is None and product_options(opts):
                fallback = product_options(opts)[0].get('id')
            plan[key] = fallback
    vehicle = find_option(catalog.get('car_loan') or {}, plan['vehicle']) or {}
    if _dec(vehicle.get('loan_weekly')) > 0:
        plan['car_insurance'] = 'full'
    plan['version'] = 2
    return plan


def plan_problems(raw_plan, catalog):
    """Explain choices normalize_plan would have to change (shown to the student)."""
    problems = []
    vehicle = find_option(catalog.get('car_loan') or {}, (raw_plan or {}).get('vehicle')) or {}
    if _dec(vehicle.get('loan_weekly')) > 0 and (raw_plan or {}).get('car_insurance') == 'liability':
        problems.append('A car with a loan needs full coverage insurance, so we switched it to full coverage.')
    return problems


def student_loan_spec(catalog, card_color):
    params = (catalog.get('student_loan') or {}).get('params') or {}
    return (params.get('by_color') or {}).get((card_color or '').lower())


def selected_slugs(plan, catalog, card_color):
    slugs = ['rent', 'electric', 'renters', 'groceries', 'health', 'savings']
    if student_loan_spec(catalog, card_color):
        slugs.append('student_loan')
    if plan.get('internet') and plan['internet'] != 'none':
        slugs.append('internet')
    if plan.get('trash') and plan['trash'] != 'none':
        slugs.append('trash')
    if plan.get('cell') and plan['cell'] != 'none':
        slugs.append('cell')
    if plan.get('vehicle') and plan['vehicle'] != 'none':
        vehicle = find_option(catalog.get('car_loan') or {}, plan['vehicle']) or {}
        if _dec(vehicle.get('loan_weekly')) > 0:
            slugs.append('car_loan')
        slugs.extend(['car_insurance', 'fuel'])
    return [slug for slug in PRODUCT_ORDER if slug in slugs and slug in catalog]


def housing_listing(plan, catalog):
    return find_option(catalog.get('rent') or {}, plan.get('housing')) or find_option(catalog.get('rent') or {}, 'apt_1br') or {}


# ---------------------------------------------------------------------------
# Assistance math (realistic, simplified; parameters are admin-editable)
# ---------------------------------------------------------------------------

def fpl_weekly(settings):
    return _dec(settings['benefits']['fpl_annual']) / WEEKS_PER_YEAR


def _pct_text(rate):
    return f"{float(_dec(rate) * 100):g}%"


def housing_assistance(rent_weekly, bedrooms, income_weekly, settings):
    """Section 8: you pay 30% of your income; the voucher pays the rest of the rent, up to the payment standard.

    Payment standards follow local rents, so they move with the cost of living too.
    """
    params = settings['benefits']['housing']
    standards = params.get('payment_standard_weekly') or {}
    # One person gets a 1-bedroom voucher; HUD uses the lower of voucher size and unit size (24 CFR 982.505(c)(1)).
    key = str(min(int(bedrooms or 0), 1))
    standard = money(_dec(standards.get(key), standards.get('1', '185.31')) * cost_of_living(settings))
    rate = _dec(params.get('tenant_share'), '0.30')
    share = money(_dec(income_weekly) * rate)
    covered = min(money(rent_weekly), standard)
    amount = max(ZERO, money(covered - share))
    explain = (
        f"You pay {_pct_text(rate)} of your take-home pay (${money(income_weekly):,.2f} a week x {_pct_text(rate)} = ${share:,.2f}). "
        f"The voucher pays the rest of your rent, up to ${standard:,.2f} a week."
    )
    over = money(rent_weekly) - standard
    if over > 0:
        why = 'A voucher for one person is a 1-bedroom voucher, so you' if int(bedrooms or 0) > 1 else 'You'
        explain += f" {why} also pay the ${over:,.2f} your rent is over that."
    return {
        'amount': amount,
        'tenant_share': share,
        'payment_standard': standard,
        'explain': explain,
    }


def snap_benefit(income_weekly, shelter_weekly, settings):
    params = settings['benefits']['snap']
    income = _dec(income_weekly)
    limit = fpl_weekly(settings) * _dec(params['gross_limit_pct_fpl']) / Decimal('100')
    max_weekly = weekly_from_monthly(params['max_allotment_monthly'])
    if income > limit:
        return {'amount': ZERO, 'eligible': False,
                'explain': f"Your take-home pay (${money(income):,.2f} a week) is over the SNAP limit of ${money(limit):,.2f} a week."}
    adjusted = max(ZERO, income * (Decimal('1') - _dec(params['earned_income_deduction']))
                   - weekly_from_monthly(params['standard_deduction_monthly']))
    shelter = _dec(shelter_weekly) + weekly_from_monthly(params['utility_allowance_monthly'])
    excess = max(ZERO, shelter - adjusted / Decimal('2'))
    excess = min(excess, weekly_from_monthly(params['shelter_cap_monthly']))
    net = max(ZERO, adjusted - excess)
    amount = max(ZERO, money(max_weekly - net * _dec(params['benefit_reduction'])))
    return {
        'amount': amount,
        'eligible': amount > 0,
        'explain': (
            f"The most SNAP pays one person is ${max_weekly:,.2f} a week. It goes down by {_pct_text(params['benefit_reduction'])} of your take-home pay "
            f"after SNAP's deductions for work, rent, and utilities (${money(net):,.2f}), which leaves ${amount:,.2f} a week for groceries."
        ),
    }


def health_help(income_weekly, benchmark_weekly, settings):
    params = settings['benefits']['health']
    income = _dec(income_weekly)
    fpl = fpl_weekly(settings)
    ma_limit = fpl * _dec(params['ma_limit_pct_fpl']) / Decimal('100')
    credit_limit = fpl * _dec(params['credit_limit_pct_fpl']) / Decimal('100')
    if income <= ma_limit:
        return {'kind': 'ma', 'amount': None,
                'explain': f"Your take-home pay (${money(income):,.2f} a week) is under ${money(ma_limit):,.2f}, so Medical Assistance pays your whole premium."}
    if income <= credit_limit:
        rate = _dec(params['expected_contribution'])
        expected = money(income * rate)
        credit = max(ZERO, money(_dec(benchmark_weekly) - expected))
        return {'kind': 'credit', 'amount': credit,
                'explain': (
                    f"You're over the Medical Assistance limit, so you get a premium tax credit instead: "
                    f"the silver plan (${money(benchmark_weekly):,.2f}) minus {_pct_text(rate)} of your take-home pay (${expected:,.2f}) = ${credit:,.2f} a week."
                )}
    return {'kind': None, 'amount': ZERO,
            'explain': f"Your take-home pay is over ${money(credit_limit):,.2f} a week, so you don't qualify for help paying for health insurance."}


# ---------------------------------------------------------------------------
# Statement lines
# ---------------------------------------------------------------------------

def _line(label, amount, kind='charge'):
    return {'label': label, 'amount': str(money(amount)), 'kind': kind}


def lines_total(lines):
    return money(sum((Decimal(str(line['amount'])) for line in lines), ZERO))


def electric_usage(product_opts, listing, student_id, monday):
    params = product_opts.get('params') or {}
    season = params.get('season') or {}
    factor = _dec(season.get(str(monday.month)), '1')
    jitter = _dec(params.get('jitter'), '0.08')
    wobble = Decimal(str(round(_stable_fraction(student_id, monday.isoformat(), 'kwh') * 2 - 1, 4))) * jitter
    kwh = _dec(params.get('base_kwh_week'), '105') * _dec(listing.get('kwh_factor'), '1') * factor * (Decimal('1') + wobble)
    return int(kwh.quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def statement_lines(slug, catalog, plan, ctx):
    """Line items for one product's weekly statement.

    ctx: student_id, monday, card_color, benefits (dict program -> approved info),
    loan_balance (Decimal or None), settings.
    Returns (lines, meta).
    """
    opts = catalog.get(slug) or {}
    listing = housing_listing(plan, catalog)
    roommate = bool(listing.get('roommate'))
    lines = []
    meta = {}
    benefits = ctx.get('benefits') or {}

    if slug == 'rent':
        rent = money(listing.get('weekly'))
        lines.append(_line(f"Rent: {listing.get('label', 'Apartment')} ({listing.get('unit', '')})".replace(' ()', ''), rent))
        housing = benefits.get('housing')
        housing_credit = ZERO
        if housing and housing.get('income_weekly') is not None:
            calc = housing_assistance(rent, listing.get('bedrooms'), housing['income_weekly'], ctx['settings'])
            if calc['amount'] > 0:
                lines.append(_line('Housing assistance payment (Section 8 voucher)', -calc['amount'], 'credit'))
                housing_credit = calc['amount']
        meta['payee'] = listing.get('payee')
        meta['rent_base'] = str(rent)
        meta['housing_credit'] = str(housing_credit)
    elif slug == 'electric':
        params = opts.get('params') or {}
        kwh = electric_usage(opts, listing, ctx['student_id'], ctx['monday'])
        rate = _dec(params.get('rate_per_kwh'), '0.16')
        customer_charge = _dec(params.get('customer_charge_weekly'), '2.00')
        lines.append(_line('Basic service charge', customer_charge))
        lines.append(_line(f'Energy used: {kwh} kWh x ${rate_text(rate)}', money(Decimal(kwh) * rate)))
        if roommate:
            half = money(lines_total(lines) / 2)
            lines.append(_line('Your roommate pays half', -half, 'credit'))
        meta['kwh'] = kwh
        meta['rate_per_kwh'] = str(rate)
        meta['customer_charge'] = str(money(customer_charge))
        meta['roommate'] = roommate
    elif slug == 'internet':
        opt = find_option(opts, plan.get('internet')) or {}
        params = opts.get('params') or {}
        lines.append(_line(f"{opt.get('label', 'Internet')} plan", opt.get('weekly')))
        if _dec(params.get('equipment_weekly')) > 0:
            lines.append(_line(params.get('equipment_label') or 'Equipment', params.get('equipment_weekly')))
        if roommate:
            half = money(lines_total(lines) / 2)
            lines.append(_line('Your roommate pays half', -half, 'credit'))
        meta['plan_price'] = str(money(opt.get('weekly')))
        meta['equipment_price'] = str(money(params.get('equipment_weekly'))) if _dec(params.get('equipment_weekly')) > 0 else '0.00'
        meta['roommate'] = roommate
    elif slug == 'groceries':
        opt = find_option(opts, plan.get('groceries')) or {}
        total = money(opt.get('weekly'))
        cats = (opts.get('params') or {}).get('categories') or [['Groceries', '1']]
        running = ZERO
        for idx, (label, share) in enumerate(cats):
            amount = total - running if idx == len(cats) - 1 else money(total * _dec(share))
            running += amount
            lines.append(_line(label, amount))
        snap = benefits.get('snap')
        if snap and snap.get('income_weekly') is not None:
            shelter = money(listing.get('weekly'))
            housing = benefits.get('housing')
            if housing and housing.get('income_weekly') is not None:
                shelter = money(shelter - housing_assistance(shelter, listing.get('bedrooms'), housing['income_weekly'], ctx['settings'])['amount'])
            calc = snap_benefit(snap['income_weekly'], shelter, ctx['settings'])
            amount = min(calc['amount'], total)
            if amount > 0:
                lines.append(_line('SNAP EBT card', -amount, 'credit'))
        meta['plan'] = opt.get('label')
        meta['weekly_budget'] = str(total)
        meta['category_label'] = cats[0][0]
        meta['category_share'] = str(cats[0][1])
    elif slug == 'health':
        opt = find_option(opts, plan.get('health')) or {}
        premium = money(opt.get('weekly'))
        lines.append(_line(f"{opt.get('label', 'Health plan')} premium ({opt.get('detail', '').rstrip('.')})".replace(' ()', ''), premium))
        health = benefits.get('health')
        health_credit = ZERO
        if health and health.get('income_weekly') is not None:
            bench = find_option(opts, ctx['settings']['benefits']['health'].get('benchmark_option', 'silver')) or opt
            calc = health_help(health['income_weekly'], money(bench.get('weekly')), ctx['settings'])
            if calc['kind'] == 'ma':
                lines.append(_line('Medical Assistance pays your premium', -premium, 'credit'))
                health_credit = premium
            elif calc['kind'] == 'credit' and calc['amount'] > 0:
                health_credit = min(calc['amount'], premium)
                lines.append(_line('Premium tax credit', -health_credit, 'credit'))
        meta['plan'] = opt.get('label')
        meta['premium'] = str(premium)
        meta['health_credit'] = str(health_credit)
    elif slug == 'savings':
        opt = find_option(opts, plan.get('savings')) or {}
        lines.append(_line('Deposit to your emergency fund', opt.get('weekly')))
    elif slug == 'student_loan':
        spec = student_loan_spec(catalog, ctx.get('card_color')) or {}
        rate = _dec((opts.get('params') or {}).get('rate'), '0.0652')
        balance = ctx.get('loan_balance')
        if balance is None:
            balance = _dec(spec.get('principal'))
        payment = money(spec.get('weekly'))
        interest = money(_dec(balance) * rate / WEEKS_PER_YEAR)
        principal = max(ZERO, min(money(balance), money(payment - interest)))
        lines.append(_line('Principal', principal))
        lines.append(_line(f'Interest ({(rate * 100):.2f}% a year)', interest))
        meta.update({
            'balance_before': str(money(balance)), 'principal': str(principal), 'loan_label': spec.get('label'),
            'rate': str(rate), 'payment': str(payment),
        })
    elif slug == 'trash':
        opt = find_option(opts, plan.get('trash')) or {}
        lines.append(_line(opt.get('label', 'Trash pickup'), opt.get('weekly')))
    elif slug == 'renters':
        opt = find_option(opts, plan.get('renters')) or {}
        lines.append(_line(f"Renters insurance premium ({opt.get('label', 'coverage')})", opt.get('weekly')))
    elif slug == 'cell':
        opt = find_option(opts, plan.get('cell')) or {}
        lines.append(_line(f"{opt.get('label', 'Phone')} plan", opt.get('weekly')))
    elif slug == 'car_loan':
        vehicle = find_option(opts, plan.get('vehicle')) or {}
        lines.append(_line(f"Loan payment: {vehicle.get('label', 'Car')}", vehicle.get('loan_weekly')))
    elif slug == 'car_insurance':
        opt = find_option(opts, plan.get('car_insurance')) or {}
        lines.append(_line(f"{opt.get('label', 'Coverage')} premium", opt.get('weekly')))
    elif slug == 'fuel':
        vehicle = find_option(catalog.get('car_loan') or {}, plan.get('vehicle')) or {}
        price = _dec((opts.get('params') or {}).get('fuel_price'), '4.37')
        gallons = _dec(vehicle.get('gallons_week'), '10')
        lines.append(_line(f'Unleaded fuel: {gallons.normalize()} gal x ${price:.2f}', money(gallons * price)))
        lines.append(_line('Oil changes, tires, and repairs', vehicle.get('upkeep_weekly')))
        meta['gallons'] = str(gallons)
        meta['fuel_price'] = str(price)
        meta['upkeep'] = str(money(vehicle.get('upkeep_weekly')))
    return lines, meta


def payee_for(slug, catalog, plan):
    opts = catalog.get(slug) or {}
    if slug == 'rent':
        return housing_listing(plan, catalog).get('payee') or 'Your landlord'
    return opts.get('payee') or slug.replace('_', ' ').title()


def product_code(slug, catalog):
    return (catalog.get(slug) or {}).get('code') or slug[:3].upper()


def weekly_plan_total(plan, catalog, card_color, loan_balance=None):
    """Estimated weekly total for the plan page (no assistance, typical usage)."""
    total = ZERO
    items = []
    listing = housing_listing(plan, catalog)
    for slug in selected_slugs(plan, catalog, card_color):
        opts = catalog.get(slug) or {}
        if slug == 'electric':
            params = opts.get('params') or {}
            kwh = _dec(params.get('base_kwh_week'), '105') * _dec(listing.get('kwh_factor'), '1')
            amount = money(_dec(params.get('customer_charge_weekly'), '2.00') + kwh * _dec(params.get('rate_per_kwh'), '0.16'))
            if listing.get('roommate'):
                amount = money(amount / 2)
        else:
            lines, _meta = statement_lines(slug, catalog, plan, {
                'student_id': 0, 'monday': None, 'card_color': card_color, 'benefits': {},
                'loan_balance': loan_balance, 'settings': merged_settings({}),
            })
            amount = lines_total(lines)
        total += amount
        items.append({'slug': slug, 'amount': amount})
    return money(total), items


def savings_goal(plan, catalog, card_color, settings):
    total, items = weekly_plan_total(plan, catalog, card_color)
    spending = money(sum((item['amount'] for item in items if item['slug'] != 'savings'), ZERO))
    weeks = int(settings.get('savings_goal_weeks') or DEFAULT_SETTINGS['savings_goal_weeks'])
    return money(spending * weeks), weeks


def late_fee(slug, overdue, rent_charge, settings):
    """Minnesota caps rent late fees at 8% of the overdue rent payment (Minn. Stat. 504B.177)."""
    fees = settings.get('late_fees') or {}
    overdue = money(overdue)
    if overdue <= 0:
        return ZERO
    if slug == 'rent':
        base = min(overdue, money(rent_charge)) if rent_charge else overdue
        return money(base * _dec(fees.get('rent_percent'), '0.08'))
    return money(_dec(fees.get('other_flat'), '5.00'))


# ---------------------------------------------------------------------------
# Worksheets: work the bill's math out by hand, or pay a fee to skip it
# ---------------------------------------------------------------------------

def convenience_fee(base_amount, settings):
    """20% (by default) to have a worksheet bill filled in instead of worked out."""
    rate = _dec((settings or {}).get('convenience_fee_percent'), '0.20')
    return money(_dec(base_amount) * rate)


def worksheet_spec(slug, meta):
    """Answer-free worksheet for the browser: the given numbers, and blank fields to fill in.

    Only reads ``meta`` (frozen on the bill at statement time), never the catalog or
    settings, so what a student sees can never drift from what they're graded against.
    """
    meta = meta or {}
    if slug == 'electric':
        given = [
            ('Energy used', f"{meta.get('kwh', 0)} kWh"),
            ('Rate', f"${rate_text(_dec(meta.get('rate_per_kwh')))} per kWh"),
            ('Basic service charge', f"${_dec(meta.get('customer_charge')):,.2f}"),
        ]
        fields = [
            {'id': 'energy_charge', 'label': 'Energy charge (kWh x rate)'},
            {'id': 'total', 'label': 'Total due' + (', split with your roommate' if meta.get('roommate') else '')},
        ]
    elif slug == 'groceries':
        given = [
            ('Weekly grocery budget', f"${_dec(meta.get('weekly_budget')):,.2f}"),
            (f"{meta.get('category_label') or 'First category'} share", f"{_dec(meta.get('category_share')) * 100:.0f}% of the budget"),
        ]
        fields = [
            {'id': 'category_amount', 'label': f"{meta.get('category_label') or 'That category'} amount"},
            {'id': 'total', 'label': 'Total due (after any SNAP credit)'},
        ]
    elif slug == 'student_loan':
        given = [
            ('Balance before this payment', f"${_dec(meta.get('balance_before')):,.2f}"),
            ('Interest rate', f"{_dec(meta.get('rate')) * 100:.2f}% a year"),
            ('Weekly payment', f"${_dec(meta.get('payment')):,.2f}"),
        ]
        fields = [
            {'id': 'interest', 'label': 'Interest (balance x rate / 52)'},
            {'id': 'principal', 'label': 'Principal (payment - interest)'},
        ]
    elif slug == 'fuel':
        given = [
            ('Gallons used', str(_dec(meta.get('gallons')).normalize())),
            ('Price per gallon', f"${_dec(meta.get('fuel_price')):,.2f}"),
            ('Oil changes, tires, and repairs', f"${_dec(meta.get('upkeep')):,.2f}"),
        ]
        fields = [
            {'id': 'fuel_cost', 'label': 'Fuel cost (gallons x price)'},
            {'id': 'total', 'label': 'Total due (fuel cost + upkeep)'},
        ]
    elif slug == 'internet':
        given = [
            ('Plan price', f"${_dec(meta.get('plan_price')):,.2f}"),
            ('Equipment', f"${_dec(meta.get('equipment_price')):,.2f}"),
        ]
        fields = [
            {'id': 'subtotal', 'label': 'Subtotal (plan + equipment)'},
            {'id': 'total', 'label': 'Total due' + (', split with your roommate' if meta.get('roommate') else '')},
        ]
    elif slug == 'rent':
        given = [
            ('Rent', f"${_dec(meta.get('rent_base')):,.2f}"),
            ('Housing assistance credit', f"${_dec(meta.get('housing_credit')):,.2f}"),
        ]
        fields = [{'id': 'total', 'label': 'Total due (rent - assistance credit)'}]
    elif slug == 'health':
        given = [
            ('Premium', f"${_dec(meta.get('premium')):,.2f}"),
            ('Assistance credit', f"${_dec(meta.get('health_credit')):,.2f}"),
        ]
        fields = [{'id': 'total', 'label': 'Total due (premium - assistance credit)'}]
    else:
        given, fields = [], []
    return {'given': given, 'fields': fields}


def grade_worksheet(slug, meta, base_amount, answers):
    """Grade a student's worksheet answers against the numbers frozen on this bill.

    ``answers``: {field_id: raw string}. Returns (all_correct, errors), where errors
    maps field_id -> message for any missing or wrong answer.
    """
    meta = meta or {}
    answers = answers or {}
    errors = {}
    base_amount = money(base_amount)

    def check(field_id, expected, message):
        value = parse_money(answers.get(field_id))
        if value is None:
            errors[field_id] = 'Enter an amount.'
        elif not amounts_close(value, expected):
            errors[field_id] = message

    if slug == 'electric':
        energy_charge = money(_dec(meta.get('kwh')) * _dec(meta.get('rate_per_kwh')))
        check('energy_charge', energy_charge, 'Multiply kWh used by the rate per kWh.')
        check('total', base_amount, 'Add the basic service charge to the energy charge'
              + (', then split it with your roommate.' if meta.get('roommate') else '.'))
    elif slug == 'groceries':
        category_amount = money(_dec(meta.get('weekly_budget')) * _dec(meta.get('category_share')))
        check('category_amount', category_amount, "Multiply the weekly budget by that category's share.")
        check('total', base_amount, 'Start from the weekly budget and subtract any SNAP credit.')
    elif slug == 'student_loan':
        balance = _dec(meta.get('balance_before'))
        rate = _dec(meta.get('rate'))
        payment = _dec(meta.get('payment'))
        interest = money(balance * rate / WEEKS_PER_YEAR)
        principal = max(ZERO, min(money(balance), money(payment - interest)))
        check('interest', interest, 'Multiply the balance by the interest rate, then divide by 52 weeks.')
        check('principal', principal, 'Subtract the interest from the weekly payment.')
    elif slug == 'fuel':
        fuel_cost = money(_dec(meta.get('gallons')) * _dec(meta.get('fuel_price')))
        check('fuel_cost', fuel_cost, 'Multiply gallons used by the price per gallon.')
        check('total', base_amount, 'Add the fuel cost to the upkeep cost.')
    elif slug == 'internet':
        subtotal = money(_dec(meta.get('plan_price')) + _dec(meta.get('equipment_price')))
        check('subtotal', subtotal, 'Add the plan price and the equipment cost.')
        check('total', base_amount, 'Split the subtotal with your roommate.' if meta.get('roommate') else 'The subtotal is the total due.')
    elif slug == 'rent':
        check('total', money(_dec(meta.get('rent_base')) - _dec(meta.get('housing_credit'))),
              'Subtract your housing assistance credit from the rent.')
    elif slug == 'health':
        check('total', money(_dec(meta.get('premium')) - _dec(meta.get('health_credit'))),
              'Subtract your assistance credit from the premium.')
    else:
        return True, {}
    return (not errors), errors
