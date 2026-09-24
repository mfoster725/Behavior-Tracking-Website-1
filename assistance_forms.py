"""Practice assistance applications modeled on real Minnesota paperwork.

Three forms, laid out like the real ones:
  snap    - Combined Application Form, DHS-5223-ENG 3-26 (SNAP / food help)
  health  - Application for Health Coverage and Help Paying Costs, DHS-6696-ENG 6-26
  housing - a county HRA Housing Choice Voucher (Section 8) pre-application

No real personal information: students write initials for names, their current
grade for a birth date, their lunch number for a Social Security number, and the
school's address for a home address. Sensitive questions (gender, pregnancy,
citizenship, race, disability, criminal history) are shown grayed out as
"Not collected in this class".

Every graded field must be right (100%) before the application is approved.
Students only learn which fields are wrong, never the right answers.
"""

from __future__ import annotations

import re
from datetime import datetime

from economy_lib import parse_money

SCHOOL_ADDRESS = {
    'street': '500 John St',
    'city': 'Starbuck',
    'state': 'MN',
    'zip': '56381',
    'county': 'Pope',
}

CLASS_RULES = [
    ('Name', 'Your initials. First name box: first initial. Last name box: last initial.'),
    ('Date of birth', 'Your current grade (for example, 10).'),
    ('Social Security number', 'Your lunch number.'),
    ('Address', 'The school: 500 John St, Starbuck, MN 56381 (Pope County).'),
    ('You', 'An adult living on your own who works at Manny\'s Market and files your own taxes.'),
    ('Pay', 'Use your most recent Weekly Earnings Record. A school day counts as 6 work hours.'),
    ('Rent and bills', 'Use this week\'s bills on the Bills page. Enter weekly amounts.'),
    ('Sign and date', 'Type your initials to sign. Date: today, as MM/DD/YYYY.'),
]

NOT_COLLECTED = 'Not collected in this class'

YES_NO = [('yes', 'Yes'), ('no', 'No')]


def f(field_id, label, answer=None, match='text', span=12, type='text', **extra):
    """Shorthand for a field. ``answer`` names a key in the expected-answers dict."""
    spec = {'id': field_id, 'label': label, 'type': type, 'span': span, 'answer': answer, 'match': match}
    spec.update(extra)
    return spec


def yn(field_id, label, answer, span=12, **extra):
    return f(field_id, label, answer=answer, match='choice', span=span, type='radio', options=YES_NO, **extra)


def off(field_id, label, span=12, **extra):
    return f(field_id, label, span=span, type='disabled', note=NOT_COLLECTED, **extra)


def opt(field_id, label, span=12, **extra):
    return f(field_id, label, span=span, optional=True, **extra)


