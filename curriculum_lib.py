"""Financial literacy curriculum: seeded lessons and helpers."""

from decimal import Decimal

LESSON_SEEDS = [
    {
        'slug': 'read_paycheck',
        'title': 'Read your paycheck',
        'skill_name': 'Net pay',
        'sort_order': 1,
        'student_prompt': (
            'Your paycheck comes from this week. Work the worksheet in Bank Account: '
            'base pay, citations, deduction, and take-home. Deposit when the numbers are right.'
        ),
        'staff_script': (
            'Payday. Open Bank Account with the student and have them complete the paycheck '
            'worksheet. Ask them to say the take-home amount out loud before they submit.'
        ),
    },
    {
        'slug': 'why_pay_changed',
        'title': 'Why did my pay change?',
        'skill_name': 'Cause and effect',
        'sort_order': 2,
        'student_prompt': (
            'Compare this week to last week. Pay can go up or down. Figure out the difference '
            'and name what changed — citations, attendance, or a stronger week.'
        ),
        'staff_script': (
            'Show this week vs last week. If pay went up, ask what they did differently. '
            'If it went down, ask what it cost. If this is their first check, use pay with '
            'zero citations as the comparison.'
        ),
    },
    {
        'slug': 'save_or_buy',
        'title': 'Save or buy',
        'skill_name': 'Spending decisions',
        'sort_order': 3,
        'student_prompt': (
            'Pick one marketplace item. Compare it to your balance. Decide: buy it now, '
            'wait, or set it as a savings goal.'
        ),
        'staff_script': (
            'Have them pick a real item they can see. Ask: do you have enough, and if you '
            'spend it today, what do you give up? Done is a choice, not a lecture.'
        ),
    },
    {
        'slug': 'opportunity_cost',
        'title': 'Opportunity cost',
        'skill_name': 'Tradeoffs',
        'sort_order': 4,
        'student_prompt': (
            'Pick two items. Can you buy both with your current balance? If not, choose one '
            'and say what you are giving up.'
        ),
        'staff_script': (
            'Two items vs one balance. If they cannot buy both, make them pick and name the '
            'thing they are not getting. That is the whole lesson.'
        ),
    },
    {
        'slug': 'needs_vs_wants',
        'title': 'Needs vs wants',
        'skill_name': 'Prioritizing spending',
        'sort_order': 5,
        'student_prompt': (
            'Look at what you have bought (or items you could buy). Tag each as a need or a want.'
        ),
        'staff_script': (
            'Use their purchase history if they have it. No history: use catalog items. '
            'Do not argue the tags. Ask one follow-up: which want could wait?'
        ),
    },
    {
        'slug': 'savings_goal',
        'title': 'Set a savings goal',
        'skill_name': 'Saving',
        'sort_order': 6,
        'student_prompt': (
            'Pick a target — a marketplace item or a dollar amount. See how many paychecks '
            'it would take at last week’s take-home.'
        ),
        'staff_script': (
            'Help them pick one goal they actually care about. Show weeks-to-goal using last '
            'week’s take-home. They can change it later.'
        ),
    },
]


def money_to_float(value):
    if value is None:
        return 0.0
    return float(Decimal(str(value)))
