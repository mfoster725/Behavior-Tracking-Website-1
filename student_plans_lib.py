"""Shared helpers for student if/then plans (seeds, normalization, percent math)."""

from datetime import datetime, time, timedelta, date

PLAN_IF_SEED_TEXTS = [
    "Raises hand and waits to be called on before speaking",
    "Stays seated during instruction",
    "Completes assigned classwork",
    "Follows adult directions within one prompt",
    "Uses an inside or hallway voice",
    "Keeps hands and feet to self",
    "Transitions after one prompt",
    "Comes to class prepared with materials",
    "Turns in homework on time",
    "Stays on task during independent work",
    "Uses respectful language with peers and staff",
    "Asks for a break appropriately",
    "Stays in assigned area",
    "Participates at least once in class discussion",
    "Walks safely in the hallway",
    "Remains calm when frustrated",
    "Accepts feedback without arguing",
    "Starts work within two minutes of being asked",
    "Puts away materials when asked",
    "Uses kind words when upset",
    "Follows the classroom routine independently",
    "Remains in seat during group instruction",
    "Completes exit ticket before leaving",
    "Greets staff appropriately",
    "Uses expected voice level in the cafeteria",
    "Shares materials with peers",
    "Waits turn in line",
    "Returns from break or bathroom on time",
    "Keeps workspace organized",
    "Asks for help when stuck",
    "Uses a coping strategy when escalated",
    "Completes morning arrival routine",
    "Follows bus or van safety expectations",
    "Responds to name or attention signal",
    "Keeps phone or device put away",
    "Uses appropriate language (no cursing)",
    "Remains with the group during transitions",
    "Shows expected behavior during specials or electives",
    "Ends the day with materials packed and ready",
    "Follows playground or recess expectations",
]

THRESHOLD_TYPES = (
    'by_time',
    'dow_range',
    'consecutive_days',
    'days_in_window',
    'specific_period',
    'end_of_day',
    'weekly_average',
    'category_specific',
)

DOW_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def normalize_if_text(text):
    if not text:
        return ''
    return ' '.join(str(text).strip().lower().split())


def parse_hhmm(value):
    """Parse 'HH:MM', 'H:MM', or 'H:MM AM/PM' into datetime.time."""
    if value is None:
        return None
    if isinstance(value, time):
        return value
    s = str(value).strip()
    if not s:
        return None
    for fmt in ('%H:%M', '%H:%M:%S', '%I:%M %p', '%I:%M%p', '%I:%M:%S %p'):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    # Also accept 1430-style
    if s.isdigit() and len(s) in (3, 4):
        s = s.zfill(4)
        try:
            return time(int(s[:2]), int(s[2:]))
        except ValueError:
            return None
    return None


def parse_period_end_time(time_range):
    """Extract end clock time from strings like '7:45-8:30' or '7:45 – 8:30'."""
    if not time_range:
        return None
    s = str(time_range).replace('–', '-').replace('—', '-')
    if '-' not in s:
        return parse_hhmm(s)
    end = s.split('-')[-1].strip()
    return parse_hhmm(end)


def period_has_entered_points(period):
    """True when at least one STAR cell was actually entered (including explicit 0)."""
    if period is None:
        return False
    if isinstance(period, dict):
        values = (
            period.get('safety_points'),
            period.get('teamwork_points'),
            period.get('accountability_points'),
            period.get('relationships_points'),
        )
    else:
        values = (
            getattr(period, 'safety_points', None),
            getattr(period, 'teamwork_points', None),
            getattr(period, 'accountability_points', None),
            getattr(period, 'relationships_points', None),
        )
    return any(value is not None and value != '' for value in values)


def period_points_tuple(period):
    """Return (s, t, a, r) ints from a PeriodRecord-like object."""
    def _n(v):
        try:
            return int(v) if v is not None else 0
        except (TypeError, ValueError):
            return 0
    return (
        _n(getattr(period, 'safety_points', 0)),
        _n(getattr(period, 'teamwork_points', 0)),
        _n(getattr(period, 'accountability_points', 0)),
        _n(getattr(period, 'relationships_points', 0)),
    )


def percent_from_periods(periods, star_category=None):
    """
    Compute STAR percent from period records.
    Max 2 points per category per period (matches entry UI).
    star_category: None/'overall' or 's'|'t'|'a'|'r' / full names.
    """
    periods = list(periods or [])
    if not periods:
        return None

    cat = (star_category or 'overall').lower().strip()
    alias = {
        's': 'safety', 't': 'teamwork', 'a': 'accountability', 'r': 'relationships',
        'safety': 'safety', 'teamwork': 'teamwork', 'accountability': 'accountability',
        'relationships': 'relationships', 'overall': 'overall', '': 'overall',
    }
    cat = alias.get(cat, cat)

    totals = {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0}
    n = 0
    for p in periods:
        if not period_has_entered_points(p):
            continue
        s, t, a, r = period_points_tuple(p)
        # Explicit zeros count; unfilled (null) rows are skipped above.
        totals['safety'] += s
        totals['teamwork'] += t
        totals['accountability'] += a
        totals['relationships'] += r
        n += 1

    if n == 0:
        return None

    max_per_cat = n * 2
    if cat == 'overall':
        earned = sum(totals.values())
        possible = max_per_cat * 4
        if possible <= 0:
            return None
        return round((earned / possible) * 100, 2)

    if cat not in totals:
        return None
    if max_per_cat <= 0:
        return None
    return round((totals[cat] / max_per_cat) * 100, 2)


def week_monday(d):
    return d - timedelta(days=d.weekday())


def window_key_for_row(row, eval_date):
    """Stable once-per-window key for met events."""
    t = (getattr(row, 'threshold_type', None) or '').strip()
    if t in ('by_time', 'end_of_day', 'specific_period', 'category_specific'):
        return eval_date.isoformat()
    if t == 'weekly_average':
        mon = week_monday(eval_date)
        return f"week-{mon.isoformat()}"
    if t == 'dow_range':
        return f"dow-{eval_date.isoformat()}"
    if t == 'consecutive_days':
        return f"consec-{eval_date.isoformat()}"
    if t == 'days_in_window':
        return f"win-{eval_date.isoformat()}"
    return eval_date.isoformat()


def dow_index(name_or_int):
    if name_or_int is None:
        return None
    if isinstance(name_or_int, int):
        return name_or_int if 0 <= name_or_int <= 6 else None
    s = str(name_or_int).strip().lower()
    if s.isdigit():
        i = int(s)
        return i if 0 <= i <= 6 else None
    if s in DOW_NAMES:
        return DOW_NAMES.index(s)
    # abbreviations
    abbrev = {'mon': 0, 'tue': 1, 'tues': 1, 'wed': 2, 'thu': 3, 'thur': 3, 'thurs': 3, 'fri': 4, 'sat': 5, 'sun': 6}
    return abbrev.get(s[:3] if len(s) >= 3 else s)