FORMS = {
    'snap': {
        'program': 'snap',
        'style': 'caf',
        'title': 'Combined Application Form',
        'form_number': 'DHS-5223-ENG',
        'revision': '3-26',
        'agency': 'Minnesota Department of Human Services',
        'program_name': 'SNAP (food)',
        'benefit_summary': 'Help paying for groceries, taken off your weekly grocery bill.',
        'intro': 'If you need help filling out this application contact your local county or Tribal Nation office. '
                 'Sign and date the application on pages 1 and 12.',
        'sections': [
            {'id': 'person1', 'bar': 'PERSON 1', 'page': 1, 'rows': [
                [f('last_initial', "APPLICANT'S LEGAL NAME - LAST", 'last_initial', 'letters', 5, maxlength=3),
                 f('first_initial', 'FIRST NAME', 'first_initial', 'letters', 4, maxlength=3),
                 opt('middle_name', 'MIDDLE NAME', 3, maxlength=3)],
                [opt('other_names', 'OTHER NAMES YOU USE (family name, nickname, etc.)', 7),
                 f('ssn', 'SOCIAL SECURITY NUMBER (only if applying for help)', 'lunch_number', 'digits', 5)],
                [f('dob', 'DATE OF BIRTH', 'grade', 'int', 4),
                 off('gender', 'GENDER', 4),
                 f('marital', 'MARITAL STATUS*', 'marital_code', 'choice', 4, type='radio',
                   options=[('N', 'N'), ('M', 'M'), ('S', 'S'), ('L', 'L'), ('D', 'D'), ('W', 'W')])],
                [f('street', 'ADDRESS OF CURRENT RESIDENCE', 'street', 'address', 5),
                 opt('apt', 'APT. NUMBER', 2),
                 f('city', 'CITY', 'city', 'text', 2),
                 f('state', 'STATE', 'state', 'state', 1),
                 f('zip', 'ZIP CODE', 'zip', 'digits', 2)],
                [opt('mail_street', 'MAILING ADDRESS (If different from address where you live)', 7),
                 opt('mail_city', 'CITY', 3), opt('mail_zip', 'ZIP CODE', 2)],
                [yn('homeless', 'Do you consider yourself homeless?', 'no', 4),
                 yn('tribal', 'Do you live within the boundaries of a Tribal Nation?', 'no', 8)],
                [opt('phone', 'PRIMARY PHONE NUMBER', 4),
                 off('pregnant', 'Is anyone in your household pregnant?', 8)],
                [yn('interpreter', 'Do you need an interpreter?', 'no', 4),
                 f('spoken_language', 'What is your preferred spoken language?', 'language', 'text', 4),
                 f('written_language', 'What is your preferred written language?', 'language', 'text', 4)],
                [f('programs', 'What program(s) are you applying for?', 'programs_snap', 'set', 12, type='checkboxes',
                   options=[('snap', 'SNAP (food)'), ('cash', 'Cash programs'), ('emergency', 'Emergency Assistance'), ('none', 'None')])],
                [yn('hsp', 'Are you applying for Housing Support Program (HSP) benefits?', 'no', 12)],
            ],
                'legend': '*Marital status (choose one): N = Never married, M = Married living with spouse, '
                          'S = Separated, L = Legally separated, D = Divorced, W = Widowed'},
            {'id': 'expedited', 'box': 'Do you need help with food right away? Answer questions 1-6.', 'page': 1,
             'note': 'Optional. If you can get help right away, you will be contacted within 24 hours for an interview.',
             'rows': [
                 [opt('exp_income', '1. How much income did or will your household get this month? $', 12, type='money')],
                 [opt('exp_cash', '2. How much does your household have in cash, checking or savings? $', 12, type='money')],
                 [opt('exp_utilities', '3. What utilities do you pay?', 12, type='checkboxes',
                      options=[('heat', 'Heat'), ('ac', 'Air conditioning'), ('electricity', 'Electricity'), ('phone', 'Phone'), ('none', 'None')])],
                 [opt('exp_housing', '4. How much does your household pay for housing costs other than utilities? $', 12, type='money')],
             ]},
            {'id': 'sign1', 'statement': 'I have looked over my answers and believe they are all true and correct to the best of my knowledge.',
             'page': 1, 'rows': [
                 [f('signature1', 'SIGNATURE OF APPLICANT OR AUTHORIZED REPRESENTATIVE', 'initials', 'letters', 5, sign=True),
                  f('date1', 'DATE', 'today', 'date_today', 3, placeholder='MM/DD/YYYY'),
                  f('agency_sig', 'AGENCY/TRIBAL NATION SIGNATURE', span=2, type='agency'),
                  f('date_received', 'DATE RECEIVED', span=2, type='agency')],
             ]},
            {'id': 'person1_more', 'bar': 'PERSON 1 - Additional Information', 'page': 2, 'rows': [
                [off('citizenship', 'CITIZENSHIP', 6), yn('military', 'Have you served in the U.S. military?', 'no', 6)],
                [off('race', 'HISPANIC, LATINO OR SPANISH ORIGIN / RACE (optional)', 12)],
            ]},
            {'id': 'household', 'heading': 'Household', 'page': 5, 'rows': [
                [yn('q1_food', '1. Does everyone in your household buy, fix or eat food with you?', 'buys_food_together', 12,
                    hint='If you have a roommate who buys their own food, answer No.')],
                [off('q5_health', '5. Does anyone in the household have a health condition that limits the work they can do?', 12)],
            ]},
            {'id': 'income', 'heading': 'Income', 'page': 5, 'rows': [
                [yn('q9_job', '9. What kinds of income do you have? A job?', 'yes', 4),
                 yn('q9_self', 'Self-employment?', 'no', 4),
                 yn('q9_other', 'Any other source?', 'no', 4)],
            ]},
            {'id': 'income1', 'numbered': '1.', 'page': 6, 'rows': [
                [f('inc_who', 'Who receives this income?', 'initials', 'letters', 12)],
                [f('inc_type', 'Type of income', 'income_type', 'choice', 4, type='radio',
                   options=[('job', 'Job'), ('self', 'Self-employment'), ('other', 'Other')]),
                 f('inc_employer', 'EMPLOYER', 'employer', 'text', 8)],
                [f('inc_expect', 'Do you expect this income to:', 'income_expect', 'choice', 12, type='radio',
                   options=[('continue', 'Continue at the same amount'), ('change', 'Change'), ('end', 'End')])],
                [f('inc_hours', 'If work, average hours per week', 'hours_per_week', 'int', 6),
                 f('inc_gross', 'Gross amount received (amount before taxes/deductions)', 'weekly_gross', 'money', 6, type='money')],
                [f('inc_freq', 'How often received?', 'pay_frequency', 'choice', 12, type='radio',
                   options=[('weekly', 'Weekly'), ('biweekly', 'Every 2 weeks'), ('twice_month', 'Twice a month'), ('monthly', 'Monthly'), ('other', 'Other')])],
            ]},
            {'id': 'q10', 'page': 7, 'rows': [
                [yn('q10_quit', '10. In the last 60 days, did anyone quit a job, cut their hours, or go on strike?', 'no', 12)],
            ]},
            {'id': 'expenses', 'heading': '14. What kinds of expenses do you have, including seasonal charges? (Check all that apply.)',
             'page': 8, 'note': 'In this class, enter weekly amounts.', 'table': 'expenses', 'rows': [
                 [f('exp_rows', 'Expenses', 'expense_rows', 'set', 12, type='checkboxes',
                    options=[('rent', 'Rent'), ('lot', 'Mobile home lot rent'), ('mortgage', 'Mortgage/contract for deed payment'),
                             ('association', 'Association fees'), ('homeowners', "Homeowner's insurance"),
                             ('taxes', 'Real estate taxes'), ('board', 'Room and/or board'),
                             ('water', 'Water and sewer'), ('gas', 'Gas (Natural Gas/Propane)'),
                             ('electricity', 'Electricity'), ('fuel', 'Other fuel'), ('phone', 'Phone/cell phone')])],
                 [f('rent_amount', 'Rent: amount per week', 'rent_weekly', 'money', 6, type='money'),
                  f('rent_who', 'Rent: who pays?', 'initials', 'letters', 6, hint='Your initials')],
                 [yn('q14a', '14a. Do you receive a rental subsidy (ex: Section 8)?', 'has_housing_subsidy', 12)],
                 [yn('q14b', '14b. Did you or anyone in your household receive energy assistance of more than $20 in the past 12 months?', 'no', 12)],
             ]},
            {'id': 'assets', 'heading': '19. Does anyone in the household own any of the following? Bring or send proof.', 'page': 9, 'rows': [
                [yn('a_cash', 'Cash', 'no', 6), yn('a_bank', 'Bank accounts (savings, checking, debit card, etc.)', 'yes', 6)],
                [yn('a_card', 'Electronic payment card', 'no', 6), yn('a_stocks', 'Stocks, bonds, annuities, 401K, etc.', 'no', 6)],
                [yn('a_vehicle', 'Vehicles (cars, trucks, motorcycles, campers, trailers)', 'has_vehicle', 12)],
            ]},
            {'id': 'penalty', 'heading': 'Penalty warnings and qualification questions', 'page': 10, 'rows': [
                [off('penalty_q', 'Qualification questions 1-5 (past fraud, drug, or parole questions)', 12)],
            ]},
            {'id': 'sign12', 'heading': 'By signing:', 'page': 12,
             'note': 'You declare under penalty of perjury that everything on this application is true and correct, '
                     'and you agree to report changes. Giving false information can lead to fines, jail, and losing benefits.',
             'rows': [
                 [f('signature12', 'SIGNATURE OF APPLICANT OR AUTHORIZED REPRESENTATIVE', 'initials', 'letters', 8, sign=True),
                  f('date12', 'DATE', 'today', 'date_today', 4, placeholder='MM/DD/YYYY')],
                 [f('certify', 'I understand that giving false information can lead to penalties.', 'true', 'checked', 12, type='checkbox')],
             ]},
        ],
    },
    'health': {
        'program': 'health',
        'style': 'mhcp',
        'title': 'Application for Health Coverage and Help Paying Costs',
        'form_number': 'DHS-6696-ENG',
        'revision': '6-26',
        'agency': 'Minnesota Department of Human Services',
        'program_name': 'Medical Assistance (MA) and help paying for health insurance',
        'benefit_summary': 'Medical Assistance can pay your whole premium. Above its income limit, you may get a premium tax credit.',
        'intro': 'Complete Step 2 for yourself. Person 1 should be the contact person for the application.',
        'sections': [
            {'id': 'step2', 'step': 'STEP 2:', 'step_sub': 'PERSON 1', 'step_title': 'Start with yourself', 'page': 1, 'rows': [
                [f('first_initial', '1. FIRST NAME', 'first_initial', 'letters', 5, maxlength=3),
                 opt('middle_name', 'MIDDLE NAME', 2, maxlength=3),
                 f('last_initial', 'LAST NAME', 'last_initial', 'letters', 4, maxlength=3),
                 opt('suffix', 'SUFFIX', 1)],
                [f('dob', '2. DATE OF BIRTH (MM/DD/YYYY)', 'grade', 'int', 5),
                 off('sex', '3. SEX', 3),
                 f('marital', '4. MARITAL STATUS', 'marital', 'choice', 4, type='radio',
                   options=[('separated', 'Legally separated'), ('married', 'Married'), ('divorced', 'Divorced'),
                            ('widowed', 'Widowed'), ('never', 'Never married')])],
                [f('has_ssn', '5. Do you have a Social Security number (SSN)?', 'yes', 'choice', 6, type='radio',
                   options=[('yes', 'Yes'), ('no', 'No'), ('decline', 'Not applying and choose not to answer')]),
                 f('ssn', 'Yes - what is your SSN?', 'lunch_number', 'digits', 6)],
                [f('homeless', '6. Check here if you are homeless.', 'false', 'checked', 12, type='checkbox')],
                [f('street', '7a. HOME ADDRESS (Do not write a post office box number here.)', 'street', 'address', 9),
                 opt('apt', '7b. APARTMENT OR SUITE NUMBER', 3)],
                [f('city', '8. CITY', 'city', 'text', 5), f('state', '9. STATE', 'state', 'state', 2),
                 f('zip', '10. ZIP CODE', 'zip', 'digits', 2), f('county', '11. COUNTY', 'county', 'text', 3)],
                [opt('mail_street', '12. MAILING ADDRESS (if different from home address)', 12)],
                [opt('phone', '18. PHONE NUMBER (where we can call you)', 6), opt('phone2', '19. OTHER PHONE NUMBER', 6)],
                [f('spoken_language', '20a. YOUR PREFERRED SPOKEN LANGUAGE', 'language', 'text', 4),
                 f('written_language', '20b. YOUR PREFERRED WRITTEN LANGUAGE', 'language', 'text', 4),
                 yn('interpreter', '21. Do you need an interpreter?', 'no', 4)],
                [f('contact', '22. SELECT YOUR PREFERRED METHOD OF CONTACT ABOUT THIS APPLICATION', 'any', 'any_set', 12,
                   type='checkboxes', options=[('mail', 'U.S. Postal Mail'), ('email', 'Email Address')])],
                [yn('auth_rep', '23. Do you want someone to act on your behalf as an authorized representative?', 'no', 12)],
            ]},
            {'id': 'taxes', 'step': 'STEP 2:', 'step_sub': 'PERSON 1', 'step_title': '(Continue with yourself)', 'page': 2, 'rows': [
                [yn('tax_file', '24. Do you plan to file a federal income tax return next year?', 'yes', 12)],
                [yn('tax_joint', 'a. Will you file jointly with a spouse?', 'no', 4),
                 yn('tax_dependents', 'b. Will you claim any dependents on your tax return?', 'no', 4),
                 yn('tax_claimed', 'c. Will you be claimed as a dependent on someone else\'s tax return?', 'no', 4)],
                [yn('applying_self', '26. Are you applying for health coverage for yourself?', 'yes', 12)],
                [yn('res_home', '27. Do you plan to make Minnesota your home?', 'yes', 6),
                 yn('res_moved', 'Did you move to Minnesota in the last three months?', 'no', 6)],
                [off('citizen', '29. Are you a U.S. citizen or U.S. national?', 6),
                 yn('past_bills', '32. Do you want MA to pay medical bills from the past three months?', 'no', 6)],
            ]},
            {'id': 'jobs', 'heading': 'Recent Job Changes', 'page': 4, 'rows': [
                [f('job_changes', '33. In the past six months, did you do any of these things? (Check all that apply)', 'empty', 'set', 12,
                   type='checkboxes', options=[('change', 'Change jobs'), ('stop', 'Stop working'), ('fewer', 'Start working fewer hours or have a salary cut')])],
                [f('job_status', 'Current Job and Income Information (Check all that apply)', 'employed_set', 'set', 12,
                   type='checkboxes', options=[('employed', 'Employed'), ('self', 'Self-employed'), ('seasonal', 'Seasonally employed'), ('not', 'Not employed')])],
            ]},
            {'id': 'job1', 'heading': 'Current Job 1', 'page': 4, 'rows': [
                [f('employer', '34. EMPLOYER NAME', 'employer', 'text', 5),
                 f('employer_address', 'EMPLOYER ADDRESS', 'full_address', 'address_full', 4),
                 opt('ein', 'EMPLOYER IDENTIFICATION NUMBER (EIN)', 3)],
                [f('wage_amount', '35. TAXABLE WAGES AND TIPS (before taxes). a. Amount: $', 'weekly_gross', 'money', 6, type='money'),
                 f('wage_hours', 'b. Average hours worked each week', 'hours_per_week', 'int', 6)],
                [f('wage_freq', 'c. Frequency', 'pay_frequency', 'choice', 12, type='radio',
                   options=[('hourly', 'Hourly'), ('weekly', 'Weekly'), ('biweekly', 'Every two weeks'), ('twice_month', 'Twice a month'), ('monthly', 'Monthly'), ('yearly', 'Yearly')])],
            ]},
            {'id': 'other_income', 'heading': 'Other income', 'page': 5, 'rows': [
                [f('other_income', '40. OTHER INCOME (check all that apply; leave blank if none)', 'empty', 'set', 12, type='checkboxes',
                   options=[('unemployment', 'Unemployment'), ('social_security', 'Social Security'), ('interest', 'Interest'), ('other', 'Other taxable income')])],
                [f('adjustments', '41. ADJUSTMENTS TO INCOME (leave blank if none)', 'empty', 'set', 12, type='checkboxes',
                   options=[('educator', 'Educator expenses'), ('ira', 'IRA deduction'), ('student_loan', 'Student loan interest')])],
                [f('annual_income', '42. PROJECTED ANNUAL INCOME FOR 2026: My total income expected for 2026 will be: $', 'yearly_income', 'money', 12,
                   type='money', hint='A year has 52 weeks.')],
            ]},
            {'id': 'coverage', 'step': 'STEP 3', 'step_title': "Your Household's Health Coverage", 'page': 21, 'rows': [
                [yn('enrolled', '1. Is anyone now enrolled in health coverage?', 'yes', 12)],
                [f('coverage_type', 'Type of coverage (check all that apply)', 'coverage_set', 'set', 12, type='checkboxes',
                   options=[('ma', 'Medical Assistance'), ('mncare', 'MinnesotaCare'), ('medicare', 'Medicare'),
                            ('employer', 'Employer insurance'), ('private', 'Private or other insurance'), ('va', 'VA health care')])],
                [f('policyholder', "POLICYHOLDER'S NAME", 'initials', 'letters', 4),
                 f('insurer', 'INSURANCE COMPANY NAME', 'health_company', 'text', 4),
                 f('policy_name', 'NAME OF INSURANCE POLICY', 'health_plan', 'contains', 4)],
                [yn('offered_job_ins', '2. Is anyone offered health insurance through a job but not enrolled?', 'no', 6),
                 yn('injury', '3. Is anyone getting medical care for an accident or injury?', 'no', 6)],
            ]},
            {'id': 'household', 'step': 'STEP 4', 'step_title': 'Household Details', 'page': 21, 'rows': [
                [yn('out_of_state', 'Has anyone been out of Minnesota for more than 30 days in a row?', 'no', 6),
                 yn('military', 'Has anyone ever served in the military?', 'no', 6)],
            ]},
            {'id': 'changes', 'step': 'STEP 5', 'step_title': 'Household Changes', 'page': 23, 'rows': [
                [yn('unemployment_applied', 'Has anyone applied for unemployment benefits?', 'no', 6),
                 yn('family_changed', 'Has your family size changed?', 'no', 6)],
                [yn('income_down', "Has a tax filer's income gone down?", 'no', 6),
                 yn('filing_changed', 'Has tax filing status changed or will it change?', 'no', 6)],
            ]},
            {'id': 'sign', 'step': 'STEP 6', 'step_title': 'Read the notices and sign', 'page': 23,
             'note': 'By signing, you declare under penalty of perjury that the information on this application is true. '
                     'You agree to report changes. The penalty for lying on purpose can be up to 5 years in prison and/or a $10,000 fine.',
             'rows': [
                 [opt('renewal_years', 'Verifying Eligibility and Renewing Coverage: years we may use tax data', 12, type='radio',
                      options=[('5', '5 years'), ('4', '4 years'), ('3', '3 years'), ('2', '2 years'), ('1', '1 year'), ('none', 'Do not use')])],
                 [opt('voter', 'Do you want a voter registration form?', 12, type='radio', options=YES_NO)],
                 [f('signature', 'SIGNATURE', 'initials', 'letters', 8, sign=True),
                  f('date', 'DATE (MM/DD/YYYY)', 'today', 'date_today', 4, placeholder='MM/DD/YYYY')],
             ]},
        ],
    },
    'housing': {
        'program': 'housing',
        'style': 'hra',
        'title': 'HOUSING ASSISTANCE PRE-APPLICATION',
        'form_number': 'Section 8 pre-application',
        'revision': '06/26',
        'agency': 'Lakes Region Housing and Redevelopment Authority',
        'agency_address': 'Serving Pope and Douglas counties',
        'program_name': 'Housing Choice Voucher (Section 8)',
        'benefit_summary': 'You pay 30% of your income toward rent. The voucher pays the rest, taken off your weekly rent bill.',
        'warning': 'If we are UNABLE TO READ the application or if it is NOT FULLY COMPLETED the application will be returned for you to complete and turn back in.',
        'sections': [
            {'id': 'contact', 'page': 3, 'rows': [
                [f('full_name', 'Full Legal Name (First, Middle, Last)', 'initials', 'letters', 12)],
                [f('street', 'Physical Address', 'street', 'address', 9), opt('apt', 'Apt', 3)],
                [f('city', 'City', 'city', 'text', 5), f('state', 'State', 'state', 'state', 3), f('zip', 'Zip Code', 'zip', 'digits', 4)],
                [opt('mailing', 'Mailing Address if different', 12)],
                [opt('phone', 'Phone #', 4), opt('email', 'Email', 5), opt('other_contact', 'Other contact #', 3)],
                [yn('adult', 'Are you 18 years of age or older, or an emancipated minor under the age of 18?', 'yes', 12)],
                [yn('english', 'Is English your preferred language?', 'yes', 12)],
                [yn('county_school_work', 'Do you attend school or work in Pope County?', 'yes', 6),
                 yn('county_reside', 'Do you reside in Pope County?', 'yes', 6)],
                [yn('veteran', 'Are you a Veteran?', 'no', 12)],
                [off('screening', 'Federal screening questions (lifetime sex offender registration, methamphetamine conviction)', 12)],
            ]},
            {'id': 'waitlist', 'heading': 'PLEASE SPECIFY WHAT WAITING LIST YOU WOULD LIKE TO BE ON: You may apply for both', 'page': 3, 'rows': [
                [f('waitlists', 'Waiting lists', 'waitlist_set', 'set', 12, type='checkboxes',
                   options=[('section8', 'SECTION 8 (Housing Choice Voucher Program)'),
                            ('public', 'PUBLIC HOUSING: 3 and 4 bedroom rental units owned and managed by the HRA. 1 person households are not eligible.')])],
            ]},
            {'id': 'family', 'heading': 'Family Composition', 'page': 3,
             'note': 'List all family members, including yourself, who will live in the assisted unit.', 'table': 'family', 'rows': [
                 [f('member_name', '1. Household Members (Last name, first name, middle initial)', 'initials', 'letters', 4),
                  f('member_ssn', 'Social Security Number', 'lunch_number', 'digits', 3),
                  f('member_relationship', 'Relationship to Head', span=2, type='fixed', value='SELF'),
                  f('member_dob', 'Date of Birth', 'grade', 'int', 3)],
                 [off('member_other', 'Gender, Disabled (Y/N), Race, Ethnicity', 12)],
             ]},
            {'id': 'income', 'heading': 'Gross Annual Income (Before Taxes)', 'page': 4,
             'note': 'Provide the total amount of gross annual income (before taxes) for all family members from all sources.', 'rows': [
                 [f('income_name', "Household Member's Name", 'initials', 'letters', 4),
                  f('wages_annual', 'Wages Annual Amount', 'yearly_income', 'money', 4, type='money', hint='A year has 52 weeks.'),
                  opt('other_annual', 'Other Non-Wages Annual Amount', 4, type='money')],
                 [yn('worked_20', 'Has anyone in your household been employed an average of 20 hours a week for the past 6 mos?', 'yes', 8),
                  f('worked_who', 'If so who?', 'initials', 'letters', 4)],
                 [f('current_rent', 'Current Rent $ per week', 'rent_weekly', 'money', 6, type='money'),
                  f('landlord', 'Present landlord or Management Company', 'landlord', 'text', 6)],
             ]},
            {'id': 'certify', 'heading': 'Certify that all information provided on this application is correct:', 'page': 4,
             'note': 'I certify that all information given on this application is accurate and complete to the best of my knowledge. '
                     'I understand that false statements or information are punishable under Federal Law and are grounds for denial '
                     'of housing assistance.',
             'banner': 'ALL ADULT MEMBERS of the household MUST SIGN this form',
             'rows': [
                 [f('printed_name', 'Head of Household Printed Name', 'initials', 'letters', 4),
                  f('signature', 'Head of Household Signature', 'initials', 'letters', 5, sign=True),
                  f('date', 'Date', 'today', 'date_today', 3, placeholder='MM/DD/YYYY')],
             ]},
        ],
    },
}

