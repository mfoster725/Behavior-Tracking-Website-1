"""Financial literacy curriculum: seeded lessons and helpers."""

from decimal import Decimal

LESSON_SEEDS = [
    {
        'slug': 'read_paycheck',
        'title': 'Read your paycheck',
        'skill_name': 'Net pay',
        'sort_order': 1,
        'student_prompt': (
            'This week’s STAR percent and citations are already on this page. '
            'Use them on the Bank Account worksheet, then deposit.'
        ),
        'staff_script': (
            'Teach the formula out loud before they type: base pay is $100 times '
            'STAR percent, then $2 per citation comes off. Have them point at this '
            'week’s numbers on the lesson, then open Bank Account and run the worksheet.'
        ),
        'teaching': (
            'Your paycheck is math from this week. Not a random number.\n\n'
            'Base pay starts at $100, then gets multiplied by your STAR percent for '
            'the week. If the week was 80%, base pay is $80.\n\n'
            'Citations come off after that. Each citation is $2. Three citations is $6 off.\n\n'
            'Take-home is what is left: base pay minus that deduction. That is the number '
            'that hits your account when you deposit.\n\n'
            'The worksheet in Bank Account is the same math with this week’s numbers. '
            'Run it. Deposit when it is right.'
        ),
    },
    {
        'slug': 'why_pay_changed',
        'title': 'Why did my pay change?',
        'skill_name': 'Cause and effect',
        'sort_order': 2,
        'student_prompt': (
            'Both weeks are already pulled up. Read the two columns, then say what moved.'
        ),
        'staff_script': (
            'Do not send them hunting for paystubs. The two weeks are on the page. '
            'Walk STAR percent first (that is base pay), then citations ($2 each). '
            'If this is a first check, compare to pay with zero citations. Ask them '
            'to name the lever that did the most work.'
        ),
        'teaching': (
            'Pay moves for a reason. Two levers.\n\n'
            '- The week — STAR percent — sets base pay. A stronger week raises it. '
            'A weaker week lowers it.\n'
            '- Citations come off after. More citations, more money gone. Fewer '
            'citations, more of the base pay stays.\n\n'
            'If both moved, look at which one did more of the work. The two weeks '
            'are sitting right here. Read them. Then say what happened.'
        ),
    },
    {
        'slug': 'save_or_buy',
        'title': 'Save or buy',
        'skill_name': 'Spending decisions',
        'sort_order': 3,
        'student_prompt': (
            'Your balance is already shown. Pick a marketplace item and decide: '
            'buy it now, wait, or set it as a goal.'
        ),
        'staff_script': (
            'Have them pick a real item they can see. First: enough money or not. '
            'Second: if they spend it today, what do they give up? Done is a choice, '
            'not a lecture.'
        ),
        'teaching': (
            'Cash in your account spends once. Buy the item today and that money is '
            'not there for anything else.\n\n'
            'First question: do you have enough? If the price is bigger than your '
            'balance, you cannot buy it today.\n\n'
            'Second question: even if you have enough, is today the day? Waiting keeps '
            'the money. Setting a goal puts a target on it so you do not spend it by accident.\n\n'
            'There is no trick answer. Pick a real item and make the call.'
        ),
    },
    {
        'slug': 'opportunity_cost',
        'title': 'Opportunity cost',
        'skill_name': 'Tradeoffs',
        'sort_order': 4,
        'student_prompt': (
            'Your balance is already shown. Pick two items. If you cannot buy both, '
            'choose one and name what you are giving up.'
        ),
        'staff_script': (
            'Two items vs one balance. If they cannot buy both, make them pick and '
            'name the thing they are not getting. That name is the lesson.'
        ),
        'teaching': (
            'Opportunity cost is the thing you do not get because you picked the other thing.\n\n'
            'If your balance covers both items, there is no trade yet. If it does not, '
            'choosing A means B stays on the shelf. B is the cost.\n\n'
            'Name the thing you are giving up. That is the whole skill.'
        ),
    },
    {
        'slug': 'needs_vs_wants',
        'title': 'Needs vs wants',
        'skill_name': 'Prioritizing spending',
        'sort_order': 5,
        'student_prompt': (
            'Tag each item below as a need or a want. Then pick one want that could wait.'
        ),
        'staff_script': (
            'Use their purchases if they have them. No history: use catalog items. '
            'Do not argue the tags. Ask one follow-up: which want could wait?'
        ),
        'teaching': (
            'A need gets you through the week. Food. Something required. Something that '
            'keeps you from getting stuck.\n\n'
            'A want is the rest. Headphones. Extra snacks. Nice-to-have. Wants are allowed. '
            'They just should not empty the account before needs are covered.\n\n'
            'Tag each item. Then look at the wants and pick one that could wait.'
        ),
    },
    {
        'slug': 'savings_goal',
        'title': 'Set a savings goal',
        'skill_name': 'Saving',
        'sort_order': 6,
        'student_prompt': (
            'Last week’s take-home is already on this page. Pick a target and see how '
            'many paychecks it would take if you do not spend it first.'
        ),
        'staff_script': (
            'Help them pick one goal they actually care about. Use last week’s take-home '
            'to count weeks. They can change the goal later. Money is not locked.'
        ),
        'teaching': (
            'A savings goal is a number you are aiming at — a marketplace item or a '
            'dollar amount.\n\n'
            'Last week’s take-home is the pace. Divide the target by that paycheck and '
            'you get a rough count of weeks, if you do not spend it first.\n\n'
            'You are not locking the money. You are naming the target so you can see '
            'if you are getting closer.'
        ),
    },
]


def money_to_float(value):
    if value is None:
        return 0.0
    return float(Decimal(str(value)))