PROGRAM_ORDER = ['snap', 'health', 'housing']


def form_spec(program):
    return FORMS.get(program)


def graded_fields(spec):
    for section in spec['sections']:
        for row in section['rows']:
            for field in row:
                if field.get('type') in ('disabled', 'agency', 'fixed', 'info') or field.get('optional'):
                    continue
                yield field


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------

def _letters(value):
    return re.sub(r'[^A-Za-z]', '', str(value or '')).upper()


def _digits(value):
    return re.sub(r'\D', '', str(value or ''))


def _norm_text(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


ADDRESS_WORDS = {
    'street': 'st', 'st': 'st', 'avenue': 'ave', 'ave': 'ave', 'road': 'rd', 'rd': 'rd',
    'drive': 'dr', 'dr': 'dr', 'north': 'n', 'south': 's', 'east': 'e', 'west': 'w',
    'minnesota': 'mn',
}


def _norm_address(value):
    words = re.findall(r'[a-z0-9]+', str(value or '').lower())
    return ''.join(ADDRESS_WORDS.get(w, w) for w in words)


def _parse_date(value):
    text = str(value or '').strip()
    for fmt in ('%m/%d/%Y', '%m-%d-%Y', '%m/%d/%y', '%Y-%m-%d'):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _as_set(value):
    if isinstance(value, (list, tuple, set)):
        return {str(v) for v in value if str(v)}
    if value in (None, ''):
        return set()
    return {str(value)}


def check_field(field, raw, expected):
    """True if the student's answer matches what the student's own records say.

    A list target means any of those answers is right (e.g. rent before or after a
    housing subsidy). A blank target means the school has no record to check against,
    so any answer counts.
    """
    match = field.get('match') or 'text'
    key = field.get('answer')
    if key in ('yes', 'no', 'true', 'false', 'any', 'empty'):
        target = {'yes': 'yes', 'no': 'no', 'true': True, 'false': False, 'any': None, 'empty': set()}[key]
    else:
        target = expected.get(key)
    if isinstance(target, list):
        return any(check_field(dict(field, answer='_one'), raw, {'_one': one}) for one in target)
    if match == 'any_set':
        return bool(_as_set(raw))
    if match in ('letters', 'digits', 'int', 'text') and (target is None or str(target).strip() == ''):
        return raw is not None and str(raw).strip() != ''
    if match == 'checked':
        return bool(raw) == bool(target)
    if match == 'set':
        return _as_set(raw) == _as_set(target)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return False
    if match == 'letters':
        return _letters(raw) == _letters(target) and _letters(target) != ''
    if match == 'digits':
        return _digits(raw) == _digits(target) and _digits(target) != ''
    if match == 'int':
        digits = _digits(raw)
        return digits != '' and str(int(digits)) == str(int(_digits(target) or '0'))
    if match == 'money':
        entered = parse_money(raw) if isinstance(raw, str) else raw
        try:
            return entered is not None and abs(float(entered) - float(target)) < 0.005
        except (TypeError, ValueError):
            return False
    if match == 'choice':
        return str(raw) == str(target)
    if match == 'state':
        return _norm_address(raw) == 'mn'
    if match == 'address':
        return _norm_address(raw) == _norm_address(target)
    if match == 'address_full':
        return _norm_address(raw) == _norm_address(target)
    if match == 'date_today':
        return _parse_date(raw) == target
    if match == 'contains':
        needle = _norm_text(target).replace('plan', '')
        return bool(needle) and needle in _norm_text(raw)
    return _norm_text(raw) == _norm_text(target) and _norm_text(target) != ''


def grade(program, answers, expected):
    """Return (results, score) where results maps field id -> True/False."""
    spec = form_spec(program)
    answers = answers if isinstance(answers, dict) else {}
    results = {}
    for field in graded_fields(spec):
        results[field['id']] = bool(check_field(field, answers.get(field['id']), expected))
    total = len(results) or 1
    correct = sum(1 for ok in results.values() if ok)
    return results, round(correct * 100 / total)


def public_spec(program):
    """Form spec for the browser, without the answer keys."""
    spec = form_spec(program)
    if not spec:
        return None
    out = {k: v for k, v in spec.items() if k != 'sections'}
    out['class_rules'] = [{'label': a, 'text': b} for a, b in CLASS_RULES]
    out['sections'] = []
    for section in spec['sections']:
        sec = {k: v for k, v in section.items() if k != 'rows'}
        sec['rows'] = []
        for row in section['rows']:
            sec['rows'].append([
                {k: v for k, v in field.items() if k not in ('answer', 'match')} for field in row
            ])
        out['sections'].append(sec)
    return out
