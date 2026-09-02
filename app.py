import os
import sys

# Windows + recent Python: SQLAlchemy import can block on WMI via platform.machine().
if sys.platform == 'win32':
    os.environ.setdefault('DISABLE_SQLALCHEMY_CEXT_RUNTIME', '1')
    import platform as _platform

    _platform_machine_orig = _platform.machine

    def _platform_machine_fast():
        arch = os.environ.get('PROCESSOR_ARCHITECTURE')
        if arch:
            return arch
        try:
            return _platform_machine_orig()
        except Exception:
            return 'AMD64'

    _platform.machine = _platform_machine_fast

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text, event, func, or_
from sqlalchemy.orm import selectinload, load_only, joinedload
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta, timezone
from functools import wraps
from decimal import Decimal
import re
import math
import secrets
import threading
import csv
import json
import time
import logging
import shutil
import copy
from types import SimpleNamespace
from io import StringIO, BytesIO
from urllib.parse import urlparse, urljoin
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import calendar as _calendar
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Optional: Google Sheets sync (install gspread, google-auth)
try:
    import gspread
    from google.oauth2.service_account import Credentials
    _GOOGLE_SHEETS_AVAILABLE = True
except ImportError:
    _GOOGLE_SHEETS_AVAILABLE = False

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import stripe as stripe_sdk
except ImportError:
    stripe_sdk = None

app = Flask(__name__)
SUMMARY_API_BUILD = 'frenzies-card-v3'
FRENZY_MISSING_LABEL = 'Not recorded'
# "Unknown" was never a real location option — only an old empty-field fallback in reports code.
_FRENZY_LEGACY_LOCATION_SENTINELS = frozenset({'unknown'})


def frenzy_label_or_missing(value):
    """Keep stored labels (including literal 'Unknown'); only empty/missing uses FRENZY_MISSING_LABEL."""
    if value is None:
        return FRENZY_MISSING_LABEL
    text = str(value).strip()
    return text if text else FRENZY_MISSING_LABEL


def frenzy_location_label(value):
    """Normalize frenzy location: blank or legacy 'Unknown' sentinel → Not recorded."""
    text = frenzy_label_or_missing(value)
    if text.casefold() in _FRENZY_LEGACY_LOCATION_SENTINELS:
        return FRENZY_MISSING_LABEL
    return text


def frenzy_purpose_labels_from_event(purpose1, purpose2=None):
    labels = []
    for purp in (purpose1, purpose2):
        text = (str(purp or '')).strip()
        if text:
            labels.append(text)
    return labels if labels else [FRENZY_MISSING_LABEL]


def frenzy_purpose_labels_from_info(info_data):
    labels = []
    purposes = (info_data or {}).get('purposes')
    if isinstance(purposes, list):
        labels.extend(purposes)
    for key in ('purpose1', 'purpose2'):
        p = (info_data or {}).get(key)
        if p:
            labels.append(p)
    cleaned = []
    seen = set()
    for label in labels:
        text = (str(label or '')).strip()
        if text and text not in seen:
            seen.add(text)
            cleaned.append(text)
    return cleaned if cleaned else [FRENZY_MISSING_LABEL]


def _env_truthy(name):
    return os.environ.get(name, '').strip().lower() in ('1', 'true', 'yes')


# Database configuration: PostgreSQL on Render/production; SQLite for local dev by default.
# Locally, DATABASE_URL in your shell (e.g. from Aiven setup) is ignored unless USE_POSTGRES=1.
# Force SQLite: USE_LOCAL_DB=1. Force Postgres locally: USE_POSTGRES=1 + DATABASE_URL.
database_url = os.environ.get('DATABASE_URL')
_on_render = bool(os.environ.get('RENDER') or os.environ.get('RENDER_EXTERNAL_URL'))
use_postgres_db = bool(
    database_url
    and not _env_truthy('USE_LOCAL_DB')
    and (_on_render or _env_truthy('USE_POSTGRES'))
)

if use_postgres_db:
    # Aiven/Render/Neon provide postgres:// or postgresql://; SQLAlchemy needs postgresql+psycopg:// for psycopg3
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql+psycopg://', 1)
    elif database_url.startswith('postgresql://') and '+psycopg' not in database_url:
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    
    # Production Postgres (Aiven, Render, etc.) requires SSL - add if not already present
    if 'sslmode' not in database_url.lower():
        separator = '&' if '?' in database_url else '?'
        database_url = f"{database_url}{separator}sslmode=require"
    # On Windows, SSL "certificate verify failed" with Aiven: use Aiven's CA. Set DB_SSL_ROOT_CERT to path to the downloaded CA .pem file.
    ssl_root_cert = os.environ.get('DB_SSL_ROOT_CERT')
    if ssl_root_cert and os.path.isfile(ssl_root_cert):
        cert_path = os.path.abspath(ssl_root_cert).replace('\\', '/')
        database_url = re.sub(r'([?&])sslmode=[^&]*', r'\1sslmode=verify-ca', database_url, flags=re.IGNORECASE)
        database_url = f"{database_url}&sslrootcert={cert_path}"
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    # Configure connection pool for production (Flask-SQLAlchemy uses these via SQLALCHEMY_ENGINE_OPTIONS)
    pool_size = int(os.environ.get('DB_POOL_SIZE', 5))
    engine_options = {
        'pool_size': pool_size,
        'pool_recycle': 300,
        'pool_pre_ping': True,
    }
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = engine_options
else:
    # Local development: use a non-OneDrive local DB path by default on Windows.
    project_root = os.path.dirname(os.path.abspath(__file__))
    instance_path = os.path.join(project_root, 'instance')
    os.makedirs(instance_path, exist_ok=True)

    local_appdata = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    default_local_db_dir = os.path.join(local_appdata, 'BehaviorTracking')
    local_db_dir = os.environ.get('LOCAL_DB_DIR', default_local_db_dir)
    os.makedirs(local_db_dir, exist_ok=True)

    legacy_db_path = os.path.join(instance_path, "behavior_tracking.db")
    local_db_path = os.path.join(local_db_dir, "behavior_tracking.db")

    # Optional: use test DB for seeding (run with USE_TEST_DB=1 to use behavior_tracking_test.db)
    if os.environ.get('USE_TEST_DB') or os.environ.get('TEST_DATABASE_URI'):
        test_uri = os.environ.get('TEST_DATABASE_URI')
        if test_uri:
            app.config['SQLALCHEMY_DATABASE_URI'] = test_uri
        else:
            test_db_path = os.path.join(instance_path, "behavior_tracking_test.db").replace("\\", "/")
            app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{test_db_path}'
    else:
        # One-time migration: move existing DB from project instance folder to local non-OneDrive path.
        if os.path.exists(legacy_db_path) and not os.path.exists(local_db_path):
            try:
                shutil.move(legacy_db_path, local_db_path)
                print(f"Moved SQLite DB to local path: {local_db_path}")
            except Exception as move_err:
                print(f"Warning: failed to move DB to local path ({move_err}); using legacy path.")
                local_db_path = legacy_db_path
        elif not os.path.exists(local_db_path) and os.path.exists(legacy_db_path):
            local_db_path = legacy_db_path
        app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{local_db_path}'

if use_postgres_db:
    print('Database: PostgreSQL (DATABASE_URL)', flush=True)
else:
    _sqlite_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    print(f'Database: SQLite ({_sqlite_path})', flush=True)
    print(f'Summary API build: {SUMMARY_API_BUILD}', flush=True)
    if database_url and not _on_render:
        print(
            'Note: DATABASE_URL is set in your environment but ignored for local dev. '
            'Use USE_POSTGRES=1 to connect to Postgres locally.',
            flush=True,
        )

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=[],
    storage_uri=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
)


def _login_attempt_key():
    """Rate-limit password guesses per username so a shared school IP is not one bucket."""
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    if username:
        return f"login-user:{username}"
    return get_remote_address()

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '').strip()
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '').strip()
STRIPE_PRICE_LOOKUP_KEY = os.environ.get('STRIPE_PRICE_LOOKUP_KEY', 'monthly').strip() or 'monthly'
STRIPE_BUILD_FEE_LOOKUP_KEY = os.environ.get('STRIPE_BUILD_FEE_LOOKUP_KEY', 'build_fee').strip() or 'build_fee'
# Optional fallbacks while migrating off hardcoded Price IDs.
STRIPE_PRICE_ID = os.environ.get('STRIPE_PRICE_ID', '').strip()
STRIPE_BUILD_FEE_PRICE_ID = os.environ.get('STRIPE_BUILD_FEE_PRICE_ID', '').strip()
if stripe_sdk is not None and STRIPE_SECRET_KEY:
    stripe_sdk.api_key = STRIPE_SECRET_KEY
_STRIPE_PRICE_CACHE = {}
_STRIPE_PRICE_CACHE_TTL = 60

# Render/production sits behind a reverse proxy; trust X-Forwarded-* for HTTPS and cookies.
if use_postgres_db:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'


@app.after_request
def _disable_browser_html_cache(response):
    """Avoid stale index.html keeping an old app.js ?v= query string after deploys."""
    content_type = (response.content_type or '').split(';', 1)[0].strip().lower()
    if content_type == 'text/html':
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response


@login_manager.unauthorized_handler
def unauthorized():
    """Return JSON for API routes so fetch() does not follow an HTML login redirect."""
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Authentication required', 'login_required': True}), 401
    return redirect(url_for('login', next=request.url))


@app.errorhandler(429)
def _ratelimit_error(e):
    description = getattr(e, 'description', None) or str(e)
    return jsonify({'error': f'Too many requests. {description}'}), 429


@app.errorhandler(500)
def _api_internal_error(e):
    original = getattr(e, 'original_exception', None) or e
    app.logger.exception('Unhandled server error on %s', getattr(request, 'path', ''))
    if request.path.startswith('/api/'):
        text = str(original).strip()
        name = type(original).__name__
        return jsonify({'error': f'{name}: {text}' if text else name}), 500
    return ('Internal Server Error', 500)

# SQLite performance tuning for local development.
# Safe no-op for Postgres environments.
if str(app.config.get('SQLALCHEMY_DATABASE_URI', '')).startswith('sqlite'):
    with app.app_context():
        _sqlite_engine = db.engine

    @event.listens_for(_sqlite_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA temp_store=MEMORY")
            # Negative cache_size means kibibytes; -65536 ~= 64MB page cache.
            cursor.execute("PRAGMA cache_size=-65536")
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()

# Audit Logging Setup
audit_log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(audit_log_dir, exist_ok=True)

audit_logger = logging.getLogger('audit')
audit_logger.setLevel(logging.INFO)
audit_handler = logging.FileHandler(
    os.path.join(audit_log_dir, 'audit.log'),
    encoding='utf-8'
)
audit_formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
audit_handler.setFormatter(audit_formatter)
audit_logger.addHandler(audit_handler)
audit_logger.propagate = False  # Don't propagate to root logger

# Audit logging function
def log_phi_access(action, user_id=None, username=None, role=None, resource_type=None, resource_id=None, details=None, ip_address=None):
    """
    Log access to sensitive data for audit purposes.
    
    Args:
        action: Action performed (e.g., 'VIEW', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT')
        user_id: ID of the user performing the action
        username: Username of the user
        role: Role of the user (student, staff, admin, parent)
        resource_type: Type of resource accessed (e.g., 'students', 'daily_records', 'period_records')
        resource_id: ID of the specific resource (optional)
        details: Additional details about the action (optional)
        ip_address: IP address of the user (optional)
    """
    log_message = f"ACTION={action}"
    if user_id is not None:
        log_message += f" | USER_ID={user_id}"
    if username:
        log_message += f" | USERNAME={username}"
    if role:
        log_message += f" | ROLE={role}"
    if resource_type:
        log_message += f" | RESOURCE_TYPE={resource_type}"
    if resource_id is not None:
        log_message += f" | RESOURCE_ID={resource_id}"
    if details:
        log_message += f" | DETAILS={details}"
    if ip_address:
        log_message += f" | IP={ip_address}"
    
    audit_logger.info(log_message)


# User loader for Flask-Login
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Role-based access control decorators
def staff_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentication required'}), 401
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Staff or admin access required'}), 403
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentication required'}), 401
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated_function


def api_json_errors(f):
    """Ensure uncaught API exceptions return JSON (not Flask HTML error pages)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            app.logger.exception('API error in %s', f.__name__)
            return jsonify({'error': f'Failed to complete {f.__name__}', 'detail': str(e)}), 500
    return decorated

# Helper Functions
def has_student_access(user, student_id):
    """
    Check if a user has access to a specific student.
    Returns True if:
    - User is admin (has access to all students)
    - User is a student and it's their own student_id
    - User is regular staff (not outside staff) - has access to all
    - User is outside staff and the student is assigned to them
    """
    if user.role == 'admin':
        return True
    if user.role == 'student':
        return user.student_id == student_id
    if user.role == 'staff':
        if user.is_outside_staff:
            # Check if student is assigned to this outside staff user
            return OutsideStaffStudent.query.filter_by(
                user_id=user.id,
                student_id=student_id
            ).first() is not None
        else:
            # Regular staff has access to all students
            return True
    return False


def get_support_team_user_ids(student_id):
    """
    Return set of user_ids who are on the student's support team.
    Support team = staff users matched from team_members for this student (by name or username).
    Does not include admins or outside-staff assignments unless they appear in team_members.
    """
    team_members = TeamMember.query.filter_by(student_id=student_id).all()
    team_member_user_ids = set()
    for tm in team_members:
        if not (tm.name and str(tm.name).strip()):
            continue
        name_or_username = str(tm.name).strip()
        u = User.query.filter(
            User.role == 'staff',
            db.or_(
                db.func.lower(User.name) == db.func.lower(name_or_username),
                db.func.lower(User.username) == db.func.lower(name_or_username)
            )
        ).first()
        if u:
            team_member_user_ids.add(u.id)
    return team_member_user_ids


def user_is_on_student_support_team(user, student_id):
    """True if user is on the student's support team (team_members row only)."""
    if not user or not student_id:
        return False
    if user.role == 'student':
        return user.student_id == student_id
    if user.role != 'staff':
        return False
    return user.id in get_support_team_user_ids(student_id)


def get_case_manager_user_ids_for_student(student_id):
    """
    Return set of user_ids for case managers associated with a student, based on the
    student's support team.

    Case managers are staff with designation 'Case Manager' who appear on the student's
    support team (derived from TeamMember + OutsideStaffStudent + admins).
    """
    support_ids = get_support_team_user_ids(student_id)
    if not support_ids:
        return set()
    case_managers = User.query.filter(
        User.id.in_(support_ids),
        User.role == 'staff',
        User.designation == 'Case Manager'
    ).all()
    return {cm.id for cm in case_managers}


def get_student_ids_for_staff_user(user):
    """
    Return set of student_ids for which the given staff user appears in the student's
    team_members (by name or username). Used to determine when two staff are on the
    same student team.
    """
    if not user or user.role != 'staff':
        return set()
    identifiers = []
    for val in (user.name, user.username):
        if val and str(val).strip():
            identifiers.append(str(val).strip().lower())
    if not identifiers:
        return set()
    team_members = TeamMember.query.filter(
        db.or_(*[db.func.lower(TeamMember.name) == ident for ident in identifiers])
    ).all()
    return {tm.student_id for tm in team_members if tm.student_id}


def are_users_on_same_student_team(user_a, user_b):
    """
    Return True if two staff users share at least one student in common in the
    student users table (i.e., both appear as team members for the same student).
    Admins are considered on a team with any case manager.
    """
    if not user_a or not user_b:
        return False
    if user_a.id == user_b.id:
        return True
    if user_a.role == 'admin' or user_b.role == 'admin':
        return True
    if user_a.role != 'staff' or user_b.role != 'staff':
        return False
    students_a = get_student_ids_for_staff_user(user_a)
    if not students_a:
        return False
    students_b = get_student_ids_for_staff_user(user_b)
    if not students_b:
        return False
    return bool(students_a & students_b)


def utc_isoformat(value):
    """Serialize naive UTC datetimes from the DB for API clients (ISO-8601 with Z suffix)."""
    if value is None:
        return None
    if not isinstance(value, datetime):
        return None
    dt = value
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec='seconds') + 'Z'


def student_grade_matches_item_grade_range(student_grade, item_grade_range):
    """Return True if student's grade can see item with given grade_range (k_3, 4_8, 9_12, school_wide)."""
    if not student_grade:
        return False
    if item_grade_range == 'school_wide':
        return True
    g = str(student_grade).strip().upper()
    if item_grade_range == 'k_3':
        return g in ('K', '1', '2', '3')
    if item_grade_range == '4_8':
        return g in ('4', '5', '6', '7', '8')
    if item_grade_range == '9_12':
        return g in ('9', '10', '11', '12')
    return False


def marketplace_hidden_rule_label(rule):
    """Human-readable label for a marketplace hidden rule."""
    if rule.hidden_type == 'student':
        try:
            sid = int(rule.value)
        except (TypeError, ValueError):
            return f'Student #{rule.value}'
        student = Student.query.get(sid)
        if student:
            return f'Student: {student.name or f"#{sid}"}'
        return f'Student #{rule.value}'
    if rule.hidden_type == 'card_color':
        value = (rule.value or '').strip()
        return f'Card color: {value.capitalize()}' if value else 'Card color'
    if rule.hidden_type == 'grade_section':
        return f'Grade section: {rule.value}'
    return rule.value or ''


def is_item_hidden_for_student(item_id, student):
    """Return True if the item is hidden for this student (by any hidden rule)."""
    if not student:
        return False
    rules = MarketplaceItemHiddenRule.query.filter_by(item_id=item_id).all()
    for r in rules:
        if r.hidden_type == 'student' and str(r.value) == str(student.id):
            return True
        if r.hidden_type == 'card_color' and (student.card_color or '').strip().lower() == (r.value or '').strip().lower():
            return True
        if r.hidden_type == 'grade_section':
            rv = (r.value or '').strip()
            # Section rules: K-3, 4-8, 9-12
            if rv == 'K-3' and student_grade_matches_item_grade_range(student.grade, 'k_3'):
                return True
            if rv == '4-8' and student_grade_matches_item_grade_range(student.grade, '4_8'):
                return True
            if rv == '9-12' and student_grade_matches_item_grade_range(student.grade, '9_12'):
                return True
            # Legacy: single-grade rule (exact match)
            if (student.grade or '').strip() == rv:
                return True
    return False


def is_case_manager(user):
    """True if user can create/approve marketplace items (Case Manager designation)."""
    return user.role in ('staff', 'admin') and getattr(user, 'designation', None) == 'Case Manager'


def can_manage_level_ups(user):
    """True if user can see/use the Level Up action (admins and Case Managers)."""
    if not user:
        return False
    if getattr(user, 'role', None) == 'admin':
        return True
    return is_case_manager(user)


# Password validation
def validate_password_strength(password):
    """
    Validate password strength.
    Returns (is_valid, error_message) tuple.
    """
    if not password:
        return False, 'Password is required'
    
    if len(password) < 6:
        return False, 'Password must be at least 6 characters long'
    
    # Optional: Add more strength requirements
    # if not re.search(r'[A-Z]', password):
    #     return False, 'Password must contain at least one uppercase letter'
    # if not re.search(r'[a-z]', password):
    #     return False, 'Password must contain at least one lowercase letter'
    # if not re.search(r'\d', password):
    #     return False, 'Password must contain at least one number'
    
    return True, None

# Helper function to filter students based on directory information opt-out
def filter_directory_info(students, include_opted_out=False):
    """
    Filter students based on directory information opt-out status.
    
    Args:
        students: List or query result of Student objects
        include_opted_out: If True, include all students (for internal educational use).
                          If False, exclude students who opted out (for public directory information).
    
    Returns:
        Filtered list of students
    """
    if include_opted_out:
        # For internal educational purposes, include all students
        return students
    
    # For public directory information, exclude opted-out students
    if isinstance(students, list):
        return [s for s in students if not s.directory_info_opt_out]
    else:
        # If it's a query object, filter it
        return students.filter(Student.directory_info_opt_out == False)

# Database Models
class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))  # Full name of the user
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'student', 'staff', 'admin', or 'parent'
    designation = db.Column(db.String(50))  # 'Case Manager', 'Practitioner', 'Paraprofessional', 'Professional', 'Admin'
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=True)
    is_outside_staff = db.Column(db.Boolean, default=False, nullable=False)  # True for Outside Staff users
    district = db.Column(db.String(100), nullable=True)  # District name for Outside Staff
    claimed_student_name = db.Column(db.String(200), nullable=True)  # Parent self-registration: name they gave
    claimed_relationship = db.Column(db.String(50), nullable=True)  # Parent self-registration: relationship
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # JSON-encoded per-user UI preferences (non-PHI, e.g., hidden sections)
    ui_preferences = db.Column(db.Text, nullable=True)
    # Grades taught by teachers/case managers (e.g. "9, 10, 11" or "9-12")
    grades_taught = db.Column(db.String(50), nullable=True)
    # Paraprofessional: link to a Case Manager; "Show students managed by me" shows that CM's students
    linked_case_manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    # Staff import: external identifier from CSV
    user_number = db.Column(db.String(50), nullable=True)
    # Imported staff must change their generated password after first login
    must_change_password = db.Column(db.Boolean, default=False, nullable=False)
    # Hidden from User Management tables; still a real DB user and can log in
    hidden_from_management = db.Column(db.Boolean, default=False, nullable=False)
    # Contact email for user management and future notifications
    email = db.Column(db.String(200), nullable=True)
    
    # Relationship to student (for student users)
    student = db.relationship('Student', backref='user_account', foreign_keys=[student_id])
    
    # Relationship to assigned students (for Outside Staff)
    assigned_students = db.relationship('OutsideStaffStudent', backref='user', lazy=True, cascade='all, delete-orphan')
    # Relationship to parent-student relationships (for Parents)
    parent_student_relationships = db.relationship('ParentStudent', foreign_keys='ParentStudent.parent_user_id', backref='parent_user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)
    
    def get_designations_list(self):
        """Get list of all applicable designations based on primary designation"""
        if not self.designation:
            return []
        
        # Map primary designation to all applicable designations
        designation_map = {
            'Case Manager': ['Case Manager', 'Teacher'],
            'Practitioner': ['Practitioner', 'Group Leader'],
            'Paraprofessional': ['Paraprofessional'],
            'Professional': ['Professional'],
            'Admin': ['Admin']
        }
        
        return designation_map.get(self.designation, [])


# One-time Postgres migration: ensure ui_preferences column exists in production
def ensure_ui_preferences_column():
    """
    Ensure the ui_preferences column exists on the users table in Postgres.
    Safe to run multiple times thanks to IF NOT EXISTS.
    """
    # Only run when using external Postgres (Aiven, Render, etc.)
    if not use_postgres_db:
        return

    try:
        with app.app_context():
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_preferences TEXT"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS grades_taught VARCHAR(50)"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_case_manager_id INTEGER REFERENCES users(id)"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS user_number VARCHAR(50)"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_management BOOLEAN DEFAULT FALSE"
                ))
                conn.execute(text(
                    "ALTER TABLE students ADD COLUMN IF NOT EXISTS lunch_number VARCHAR(50)"
                ))
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(200)"
                ))
                conn.commit()
    except Exception as e:
        # Log but don't crash the app if migration fails
        app.logger.warning(f"Failed to ensure ui_preferences column exists: {e}")


# Run the migration once when the app starts up in a Postgres environment
ensure_ui_preferences_column()


def ensure_hidden_from_management_column():
    """Add users.hidden_from_management on SQLite and Postgres if it is missing."""
    try:
        with app.app_context():
            from sqlalchemy import inspect
            inspector = inspect(db.engine)
            if 'users' not in inspector.get_table_names():
                return
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'hidden_from_management' in columns:
                return
            is_postgres = 'postgresql' in str(db.engine.url).lower()
            with db.engine.connect() as conn:
                if is_postgres:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_management BOOLEAN DEFAULT FALSE NOT NULL"
                    ))
                else:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN hidden_from_management BOOLEAN DEFAULT 0 NOT NULL"
                    ))
                conn.commit()
    except Exception as e:
        try:
            app.logger.warning(f"Failed to ensure hidden_from_management column exists: {e}")
        except Exception:
            print(f"Failed to ensure hidden_from_management column exists: {e}")


ensure_hidden_from_management_column()


def ensure_schedule_recurrence_columns():
    """Add schedule recurrence columns on SQLite and Postgres if missing."""
    try:
        with app.app_context():
            from sqlalchemy import inspect
            inspector = inspect(db.engine)
            if 'schedules' not in inspector.get_table_names():
                return
            columns = {col['name'] for col in inspector.get_columns('schedules')}
            is_postgres = 'postgresql' in str(db.engine.url).lower()
            additions = []
            if 'recurrence_type' not in columns:
                additions.append(
                    "recurrence_type VARCHAR(20) DEFAULT 'daily'"
                    if is_postgres
                    else "recurrence_type VARCHAR(20) DEFAULT 'daily'"
                )
            if 'weekdays' not in columns:
                additions.append('weekdays TEXT')
            if 'month_ordinal' not in columns:
                additions.append('month_ordinal VARCHAR(10)')
            if 'biweekly_anchor' not in columns:
                additions.append('biweekly_anchor DATE')
            if 'effective_start' not in columns:
                additions.append('effective_start DATE')
            if 'effective_end' not in columns:
                additions.append('effective_end DATE')
            if not additions:
                return
            with db.engine.connect() as conn:
                for ddl in additions:
                    col_name = ddl.split()[0]
                    if is_postgres:
                        conn.execute(text(
                            f"ALTER TABLE schedules ADD COLUMN IF NOT EXISTS {ddl}"
                        ))
                    else:
                        # SQLite has no IF NOT EXISTS for ADD COLUMN; skip if present
                        if col_name in columns:
                            continue
                        conn.execute(text(f"ALTER TABLE schedules ADD COLUMN {ddl}"))
                conn.commit()
    except Exception as e:
        try:
            app.logger.warning(f"Failed to ensure schedule recurrence columns exist: {e}")
        except Exception:
            print(f"Failed to ensure schedule recurrence columns exist: {e}")


ensure_schedule_recurrence_columns()


def ensure_user_email_column():
    """Add users.email on SQLite and Postgres if it is missing."""
    try:
        with app.app_context():
            from sqlalchemy import inspect
            inspector = inspect(db.engine)
            if 'users' not in inspector.get_table_names():
                return
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'email' in columns:
                return
            is_postgres = 'postgresql' in str(db.engine.url).lower()
            with db.engine.connect() as conn:
                if is_postgres:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(200)"
                    ))
                else:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN email VARCHAR(200)"
                    ))
                conn.commit()
    except Exception as e:
        try:
            app.logger.warning(f"Failed to ensure users.email column exists: {e}")
        except Exception:
            print(f"Failed to ensure users.email column exists: {e}")


ensure_user_email_column()


def ensure_frenzy_severity_column():
    """
    Ensure frenzy_events.severity exists in Postgres and backfill NULL to 1 (Para).
    Safe to run multiple times thanks to IF NOT EXISTS.
    """
    if not use_postgres_db:
        return

    try:
        with app.app_context():
            with db.engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE frenzy_events ADD COLUMN IF NOT EXISTS severity INTEGER"
                ))
                conn.execute(text(
                    "UPDATE frenzy_events SET severity = 1 WHERE severity IS NULL"
                ))
                conn.commit()
    except Exception as e:
        app.logger.warning(f"Failed to ensure frenzy_events.severity column exists: {e}")


ensure_frenzy_severity_column()


def ensure_daily_query_indexes():
    """Create missing indexes used by daily overview queries."""
    try:
        with app.app_context():
            with db.engine.connect() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_daily_records_date ON daily_records (date)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_daily_records_student_id ON daily_records (student_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_daily_records_student_date ON daily_records (student_id, date)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_period_records_daily_record_id ON period_records (daily_record_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_frenzy_events_daily_record_id ON frenzy_events (daily_record_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_infractions_period_record_id ON infractions (period_record_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_checkpoints_date ON checkpoints (date)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_checkpoint_students_student_id ON checkpoint_students (student_id)"
                ))
                conn.commit()
    except Exception as e:
        app.logger.warning(f"Failed to ensure daily query indexes: {e}")


def ensure_point_card_submit_schema():
    """Add daily_records.submitted_at if the column is missing."""
    try:
        from sqlalchemy import inspect
        inspector = inspect(db.engine)
        if 'daily_records' not in inspector.get_table_names():
            return
        columns = [col['name'] for col in inspector.get_columns('daily_records')]
        if 'submitted_at' in columns:
            return
        with db.engine.connect() as conn:
            conn.execute(text('ALTER TABLE daily_records ADD COLUMN submitted_at TIMESTAMP'))
            conn.commit()
        print('Migration complete: submitted_at column added to daily_records', flush=True)
    except Exception as e:
        print(f'Point card submit schema check: {e}', flush=True)


def _school_tz():
    name = (os.environ.get('SCHOOL_TIMEZONE') or 'America/Chicago').strip() or 'America/Chicago'
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:
        return timezone(timedelta(hours=-5))


# Nightly submit: 11:15pm school time (matches the external cron job).
POINT_CARD_SUBMIT_HOUR = 23
POINT_CARD_SUBMIT_MINUTE = 15


def school_now():
    return datetime.now(_school_tz())


def is_past_point_card_submit_time(record_date):
    if not record_date:
        return False
    now = school_now()
    submit_at = datetime(
        record_date.year, record_date.month, record_date.day,
        POINT_CARD_SUBMIT_HOUR, POINT_CARD_SUBMIT_MINUTE, 0,
        tzinfo=now.tzinfo,
    )
    return now >= submit_at


def _dates_due_for_point_card_submit():
    now = school_now()
    today = now.date()
    dates = []
    if is_past_point_card_submit_time(today):
        dates.append(today)
    for days_ago in range(1, 8):
        dates.append(today - timedelta(days=days_ago))
    return dates


POINT_CARD_PERIODS = (
    ('AM Bus', 'Bus'),
    ('7:45-8:30', 'Bkfst'),
    ('8:30-9:00', 'English'),
    ('9:00-9:30', 'Math'),
    ('9:30-10:00', 'Science'),
    ('10:00-10:30', 'Group'),
    ('10:30-11:00', 'Group'),
    ('11:00-11:30', 'Individual'),
    ('11:30-12:00', 'Lunch'),
    ('12:00-12:30', 'Phys Ed'),
    ('12:30-1:00', 'Social'),
    ('1:00-1:30', 'Individual'),
    ('1:30-2:00', 'Studio'),
    ('2:00-2:30', 'Studio'),
    ('2:30-2:45', 'Homeroom'),
    ('PM Bus', 'Bus'),
)
POINT_CARD_TIME_RANGES = tuple(time_range for time_range, _location in POINT_CARD_PERIODS)
POINT_CARD_DEFAULT_LOCATIONS = dict(POINT_CARD_PERIODS)

# School-day clock helpers for student transitions (arrive/leave split).
# AM Bus ends at first bell; PM Bus starts at last bell. 1:00–6:59 on the
# labeled grid is afternoon.
_TRANSITION_CLOCK_RE = re.compile(r'^(\d{1,2}):(\d{2})$')
_TRANSITION_RANGE_RE = re.compile(r'^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$')
_FIRST_BELL_MINUTES = 7 * 60 + 45
_LAST_BELL_MINUTES = 14 * 60 + 45


def _clock_token_to_minutes(token, *, afternoon_hint=False):
    """Parse '7:45', '10:00', or '13:30' into minutes from midnight."""
    raw = (token or '').strip().lower().replace('a.m.', '').replace('p.m.', '')
    raw = raw.replace('am', '').replace('pm', '').strip()
    match = _TRANSITION_CLOCK_RE.match(raw)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    if hour > 12:
        return hour * 60 + minute
    if hour == 12:
        return 12 * 60 + minute
    if hour <= 6 or afternoon_hint:
        hour += 12
    return hour * 60 + minute


def _normalize_transition_time(raw):
    minutes = _clock_token_to_minutes(raw)
    if minutes is None:
        return None
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def _period_start_end_minutes(time_period):
    label = (time_period or '').strip()
    if not label:
        return None
    lowered = label.lower()
    if lowered == 'am bus':
        return (_FIRST_BELL_MINUTES - 45, _FIRST_BELL_MINUTES)
    if lowered == 'pm bus':
        return (_LAST_BELL_MINUTES, _LAST_BELL_MINUTES + 30)
    match = _TRANSITION_RANGE_RE.match(label)
    if not match:
        return None
    start = _clock_token_to_minutes(match.group(1))
    end = _clock_token_to_minutes(
        match.group(2),
        afternoon_hint=(start is not None and start >= 12 * 60),
    )
    if start is None or end is None:
        return None
    if end <= start:
        end = _clock_token_to_minutes(match.group(2), afternoon_hint=True) or end
    return (start, end)


def is_home_period(transition, time_period):
    """True when this school owns the period. No transition → all periods are ours."""
    if not transition:
        return True
    bounds = _period_start_end_minutes(time_period)
    if not bounds:
        return True
    start, end = bounds
    if isinstance(transition, dict):
        time_value = transition.get('time')
        direction = (transition.get('direction') or '').strip().lower()
    else:
        time_value = getattr(transition, 'time', None)
        direction = (getattr(transition, 'direction', None) or '').strip().lower()
    split_at = _clock_token_to_minutes(time_value)
    if split_at is None:
        return True
    if direction == 'arrive':
        return start >= split_at
    if direction == 'leave':
        return end <= split_at
    return True


def _serialize_student_transition(transition):
    if not transition:
        return None
    return {
        'student_id': transition.student_id,
        'direction': transition.direction,
        'time': transition.time,
        'updated_by': transition.updated_by,
        'updated_at': transition.updated_at.isoformat() if transition.updated_at else None,
    }


def _get_student_transition(student_id):
    if not student_id:
        return None
    return StudentTransition.query.filter_by(student_id=student_id).first()


def _transitions_by_student_id(student_ids):
    ids = [sid for sid in (student_ids or []) if sid]
    if not ids:
        return {}
    rows = StudentTransition.query.filter(StudentTransition.student_id.in_(ids)).all()
    return {row.student_id: row for row in rows}


def user_can_edit_student_transition(user, student_id):
    if not user or not student_id:
        return False
    if user.role == 'admin':
        return True
    if user.role == 'staff':
        if getattr(user, 'is_outside_staff', False):
            return has_student_access(user, student_id)
        return True
    return False


def user_can_write_student_period(user, student_id, time_period):
    """Our staff/admin write home periods; assigned outside staff write other-school periods."""
    if not user or user.role not in ('staff', 'admin'):
        return False
    is_home = is_home_period(_get_student_transition(student_id), time_period)
    if user.role == 'admin' or (user.role == 'staff' and not getattr(user, 'is_outside_staff', False)):
        return is_home
    if not has_student_access(user, student_id):
        return False
    return not is_home


SCHEDULE_WEEKDAY_KEYS = ('mon', 'tue', 'wed', 'thu', 'fri')
SCHEDULE_WEEKDAY_FROM_PYTHON = {
    0: 'mon',
    1: 'tue',
    2: 'wed',
    3: 'thu',
    4: 'fri',
}
SCHEDULE_RECURRENCE_TYPES = frozenset({'daily', 'weekly', 'biweekly', 'nth_weekday'})
SCHEDULE_MONTH_ORDINALS = frozenset({'1', '2', '3', '4', 'last'})


def _parse_schedule_date(value):
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _normalize_schedule_weekdays(value):
    if value is None or value == '':
        return []
    raw = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except (TypeError, ValueError):
            raw = [part.strip() for part in text.split(',') if part.strip()]
    if not isinstance(raw, (list, tuple)):
        return []
    aliases = {
        'monday': 'mon', 'mon': 'mon', 'm': 'mon', '0': 'mon',
        'tuesday': 'tue', 'tue': 'tue', 'tues': 'tue', '1': 'tue',
        'wednesday': 'wed', 'wed': 'wed', 'w': 'wed', '2': 'wed',
        'thursday': 'thu', 'thu': 'thu', 'thur': 'thu', 'thurs': 'thu', '3': 'thu',
        'friday': 'fri', 'fri': 'fri', 'f': 'fri', '4': 'fri',
    }
    out = []
    seen = set()
    for item in raw:
        key = aliases.get(str(item).strip().lower())
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _serialize_schedule_weekdays(value):
    days = _normalize_schedule_weekdays(value)
    return days


def _weekdays_storage(value):
    days = _normalize_schedule_weekdays(value)
    if not days:
        return None
    return json.dumps(days)


def _normalize_month_ordinal(value):
    if value is None or value == '':
        return None
    text = str(value).strip().lower()
    if text in SCHEDULE_MONTH_ORDINALS:
        return text
    aliases = {
        'first': '1', '1st': '1',
        'second': '2', '2nd': '2',
        'third': '3', '3rd': '3',
        'fourth': '4', '4th': '4',
        'fifth': 'last', '5th': 'last',
    }
    return aliases.get(text)


def _monday_of_week(d):
    return d - timedelta(days=d.weekday())


def _nth_weekday_of_month(year, month, weekday_key, ordinal):
    """Return the date of the nth (or last) Mon–Fri weekday in a month, or None."""
    py_weekday = {v: k for k, v in SCHEDULE_WEEKDAY_FROM_PYTHON.items()}.get(weekday_key)
    if py_weekday is None:
        return None
    if ordinal == 'last':
        if month == 12:
            cursor = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            cursor = date(year, month + 1, 1) - timedelta(days=1)
        while cursor.weekday() != py_weekday:
            cursor -= timedelta(days=1)
        return cursor
    try:
        n = int(ordinal)
    except (TypeError, ValueError):
        return None
    if n < 1 or n > 4:
        return None
    cursor = date(year, month, 1)
    while cursor.weekday() != py_weekday:
        cursor += timedelta(days=1)
    target = cursor + timedelta(weeks=n - 1)
    if target.month != month:
        return None
    return target


def schedule_entry_applies_on_date(entry, on_date=None):
    """Return True if a schedule entry applies on the given school date."""
    if on_date is None:
        on_date = school_now().date()
    elif isinstance(on_date, datetime):
        on_date = on_date.date()

    if isinstance(entry, dict):
        recurrence_type = (entry.get('recurrence_type') or 'daily').strip().lower() or 'daily'
        weekdays = _normalize_schedule_weekdays(entry.get('weekdays'))
        month_ordinal = _normalize_month_ordinal(entry.get('month_ordinal'))
        biweekly_anchor = _parse_schedule_date(entry.get('biweekly_anchor'))
        effective_start = _parse_schedule_date(entry.get('effective_start'))
        effective_end = _parse_schedule_date(entry.get('effective_end'))
    else:
        recurrence_type = (getattr(entry, 'recurrence_type', None) or 'daily').strip().lower() or 'daily'
        weekdays = _normalize_schedule_weekdays(getattr(entry, 'weekdays', None))
        month_ordinal = _normalize_month_ordinal(getattr(entry, 'month_ordinal', None))
        biweekly_anchor = _parse_schedule_date(getattr(entry, 'biweekly_anchor', None))
        effective_start = _parse_schedule_date(getattr(entry, 'effective_start', None))
        effective_end = _parse_schedule_date(getattr(entry, 'effective_end', None))

    if effective_start and on_date < effective_start:
        return False
    if effective_end and on_date > effective_end:
        return False

    if recurrence_type not in SCHEDULE_RECURRENCE_TYPES:
        recurrence_type = 'daily'

    # Weekends never match weekday-based school schedule rules
    if on_date.weekday() > 4:
        return recurrence_type == 'daily'

    day_key = SCHEDULE_WEEKDAY_FROM_PYTHON.get(on_date.weekday())

    if recurrence_type == 'daily':
        return True

    if recurrence_type in ('weekly', 'biweekly'):
        if not weekdays:
            return True
        if day_key not in weekdays:
            return False
        if recurrence_type == 'weekly':
            return True
        anchor = biweekly_anchor or effective_start
        if not anchor:
            return True
        weeks = (_monday_of_week(on_date) - _monday_of_week(anchor)).days // 7
        return weeks % 2 == 0

    if recurrence_type == 'nth_weekday':
        if not weekdays:
            return False
        weekday_key = weekdays[0]
        ordinal = month_ordinal or '1'
        target = _nth_weekday_of_month(on_date.year, on_date.month, weekday_key, ordinal)
        return bool(target and target == on_date)

    return True


def _filter_schedule_rows_for_date(rows, on_date=None):
    return [row for row in (rows or []) if schedule_entry_applies_on_date(row, on_date)]


def _normalize_period_recurrence(period):
    """Normalize recurrence fields from an API period payload."""
    period = period or {}
    recurrence_type = (period.get('recurrence_type') or 'daily').strip().lower() or 'daily'
    if recurrence_type not in SCHEDULE_RECURRENCE_TYPES:
        recurrence_type = 'daily'
    weekdays = _normalize_schedule_weekdays(period.get('weekdays'))
    month_ordinal = _normalize_month_ordinal(period.get('month_ordinal'))
    biweekly_anchor = _parse_schedule_date(period.get('biweekly_anchor'))
    effective_start = _parse_schedule_date(period.get('effective_start'))
    effective_end = _parse_schedule_date(period.get('effective_end'))

    if recurrence_type == 'daily':
        weekdays = []
        month_ordinal = None
        biweekly_anchor = None
    elif recurrence_type == 'weekly':
        month_ordinal = None
        biweekly_anchor = None
    elif recurrence_type == 'biweekly':
        month_ordinal = None
        if not biweekly_anchor:
            biweekly_anchor = effective_start or school_now().date()
    elif recurrence_type == 'nth_weekday':
        biweekly_anchor = None
        if weekdays:
            weekdays = weekdays[:1]
        if not month_ordinal:
            month_ordinal = '1'

    return {
        'recurrence_type': recurrence_type,
        'weekdays': weekdays,
        'month_ordinal': month_ordinal,
        'biweekly_anchor': biweekly_anchor,
        'effective_start': effective_start,
        'effective_end': effective_end,
    }


def _period_payload_from_request(period):
    time_period = (period.get('time_period') or '').strip()
    recurrence = _normalize_period_recurrence(period)
    return {
        'time_period': time_period,
        'class_name': (period.get('class_name') or '').strip() or None,
        'staff_name': (period.get('staff_name') or '').strip() or None,
        'recurrence_type': recurrence['recurrence_type'],
        'weekdays': recurrence['weekdays'],
        'month_ordinal': recurrence['month_ordinal'],
        'biweekly_anchor': recurrence['biweekly_anchor'],
        'effective_start': recurrence['effective_start'],
        'effective_end': recurrence['effective_end'],
    }


def _period_payload_from_row(row):
    return {
        'time_period': row.time_period,
        'class_name': row.class_name,
        'staff_name': row.staff_name,
        'recurrence_type': (row.recurrence_type or 'daily'),
        'weekdays': _serialize_schedule_weekdays(row.weekdays),
        'month_ordinal': row.month_ordinal,
        'biweekly_anchor': row.biweekly_anchor,
        'effective_start': row.effective_start,
        'effective_end': row.effective_end,
    }


def _create_schedule_row(schedule_type, *, user_id=None, student_id=None, period=None, sort_order=0):
    period = period or {}
    recurrence = _normalize_period_recurrence(period)
    return Schedule(
        schedule_type=schedule_type,
        user_id=user_id,
        student_id=student_id,
        time_period=(period.get('time_period') or '').strip(),
        class_name=(period.get('class_name') or '').strip() or None,
        staff_name=(period.get('staff_name') or '').strip() or None,
        sort_order=sort_order,
        recurrence_type=recurrence['recurrence_type'],
        weekdays=_weekdays_storage(recurrence['weekdays']),
        month_ordinal=recurrence['month_ordinal'],
        biweekly_anchor=recurrence['biweekly_anchor'],
        effective_start=recurrence['effective_start'],
        effective_end=recurrence['effective_end'],
    )


def _serialize_schedule_row(s):
    return {
        'id': s.id,
        'schedule_type': s.schedule_type,
        'user_id': s.user_id,
        'student_id': s.student_id,
        'time_period': s.time_period,
        'class_name': s.class_name,
        'staff_name': s.staff_name,
        'sort_order': s.sort_order,
        'recurrence_type': (s.recurrence_type or 'daily'),
        'weekdays': _serialize_schedule_weekdays(s.weekdays),
        'month_ordinal': s.month_ordinal,
        'biweekly_anchor': s.biweekly_anchor.isoformat() if s.biweekly_anchor else None,
        'effective_start': s.effective_start.isoformat() if s.effective_start else None,
        'effective_end': s.effective_end.isoformat() if s.effective_end else None,
    }


def _format_student_schedule_location(schedule_rows, time_period, on_date=None):
    """Format a student's schedule rows for one point-card period."""
    time_period = (time_period or '').strip()
    class_names = []
    seen = set()
    for row in _filter_schedule_rows_for_date(schedule_rows, on_date):
        if isinstance(row, dict):
            row_period = (row.get('time_period') or '').strip()
            class_name = (row.get('class_name') or '').strip()
        else:
            row_period = (getattr(row, 'time_period', None) or '').strip()
            class_name = (getattr(row, 'class_name', None) or '').strip()
        if row_period != time_period or not class_name or class_name in seen:
            continue
        seen.add(class_name)
        class_names.append(class_name)
    return ', '.join(class_names)


def _student_schedule_rows(student_id):
    if not student_id:
        return []
    return (
        Schedule.query
        .filter_by(schedule_type='student', student_id=student_id)
        .order_by(Schedule.sort_order, Schedule.id)
        .all()
    )


def _student_schedule_rows_by_student(student_ids):
    student_ids = [sid for sid in (student_ids or []) if sid]
    if not student_ids:
        return {}
    rows = (
        Schedule.query
        .filter(
            Schedule.schedule_type == 'student',
            Schedule.student_id.in_(student_ids),
        )
        .order_by(Schedule.sort_order, Schedule.id)
        .all()
    )
    grouped = {}
    for row in rows:
        grouped.setdefault(row.student_id, []).append(row)
    return grouped


def _student_location_for_period(student_id, time_period, schedule_rows=None, fallback='', on_date=None):
    """Resolve location text from a student's schedule, with optional fallback."""
    rows = schedule_rows if schedule_rows is not None else _student_schedule_rows(student_id)
    location = _format_student_schedule_location(rows, time_period, on_date=on_date)
    if location:
        return location
    fallback = (fallback or '').strip()
    if fallback:
        return fallback
    transition = _get_student_transition(student_id)
    if not is_home_period(transition, time_period):
        return 'Other school'
    return POINT_CARD_DEFAULT_LOCATIONS.get((time_period or '').strip(), '')


STAR_POINT_FIELDS = (
    ('safety_points', 'Safety'),
    ('teamwork_points', 'Teamwork'),
    ('accountability_points', 'Accountability'),
    ('relationships_points', 'Relationships'),
)

ABSENT_ATTENDANCE_STATUSES = frozenset({'excused', 'unexcused'})
STAR_POINT_LETTER_CODES = frozenset({'E', 'U'})


def _normalize_star_point(value):
    """Normalize STAR cell value to None, '0'-'2', 'E', or 'U'."""
    if value is None or value == '':
        return None
    if isinstance(value, str):
        text = value.strip().upper()
        if text in STAR_POINT_LETTER_CODES:
            return text
        if text in ('0', '1', '2'):
            return text
    try:
        num = int(value)
        if num in (0, 1, 2):
            return str(num)
    except (TypeError, ValueError):
        pass
    return None


def _nullable_star_points(value):
    """Persistable STAR value (None, '0'-'2', 'E', or 'U')."""
    return _normalize_star_point(value)


def _star_point_counts_toward_stats(value):
    """Whether a STAR cell counts toward percentage denominators."""
    norm = _normalize_star_point(value)
    return norm is not None and norm != 'E'


def _star_point_numeric_contribution(value):
    """Points toward category totals; None when excluded (empty/E)."""
    norm = _normalize_star_point(value)
    if norm is None or norm == 'E':
        return None
    if norm == 'U':
        return 0
    return int(norm)


def _period_star_field_values(period_or_data):
    if period_or_data is None:
        return (None, None, None, None)
    if isinstance(period_or_data, dict):
        return (
            period_or_data.get('safety_points'),
            period_or_data.get('teamwork_points'),
            period_or_data.get('accountability_points'),
            period_or_data.get('relationships_points'),
        )
    return (
        getattr(period_or_data, 'safety_points', None),
        getattr(period_or_data, 'teamwork_points', None),
        getattr(period_or_data, 'accountability_points', None),
        getattr(period_or_data, 'relationships_points', None),
    )


def _period_has_entered_star_points(period_or_data):
    if period_or_data is None:
        return False
    values = _period_star_field_values(period_or_data)
    return any(_star_point_counts_toward_stats(value) for value in values)


def _points_possible_for_star_values(period_or_data):
    return sum(
        1 for value in _period_star_field_values(period_or_data)
        if _star_point_counts_toward_stats(value)
    )


def _period_points_possible(period_or_data):
    """Use stored points_possible, including 0 for empty rows. Infer only when unset."""
    if period_or_data is None:
        return 0
    if isinstance(period_or_data, dict):
        pp = period_or_data.get('points_possible')
    else:
        pp = getattr(period_or_data, 'points_possible', None)
    if pp is None or pp == '':
        return _points_possible_for_star_values(period_or_data)
    try:
        return int(pp)
    except (TypeError, ValueError):
        return _points_possible_for_star_values(period_or_data)


def _empty_serialized_point_card_period(time_range, location, include_details=True):
    period = {
        'id': None,
        'time_range': time_range,
        'location': location,
        'safety_points': None,
        'teamwork_points': None,
        'accountability_points': None,
        'relationships_points': None,
        'info': '',
    }
    if include_details:
        period.update({
            'points_possible': 0,
            'reset': False,
            'frenzy': False,
            'notes': None,
            'reminders': None,
            'infractions': [],
        })
    return period


def _expand_serialized_point_card_periods(periods, include_details=True):
    """Return every standard point-card row, even when STAR cells are empty."""
    periods = list(periods or [])
    standard_times = set(POINT_CARD_TIME_RANGES)
    by_time = {}
    extras = []
    for period in periods:
        if not isinstance(period, dict):
            continue
        time_range = (period.get('time_range') or '').strip()
        if time_range in standard_times:
            by_time.setdefault(time_range, period)
        else:
            extras.append(period)
    expanded = []
    for time_range, location in POINT_CARD_PERIODS:
        existing = by_time.get(time_range)
        if existing:
            expanded.append(existing)
        else:
            expanded.append(_empty_serialized_point_card_period(time_range, '', include_details))
    for period in extras:
        time_range = (period.get('time_range') or '').strip()
        location = (period.get('location') or '').strip()
        if time_range or location:
            expanded.append(period)
    return expanded


def _ensure_full_point_card_periods(daily_record):
    """Persist every standard point-card row, including empty STAR cells.

    Uses a direct table query instead of the ORM collection so concurrent
    period saves cannot trigger delete-orphan on rows another user just added.
    """
    if not daily_record:
        return
    if not getattr(daily_record, 'id', None):
        db.session.flush()
    if not getattr(daily_record, 'id', None):
        return
    existing = {
        (time_range or '').strip()
        for (time_range,) in db.session.query(PeriodRecord.time_range)
            .filter_by(daily_record_id=daily_record.id)
            .all()
        if (time_range or '').strip()
    }
    schedule_rows = _student_schedule_rows(daily_record.student_id)
    for time_range, default_location in POINT_CARD_PERIODS:
        if time_range in existing:
            continue
        location = _student_location_for_period(
            daily_record.student_id,
            time_range,
            schedule_rows=schedule_rows,
            fallback=default_location,
            on_date=getattr(daily_record, 'date', None),
        )
        db.session.add(PeriodRecord(
            daily_record_id=daily_record.id,
            time_range=time_range,
            location=location,
            safety_points=None,
            teamwork_points=None,
            accountability_points=None,
            relationships_points=None,
            points_possible=0,
        ))
        existing.add(time_range)


def _find_period_record(daily_record_id, time_range):
    time_range = (time_range or '').strip()
    if not daily_record_id or not time_range:
        return None
    return (
        PeriodRecord.query
        .filter_by(daily_record_id=daily_record_id, time_range=time_range)
        .order_by(PeriodRecord.id.asc())
        .first()
    )


def _sync_period_flags_from_info(period_record, info_value):
    if not info_value or not isinstance(info_value, str):
        return
    try:
        info_obj = json.loads(info_value)
    except (TypeError, ValueError):
        return
    if not isinstance(info_obj, dict):
        return
    if 'reset' in info_obj:
        period_record.reset = bool(info_obj.get('reset'))
    if 'frenzy' in info_obj:
        period_record.frenzy = bool(info_obj.get('frenzy'))


def _apply_period_payload(period_record, period_data, *, merge=False):
    """Copy client fields onto a PeriodRecord. Merge mode updates only present keys."""
    if not isinstance(period_data, dict):
        return

    def has(key):
        return True if not merge else key in period_data

    if has('location'):
        location = period_data.get('location')
        if merge:
            if location and not (period_record.location or '').strip():
                period_record.location = location
        elif location or not (period_record.location or '').strip():
            period_record.location = location or period_record.location
    if has('safety_points'):
        period_record.safety_points = _nullable_star_points(period_data.get('safety_points'))
    if has('teamwork_points'):
        period_record.teamwork_points = _nullable_star_points(period_data.get('teamwork_points'))
    if has('accountability_points'):
        period_record.accountability_points = _nullable_star_points(period_data.get('accountability_points'))
    if has('relationships_points'):
        period_record.relationships_points = _nullable_star_points(period_data.get('relationships_points'))
    if has('info'):
        period_record.info = period_data.get('info')
        _sync_period_flags_from_info(period_record, period_record.info)
    if has('reset'):
        period_record.reset = bool(period_data.get('reset', False))
    if has('frenzy'):
        period_record.frenzy = bool(period_data.get('frenzy', False))
    if has('notes'):
        period_record.notes = period_data.get('notes')
    if has('reminders'):
        period_record.reminders = period_data.get('reminders')
    period_record.points_possible = _points_possible_for_star_values(period_record)


def _upsert_period_record(daily_record, period_data, *, merge=False, default_location=''):
    """Create or update one period row without loading DailyRecord.periods."""
    if not daily_record or not getattr(daily_record, 'id', None):
        return None
    if not isinstance(period_data, dict):
        return None
    time_range = (period_data.get('time_range') or '').strip()
    if not time_range:
        return None
    period_record = _find_period_record(daily_record.id, time_range)
    if not period_record:
        location = period_data.get('location')
        if not (location or '').strip():
            location = _student_location_for_period(
                daily_record.student_id,
                time_range,
                fallback=default_location or POINT_CARD_DEFAULT_LOCATIONS.get(time_range, ''),
                on_date=getattr(daily_record, 'date', None),
            )
        period_record = PeriodRecord(
            daily_record_id=daily_record.id,
            time_range=time_range,
            location=location,
            points_possible=0,
        )
        db.session.add(period_record)
        db.session.flush()
    _apply_period_payload(period_record, period_data, merge=merge)
    if default_location and not (period_record.location or '').strip():
        period_record.location = default_location
    db.session.flush()
    return period_record


def _format_school_date(record_date):
    return record_date.strftime('%B ') + str(record_date.day) + record_date.strftime(', %Y')


def _collect_point_card_gaps(period_records_by_time):
    gaps = []
    all_labels = [label for _, label in STAR_POINT_FIELDS]
    for time_range in POINT_CARD_TIME_RANGES:
        period = period_records_by_time.get(time_range)
        if period is None:
            gaps.append({'time_range': time_range, 'categories': list(all_labels)})
            continue
        missing = [
            label for field, label in STAR_POINT_FIELDS
            if getattr(period, field, None) is None
        ]
        if missing:
            gaps.append({'time_range': time_range, 'categories': missing})
    return gaps


def _format_missing_gap_line(gap):
    labels = gap.get('categories') or []
    if len(labels) >= len(STAR_POINT_FIELDS):
        detail = 'no points added'
    else:
        detail = ', '.join(labels)
    return f"• {gap['time_range']} — {detail}"


def _missing_points_body(student_name, record_date, gaps, for_scheduled_staff=False):
    date_label = _format_school_date(record_date)
    if for_scheduled_staff:
        header = (
            f"{student_name} did not have points added during your scheduled time "
            f"on {date_label}:"
        )
    else:
        header = f"{student_name} did not have points added on {date_label}:"
    return header + '\n' + '\n'.join(_format_missing_gap_line(gap) for gap in gaps)


def _staff_users_by_schedule_name():
    lookup = {}
    users = User.query.filter(User.role.in_(['staff', 'admin'])).all()
    for user in users:
        if user.name and user.name.strip():
            lookup[user.name.strip().lower()] = user
        if user.username and user.username.strip():
            lookup.setdefault(user.username.strip().lower(), user)
    return lookup


def _dates_for_missing_point_notifications(dates):
    if not dates:
        return []
    today = school_now().date()
    earliest = today - timedelta(days=1)
    result = []
    for record_date in dates:
        if record_date < earliest or record_date > today:
            continue
        if record_date.weekday() >= 5:
            continue
        if not is_past_point_card_submit_time(record_date):
            continue
        result.append(record_date)
    return result


def notify_missing_point_card_entries(dates):
    """Notify case managers and scheduled staff about empty STAR boxes after nightly submit."""
    dates = _dates_for_missing_point_notifications(dates)
    if not dates:
        return 0

    student_users = User.query.filter_by(role='student').all()
    active_student_ids = [u.student_id for u in student_users if u.student_id]
    if not active_student_ids:
        return 0

    students = Student.query.filter(Student.id.in_(active_student_ids)).all()
    students_by_id = {s.id: s for s in students}
    staff_lookup = _staff_users_by_schedule_name()

    schedules = Schedule.query.filter(
        Schedule.schedule_type == 'student',
        Schedule.student_id.in_(active_student_ids),
    ).all()
    schedules_by_student = {}
    for row in schedules:
        if row.student_id:
            schedules_by_student.setdefault(row.student_id, []).append(row)

    notified_students = 0
    for record_date in dates:
        existing_notices = {
            n.student_id
            for n in MissingPointCardNotice.query.filter_by(record_date=record_date).all()
        }
        records = DailyRecord.query.filter(
            DailyRecord.date == record_date,
            DailyRecord.student_id.in_(active_student_ids),
        ).options(selectinload(DailyRecord.periods)).all()
        records_by_student = {r.student_id: r for r in records}

        for student_id in active_student_ids:
            if student_id in existing_notices:
                continue
            student = students_by_id.get(student_id)
            if not student:
                continue

            record = records_by_student.get(student_id)
            status = (record.attendance_status or 'present') if record else 'present'
            if status in ABSENT_ATTENDANCE_STATUSES:
                db.session.add(MissingPointCardNotice(
                    student_id=student_id, record_date=record_date
                ))
                continue

            period_by_time = {}
            if record:
                for period in record.periods:
                    if period.time_range:
                        period_by_time[period.time_range] = period
            gaps = _collect_point_card_gaps(period_by_time)
            if not gaps:
                db.session.add(MissingPointCardNotice(
                    student_id=student_id, record_date=record_date
                ))
                continue

            case_manager = get_student_case_manager(student_id)
            skip_staff_ids = set()
            if case_manager:
                db.session.add(Notification(
                    user_id=case_manager.id,
                    type='missing_point_card',
                    title=f'Missing points: {student.name}',
                    body=_missing_points_body(student.name, record_date, gaps, False),
                ))
                skip_staff_ids.add(case_manager.id)

            gaps_by_staff = {}
            student_rows = schedules_by_student.get(student_id, [])
            period_staff = {}
            for row in sorted(student_rows, key=lambda r: (r.sort_order or 0, r.id or 0)):
                if not row.time_period or not schedule_entry_applies_on_date(row, record_date):
                    continue
                period_staff.setdefault(row.time_period, row.staff_name)
            for gap in gaps:
                staff_name = (period_staff.get(gap['time_range']) or '').strip()
                if not staff_name:
                    continue
                staff_user = staff_lookup.get(staff_name.lower())
                if not staff_user or staff_user.id in skip_staff_ids:
                    continue
                gaps_by_staff.setdefault(staff_user.id, []).append(gap)

            for staff_user_id, staff_gaps in gaps_by_staff.items():
                db.session.add(Notification(
                    user_id=staff_user_id,
                    type='missing_point_card',
                    title=f'Missing points: {student.name}',
                    body=_missing_points_body(student.name, record_date, staff_gaps, True),
                ))

            db.session.add(MissingPointCardNotice(
                student_id=student_id, record_date=record_date
            ))
            notified_students += 1

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    if notified_students:
        app.logger.info(
            'Sent missing-point notifications for %s student(s) on %s',
            notified_students,
            ', '.join(d.isoformat() for d in dates),
        )
    return notified_students


def run_point_card_auto_submit(target_date=None):
    """Mark point cards with entered data as submitted after 11:15pm school time. No browser required."""
    if target_date is not None:
        if isinstance(target_date, str):
            target_date = datetime.strptime(target_date, '%Y-%m-%d').date()
        dates = [target_date]
    else:
        dates = _dates_due_for_point_card_submit()

    if not dates:
        return 0

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    count = 0
    records = DailyRecord.query.filter(
        DailyRecord.date.in_(dates),
        DailyRecord.submitted_at.is_(None),
    ).options(selectinload(DailyRecord.periods)).all()
    for record in records:
        if not record.periods:
            continue
        if not is_past_point_card_submit_time(record.date):
            continue
        record.submitted_at = now_naive
        count += 1
    if count:
        db.session.commit()
        app.logger.info(
            'Auto-submitted %s point card(s) for %s',
            count,
            ', '.join(d.isoformat() for d in dates),
        )
    try:
        notify_missing_point_card_entries(dates)
    except Exception:
        app.logger.exception('missing point card notifications failed')
        try:
            db.session.rollback()
        except Exception:
            pass
    return count


def maybe_auto_submit_point_cards_for_date(record_date):
    if not is_past_point_card_submit_time(record_date):
        return 0
    return run_point_card_auto_submit(record_date)


def mark_daily_record_submitted_if_due(daily_record):
    if not daily_record or daily_record.submitted_at or not daily_record.periods:
        return
    if is_past_point_card_submit_time(daily_record.date):
        daily_record.submitted_at = datetime.now(timezone.utc).replace(tzinfo=None)


def backfill_point_card_locations_for_date(record_date, *, dry_run=False):
    """Overwrite period locations from each student's current schedule for one date."""
    daily_records = (
        DailyRecord.query.filter_by(date=record_date)
        .order_by(DailyRecord.student_id.asc())
        .all()
    )
    if not daily_records:
        return {
            'date': record_date.isoformat(),
            'daily_records': 0,
            'students': 0,
            'period_updates': 0,
            'period_unchanged': 0,
            'students_touched': 0,
            'dry_run': dry_run,
            'changes': [],
        }

    student_ids = sorted({record.student_id for record in daily_records if record.student_id})
    students_by_id = {
        student.id: student
        for student in Student.query.filter(Student.id.in_(student_ids)).all()
    }
    schedules_by_student = _student_schedule_rows_by_student(student_ids)

    period_updates = 0
    period_unchanged = 0
    students_touched = set()
    changes = []

    for daily_record in daily_records:
        student_id = daily_record.student_id
        schedule_rows = schedules_by_student.get(student_id, [])
        periods = (
            PeriodRecord.query.filter_by(daily_record_id=daily_record.id)
            .order_by(PeriodRecord.id.asc())
            .all()
        )
        for period in periods:
            time_range = (period.time_range or '').strip()
            if not time_range:
                continue
            new_location = _student_location_for_period(
                student_id,
                time_range,
                schedule_rows=schedule_rows,
                on_date=getattr(daily_record, 'date', None),
            )
            old_location = (period.location or '').strip()
            if old_location == new_location:
                period_unchanged += 1
                continue
            period_updates += 1
            students_touched.add(student_id)
            student = students_by_id.get(student_id)
            student_name = student.name if student else f'student #{student_id}'
            changes.append({
                'student_id': student_id,
                'student_name': student_name,
                'time_range': time_range,
                'old_location': old_location,
                'new_location': new_location,
            })
            if not dry_run:
                period.location = new_location

    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()

    return {
        'date': record_date.isoformat(),
        'daily_records': len(daily_records),
        'students': len(student_ids),
        'period_updates': period_updates,
        'period_unchanged': period_unchanged,
        'students_touched': len(students_touched),
        'dry_run': dry_run,
        'changes': changes[:200],
        'changes_truncated': len(changes) > 200,
    }


_point_card_submit_thread_started = False
_point_card_submit_thread_lock = threading.Lock()


def _seconds_until_next_point_card_submit():
    now = school_now()
    target = now.replace(
        hour=POINT_CARD_SUBMIT_HOUR, minute=POINT_CARD_SUBMIT_MINUTE, second=0, microsecond=0
    )
    if now >= target:
        target = target + timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


def _point_card_submit_loop():
    try:
        with app.app_context():
            run_point_card_auto_submit()
    except Exception:
        app.logger.exception('point card auto-submit catch-up failed')
    while True:
        try:
            time.sleep(_seconds_until_next_point_card_submit())
            with app.app_context():
                run_point_card_auto_submit()
        except Exception:
            app.logger.exception('point card nightly auto-submit failed')
            time.sleep(60)


def start_point_card_nightly_submit_thread():
    global _point_card_submit_thread_started
    with _point_card_submit_thread_lock:
        if _point_card_submit_thread_started:
            return
        _point_card_submit_thread_started = True
    thread = threading.Thread(
        target=_point_card_submit_loop,
        name='point-card-nightly-submit',
        daemon=True,
    )
    thread.start()
    print('Point card nightly auto-submit thread started (11:15pm school time)', flush=True)


class Student(db.Model):
    __tablename__ = 'students'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100))
    grade = db.Column(db.String(20))  # Grade level (e.g., "9", "10", "11", "12")
    card_color = db.Column(db.String(20), nullable=True)  # 'yellow', 'green', 'blue', or None
    # When set, only school days with data after this date count toward the next level-up window.
    card_level_reset_at = db.Column(db.Date, nullable=True)
    # Directory information opt-out
    directory_info_opt_out = db.Column(db.Boolean, default=False, nullable=False)
    # Import: lunch number used as external unique identifier
    lunch_number = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    daily_records = db.relationship('DailyRecord', backref='student', lazy=True, cascade='all, delete-orphan')
    parent_relationships = db.relationship('ParentStudent', backref='student', lazy=True, cascade='all, delete-orphan')


def get_archived_students():
    """
    Helper to compute 'archived' students.
    
    Archived students are defined as Student records that do NOT currently have
    an associated User account with role='student'. This allows the system to
    retain historical student data while removing their active login/user entry.
    """
    # Get all active student user accounts
    student_users = User.query.filter_by(role='student').all()
    active_student_ids = {u.student_id for u in student_users if u.student_id}
    
    if not active_student_ids:
        # If there are no active student users, then all students are archived
        return Student.query.order_by(Student.name).all()
    
    # Archived students = all students whose id is NOT in active_student_ids
    return Student.query.filter(~Student.id.in_(active_student_ids)).order_by(Student.name).all()

class DailyRecord(db.Model):
    __tablename__ = 'daily_records'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    date = db.Column(db.Date, nullable=False, index=True)
    day_of_week = db.Column(db.String(20))
    
    # Attendance: 'present', 'excused', or 'unexcused'
    attendance_status = db.Column(db.String(20), default='present')
    # Keep present field for backward compatibility during migration
    present = db.Column(db.Boolean, default=True)
    # Set after 11:15pm (school timezone) when the point card had data, even if no browser is open
    submitted_at = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    periods = db.relationship('PeriodRecord', backref='daily_record', lazy=True, cascade='all, delete-orphan')
    frenzies = db.relationship('FrenzyEvent', backref='daily_record', lazy=True, cascade='all, delete-orphan')
    
    __table_args__ = (db.UniqueConstraint('student_id', 'date', name='unique_student_date'),)

class PeriodRecord(db.Model):
    __tablename__ = 'period_records'
    id = db.Column(db.Integer, primary_key=True)
    daily_record_id = db.Column(db.Integer, db.ForeignKey('daily_records.id'), nullable=False, index=True)
    
    # Period info
    time_range = db.Column(db.String(20))  # e.g., "7:45-8:30"
    location = db.Column(db.String(50))  # e.g., "English", "Math", "Bus"
    
    # STAR points (Safety, Teamwork, Accountability, Relationships): 0-2, E, or U
    safety_points = db.Column(db.String(5), nullable=True)
    teamwork_points = db.Column(db.String(5), nullable=True)
    accountability_points = db.Column(db.String(5), nullable=True)
    relationships_points = db.Column(db.String(5), nullable=True)
    points_possible = db.Column(db.Integer, nullable=True, default=0)
    
    # Flags
    reset = db.Column(db.Boolean, default=False)
    frenzy = db.Column(db.Boolean, default=False)
    
    # Notes
    notes = db.Column(db.Text)
    reminders = db.Column(db.Text)
    
    # Info column data (JSON string)
    info = db.Column(db.Text)
    
    # Infractions
    infractions = db.relationship('Infraction', backref='period_record', lazy=True, cascade='all, delete-orphan')

class Infraction(db.Model):
    __tablename__ = 'infractions'
    id = db.Column(db.Integer, primary_key=True)
    period_record_id = db.Column(db.Integer, db.ForeignKey('period_records.id'), nullable=False, index=True)
    
    # Infraction types
    infraction_type = db.Column(db.String(50), nullable=False)  # e.g., "Lang", "NFD", "Off Task", etc.
    count = db.Column(db.Integer, default=1)
    
    # Categories
    is_general = db.Column(db.Boolean, default=True)  # General vs Harmful
    is_harmful = db.Column(db.Boolean, default=False)

class FrenzyEvent(db.Model):
    __tablename__ = 'frenzy_events'
    id = db.Column(db.Integer, primary_key=True)
    daily_record_id = db.Column(db.Integer, db.ForeignKey('daily_records.id'), nullable=False, index=True)
    
    # Event details
    time_range = db.Column(db.String(20))
    location = db.Column(db.String(50))
    purpose = db.Column(db.String(100))
    purpose2 = db.Column(db.String(100))
    duration_minutes = db.Column(db.Integer)
    # Frenzy severity level (1=Para, 2=Response Team, 3=Professional,
    # 4=Administration, 5=SRO). Default 1 so inserts never leave NULL (heatmap).
    severity = db.Column(db.Integer, default=1)

    # Result/outcome
    result = db.Column(db.String(100))


class CheckpointStudent(db.Model):
    __tablename__ = 'checkpoint_students'
    id = db.Column(db.Integer, primary_key=True)
    checkpoint_id = db.Column(db.Integer, db.ForeignKey('checkpoints.id'), nullable=False, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, index=True)

    student = db.relationship('Student')
    __table_args__ = (db.UniqueConstraint('checkpoint_id', 'student_id', name='unique_checkpoint_student'),)


class Checkpoint(db.Model):
    __tablename__ = 'checkpoints'
    id = db.Column(db.Integer, primary_key=True)
    checkpoint_type = db.Column(db.String(30), nullable=False, index=True)  # intervention, transition, life_event, card_change
    color = db.Column(db.String(20), nullable=False)
    date = db.Column(db.Date, nullable=False, index=True)
    label = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    created_by = db.relationship('User')
    students = db.relationship('CheckpointStudent', backref='checkpoint', lazy=True, cascade='all, delete-orphan')

class TeamMember(db.Model):
    __tablename__ = 'team_members'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    role = db.Column(db.String(50))  # e.g., "Professional", "Practitioner", "Group Leader"
    name = db.Column(db.String(100))
    email = db.Column(db.String(100))
    email_status = db.Column(db.String(50))

class OutsideStaffStudent(db.Model):
    __tablename__ = 'outside_staff_students'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship to student
    student = db.relationship('Student', backref='outside_staff_assignments')
    
    __table_args__ = (db.UniqueConstraint('user_id', 'student_id', name='unique_outside_staff_student'),)

# Parent-Student Relationship
class ParentStudent(db.Model):
    __tablename__ = 'parent_students'
    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    relationship = db.Column(db.String(50), nullable=False)  # 'parent', 'guardian', 'custodial_parent', etc.
    verified = db.Column(db.Boolean, default=False, nullable=False)  # Must be verified by admin/staff
    verified_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    verified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    # Note: parent_user is available via backref from User.parent_student_relationships
    verified_by = db.relationship('User', foreign_keys=[verified_by_user_id])
    
    __table_args__ = (db.UniqueConstraint('parent_user_id', 'student_id', name='unique_parent_student'),)

# Amendment Request
class AmendmentRequest(db.Model):
    __tablename__ = 'amendment_requests'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    requested_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    record_type = db.Column(db.String(50), nullable=False)  # 'daily_record', 'period_record', 'infraction', 'frenzy_event', 'general'
    record_id = db.Column(db.Integer, nullable=True)  # ID of specific record, or None for general requests
    current_value = db.Column(db.Text, nullable=True)  # Current value that needs correction
    requested_change = db.Column(db.Text, nullable=False)  # What change is requested
    reason = db.Column(db.Text, nullable=False)  # Why the change is needed
    status = db.Column(db.String(20), default='pending', nullable=False)  # 'pending', 'approved', 'denied'
    reviewed_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    review_notes = db.Column(db.Text, nullable=True)  # Notes from reviewer
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    student = db.relationship('Student', backref='amendment_requests')
    requested_by = db.relationship('User', foreign_keys=[requested_by_user_id], backref='amendment_requests')
    reviewed_by = db.relationship('User', foreign_keys=[reviewed_by_user_id], backref='reviewed_amendment_requests')

# Rights Notification Tracking
class RightsNotification(db.Model):
    __tablename__ = 'ferpa_rights_notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=True)  # Nullable for parent users
    notification_year = db.Column(db.Integer, nullable=False)  # Year the notification was sent
    acknowledged_at = db.Column(db.DateTime, nullable=True)
    acknowledged_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    user = db.relationship('User', foreign_keys=[user_id], backref='rights_notifications')
    student = db.relationship('Student', backref='rights_notifications')
    acknowledged_by = db.relationship('User', foreign_keys=[acknowledged_by_user_id])

class Schedule(db.Model):
    __tablename__ = 'schedules'
    id = db.Column(db.Integer, primary_key=True)
    schedule_type = db.Column(db.String(20), nullable=False)  # 'teacher' or 'student'
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # User who owns this schedule (for teacher schedules)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=True)  # Null for teacher schedules
    time_period = db.Column(db.String(50), nullable=False)  # e.g., "7:45-8:30"
    class_name = db.Column(db.String(100))  # Class/Activity name
    staff_name = db.Column(db.String(100))  # Staff member name
    sort_order = db.Column(db.Integer, default=0)  # Explicit sort order to maintain position
    # Recurrence: daily (default), weekly, biweekly, nth_weekday
    recurrence_type = db.Column(db.String(20), default='daily')
    weekdays = db.Column(db.Text)  # JSON list e.g. ["mon","wed"] for weekly/biweekly/nth
    month_ordinal = db.Column(db.String(10))  # "1"|"2"|"3"|"4"|"last" for nth_weekday
    biweekly_anchor = db.Column(db.Date)  # week-0 marker for biweekly
    effective_start = db.Column(db.Date)
    effective_end = db.Column(db.Date)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StudentTransition(db.Model):
    """Standing daily arrive/leave split between this school and another school."""
    __tablename__ = 'student_transitions'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, unique=True)
    direction = db.Column(db.String(10), nullable=False)  # 'arrive' or 'leave'
    time = db.Column(db.String(8), nullable=False)  # 24h HH:MM
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    student = db.relationship('Student', backref=db.backref('transition', uselist=False))


class BankAccount(db.Model):
    __tablename__ = 'bank_accounts'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, unique=True)
    balance = db.Column(db.Numeric(10, 2), default=Decimal('0.00'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    student = db.relationship('Student', backref='bank_account')
    transactions = db.relationship('Transaction', backref='bank_account', lazy=True, cascade='all, delete-orphan')


class StarbucksBalance(db.Model):
    __tablename__ = 'starbucks_balances'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, unique=True)
    count = db.Column(db.Integer, default=0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    student = db.relationship('Student', backref='starbucks_balance')


class PlanIfLibrary(db.Model):
    __tablename__ = 'plan_if_library'
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    normalized_text = db.Column(db.String(500), nullable=False, unique=True, index=True)
    usage_count = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class StudentPlan(db.Model):
    __tablename__ = 'student_plans'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, unique=True)
    updated_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    student = db.relationship('Student', backref=db.backref('plan', uselist=False))
    rows = db.relationship('StudentPlanRow', backref='plan', lazy=True, cascade='all, delete-orphan',
                           order_by='StudentPlanRow.sort_order')


class StudentPlanRow(db.Model):
    __tablename__ = 'student_plan_rows'
    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('student_plans.id'), nullable=False, index=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)
    if_text = db.Column(db.Text, nullable=False, default='')
    then_text = db.Column(db.Text, nullable=False, default='')
    has_threshold = db.Column(db.Boolean, default=False, nullable=False)
    threshold_percent = db.Column(db.Numeric(5, 2), nullable=True)
    # by_time | dow_range | consecutive_days | days_in_window | specific_period |
    # end_of_day | weekly_average | category_specific
    threshold_type = db.Column(db.String(40), nullable=True)
    cutoff_time = db.Column(db.String(20), nullable=True)  # HH:MM
    dow_start = db.Column(db.String(20), nullable=True)
    dow_end = db.Column(db.String(20), nullable=True)
    consecutive_n = db.Column(db.Integer, nullable=True)
    days_needed = db.Column(db.Integer, nullable=True)
    window_days = db.Column(db.Integer, nullable=True)
    period_time_range = db.Column(db.String(50), nullable=True)
    period_location = db.Column(db.String(100), nullable=True)
    star_category = db.Column(db.String(20), nullable=True)  # overall|s|t|a|r


class PlanThresholdEvent(db.Model):
    __tablename__ = 'plan_threshold_events'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, index=True)
    plan_row_id = db.Column(db.Integer, db.ForeignKey('student_plan_rows.id'), nullable=False, index=True)
    if_normalized = db.Column(db.String(500), nullable=False, index=True)
    window_key = db.Column(db.String(64), nullable=False)
    met_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    delivered_at = db.Column(db.DateTime, nullable=True)
    delivered_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    student = db.relationship('Student', backref='plan_threshold_events')
    plan_row = db.relationship('StudentPlanRow', backref='threshold_events')
    delivered_by = db.relationship('User', foreign_keys=[delivered_by_user_id])

    __table_args__ = (
        db.UniqueConstraint('plan_row_id', 'window_key', name='unique_plan_row_window'),
    )


def seed_plan_if_library():
    """Insert the 40 common If texts if the library is empty / missing any."""
    from student_plans_lib import PLAN_IF_SEED_TEXTS, normalize_if_text as _norm_if
    try:
        for text in PLAN_IF_SEED_TEXTS:
            norm = _norm_if(text)
            if not norm:
                continue
            existing = PlanIfLibrary.query.filter_by(normalized_text=norm).first()
            if existing:
                continue
            db.session.add(PlanIfLibrary(text=text, normalized_text=norm, usage_count=0))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        try:
            app.logger.warning(f"seed_plan_if_library failed: {e}")
        except Exception:
            print(f"seed_plan_if_library failed: {e}")


def seed_curriculum_lessons(commit=True):
    """Insert or refresh the six financial-literacy lessons."""
    from curriculum_lib import LESSON_SEEDS
    inserted = 0
    try:
        for data in LESSON_SEEDS:
            existing = CurriculumLesson.query.filter_by(slug=data['slug']).first()
            if existing:
                existing.title = data['title']
                existing.skill_name = data['skill_name']
                existing.student_prompt = data['student_prompt']
                existing.staff_script = data['staff_script']
                existing.teaching_body = data.get('teaching')
                existing.sort_order = data['sort_order']
                if existing.is_active is None:
                    existing.is_active = True
                continue
            db.session.add(CurriculumLesson(
                slug=data['slug'],
                title=data['title'],
                skill_name=data['skill_name'],
                student_prompt=data['student_prompt'],
                staff_script=data['staff_script'],
                teaching_body=data.get('teaching'),
                sort_order=data['sort_order'],
                is_active=True,
            ))
            inserted += 1
        if commit:
            db.session.commit()
    except Exception as e:
        if commit:
            db.session.rollback()
        try:
            app.logger.warning(f"seed_curriculum_lessons failed: {e}")
        except Exception:
            print(f"seed_curriculum_lessons failed: {e}")
    return inserted


class Paycheck(db.Model):
    __tablename__ = 'paychecks'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    pay_period_start = db.Column(db.Date, nullable=False)  # Monday of the week
    pay_period_end = db.Column(db.Date, nullable=False)  # Friday of the week
    average_star_percent = db.Column(db.Numeric(5, 2), nullable=False)  # Average STAR percentage for the week
    base_pay = db.Column(db.Numeric(10, 2), nullable=False)  # Calculated pay before deductions (average_percent * 100)
    citation_count = db.Column(db.Integer, default=0, nullable=False)  # Number of infractions
    citation_deduction = db.Column(db.Numeric(10, 2), default=Decimal('0.00'), nullable=False)  # citation_count * 2
    final_pay = db.Column(db.Numeric(10, 2), nullable=False)  # base_pay - citation_deduction
    worksheet_completed = db.Column(db.Boolean, default=False, nullable=False)
    student_calculated_pay = db.Column(db.Numeric(10, 2), nullable=True)  # Student's calculation
    student_calculated_citations = db.Column(db.Integer, nullable=True)
    student_calculated_deduction = db.Column(db.Numeric(10, 2), nullable=True)
    student_calculated_final = db.Column(db.Numeric(10, 2), nullable=True)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    deposited_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    student = db.relationship('Student', backref='paychecks')
    transactions = db.relationship('Transaction', backref='paycheck', lazy=True)


class CurriculumLesson(db.Model):
    __tablename__ = 'curriculum_lessons'
    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(50), nullable=False, unique=True)
    title = db.Column(db.String(200), nullable=False)
    skill_name = db.Column(db.String(100), nullable=False)
    student_prompt = db.Column(db.Text, nullable=True)
    staff_script = db.Column(db.Text, nullable=True)
    teaching_body = db.Column(db.Text, nullable=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)


class CurriculumAssignment(db.Model):
    __tablename__ = 'curriculum_assignments'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, index=True)
    lesson_id = db.Column(db.Integer, db.ForeignKey('curriculum_lessons.id'), nullable=False, index=True)
    assigned_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    source = db.Column(db.String(20), nullable=False, default='staff')  # paycheck | staff
    paycheck_id = db.Column(db.Integer, db.ForeignKey('paychecks.id'), nullable=True, index=True)
    status = db.Column(db.String(20), nullable=False, default='assigned')  # assigned, in_progress, completed, needs_help
    responses_json = db.Column(db.Text, nullable=True)
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    student = db.relationship('Student', backref='curriculum_assignments')
    lesson = db.relationship('CurriculumLesson', backref='assignments')
    assigned_by = db.relationship('User', foreign_keys=[assigned_by_user_id])
    paycheck = db.relationship('Paycheck', backref='curriculum_assignments')

    __table_args__ = (
        db.Index(
            'ix_curriculum_assign_paycheck',
            'student_id',
            'lesson_id',
            'paycheck_id',
            unique=True,
        ),
    )


class SavingsGoal(db.Model):
    __tablename__ = 'savings_goals'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False, index=True)
    marketplace_item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=True)
    custom_label = db.Column(db.String(200), nullable=True)
    target_amount = db.Column(db.Numeric(10, 2), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)

    student = db.relationship('Student', backref='savings_goals')
    marketplace_item = db.relationship('MarketplaceItem')


# Admin-managed lookup tables for Marketplace
class MarketplaceItemType(db.Model):
    __tablename__ = 'marketplace_item_types'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)

class MarketplaceCategory(db.Model):
    __tablename__ = 'marketplace_categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)

class MarketplaceItem(db.Model):
    __tablename__ = 'marketplace_items'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    is_global = db.Column(db.Boolean, default=False, nullable=False)
    is_approved_for_global = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    # New: grade_range k_3, 4_8, 9_12, school_wide
    grade_range = db.Column(db.String(20), default='9_12', nullable=False)
    item_type_id = db.Column(db.Integer, db.ForeignKey('marketplace_item_types.id'), nullable=True)
    category_id = db.Column(db.Integer, db.ForeignKey('marketplace_categories.id'), nullable=True)
    image_url = db.Column(db.String(500), nullable=True)  # URL only
    suggested_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    creator = db.relationship('User', backref='created_marketplace_items', foreign_keys=[created_by_user_id])
    suggester = db.relationship('User', foreign_keys=[suggested_by_user_id])
    item_type = db.relationship('MarketplaceItemType', backref='items')
    category = db.relationship('MarketplaceCategory', backref='items')
    purchase_orders = db.relationship('PurchaseOrder', backref='item', lazy=True)


class MarketplaceItemCaseManager(db.Model):
    """Per-item assignments to case managers, including approval status and visibility to students.

    This drives case-manager based visibility for marketplace items.
    """
    __tablename__ = 'marketplace_item_case_managers'

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=False)
    case_manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # pending: awaiting case manager decision
    # accepted: case manager has accepted item for their students
    # denied: case manager has explicitly denied item
    status = db.Column(db.String(20), default='pending', nullable=False)
    # For accepted items, controls whether the item is currently visible to the case manager's students.
    # For school-wide items, rows with visible_to_students = False act as overrides to hide the item.
    visible_to_students = db.Column(db.Boolean, default=True, nullable=False)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    item = db.relationship('MarketplaceItem', backref='case_manager_assignments')
    case_manager = db.relationship('User', foreign_keys=[case_manager_id])
    creator = db.relationship('User', foreign_keys=[created_by_user_id])


class MarketplaceItemRequest(db.Model):
    __tablename__ = 'marketplace_item_requests'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=False)
    requested_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    request_type = db.Column(db.String(50), nullable=False)  # 'add_to_global' or 'create_new'
    status = db.Column(db.String(20), default='pending', nullable=False)  # 'pending', 'approved', 'denied'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    # Relationships
    item = db.relationship('MarketplaceItem', backref='requests')
    requester = db.relationship('User', foreign_keys=[requested_by_user_id], backref='marketplace_requests')
    reviewer = db.relationship('User', foreign_keys=[reviewed_by_user_id], backref='reviewed_marketplace_requests')


class MarketplaceItemHiddenRule(db.Model):
    """Rule to hide a marketplace item from specific students (by student, card_color, or grade section: K-3, 4-8, 9-12)."""
    __tablename__ = 'marketplace_item_hidden_rules'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=False)
    hidden_type = db.Column(db.String(20), nullable=False)  # 'student', 'card_color', 'grade_section'
    value = db.Column(db.String(100), nullable=False)  # student_id, color name, or grade section (K-3, 4-8, 9-12)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    item = db.relationship('MarketplaceItem', backref=db.backref('hidden_rules', lazy=True, cascade='all, delete-orphan'))


class PurchaseOrder(db.Model):
    __tablename__ = 'purchase_orders'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=False)
    item_price = db.Column(db.Numeric(10, 2), nullable=False)
    student_balance_before = db.Column(db.Numeric(10, 2), nullable=False)
    student_calculated_balance_after = db.Column(db.Numeric(10, 2), nullable=False)
    actual_balance_after = db.Column(db.Numeric(10, 2), nullable=False)
    is_calculation_correct = db.Column(db.Boolean, nullable=True)
    status = db.Column(db.String(20), default='pending', nullable=False)  # pending, approved, fulfilled, denied
    case_manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # Legacy; support team derived
    approved_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    denied_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    denial_reason = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime, nullable=True)
    fulfilled_at = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    student = db.relationship('Student', backref='purchase_orders')
    case_manager = db.relationship('User', foreign_keys=[case_manager_id], backref='managed_purchase_orders')
    approved_by = db.relationship('User', foreign_keys=[approved_by_user_id])
    denied_by = db.relationship('User', foreign_keys=[denied_by_user_id])
    transactions = db.relationship('Transaction', backref='purchase_order', lazy=True)


class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    type = db.Column(db.String(50), nullable=False)  # purchase_approved, purchase_denied, etc.
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=True)
    purchase_order_id = db.Column(db.Integer, db.ForeignKey('purchase_orders.id'), nullable=True)
    curriculum_assignment_id = db.Column(db.Integer, db.ForeignKey('curriculum_assignments.id'), nullable=True)
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref='notifications')
    purchase_order = db.relationship('PurchaseOrder', backref='notification_records')
    curriculum_assignment = db.relationship('CurriculumAssignment', backref='notification_records')


class MissingPointCardNotice(db.Model):
    """One row per student/date after the nightly missing-points scan, so we do not re-notify."""
    __tablename__ = 'missing_point_card_notices'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    record_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    student = db.relationship('Student', backref='missing_point_card_notices')

    __table_args__ = (
        db.UniqueConstraint('student_id', 'record_date', name='unique_missing_point_card_notice'),
    )


class Transaction(db.Model):
    __tablename__ = 'transactions'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    bank_account_id = db.Column(db.Integer, db.ForeignKey('bank_accounts.id'), nullable=False)
    transaction_type = db.Column(db.String(20), nullable=False)  # 'deposit' or 'purchase'
    amount = db.Column(db.Numeric(10, 2), nullable=False)  # Positive for deposits, negative for purchases
    paycheck_id = db.Column(db.Integer, db.ForeignKey('paychecks.id'), nullable=True)
    purchase_order_id = db.Column(db.Integer, db.ForeignKey('purchase_orders.id'), nullable=True)
    balance_after = db.Column(db.Numeric(10, 2), nullable=False)
    description = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    student = db.relationship('Student', backref='transactions')


class SiteSubscription(db.Model):
    """Singleton row for this school's software subscription (Stripe)."""
    __tablename__ = 'site_subscription'
    id = db.Column(db.Integer, primary_key=True)
    stripe_customer_id = db.Column(db.String(100), nullable=True)
    stripe_subscription_id = db.Column(db.String(100), nullable=True)
    status = db.Column(db.String(40), nullable=False, default='inactive')
    price_id = db.Column(db.String(100), nullable=True)
    current_period_end = db.Column(db.DateTime, nullable=True)
    cancel_at_period_end = db.Column(db.Boolean, default=False, nullable=False)
    customer_email = db.Column(db.String(200), nullable=True)
    build_fee_paid = db.Column(db.Boolean, default=False, nullable=False)
    build_fee_paid_at = db.Column(db.DateTime, nullable=True)
    build_fee_session_id = db.Column(db.String(100), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolCalendarConfig(db.Model):
    """Singleton row for site-wide quarter and school-year dates (admin configured)."""
    __tablename__ = 'school_calendar_config'
    id = db.Column(db.Integer, primary_key=True)
    quarters_json = db.Column(db.Text, nullable=True)
    school_year_json = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def ensure_site_subscription_columns():
    """Add build-fee columns on existing site_subscription tables."""
    try:
        with app.app_context():
            inspector = None
            try:
                from sqlalchemy import inspect as sa_inspect
                inspector = sa_inspect(db.engine)
            except Exception:
                return
            if 'site_subscription' not in inspector.get_table_names():
                return
            columns = {col['name'] for col in inspector.get_columns('site_subscription')}
            is_postgres = 'postgresql' in str(db.engine.url).lower()
            alters = []
            if 'build_fee_paid' not in columns:
                if is_postgres:
                    alters.append(
                        "ALTER TABLE site_subscription "
                        "ADD COLUMN IF NOT EXISTS build_fee_paid BOOLEAN DEFAULT FALSE NOT NULL"
                    )
                else:
                    alters.append(
                        "ALTER TABLE site_subscription "
                        "ADD COLUMN build_fee_paid BOOLEAN DEFAULT 0 NOT NULL"
                    )
            if 'build_fee_paid_at' not in columns:
                if is_postgres:
                    alters.append(
                        "ALTER TABLE site_subscription "
                        "ADD COLUMN IF NOT EXISTS build_fee_paid_at TIMESTAMP"
                    )
                else:
                    alters.append(
                        "ALTER TABLE site_subscription ADD COLUMN build_fee_paid_at DATETIME"
                    )
            if 'build_fee_session_id' not in columns:
                if is_postgres:
                    alters.append(
                        "ALTER TABLE site_subscription "
                        "ADD COLUMN IF NOT EXISTS build_fee_session_id VARCHAR(100)"
                    )
                else:
                    alters.append(
                        "ALTER TABLE site_subscription "
                        "ADD COLUMN build_fee_session_id VARCHAR(100)"
                    )
            if not alters:
                return
            with db.engine.connect() as conn:
                for sql in alters:
                    conn.execute(text(sql))
                conn.commit()
    except Exception as e:
        print(f"Note: site_subscription column ensure skipped: {e}", flush=True)


ensure_site_subscription_columns()


def ensure_curriculum_schema():
    """Add curriculum columns on existing databases."""
    try:
        is_postgres = 'postgresql' in str(db.engine.url).lower()
        with db.engine.connect() as conn:
            if is_postgres:
                conn.execute(text(
                    "ALTER TABLE notifications "
                    "ADD COLUMN IF NOT EXISTS curriculum_assignment_id INTEGER"
                ))
                conn.execute(text(
                    "ALTER TABLE curriculum_lessons "
                    "ADD COLUMN IF NOT EXISTS teaching_body TEXT"
                ))
            else:
                try:
                    rows = conn.execute(text("PRAGMA table_info(notifications)")).fetchall()
                    cols = {row[1] for row in rows}
                    if rows and 'curriculum_assignment_id' not in cols:
                        conn.execute(text(
                            "ALTER TABLE notifications "
                            "ADD COLUMN curriculum_assignment_id INTEGER"
                        ))
                except Exception:
                    pass
                try:
                    rows = conn.execute(text("PRAGMA table_info(curriculum_lessons)")).fetchall()
                    cols = {row[1] for row in rows}
                    if rows and 'teaching_body' not in cols:
                        conn.execute(text(
                            "ALTER TABLE curriculum_lessons ADD COLUMN teaching_body TEXT"
                        ))
                except Exception:
                    pass
            conn.commit()
    except Exception as e:
        try:
            app.logger.warning(f"Failed to ensure curriculum schema: {e}")
        except Exception:
            print(f"Failed to ensure curriculum schema: {e}")


def _chunked_ids(ids, size=500):
    for index in range(0, len(ids), size):
        yield ids[index:index + size]


def run_pre_cutoff_data_cleanup(cutoff_date, dry_run=False):
    """
    One-off admin utility: remove point cards (daily records) and paychecks before a cutoff date.
    Also clears related infractions, frenzy events, missing-point notices,
    curriculum assignments, and reverses deposited paycheck balances.

    cutoff_date is required (date or YYYY-MM-DD string). Records on the cutoff date are kept.
    """
    if cutoff_date is None:
        raise ValueError('cutoff_date is required')
    if isinstance(cutoff_date, str):
        cutoff = datetime.strptime(cutoff_date, '%Y-%m-%d').date()
    else:
        cutoff = cutoff_date

    stats = {
        'cutoff': cutoff.isoformat(),
        'dry_run': dry_run,
        'daily_records': 0,
        'paychecks': 0,
        'transactions_reversed': 0,
        'curriculum_assignments': 0,
        'missing_point_card_notices': 0,
    }

    old_paychecks = Paycheck.query.filter(Paycheck.pay_period_end < cutoff).all()
    stats['paychecks'] = len(old_paychecks)

    if old_paychecks and not dry_run:
        paycheck_ids = [paycheck.id for paycheck in old_paychecks]
        assignment_ids = [
            row.id for row in CurriculumAssignment.query.filter(
                CurriculumAssignment.paycheck_id.in_(paycheck_ids)
            ).with_entities(CurriculumAssignment.id).all()
        ]
        stats['curriculum_assignments'] = len(assignment_ids)
        for chunk in _chunked_ids(assignment_ids):
            Notification.query.filter(
                Notification.curriculum_assignment_id.in_(chunk)
            ).delete(synchronize_session=False)
            CurriculumAssignment.query.filter(
                CurriculumAssignment.id.in_(chunk)
            ).delete(synchronize_session=False)

        for paycheck in old_paychecks:
            if paycheck.deposited_at is None:
                continue
            account = BankAccount.query.filter_by(student_id=paycheck.student_id).first()
            if account:
                account.balance -= paycheck.final_pay
                account.updated_at = datetime.utcnow()
            deleted = Transaction.query.filter_by(paycheck_id=paycheck.id).delete(
                synchronize_session=False
            )
            if deleted:
                stats['transactions_reversed'] += deleted

        for chunk in _chunked_ids(paycheck_ids):
            Paycheck.query.filter(Paycheck.id.in_(chunk)).delete(synchronize_session=False)

    stats['missing_point_card_notices'] = MissingPointCardNotice.query.filter(
        MissingPointCardNotice.record_date < cutoff
    ).count()
    if stats['missing_point_card_notices'] and not dry_run:
        MissingPointCardNotice.query.filter(
            MissingPointCardNotice.record_date < cutoff
        ).delete(synchronize_session=False)

    daily_ids = [
        row.id for row in DailyRecord.query.filter(
            DailyRecord.date < cutoff
        ).with_entities(DailyRecord.id).all()
    ]
    stats['daily_records'] = len(daily_ids)
    if daily_ids and not dry_run:
        for chunk in _chunked_ids(daily_ids):
            period_ids = [
                row.id for row in PeriodRecord.query.filter(
                    PeriodRecord.daily_record_id.in_(chunk)
                ).with_entities(PeriodRecord.id).all()
            ]
            for period_chunk in _chunked_ids(period_ids):
                Infraction.query.filter(
                    Infraction.period_record_id.in_(period_chunk)
                ).delete(synchronize_session=False)
                PeriodRecord.query.filter(
                    PeriodRecord.id.in_(period_chunk)
                ).delete(synchronize_session=False)
            FrenzyEvent.query.filter(
                FrenzyEvent.daily_record_id.in_(chunk)
            ).delete(synchronize_session=False)
            DailyRecord.query.filter(
                DailyRecord.id.in_(chunk)
            ).delete(synchronize_session=False)

    if not dry_run:
        db.session.commit()

    return stats


# Initialize database tables after all models are defined
def _star_point_sum_value(value):
    """Sum-safe STAR points; excluded cells (empty/E) contribute 0."""
    contrib = _star_point_numeric_contribution(value)
    return contrib if contrib is not None else 0


def ensure_star_points_string_schema():
    """Migrate period_records STAR columns from INTEGER to VARCHAR for E/U support."""
    try:
        from sqlalchemy import inspect, text
        from sqlalchemy.exc import OperationalError, ProgrammingError

        inspector = inspect(db.engine)
        if 'period_records' not in inspector.get_table_names():
            return

        is_postgres = 'postgresql' in str(db.engine.url).lower()
        star_cols = (
            'safety_points',
            'teamwork_points',
            'accountability_points',
            'relationships_points',
        )
        columns = {col['name']: col for col in inspector.get_columns('period_records')}
        for col_name in star_cols:
            col_info = columns.get(col_name)
            if not col_info:
                continue
            col_type = str(col_info.get('type', '')).upper()
            if 'CHAR' in col_type or 'TEXT' in col_type or 'VARCHAR' in col_type:
                continue
            print(f"Migrating period_records.{col_name} to VARCHAR(5) for STAR E/U values...")
            try:
                with db.engine.connect() as conn:
                    if is_postgres:
                        conn.execute(text(
                            f"ALTER TABLE period_records "
                            f"ALTER COLUMN {col_name} TYPE VARCHAR(5) "
                            f"USING {col_name}::text"
                        ))
                    else:
                        # SQLite stores values flexibly; normalize existing integers to text.
                        conn.execute(text(
                            f"UPDATE period_records "
                            f"SET {col_name} = CAST({col_name} AS TEXT) "
                            f"WHERE {col_name} IS NOT NULL"
                        ))
                    conn.commit()
            except (OperationalError, ProgrammingError) as e:
                print(f"Note: Could not migrate period_records.{col_name} (may already be migrated): {e}")
    except Exception as e:
        print(f"Note: STAR points schema migration skipped: {e}")


def init_db():
    """Initialize database tables if they don't exist"""
    try:
        with app.app_context():
            # Test database connection first
            try:
                print("Connecting to database...", flush=True)
                db.engine.connect()
                print("Database connection successful", flush=True)
            except Exception as conn_error:
                print(f"Database connection error: {conn_error}")
                import traceback
                traceback.print_exc()
                raise
            
            # Create all tables
            db.create_all()
            ensure_daily_query_indexes()
            ensure_point_card_submit_schema()
            ensure_star_points_string_schema()
            start_point_card_nightly_submit_thread()
            try:
                seed_plan_if_library()
            except Exception as seed_err:
                print(f"Note: plan if library seed skipped: {seed_err}", flush=True)
            try:
                ensure_curriculum_schema()
                seed_curriculum_lessons()
            except Exception as seed_err:
                print(f"Note: curriculum seed skipped: {seed_err}", flush=True)
            print("Database tables created/verified", flush=True)
            
            # Ensure OutsideStaffStudent table exists and run migrations
            try:
                from sqlalchemy import inspect, text
                from sqlalchemy.exc import OperationalError, ProgrammingError
                
                inspector = inspect(db.engine)
                table_names = inspector.get_table_names()
                is_postgres = 'postgresql' in str(db.engine.url).lower()

                # Check if outside_staff_students table exists
                if 'outside_staff_students' not in table_names:
                    print("Creating outside_staff_students table...")
                    db.create_all()
                
                # Verify columns exist in users table
                if 'users' in table_names:
                    columns = [col['name'] for col in inspector.get_columns('users')]

                    if 'is_outside_staff' not in columns:
                        print("Adding is_outside_staff column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    # PostgreSQL syntax
                                    conn.execute(text("ALTER TABLE users ADD COLUMN is_outside_staff BOOLEAN DEFAULT FALSE NOT NULL"))
                                else:
                                    # SQLite syntax
                                    conn.execute(text("ALTER TABLE users ADD COLUMN is_outside_staff BOOLEAN DEFAULT 0 NOT NULL"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            # Column might already exist or other error
                            print(f"Note: Could not add is_outside_staff column (may already exist): {e}")
                    
                    if 'district' not in columns:
                        print("Adding district column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN district VARCHAR(255)"))
                                else:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN district TEXT"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add district column (may already exist): {e}")
                    
                    if 'claimed_student_name' not in columns:
                        print("Adding claimed_student_name column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN claimed_student_name VARCHAR(200)"))
                                else:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN claimed_student_name VARCHAR(200)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add claimed_student_name column (may already exist): {e}")
                    
                    if 'claimed_relationship' not in columns:
                        print("Adding claimed_relationship column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN claimed_relationship VARCHAR(50)"))
                                else:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN claimed_relationship VARCHAR(50)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add claimed_relationship column (may already exist): {e}")
                    
                    if 'ui_preferences' not in columns:
                        print("Adding ui_preferences column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE users ADD COLUMN ui_preferences TEXT"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add ui_preferences column (may already exist): {e}")
                    
                    if 'grades_taught' not in columns:
                        print("Adding grades_taught column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE users ADD COLUMN grades_taught VARCHAR(50)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add grades_taught column (may already exist): {e}")

                    if 'hidden_from_management' not in columns:
                        print("Adding hidden_from_management column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN hidden_from_management BOOLEAN DEFAULT FALSE NOT NULL"))
                                else:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN hidden_from_management BOOLEAN DEFAULT 0 NOT NULL"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add hidden_from_management column (may already exist): {e}")

                # Ensure checkpoints.description exists for checkpoint notes.
                if 'checkpoints' in table_names:
                    checkpoint_columns = [col['name'] for col in inspector.get_columns('checkpoints')]
                    if 'description' not in checkpoint_columns:
                        print("Adding description column to checkpoints table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE checkpoints ADD COLUMN description TEXT"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add checkpoints.description column (may already exist): {e}")
                    
                    if 'linked_case_manager_id' not in columns:
                        print("Adding linked_case_manager_id column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE users ADD COLUMN linked_case_manager_id INTEGER REFERENCES users(id)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add linked_case_manager_id column (may already exist): {e}")
                    
                    if 'user_number' not in columns:
                        print("Adding user_number column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE users ADD COLUMN user_number VARCHAR(50)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add user_number column (may already exist): {e}")
                    
                    if 'must_change_password' not in columns:
                        print("Adding must_change_password column to users table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE NOT NULL"))
                                else:
                                    conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT 0 NOT NULL"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add must_change_password column (may already exist): {e}")
                
                # Verify columns exist in frenzy_events table
                if 'frenzy_events' in table_names:
                    frenzy_columns = [col['name'] for col in inspector.get_columns('frenzy_events')]
                    if 'severity' not in frenzy_columns:
                        print("Adding severity column to frenzy_events table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text(
                                        "ALTER TABLE frenzy_events ADD COLUMN IF NOT EXISTS severity INTEGER"
                                    ))
                                else:
                                    conn.execute(text(
                                        "ALTER TABLE frenzy_events ADD COLUMN severity INTEGER"
                                    ))
                                conn.execute(text(
                                    "UPDATE frenzy_events SET severity = 1 WHERE severity IS NULL"
                                ))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add frenzy_events.severity column (may already exist): {e}")

                # Verify columns exist in students table
                if 'students' in table_names:
                    columns = [col['name'] for col in inspector.get_columns('students')]
                    if 'lunch_number' not in columns:
                        print("Adding lunch_number column to students table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE students ADD COLUMN lunch_number VARCHAR(50)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add lunch_number column (may already exist): {e}")
                    if 'card_color' not in columns:
                        print("Adding card_color column to students table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE students ADD COLUMN card_color VARCHAR(20)"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add card_color column (may already exist): {e}")
                    if 'directory_info_opt_out' not in columns:
                        print("Adding directory_info_opt_out column to students table...")
                        try:
                            with db.engine.connect() as conn:
                                if is_postgres:
                                    conn.execute(text("ALTER TABLE students ADD COLUMN directory_info_opt_out BOOLEAN DEFAULT FALSE NOT NULL"))
                                else:
                                    conn.execute(text("ALTER TABLE students ADD COLUMN directory_info_opt_out BOOLEAN DEFAULT 0 NOT NULL"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add directory_info_opt_out column (may already exist): {e}")
                    if 'card_level_reset_at' not in columns:
                        print("Adding card_level_reset_at column to students table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE students ADD COLUMN card_level_reset_at DATE"))
                                conn.commit()
                        except (OperationalError, ProgrammingError) as e:
                            print(f"Note: Could not add card_level_reset_at column (may already exist): {e}")
            except Exception as inner_e:
                print(f"Error during database migration: {inner_e}")
                import traceback
                traceback.print_exc()
                # Don't raise - migrations are optional
    except Exception as e:
        print(f"Error initializing database: {e}")
        import traceback
        traceback.print_exc()
        # Re-raise to ensure we know about connection failures
        raise

# Initialize database when module is imported (for gunicorn/production)
# This ensures tables are created even when app is imported by gunicorn
_db_initialized = False
try:
    print("Loading app: running database setup (this can take a few seconds)...", flush=True)
    init_db()
    _db_initialized = True
    print("Database initialized successfully on import", flush=True)
except Exception as e:
    print(f"Warning: Database initialization failed on import: {e}", flush=True)
    import traceback
    traceback.print_exc()
    # Don't fail completely - let the app start and try again on first request
    # The database might not be ready yet, or there might be a connection issue
    _db_initialized = False

# Ensure database is initialized before handling requests
@app.before_request
def ensure_db_initialized():
    """Ensure database is initialized before handling requests"""
    global _db_initialized
    if not _db_initialized:
        try:
            init_db()
            _db_initialized = True
            print("Database initialized successfully on first request", flush=True)
        except Exception as e:
            print(f"Database initialization still failing: {e}")
            # Log but don't block - let the route handle the error
            import traceback
            traceback.print_exc()

# Login route
# Shared school Wi-Fi: do not cap page loads. Cap POST guesses per username, with a high IP ceiling.
@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("30 per minute", key_func=_login_attempt_key, methods=["POST"])
@limiter.limit("300 per minute", key_func=get_remote_address, methods=["POST"])
def login():
    if request.method == 'GET':
        return render_template('login.html')
    
    try:
        data = request.json
        if not data:
            return jsonify({'success': False, 'error': 'Invalid request. Please provide username and password.'}), 400
        
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        
        if not username or not password:
            return jsonify({'success': False, 'error': 'Username and password are required.'}), 400
        
        user = User.query.filter_by(username=username).first()
        
        # Prevent parent logins
        if user and user.role == 'parent':
            return jsonify({'success': False, 'error': 'Parent accounts are no longer supported. Please contact an administrator.'}), 403
        
        if user and user.check_password(password):
            login_user(user)
            # Audit: Log successful login
            log_phi_access(
                action='LOGIN',
                user_id=user.id,
                username=user.username,
                role=user.role,
                resource_type='authentication',
                ip_address=get_remote_address()
            )
            return jsonify({
                'success': True,
                'must_change_password': getattr(user, 'must_change_password', False) and user.role == 'staff'
            }), 200
        else:
            # Audit: Log failed login attempt
            if user:
                log_phi_access(
                    action='LOGIN_FAILED',
                    user_id=user.id,
                    username=user.username,
                    role=user.role,
                    resource_type='authentication',
                    details='Invalid password',
                    ip_address=get_remote_address()
                )
            else:
                log_phi_access(
                    action='LOGIN_FAILED',
                    user_id=None,
                    username=username,
                    role='unknown',
                    resource_type='authentication',
                    details='User not found',
                    ip_address=get_remote_address()
                )
            return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        app.logger.error(f'Login error: {str(e)}\n{error_trace}')
        print(f'Login error: {str(e)}\n{error_trace}')  # Also print to console
        return jsonify({'success': False, 'error': f'An error occurred during login: {str(e)}'}), 500

@app.route('/api/register', methods=['POST'])
@limiter.limit("60 per minute")
@limiter.limit("300 per hour")
def register():
    """Public registration endpoint for creating accounts"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        role = data.get('role')
        username = data.get('username', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate required fields
        if not role or not username or not password:
            return jsonify({'error': 'Role, username, and password are required'}), 400
        
        # Validate role
        allowed_roles = ['student', 'staff']
        if role not in allowed_roles:
            return jsonify({'error': f'Invalid role. Allowed roles: {", ".join(allowed_roles)}'}), 400
        
        # Check if username already exists
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already exists'}), 400
        
        # Validate password strength
        is_valid, error_msg = validate_password_strength(password)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Create user based on role
        if role == 'student':
            # Student accounts require grade
            grade = data.get('grade')
            if not grade:
                return jsonify({'error': 'Grade is required for student accounts'}), 400
            
            # Create student user
            student_user = User(
                name=name or None,
                username=username,
                role='student',
                password_hash=generate_password_hash(password),
                grade=grade
            )
            db.session.add(student_user)
            db.session.commit()
            
            # Log registration
            log_phi_access(
                action='REGISTER',
                user_id=None,
                username=username,
                role='public',
                resource_type='users',
                resource_id=student_user.id,
                details=f"Self-registered student account",
                ip_address=get_remote_address()
            )
            
            return jsonify({
                'id': student_user.id,
                'username': student_user.username,
                'name': student_user.name,
                'message': 'Student account created successfully.'
            }), 201
        
        elif role == 'staff':
            # Staff accounts require designation
            designation = data.get('designation')
            if not designation:
                return jsonify({'error': 'Designation is required for staff accounts'}), 400
            
            # Create staff user
            staff_user = User(
                name=name or None,
                username=username,
                role='staff',
                password_hash=generate_password_hash(password),
                designation=designation
            )
            db.session.add(staff_user)
            db.session.commit()
            
            # Log registration
            log_phi_access(
                action='REGISTER',
                user_id=None,
                username=username,
                role='public',
                resource_type='users',
                resource_id=staff_user.id,
                details=f"Self-registered staff account with designation {designation}",
                ip_address=get_remote_address()
            )
            
            return jsonify({
                'id': staff_user.id,
                'username': staff_user.username,
                'name': staff_user.name,
                'message': 'Staff account created successfully. Your account may require approval before full access.'
            }), 201
        
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'error': 'An error occurred during registration. Please try again.'}), 500

@app.route('/logout')
@login_required
def logout():
    # Audit: Log logout
    log_phi_access(
        action='LOGOUT',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='authentication',
        ip_address=get_remote_address()
    )
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template(
        'index.html',
        user=current_user,
        date=date,
        must_change_password=getattr(current_user, 'must_change_password', False) and current_user.role == 'staff'
    )


def _stripe_client():
    if stripe_sdk is None or not STRIPE_SECRET_KEY:
        return None
    return stripe_sdk.StripeClient(STRIPE_SECRET_KEY)


def _price_id_of(price_obj):
    return _stripe_id(_stripe_get(price_obj, 'id'))


def _lookup_stripe_price(lookup_key, fallback_price_id=None, fresh=False):
    """Resolve the live Stripe Price for a stable lookup key (Dashboard-updated)."""
    if stripe_sdk is None or not STRIPE_SECRET_KEY:
        return None
    cache_key = lookup_key or fallback_price_id or ''
    now = time.time()
    if not fresh and cache_key:
        cached = _STRIPE_PRICE_CACHE.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
    price_obj = None
    if lookup_key:
        try:
            client = _stripe_client()
            params = {
                'lookup_keys': [lookup_key],
                'active': True,
                'expand': ['data.product'],
                'limit': 1,
            }
            result = None
            if client is not None:
                try:
                    result = client.v1.prices.list(params)
                except TypeError:
                    result = None
            if result is None:
                result = stripe_sdk.Price.list(
                    lookup_keys=[lookup_key],
                    active=True,
                    expand=['data.product'],
                    limit=1,
                )
            data = _stripe_get(result, 'data') or []
            if data:
                price_obj = data[0]
        except Exception:
            app.logger.exception('Could not look up Stripe price %s', lookup_key)
    if price_obj is None and fallback_price_id:
        try:
            price_obj = stripe_sdk.Price.retrieve(fallback_price_id, expand=['product'])
        except Exception:
            app.logger.exception('Could not load Stripe price %s', fallback_price_id)
    if cache_key:
        ttl = _STRIPE_PRICE_CACHE_TTL if price_obj is not None else 15
        _STRIPE_PRICE_CACHE[cache_key] = (now + ttl, price_obj)
    return price_obj


def _monthly_price(fresh=False):
    return _lookup_stripe_price(STRIPE_PRICE_LOOKUP_KEY, STRIPE_PRICE_ID, fresh=fresh)


def _build_fee_price(fresh=False):
    return _lookup_stripe_price(STRIPE_BUILD_FEE_LOOKUP_KEY, STRIPE_BUILD_FEE_PRICE_ID, fresh=fresh)


def _stripe_configured():
    return bool(stripe_sdk is not None and STRIPE_SECRET_KEY and _price_id_of(_monthly_price()))


def _build_fee_configured():
    return bool(_price_id_of(_build_fee_price()))


def _build_fee_price_ids():
    ids = set()
    pid = _price_id_of(_build_fee_price())
    if pid:
        ids.add(pid)
    if STRIPE_BUILD_FEE_PRICE_ID:
        ids.add(STRIPE_BUILD_FEE_PRICE_ID)
    return ids


def _public_base_url():
    env_url = (os.environ.get('RENDER_EXTERNAL_URL') or '').strip().rstrip('/')
    if env_url:
        return env_url
    return request.host_url.rstrip('/')


def _stripe_get(obj, key, default=None):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _stripe_id(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return _stripe_get(value, 'id')


def _checkout_integration_id(kind):
    return f"{kind}-{secrets.token_hex(4)}"


def _format_price_label(price_obj, fallback_interval=None):
    if price_obj is None:
        return None
    amount = (_stripe_get(price_obj, 'unit_amount') or 0) / 100.0
    recurring = _stripe_get(price_obj, 'recurring')
    interval = _stripe_get(recurring, 'interval') if recurring else fallback_interval
    currency = (_stripe_get(price_obj, 'currency') or 'usd').upper()
    money = f"${amount:.2f}" if currency == 'USD' else f"{amount:.2f} {currency}"
    if interval:
        return f"{money} / {interval}"
    return f"{money} one-time"


def _price_info_from_obj(price_obj, fallback_interval=None):
    if price_obj is None:
        return {'label': None, 'name': None}
    product = _stripe_get(price_obj, 'product')
    name = None
    if product is not None and not isinstance(product, str):
        name = _stripe_get(product, 'name')
    if not name:
        name = _stripe_get(price_obj, 'nickname')
    return {
        'label': _format_price_label(price_obj, fallback_interval),
        'name': name,
    }


def get_site_subscription():
    row = SiteSubscription.query.order_by(SiteSubscription.id.asc()).first()
    if row is None:
        row = SiteSubscription(status='inactive', build_fee_paid=False)
        db.session.add(row)
        db.session.commit()
    return row


def _subscription_is_current(status):
    return (status or '') in ('active', 'trialing')


def _on_paid_plan(status):
    return (status or '') in (
        'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
    )


def _mark_build_fee_paid(row, session_id=None):
    if row.build_fee_paid:
        if session_id and not row.build_fee_session_id:
            row.build_fee_session_id = session_id
            db.session.commit()
        return row
    row.build_fee_paid = True
    row.build_fee_paid_at = datetime.utcnow()
    if session_id:
        row.build_fee_session_id = session_id
    row.updated_at = datetime.utcnow()
    db.session.commit()
    return row


def _period_end_from_subscription(sub):
    ts = _stripe_get(sub, 'current_period_end')
    if not ts:
        items = _stripe_get(sub, 'items') or {}
        data = _stripe_get(items, 'data') if not isinstance(items, dict) else items.get('data')
        if not data and isinstance(items, dict):
            data = items.get('data')
        if data:
            ts = _stripe_get(data[0], 'current_period_end')
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)


def _apply_stripe_subscription(sub):
    row = get_site_subscription()
    row.stripe_subscription_id = _stripe_id(_stripe_get(sub, 'id')) or row.stripe_subscription_id
    row.stripe_customer_id = _stripe_id(_stripe_get(sub, 'customer')) or row.stripe_customer_id
    row.status = _stripe_get(sub, 'status') or row.status
    row.cancel_at_period_end = bool(_stripe_get(sub, 'cancel_at_period_end') or False)
    row.current_period_end = _period_end_from_subscription(sub)
    items = _stripe_get(sub, 'items') or {}
    data = items.get('data') if isinstance(items, dict) else _stripe_get(items, 'data')
    if data:
        price = _stripe_get(data[0], 'price')
        price_id = _stripe_get(price, 'id') if price is not None else None
        if price_id:
            row.price_id = price_id
    row.updated_at = datetime.utcnow()
    db.session.commit()
    return row


def _billing_status_payload():
    row = get_site_subscription()
    monthly_ok = _subscription_is_current(row.status)
    on_paid_plan = _on_paid_plan(row.status)
    monthly_obj = _monthly_price()
    build_obj = _build_fee_price()
    configured = bool(stripe_sdk is not None and STRIPE_SECRET_KEY and _price_id_of(monthly_obj))
    build_required = bool(_price_id_of(build_obj))
    build_paid = bool(row.build_fee_paid) if build_required else True
    up_to_date = monthly_ok and build_paid
    monthly_info = _price_info_from_obj(monthly_obj, 'month') if configured else {'label': None, 'name': None}
    build_info = _price_info_from_obj(build_obj) if build_required and configured else {'label': None, 'name': None}
    period_end = row.current_period_end.isoformat() + 'Z' if row.current_period_end else None
    build_paid_at = row.build_fee_paid_at.isoformat() + 'Z' if row.build_fee_paid_at else None
    paid_name = monthly_info.get('name') or 'Paid plan'
    plans = [{
        'id': 'free',
        'name': 'Free',
        'price_label': 'Included',
        'kind': 'free',
        'current': not on_paid_plan,
    }]
    if configured:
        plans.append({
            'id': 'paid',
            'name': paid_name,
            'price_label': monthly_info.get('label'),
            'kind': 'paid',
            'current': on_paid_plan,
            'build_fee_label': build_info.get('label') if build_required else None,
        })
    return {
        'configured': configured,
        'build_fee_configured': build_required,
        'status': row.status or 'inactive',
        'monthly_ok': monthly_ok,
        'on_paid_plan': on_paid_plan,
        'current_plan': 'paid' if on_paid_plan else 'free',
        'plan_name': paid_name if on_paid_plan else 'Free',
        'plans': plans,
        'build_fee_paid': bool(row.build_fee_paid),
        'build_fee_paid_at': build_paid_at,
        'build_fee_required': build_required,
        'up_to_date': up_to_date,
        'cancel_at_period_end': bool(row.cancel_at_period_end),
        'current_period_end': period_end,
        'has_customer': bool(row.stripe_customer_id),
        'price_label': monthly_info.get('label'),
        'product_name': monthly_info.get('name'),
        'build_fee_label': build_info.get('label'),
        'build_fee_name': build_info.get('name'),
        'customer_email': row.customer_email,
        'can_subscribe': configured and not monthly_ok,
        'can_pay_build_fee': (
            configured and build_required and not bool(row.build_fee_paid)
        ),
        'needs_attention': (row.status or '') in ('past_due', 'unpaid', 'incomplete'),
    }


@app.route('/api/billing/status', methods=['GET'])
@login_required
@admin_required
def billing_status():
    return jsonify(_billing_status_payload())


@app.route('/api/billing/checkout', methods=['POST'])
@login_required
@admin_required
def billing_checkout():
    row = get_site_subscription()
    monthly = _monthly_price(fresh=True)
    monthly_id = _price_id_of(monthly)
    if stripe_sdk is None or not STRIPE_SECRET_KEY or not monthly_id:
        return jsonify({
            'error': 'Stripe is not configured. Set a lookup key of "monthly" on the live monthly Price in Stripe (or STRIPE_PRICE_ID as a fallback).'
        }), 400
    build = _build_fee_price(fresh=True)
    build_id = _price_id_of(build)
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or row.customer_email or '').strip()
    intent = (data.get('intent') or 'auto').strip().lower()
    base = _public_base_url()
    include_build = (
        bool(build_id)
        and not bool(row.build_fee_paid)
        and intent in ('auto', 'subscribe', 'both')
    )
    monthly_ok = _subscription_is_current(row.status)

    # Build-fee only (subscription already current).
    if intent == 'build_fee' or (monthly_ok and include_build and intent == 'auto'):
        if not build_id:
            return jsonify({'error': 'Build fee price is not configured. Set lookup key "build_fee" on that Price in Stripe.'}), 400
        if row.build_fee_paid:
            return jsonify({'error': 'Build fee is already marked paid.'}), 400
        kwargs = {
            'mode': 'payment',
            'line_items': [{'price': build_id, 'quantity': 1}],
            'success_url': base + '/?billing=success',
            'cancel_url': base + '/?billing=canceled',
            'client_reference_id': str(current_user.id),
            'allow_promotion_codes': True,
            'metadata': {
                'site': 'behavior-tracking',
                'admin_user_id': str(current_user.id),
                'purpose': 'build_fee',
            },
            'integration_identifier': _checkout_integration_id('buildfee'),
        }
        if row.stripe_customer_id:
            kwargs['customer'] = row.stripe_customer_id
        elif email:
            kwargs['customer_email'] = email
        try:
            session = stripe_sdk.checkout.Session.create(**kwargs)
        except Exception as e:
            app.logger.exception('Stripe build-fee checkout failed')
            return jsonify({'error': 'Could not start build-fee checkout', 'detail': str(e)}), 400
        return jsonify({'url': session.url})

    if monthly_ok:
        return jsonify({'error': 'Monthly subscription is already active. Use Manage Plan to change it.'}), 400

    line_items = [{'price': monthly_id, 'quantity': 1}]
    metadata = {
        'site': 'behavior-tracking',
        'admin_user_id': str(current_user.id),
        'purpose': 'subscription',
    }
    if include_build:
        line_items.append({'price': build_id, 'quantity': 1})
        metadata['purpose'] = 'subscription_and_build_fee'
        metadata['includes_build_fee'] = 'true'

    kwargs = {
        'mode': 'subscription',
        'line_items': line_items,
        'success_url': base + '/?billing=success',
        'cancel_url': base + '/?billing=canceled',
        'client_reference_id': str(current_user.id),
        'allow_promotion_codes': True,
        'metadata': metadata,
        'integration_identifier': _checkout_integration_id('subscribe'),
    }
    if row.stripe_customer_id:
        kwargs['customer'] = row.stripe_customer_id
    elif email:
        kwargs['customer_email'] = email
    try:
        session = stripe_sdk.checkout.Session.create(**kwargs)
    except Exception as e:
        app.logger.exception('Stripe checkout session failed')
        return jsonify({'error': 'Could not start checkout', 'detail': str(e)}), 400
    return jsonify({'url': session.url})


@app.route('/api/billing/portal', methods=['POST'])
@login_required
@admin_required
def billing_portal():
    if not _stripe_configured():
        return jsonify({'error': 'Stripe is not configured.'}), 400
    row = get_site_subscription()
    if not row.stripe_customer_id:
        return jsonify({'error': 'No billing customer yet. Subscribe first.'}), 400
    try:
        portal = stripe_sdk.billing_portal.Session.create(
            customer=row.stripe_customer_id,
            return_url=_public_base_url() + '/?billing=portal',
        )
    except Exception as e:
        app.logger.exception('Stripe billing portal failed')
        return jsonify({
            'error': 'Could not open billing portal. Enable it in the Stripe Dashboard under Settings → Billing → Customer portal.',
            'detail': str(e),
        }), 400
    return jsonify({'url': portal.url})


@app.route('/api/stripe/webhook', methods=['POST'])
@limiter.exempt
def stripe_webhook():
    if stripe_sdk is None or not STRIPE_WEBHOOK_SECRET:
        return jsonify({'error': 'Webhook not configured'}), 400
    payload = request.get_data(as_text=True)
    sig = request.headers.get('Stripe-Signature', '')
    try:
        event = stripe_sdk.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        app.logger.exception('Stripe webhook signature verification failed')
        return jsonify({'error': 'Invalid signature'}), 400

    event_type = event.get('type') if isinstance(event, dict) else getattr(event, 'type', None)
    obj = event['data']['object'] if isinstance(event, dict) else event.data.object

    try:
        if event_type == 'checkout.session.completed':
            mode = _stripe_get(obj, 'mode')
            session_id = _stripe_id(_stripe_get(obj, 'id'))
            metadata = _stripe_get(obj, 'metadata') or {}
            purpose = _stripe_get(metadata, 'purpose') if metadata is not None else None
            includes_build = str(_stripe_get(metadata, 'includes_build_fee') or '').lower() in (
                '1', 'true', 'yes'
            )
            row = get_site_subscription()
            customer_id = _stripe_id(_stripe_get(obj, 'customer'))
            email = _stripe_get(obj, 'customer_details')
            email_value = _stripe_get(email, 'email') if email is not None else None
            if not email_value:
                email_value = _stripe_get(obj, 'customer_email')
            if customer_id:
                row.stripe_customer_id = customer_id
            if email_value:
                row.customer_email = email_value
            db.session.commit()

            if mode == 'subscription':
                sub_id = _stripe_id(_stripe_get(obj, 'subscription'))
                if sub_id:
                    sub = stripe_sdk.Subscription.retrieve(sub_id)
                    _apply_stripe_subscription(sub)
                if includes_build or purpose in ('subscription_and_build_fee', 'build_fee'):
                    _mark_build_fee_paid(get_site_subscription(), session_id=session_id)
            elif mode == 'payment' and (
                purpose == 'build_fee' or includes_build
            ):
                _mark_build_fee_paid(get_site_subscription(), session_id=session_id)
        elif event_type in (
            'customer.subscription.created',
            'customer.subscription.updated',
            'customer.subscription.deleted',
        ):
            _apply_stripe_subscription(obj)
        elif event_type in ('invoice.paid', 'invoice.payment_failed'):
            sub_id = _stripe_id(_stripe_get(obj, 'subscription'))
            if sub_id:
                sub = stripe_sdk.Subscription.retrieve(sub_id)
                _apply_stripe_subscription(sub)
            if event_type == 'invoice.paid':
                fee_ids = _build_fee_price_ids()
                lines = _stripe_get(obj, 'lines') or {}
                line_data = _stripe_get(lines, 'data') if not isinstance(lines, dict) else lines.get('data')
                for line in (line_data or []):
                    price = _stripe_get(line, 'price')
                    price_id = _stripe_id(_stripe_get(price, 'id') if price is not None else None)
                    lookup_key = _stripe_get(price, 'lookup_key') if price is not None else None
                    if price_id in fee_ids or lookup_key == STRIPE_BUILD_FEE_LOOKUP_KEY:
                        _mark_build_fee_paid(get_site_subscription())
                        break
    except Exception:
        app.logger.exception('Stripe webhook handler failed for %s', event_type)
        return jsonify({'error': 'Webhook handler failed'}), 500

    return jsonify({'received': True})


@app.route('/insights')
@login_required
def insights_dashboard():
    insights_student_id = None
    insights_staff_id = None
    insights_managed_by_me = False
    if current_user.role == 'student' and getattr(current_user, 'student_id', None):
        insights_student_id = current_user.student_id
    return render_template(
        'insights-dashboard.html',
        user=current_user,
        insights_student_id=insights_student_id,
        insights_staff_id=insights_staff_id,
        insights_managed_by_me=insights_managed_by_me,
    )


@app.route('/api/insights', methods=['GET'])
@login_required
def api_insights():
    student_id_arg = request.args.get('student_id', type=int)
    log_phi_access(
        action='VIEW',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='insights',
        resource_id=student_id_arg,
        details='insights dashboard api',
        ip_address=get_remote_address(),
    )

    days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    time_blocks = ['Before School', 'Block 1', 'Block 2', 'Block 3', 'Block 4', 'After School']
    empty_cell = {'count': 0, 'infractions': [], 'resets': 0, 'frenzies': 0}
    cells = [[dict(empty_cell) for _ in time_blocks] for _ in days]

    labels_week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    zeros7 = [0, 0, 0, 0, 0, 0, 0]
    star_labels = ['Safety', 'Teamwork', 'Accountability', 'Relationships']
    zeros4 = [0.0, 0.0, 0.0, 0.0]
    growth_labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4']
    zeros_growth = [0, 0, 0, 0]

    return jsonify({
        'pulse': {
            'attendancePercent': 0,
            'starAveragePercent': 0,
            'currentState': 'stagnation',
        },
        'heatmap': {'days': days, 'timeBlocks': time_blocks, 'cells': cells},
        'escalation': {'labels': labels_week, 'reminders': zeros7, 'resets': zeros7, 'frenzies': zeros7},
        'infractionCategories': {'labels': ['Pattern A', 'Pattern B', 'Pattern C', 'Other'], 'values': [0, 0, 0, 0]},
        'starRadar': {'labels': star_labels, 'currentMonth': zeros4, 'previousMonth': zeros4},
        'growthTimeline': {'labels': growth_labels, 'starPercent': zeros_growth, 'totalIncidents': zeros_growth},
    })

@app.route('/api/students', methods=['GET', 'POST'])
@login_required
def students():
    if request.method == 'POST':
        # Only staff and admin can create students (but not Outside Staff)
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        # Block Outside Staff from creating students
        if current_user.role == 'staff' and current_user.is_outside_staff:
            return jsonify({'error': 'Outside Staff cannot create students'}), 403
        
        data = request.json
        
        # Create student record
        student = Student(
            name=data['name'], 
            email=data.get('email'),
            grade=data.get('grade'),
            card_color=data.get('card_color')
        )
        db.session.add(student)
        db.session.flush()  # Get student ID before committing
        
        # Create user account if username and password provided
        if data.get('username') and data.get('password'):
            # Check if username already exists
            if User.query.filter_by(username=data['username']).first():
                db.session.rollback()
                return jsonify({'error': 'Username already exists'}), 400
            
            # Audit: Validate password strength
            password = data['password']
            is_valid, error_msg = validate_password_strength(password)
            if not is_valid:
                db.session.rollback()
                return jsonify({'error': error_msg}), 400
            
            user = User(
                name=data['name'],
                username=data['username'],
                role='student',
                student_id=student.id
            )
            user.set_password(password)
            db.session.add(user)
        
        # Save team member info if provided
        team_roles = {
            'Professional': data.get('professional'),
            'Practitioner': data.get('practitioner'),
            'Case Manager': data.get('case_manager'),
            'Group Leader': data.get('group_leader'),
            'Paraprofessional': data.get('paraprofessional')
        }
        
        for role, names in team_roles.items():
            if not names:
                continue
            # Handle both array and single value for backward compatibility
            if not isinstance(names, list):
                names = [names]
            
            for name in names:
                if name and str(name).strip():
                    team_member = TeamMember(
                        student_id=student.id,
                        role=role,
                        name=str(name).strip()
                    )
                    db.session.add(team_member)
        
        db.session.commit()
        
        # Audit: Log student creation
        log_phi_access(
            action='CREATE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='students',
            resource_id=student.id,
            details=f"Created student: {student.name}",
            ip_address=get_remote_address()
        )
        
        return jsonify({'id': student.id, 'name': student.name}), 201
    else:
        # Students and parents can only see their own/their child's data, staff/admin can see all
        if current_user.role == 'student':
            if current_user.student_id:
                student = Student.query.get(current_user.student_id)
                # Audit: Log student data access
                log_phi_access(
                    action='VIEW',
                    user_id=current_user.id,
                    username=current_user.username,
                    role=current_user.role,
                    resource_type='students',
                    resource_id=current_user.student_id,
                    ip_address=get_remote_address()
                )
                return jsonify([{'id': student.id, 'name': student.name, 'email': student.email}])
            return jsonify([])
        else:
            # Audit: Log student list access
            log_phi_access(
                action='VIEW',
                user_id=current_user.id,
                username=current_user.username,
                role=current_user.role,
                resource_type='students',
                resource_id='all',
                ip_address=get_remote_address()
            )
            
            # Check if filtering by "managed by me"
            managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
            
            # Filter by Outside Staff assignments if applicable
            if current_user.role == 'staff' and current_user.is_outside_staff:
                # Outside Staff can only see assigned students
                assigned_student_ids = [assoc.student_id for assoc in 
                                      OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
                if not assigned_student_ids:
                    return jsonify([])
                query = Student.query.filter(Student.id.in_(assigned_student_ids))
            else:
                query = Student.query
            
            if managed_by_me:
                # Paraprofessional with a linked Case Manager: show that case manager's students
                linked_cm_id = getattr(current_user, 'linked_case_manager_id', None)
                if (
                    current_user.role == 'staff'
                    and getattr(current_user, 'designation', None) == 'Paraprofessional'
                    and linked_cm_id
                ):
                    linked_cm = User.query.get(linked_cm_id)
                    if linked_cm and linked_cm.designation == 'Case Manager':
                        cm_name = linked_cm.name or linked_cm.username or ''
                        cm_username = linked_cm.username or ''
                        team_members = TeamMember.query.filter(
                            TeamMember.role == 'Case Manager',
                            db.or_(
                                db.func.lower(TeamMember.name) == db.func.lower(cm_name),
                                db.func.lower(TeamMember.name) == db.func.lower(cm_username),
                            ),
                        ).all()
                        student_ids = list({tm.student_id for tm in team_members if tm.student_id})
                        if student_ids:
                            if current_user.role == 'staff' and current_user.is_outside_staff:
                                assigned_student_ids = [
                                    assoc.student_id
                                    for assoc in OutsideStaffStudent.query.filter_by(
                                        user_id=current_user.id
                                    ).all()
                                ]
                                student_ids = [sid for sid in student_ids if sid in assigned_student_ids]
                            if student_ids:
                                students = (
                                    query.filter(Student.id.in_(student_ids))
                                    .order_by(Student.name)
                                    .all()
                                )
                            else:
                                students = []
                        else:
                            students = []
                    else:
                        students = []
                else:
                    # Get current user's name and username - team members might be stored with either
                    user_name = (current_user.name or current_user.username or '').strip()
                    user_username = (current_user.username or '').strip()

                    # Find all students where this user is a team member (case-insensitive match)
                    team_members = TeamMember.query.filter(
                        db.or_(
                            db.func.lower(TeamMember.name) == db.func.lower(user_name),
                            db.func.lower(TeamMember.name) == db.func.lower(user_username),
                        )
                    ).all()
                    student_ids = list({tm.student_id for tm in team_members if tm.student_id})

                    if student_ids:
                        # Intersect with Outside Staff assignments if applicable
                        if current_user.role == 'staff' and current_user.is_outside_staff:
                            assigned_student_ids = [
                                assoc.student_id
                                for assoc in OutsideStaffStudent.query.filter_by(
                                    user_id=current_user.id
                                ).all()
                            ]
                            student_ids = [sid for sid in student_ids if sid in assigned_student_ids]

                        if student_ids:
                            students = (
                                query.filter(Student.id.in_(student_ids))
                                .order_by(Student.name)
                                .all()
                            )
                        else:
                            students = []
                    else:
                        students = []
            else:
                students = query.order_by(Student.name).all()
            
            # Additional restriction: for ALL roles in normal mode (including admin),
            # only expose students who currently have an active student user account in the
            # "Student Users" table. This ensures that once a student's user account is
            # removed/archived, their data is no longer accessible in daily/period entry,
            # user linking, or other standard views. Archived students can still be viewed
            # separately via the dedicated archived-students admin view.
            # Get all student user accounts
            student_users = User.query.filter_by(role='student').all()
            student_user_ids = {u.student_id for u in student_users if u.student_id}
            # Filter students list down to those with student user accounts
            students = [s for s in students if s.id in student_user_ids]
            
            # Filter out students who opted out of directory information
            # Directory information includes name, email, grade, etc.
            students = filter_directory_info(students, include_opted_out=False)
            
            return jsonify([{
                'id': s.id,
                'name': s.name,
                'email': s.email,
                'card_color': s.card_color,
                'grade': s.grade,
            } for s in students])

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
@login_required
def delete_student(student_id):
    # Only staff and admin can delete students
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    # Verify Outside Staff has access to this student
    if current_user.role == 'staff' and current_user.is_outside_staff:
        if not has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied to this student'}), 403
    
    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    
    # Delete associated user account if exists
    user = User.query.filter_by(student_id=student_id).first()
    if user:
        db.session.delete(user)
    
    # Delete student (cascades to daily records, etc.)
    db.session.delete(student)
    db.session.commit()
    
    # Audit: Log student deletion
    log_phi_access(
        action='DELETE',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='students',
        resource_id=student_id,
        details=f"Deleted student: {student.name}",
        ip_address=get_remote_address()
    )
    
    return jsonify({'message': 'Student deleted successfully'}), 200

@app.route('/api/students/by-staff-period', methods=['GET'])
@login_required
def students_by_staff_period():
    """Get students who have the current staff member in their schedule for a given period and optionally class"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    period = request.args.get('period')
    class_name = request.args.get('class_name', '').strip()  # Optional class name filter
    on_date = _parse_schedule_date(request.args.get('date')) or school_now().date()
    if not period:
        return jsonify({'error': 'Period parameter is required'}), 400
    
    # Get current user's name (prefer name, fall back to username)
    staff_name = current_user.name or current_user.username
    
    # Find all student schedules where staff_name matches and time_period matches
    query = Schedule.query.filter_by(
        schedule_type='student',
        time_period=period,
        staff_name=staff_name
    )
    
    # Filter by class_name if provided
    if class_name:
        query = query.filter_by(class_name=class_name)
    
    matching_schedules = [
        s for s in query.all()
        if schedule_entry_applies_on_date(s, on_date)
    ]
    
    # Get unique student IDs
    student_ids = list(set([s.student_id for s in matching_schedules if s.student_id]))

    # Assigned outside staff also see students who are at the other school this period
    if current_user.role == 'staff' and current_user.is_outside_staff:
        assigned_ids = [
            assoc.student_id
            for assoc in OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()
        ]
        extra_ids = []
        transitions = _transitions_by_student_id(assigned_ids)
        for sid in assigned_ids:
            if not is_home_period(transitions.get(sid), period):
                extra_ids.append(sid)
        student_ids = list(set(student_ids) | set(extra_ids))
    
    # Get student details
    if student_ids:
        students = Student.query.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
        
        # In normal views (including for admin), further restrict to students that have an
        # active student user account. This keeps archived/non-user students from
        # appearing in period entry lists. Archived students are available via a
        # separate admin-only archived-students view.
        student_users = User.query.filter_by(role='student').all()
        student_user_ids = {u.student_id for u in student_users if u.student_id}
        students = [s for s in students if s.id in student_user_ids]
        
        # Filter out students who opted out of directory information
        students = filter_directory_info(students, include_opted_out=False)
        return jsonify([{
            'id': s.id,
            'name': s.name,
            'email': s.email,
            'card_color': s.card_color,
        } for s in students])
    else:
        return jsonify([])

@app.route('/api/students/by-staff-name', methods=['GET'])
@login_required
def students_by_staff_name():
    """Get students who have a specific staff member in their team members"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    staff_name = request.args.get('staff_name')
    if not staff_name:
        return jsonify({'error': 'staff_name parameter is required'}), 400
    
    # Strip whitespace from staff_name
    staff_name = staff_name.strip()
    
    # Debug: Log the search
    print(f"Searching for staff name: '{staff_name}'")
    
    # First, try to find the User record to get both name and username
    # This handles the case where TeamMember.name might store either name or username
    user = User.query.filter(
        (db.func.lower(User.name) == db.func.lower(staff_name)) |
        (db.func.lower(User.username) == db.func.lower(staff_name))
    ).first()
    
    if user:
        user_name = user.name or ''
        user_username = user.username or ''
        print(f"Found user: name='{user_name}', username='{user_username}'")
        
        # Search TeamMember for both name and username (case-insensitive)
        team_members = TeamMember.query.filter(
            (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
            (db.func.lower(TeamMember.name) == db.func.lower(user_username))
        ).all()
    else:
        print(f"User not found, trying direct match on TeamMember.name")
        # If user not found, try direct match on TeamMember.name
        # Try exact match first (case-insensitive)
        team_members = TeamMember.query.filter(
            db.func.lower(TeamMember.name) == db.func.lower(staff_name)
        ).all()
        
        # If no exact match, try partial match (case-insensitive)
        if not team_members:
            team_members = TeamMember.query.filter(
                TeamMember.name.ilike(f'%{staff_name}%')
            ).all()
    
    print(f"Found {len(team_members)} team member records")
    
    # Debug: Show what team members were found
    if team_members:
        print(f"Team member names found: {[tm.name for tm in team_members]}")
    
    # Get unique student IDs
    student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
    
    print(f"Found {len(student_ids)} unique student IDs: {student_ids}")
    
    # Get student details
    if student_ids:
        students = Student.query.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
        
        # Restrict to students that have an active student user account so that
        # archived/non-user students are not shown in normal staff/admin views.
        student_users = User.query.filter_by(role='student').all()
        student_user_ids = {u.student_id for u in student_users if u.student_id}
        students = [s for s in students if s.id in student_user_ids]
        
        # Filter out students who opted out of directory information
        students = filter_directory_info(students, include_opted_out=False)
        return jsonify([{'id': s.id, 'name': s.name, 'email': s.email} for s in students])
    else:
        print("No students found for this staff member")
        # Debug: Show all team members to help troubleshoot
        all_team_members = TeamMember.query.all()
        if all_team_members:
            unique_names = list(set([tm.name for tm in all_team_members]))
            print(f"All team member names in database: {unique_names}")
        return jsonify([])


@app.route('/api/students/archived', methods=['GET'])
@login_required
@admin_required
def archived_students():
    """
    Admin-only endpoint to view archived students.
    
    Archived students are those who no longer have an active User account with
    role='student' (i.e., they do not appear in the Student Users table).
    They are hidden from normal student lists and can only be viewed in this
    dedicated archived mode.
    """
    students = get_archived_students()
    student_ids = [s.id for s in students]
    team_by_student = {}
    if student_ids:
        for tm in TeamMember.query.filter(TeamMember.student_id.in_(student_ids)).all():
            team_by_student.setdefault(tm.student_id, {
                'case_manager': [], 'practitioner': [], 'professional': [],
                'group_leader': [], 'paraprofessional': []
            })
            role_key = tm.role.lower().replace(' ', '_')
            if role_key in team_by_student[tm.student_id] and tm.name:
                team_by_student[tm.student_id][role_key].append(tm.name)

    # Internal administrative view of historical data.
    result = []
    for s in students:
        entry = {
            'id': s.id,
            'name': s.name,
            'grade': s.grade,
            'card_color': s.card_color,
            'team_members': team_by_student.get(s.id, {
                'case_manager': [], 'practitioner': [], 'professional': [],
                'group_leader': [], 'paraprofessional': []
            })
        }
        result.append(entry)

    return jsonify(result)


@app.route('/api/students/<int:student_id>/restore-user', methods=['POST'])
@login_required
@admin_required
def restore_student_user(student_id):
    """
    Restore a student by creating a new User account (role='student') linked
    to an existing Student record that currently has no student user.
    """
    student = Student.query.get_or_404(student_id)
    
    # Check if there is already a student user linked to this student
    existing_user = User.query.filter_by(student_id=student.id, role='student').first()
    if existing_user:
        return jsonify({'error': 'This student already has a user account.'}), 400
    
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    
    if not username:
        return jsonify({'error': 'Username is required'}), 400
    if not password:
        return jsonify({'error': 'Password is required'}), 400
    
    # Check if username already exists
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400
    
    # Validate password strength
    is_valid, error_msg = validate_password_strength(password)
    if not is_valid:
        return jsonify({'error': error_msg}), 400
    
    # Create new student user linked to this student
    user = User(
        name=student.name,
        username=username,
        role='student',
        student_id=student.id
    )
    user.set_password(password)
    
    db.session.add(user)
    db.session.commit()
    
    # Log restoration as a CREATE of a user account for existing student
    log_phi_access(
        action='CREATE',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='users',
        resource_id=user.id,
        details=f"Restored student user for student_id={student.id}, username={username}",
        ip_address=get_remote_address()
    )
    
    return jsonify({
        'message': 'Student user restored successfully.',
        'user_id': user.id
    }), 201


# ---------------------------------------------------------------------------
# Student If/Then Plans
# ---------------------------------------------------------------------------

from student_plans_lib import (
    PLAN_IF_SEED_TEXTS,
    THRESHOLD_TYPES,
    normalize_if_text,
    parse_hhmm,
    parse_period_end_time,
    percent_from_periods,
    window_key_for_row,
    dow_index,
    week_monday,
)


def upsert_plan_if_library(text):
    norm = normalize_if_text(text)
    if not norm:
        return None
    entry = PlanIfLibrary.query.filter_by(normalized_text=norm).first()
    if entry:
        entry.usage_count = (entry.usage_count or 0) + 1
        if not entry.text and text:
            entry.text = text.strip()
        return entry
    entry = PlanIfLibrary(text=str(text).strip(), normalized_text=norm, usage_count=1)
    db.session.add(entry)
    return entry


def serialize_plan_row(row):
    return {
        'id': row.id,
        'sort_order': row.sort_order,
        'if_text': row.if_text or '',
        'then_text': row.then_text or '',
        'has_threshold': bool(row.has_threshold),
        'threshold_percent': float(row.threshold_percent) if row.threshold_percent is not None else None,
        'threshold_type': row.threshold_type,
        'cutoff_time': row.cutoff_time,
        'dow_start': row.dow_start,
        'dow_end': row.dow_end,
        'consecutive_n': row.consecutive_n,
        'days_needed': row.days_needed,
        'window_days': row.window_days,
        'period_time_range': row.period_time_range,
        'period_location': row.period_location,
        'star_category': row.star_category,
    }


def serialize_plan(plan):
    if not plan:
        return {'id': None, 'student_id': None, 'rows': [], 'updated_at': None}
    return {
        'id': plan.id,
        'student_id': plan.student_id,
        'updated_at': plan.updated_at.isoformat() if plan.updated_at else None,
        'updated_by_user_id': plan.updated_by_user_id,
        'rows': [serialize_plan_row(r) for r in sorted(plan.rows, key=lambda x: x.sort_order or 0)],
    }


def _day_percent_for_student(student_id, eval_date, star_category=None, cutoff_time=None, period_filter=None):
    """Overall or category STAR % for one day, optionally filtering periods by cutoff/period."""
    daily = DailyRecord.query.filter_by(student_id=student_id, date=eval_date).first()
    if not daily:
        return None
    periods = list(daily.periods or [])
    if cutoff_time is not None:
        filtered = []
        for p in periods:
            end_t = parse_period_end_time(p.time_range)
            if end_t is None:
                filtered.append(p)  # include when unknown
            elif end_t <= cutoff_time:
                filtered.append(p)
        periods = filtered
    if period_filter:
        tr = (period_filter.get('time_range') or '').strip().lower()
        loc = (period_filter.get('location') or '').strip().lower()
        matched = []
        for p in periods:
            ok = True
            if tr and (p.time_range or '').strip().lower() != tr:
                ok = False
            if loc and (p.location or '').strip().lower() != loc:
                ok = False
            if ok:
                matched.append(p)
        periods = matched
    return percent_from_periods(periods, star_category=star_category)


def _meets_threshold(pct, threshold_percent):
    if pct is None or threshold_percent is None:
        return False
    try:
        return float(pct) >= float(threshold_percent)
    except (TypeError, ValueError):
        return False


def evaluate_plan_row_met(row, student_id, eval_date, now_dt=None):
    """
    Return (is_met: bool, window_key: str|None).
    Structured threshold evaluation only; freeform If text is ignored here.
    """
    if not row.has_threshold or row.threshold_percent is None or not row.threshold_type:
        return False, None

    now_dt = now_dt or datetime.now()
    ttype = (row.threshold_type or '').strip()
    cat = row.star_category
    if ttype == 'category_specific':
        cat = cat or 's'
    thr = row.threshold_percent
    wkey = window_key_for_row(row, eval_date)

    if ttype == 'by_time':
        cutoff = parse_hhmm(row.cutoff_time)
        if cutoff is None:
            return False, None
        # Only evaluate at/after cutoff on that day
        if eval_date == now_dt.date() and now_dt.time() < cutoff:
            return False, None
        if eval_date > now_dt.date():
            return False, None
        pct = _day_percent_for_student(student_id, eval_date, star_category=cat, cutoff_time=cutoff)
        return _meets_threshold(pct, thr), wkey

    if ttype == 'end_of_day' or ttype == 'category_specific':
        # Treat as evaluable anytime (running day average); staff typically check after school
        pct = _day_percent_for_student(student_id, eval_date, star_category=cat)
        return _meets_threshold(pct, thr), wkey

    if ttype == 'specific_period':
        pct = _day_percent_for_student(
            student_id,
            eval_date,
            star_category=cat,
            period_filter={'time_range': row.period_time_range, 'location': row.period_location},
        )
        return _meets_threshold(pct, thr), wkey

    if ttype == 'dow_range':
        start_i = dow_index(row.dow_start)
        end_i = dow_index(row.dow_end)
        if start_i is None or end_i is None:
            return False, None
        # Inclusive DOW span within the current week Mon-Sun
        mon = week_monday(eval_date)
        days = []
        for i in range(7):
            d = mon + timedelta(days=i)
            di = d.weekday()
            if start_i <= end_i:
                in_range = start_i <= di <= end_i
            else:
                in_range = di >= start_i or di <= end_i
            if in_range and d <= eval_date:
                days.append(d)
        if not days:
            return False, None
        # Average of daily overall/category percents across included days that have data
        pcts = []
        for d in days:
            p = _day_percent_for_student(student_id, d, star_category=cat)
            if p is not None:
                pcts.append(p)
        if not pcts:
            return False, None
        avg = sum(pcts) / len(pcts)
        return _meets_threshold(avg, thr), wkey

    if ttype == 'consecutive_days':
        n = int(row.consecutive_n or 0)
        if n <= 0:
            return False, None
        # Check last n school days ending at eval_date that have daily records (or calendar days with data)
        ok_streak = 0
        d = eval_date
        checked = 0
        while checked < 60 and ok_streak < n:
            pct = _day_percent_for_student(student_id, d, star_category=cat)
            if pct is None:
                # skip days with no record
                d = d - timedelta(days=1)
                checked += 1
                continue
            if _meets_threshold(pct, thr):
                ok_streak += 1
            else:
                return False, None
            d = d - timedelta(days=1)
            checked += 1
        return ok_streak >= n, wkey

    if ttype == 'days_in_window':
        needed = int(row.days_needed or 0)
        window = int(row.window_days or 0)
        if needed <= 0 or window <= 0:
            return False, None
        hits = 0
        for i in range(window):
            d = eval_date - timedelta(days=i)
            pct = _day_percent_for_student(student_id, d, star_category=cat)
            if _meets_threshold(pct, thr):
                hits += 1
        return hits >= needed, wkey

    if ttype == 'weekly_average':
        mon = week_monday(eval_date)
        fri = mon + timedelta(days=4)
        end = min(eval_date, fri)
        pcts = []
        d = mon
        while d <= end:
            pct = _day_percent_for_student(student_id, d, star_category=cat)
            if pct is not None:
                pcts.append(pct)
            d += timedelta(days=1)
        if not pcts:
            return False, None
        avg = sum(pcts) / len(pcts)
        return _meets_threshold(avg, thr), wkey

    return False, None


def evaluate_and_record_plan_thresholds(student_id, eval_date=None, now_dt=None):
    """Evaluate all threshold rows for a student; insert met events once per window_key."""
    eval_date = eval_date or date.today()
    now_dt = now_dt or datetime.now()
    plan = StudentPlan.query.filter_by(student_id=student_id).first()
    if not plan:
        return []
    created = []
    for row in plan.rows:
        if not row.has_threshold:
            continue
        is_met, wkey = evaluate_plan_row_met(row, student_id, eval_date, now_dt=now_dt)
        if not is_met or not wkey:
            continue
        existing = PlanThresholdEvent.query.filter_by(plan_row_id=row.id, window_key=wkey).first()
        if existing:
            continue
        evt = PlanThresholdEvent(
            student_id=student_id,
            plan_row_id=row.id,
            if_normalized=normalize_if_text(row.if_text),
            window_key=wkey,
            met_at=now_dt,
        )
        db.session.add(evt)
        created.append(evt)
    if created:
        db.session.commit()
    return created


def get_active_plan_mets(student_id, eval_date=None):
    """Undelivered met events (stars) for a student."""
    evaluate_and_record_plan_thresholds(student_id, eval_date=eval_date)
    events = (
        PlanThresholdEvent.query
        .filter_by(student_id=student_id)
        .filter(PlanThresholdEvent.delivered_at.is_(None))
        .order_by(PlanThresholdEvent.met_at.desc())
        .all()
    )
    out = []
    for evt in events:
        row = evt.plan_row
        out.append({
            'event_id': evt.id,
            'student_id': student_id,
            'plan_row_id': evt.plan_row_id,
            'if_text': row.if_text if row else '',
            'then_text': row.then_text if row else '',
            'if_normalized': evt.if_normalized,
            'window_key': evt.window_key,
            'met_at': evt.met_at.isoformat() if evt.met_at else None,
        })
    return out


def build_plan_threshold_stats(student_ids, start_date=None, end_date=None):
    """Aggregate met/delivery stats for overview, grouped by normalized If text."""
    empty = {
        'overall': {'met_count': 0, 'delivered_count': 0, 'student_count': 0, 'unique_if_count': 0},
        'by_if': [],
        'by_student': [],
    }
    if not student_ids:
        return empty
    q = PlanThresholdEvent.query.filter(PlanThresholdEvent.student_id.in_(list(student_ids)))
    if start_date:
        q = q.filter(PlanThresholdEvent.met_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        q = q.filter(PlanThresholdEvent.met_at <= datetime.combine(end_date, datetime.max.time()))
    events = q.all()
    by_if = {}
    by_student = {}
    for evt in events:
        key = evt.if_normalized or ''
        bucket = by_if.setdefault(key, {
            'if_normalized': key,
            'if_text': key,
            'met_count': 0,
            'delivered_count': 0,
            'student_ids': set(),
        })
        bucket['met_count'] += 1
        if evt.delivered_at:
            bucket['delivered_count'] += 1
        bucket['student_ids'].add(evt.student_id)
        # Prefer display text from row
        if evt.plan_row and evt.plan_row.if_text:
            bucket['if_text'] = evt.plan_row.if_text

        sb = by_student.setdefault(evt.student_id, {
            'student_id': evt.student_id,
            'met_count': 0,
            'delivered_count': 0,
            'by_if': {},
        })
        sb['met_count'] += 1
        if evt.delivered_at:
            sb['delivered_count'] += 1
        ib = sb['by_if'].setdefault(key, {'if_normalized': key, 'if_text': bucket['if_text'], 'met_count': 0, 'delivered_count': 0})
        ib['met_count'] += 1
        if evt.delivered_at:
            ib['delivered_count'] += 1

    by_if_list = []
    for b in by_if.values():
        by_if_list.append({
            'if_normalized': b['if_normalized'],
            'if_text': b['if_text'],
            'met_count': b['met_count'],
            'delivered_count': b['delivered_count'],
            'student_count': len(b['student_ids']),
        })
    by_if_list.sort(key=lambda x: (-x['met_count'], x['if_text'] or ''))

    students_map = {s.id: s.name for s in Student.query.filter(Student.id.in_(list(student_ids))).all()} if student_ids else {}
    by_student_list = []
    for sid, sb in by_student.items():
        by_student_list.append({
            'student_id': sid,
            'student_name': students_map.get(sid, f'Student {sid}'),
            'met_count': sb['met_count'],
            'delivered_count': sb['delivered_count'],
            'any_if_met_count': sb['met_count'],
            'by_if': sorted(sb['by_if'].values(), key=lambda x: -x['met_count']),
        })
    by_student_list.sort(key=lambda x: (-x['met_count'], x['student_name'] or ''))

    return {
        'overall': {
            'met_count': len(events),
            'delivered_count': sum(1 for e in events if e.delivered_at),
            'student_count': len(by_student),
            'unique_if_count': len(by_if),
        },
        'by_if': by_if_list,
        'by_student': by_student_list,
    }


def empty_plan_threshold_stats():
    return {
        'overall': {'met_count': 0, 'delivered_count': 0, 'student_count': 0, 'unique_if_count': 0},
        'by_if': [],
        'by_student': [],
    }


@app.route('/api/plan-if-library', methods=['GET', 'POST'])
@login_required
def plan_if_library():
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    if request.method == 'GET':
        q = (request.args.get('q') or '').strip()
        query = PlanIfLibrary.query
        if q:
            like = f"%{q.lower()}%"
            query = query.filter(db.func.lower(PlanIfLibrary.text).like(like))
        rows = query.order_by(PlanIfLibrary.usage_count.desc(), PlanIfLibrary.text.asc()).limit(40).all()
        return jsonify([{'id': r.id, 'text': r.text, 'usage_count': r.usage_count or 0} for r in rows])

    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'text is required'}), 400
    entry = upsert_plan_if_library(text)
    db.session.commit()
    return jsonify({'id': entry.id, 'text': entry.text, 'usage_count': entry.usage_count}), 201


@app.route('/api/students/<int:student_id>/plan', methods=['GET', 'PUT'])
@login_required
def student_plan(student_id):
    is_own_student = (
        current_user.role == 'student' and current_user.student_id == student_id
    )
    if request.method == 'GET':
        if current_user.role not in ('staff', 'admin') and not is_own_student:
            return jsonify({'error': 'Permission denied'}), 403
        student = Student.query.get_or_404(student_id)
        plan = StudentPlan.query.filter_by(student_id=student.id).first()
        return jsonify(serialize_plan(plan) if plan else {
            'id': None, 'student_id': student.id, 'rows': [], 'updated_at': None
        })

    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    student = Student.query.get_or_404(student_id)

    data = request.json or {}
    rows_data = data.get('rows')
    if not isinstance(rows_data, list):
        return jsonify({'error': 'rows must be an array'}), 400

    plan = StudentPlan.query.filter_by(student_id=student.id).first()
    if not plan:
        plan = StudentPlan(student_id=student.id)
        db.session.add(plan)
        db.session.flush()

    # Replace rows
    StudentPlanRow.query.filter_by(plan_id=plan.id).delete()
    for idx, raw in enumerate(rows_data):
        if_text = (raw.get('if_text') or '').strip()
        then_text = (raw.get('then_text') or '').strip()
        has_threshold = bool(raw.get('has_threshold'))
        ttype = (raw.get('threshold_type') or '').strip() or None
        if has_threshold and ttype and ttype not in THRESHOLD_TYPES:
            return jsonify({'error': f'Invalid threshold_type: {ttype}'}), 400
        thr_pct = raw.get('threshold_percent')
        if has_threshold and thr_pct is not None and thr_pct != '':
            try:
                thr_pct = float(thr_pct)
            except (TypeError, ValueError):
                return jsonify({'error': 'threshold_percent must be a number'}), 400
        else:
            thr_pct = None if not has_threshold else thr_pct

        row = StudentPlanRow(
            plan_id=plan.id,
            sort_order=int(raw.get('sort_order', idx)),
            if_text=if_text,
            then_text=then_text,
            has_threshold=has_threshold,
            threshold_percent=thr_pct if has_threshold else None,
            threshold_type=ttype if has_threshold else None,
            cutoff_time=(raw.get('cutoff_time') or None) if has_threshold else None,
            dow_start=(raw.get('dow_start') or None) if has_threshold else None,
            dow_end=(raw.get('dow_end') or None) if has_threshold else None,
            consecutive_n=int(raw['consecutive_n']) if has_threshold and raw.get('consecutive_n') not in (None, '') else None,
            days_needed=int(raw['days_needed']) if has_threshold and raw.get('days_needed') not in (None, '') else None,
            window_days=int(raw['window_days']) if has_threshold and raw.get('window_days') not in (None, '') else None,
            period_time_range=(raw.get('period_time_range') or None) if has_threshold else None,
            period_location=(raw.get('period_location') or None) if has_threshold else None,
            star_category=(raw.get('star_category') or None) if has_threshold else None,
        )
        if has_threshold and ttype == 'category_specific' and not row.star_category:
            return jsonify({'error': 'star_category is required for category_specific thresholds'}), 400
        db.session.add(row)
        if if_text:
            upsert_plan_if_library(if_text)

    plan.updated_by_user_id = current_user.id
    plan.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(serialize_plan(plan))


@app.route('/api/students/<int:student_id>/plan/evaluate', methods=['POST'])
@login_required
def student_plan_evaluate(student_id):
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    Student.query.get_or_404(student_id)
    data = request.json or {}
    eval_date = date.today()
    if data.get('date'):
        try:
            eval_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'date must be YYYY-MM-DD'}), 400
    evaluate_and_record_plan_thresholds(student_id, eval_date=eval_date)
    return jsonify({'active_mets': get_active_plan_mets(student_id, eval_date=eval_date)})


@app.route('/api/students/<int:student_id>/plan/active-mets', methods=['GET'])
@login_required
def student_plan_active_mets(student_id):
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    Student.query.get_or_404(student_id)
    eval_date = date.today()
    date_str = request.args.get('date')
    if date_str:
        try:
            eval_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'date must be YYYY-MM-DD'}), 400
    return jsonify({'active_mets': get_active_plan_mets(student_id, eval_date=eval_date)})


@app.route('/api/plan-threshold-events/<int:event_id>/deliver', methods=['POST'])
@login_required
def deliver_plan_threshold_event(event_id):
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    evt = PlanThresholdEvent.query.get_or_404(event_id)
    if evt.delivered_at:
        return jsonify({'message': 'Already delivered', 'event_id': evt.id}), 200
    evt.delivered_at = datetime.utcnow()
    evt.delivered_by_user_id = current_user.id
    db.session.commit()
    return jsonify({
        'event_id': evt.id,
        'delivered_at': evt.delivered_at.isoformat(),
        'delivered_by_user_id': evt.delivered_by_user_id,
    })


@app.route('/api/students/<int:student_id>/plan/rows/<int:row_id>/manual-met', methods=['POST'])
@login_required
def manual_plan_row_met(student_id, row_id):
    """
    Staff/admin: manually mark a plan If/Then row as met.
    Body: { "deliver": false } → met only (shows star until delivered)
          { "deliver": true }  → met + delivered in one step (no star)
    """
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    student = Student.query.get_or_404(student_id)
    plan = StudentPlan.query.filter_by(student_id=student.id).first()
    if not plan:
        return jsonify({'error': 'Student has no plan'}), 404
    row = StudentPlanRow.query.filter_by(id=row_id, plan_id=plan.id).first()
    if not row:
        return jsonify({'error': 'Plan row not found'}), 404

    data = request.json or {}
    also_deliver = bool(data.get('deliver'))

    now = datetime.utcnow()
    # Unique window key so repeated manual mets are allowed and tracked separately
    window_key = f"manual-{now.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
    evt = PlanThresholdEvent(
        student_id=student.id,
        plan_row_id=row.id,
        if_normalized=normalize_if_text(row.if_text),
        window_key=window_key,
        met_at=now,
        delivered_at=now if also_deliver else None,
        delivered_by_user_id=current_user.id if also_deliver else None,
    )
    db.session.add(evt)
    db.session.commit()
    return jsonify({
        'event_id': evt.id,
        'plan_row_id': row.id,
        'window_key': window_key,
        'met_at': evt.met_at.isoformat(),
        'delivered_at': evt.delivered_at.isoformat() if evt.delivered_at else None,
        'delivered_by_user_id': evt.delivered_by_user_id,
        'is_delivered': also_deliver,
        'message': 'Marked met and delivered' if also_deliver else 'Marked met',
    }), 201


@app.route('/api/students/<int:student_id>/plan/delivery-history', methods=['GET'])
@login_required
def student_plan_delivery_history(student_id):
    if current_user.role not in ('staff', 'admin') and not (
        current_user.role == 'student' and current_user.student_id == student_id
    ):
        return jsonify({'error': 'Permission denied'}), 403
    Student.query.get_or_404(student_id)
    events = (
        PlanThresholdEvent.query
        .filter_by(student_id=student_id)
        .order_by(PlanThresholdEvent.met_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for evt in events:
        row = evt.plan_row
        delivered_by_name = None
        if evt.delivered_by_user_id:
            u = User.query.get(evt.delivered_by_user_id)
            if u:
                delivered_by_name = u.name or u.username
        out.append({
            'event_id': evt.id,
            'if_text': row.if_text if row else evt.if_normalized,
            'then_text': row.then_text if row else '',
            'window_key': evt.window_key,
            'met_at': evt.met_at.isoformat() if evt.met_at else None,
            'delivered_at': evt.delivered_at.isoformat() if evt.delivered_at else None,
            'delivered_by': delivered_by_name,
            'is_delivered': bool(evt.delivered_at),
        })
    return jsonify({'history': out})


@app.route('/api/admin/purge-student-emails', methods=['POST'])
@login_required
@admin_required
def purge_student_emails():
    """
    Admin-only endpoint to remove all email data from Student records.
    This supports stricter privacy by deleting stored student email addresses.
    """
    students = Student.query.all()
    count = 0
    for s in students:
        if s.email:
            s.email = None
            count += 1
    
    db.session.commit()
    
    # Log the purge operation (no specific student IDs listed to avoid
    # reintroducing the deleted data into logs).
    log_phi_access(
        action='UPDATE',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='students',
        resource_id='all',
        details=f'Purged email addresses from {count} student record(s)',
        ip_address=get_remote_address()
    )
    
    return jsonify({
        'message': 'All student email addresses have been removed.',
        'updated_count': count
    }), 200

@app.route('/api/period-data', methods=['GET', 'POST'])
@login_required
def period_data():
    """Get or save period-based data for all students"""
    if request.method == 'POST':
        # Only staff and admin can save data
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        
        data = request.json
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        period = data.get('period')
        students_data = data.get('students', {})
        if isinstance(students_data, list):
            students_data = {
                str(item.get('student_id')): item
                for item in students_data
                if isinstance(item, dict) and item.get('student_id') is not None
            }
        
        saved_count = 0
        saved_daily_ids = []
        student_ids = []
        for student_id_str in students_data.keys():
            try:
                student_ids.append(int(student_id_str))
            except (TypeError, ValueError):
                continue
        schedules_by_student = _student_schedule_rows_by_student(student_ids)
        
        # Process each student's data. Merge-only: never overwrite STAR/info
        # fields the client did not send, so concurrent staff cannot clobber
        # each other's cells.
        for student_id_str, student_data in students_data.items():
            student_id = int(student_id_str)
            
            # Verify Outside Staff has access to this student
            if current_user.role == 'staff' and current_user.is_outside_staff:
                if not has_student_access(current_user, student_id):
                    continue  # Skip this student if no access

            if not user_can_write_student_period(current_user, student_id, period):
                continue

            if not isinstance(student_data, dict):
                student_data = {}
            period_payload = dict(student_data)
            period_payload['time_range'] = period
            student_schedule_rows = schedules_by_student.get(student_id, [])
            student_location = _student_location_for_period(
                student_id,
                period,
                schedule_rows=student_schedule_rows,
                on_date=record_date,
            )
            if student_location and 'location' not in period_payload:
                period_payload['location'] = student_location
            
            daily_record = (
                DailyRecord.query
                .filter_by(student_id=student_id, date=record_date)
                .with_for_update()
                .first()
            )
            
            if not daily_record:
                daily_record = DailyRecord(
                    student_id=student_id,
                    date=record_date,
                    day_of_week=record_date.strftime('%A'),
                    attendance_status='present',
                    present=True  # Keep for backward compatibility
                )
                db.session.add(daily_record)
                db.session.flush()
            
            _upsert_period_record(
                daily_record,
                period_payload,
                merge=True,
                default_location=student_location,
            )
            _ensure_full_point_card_periods(daily_record)
            
            saved_count += 1
            saved_daily_ids.append(daily_record.id)
        
        db.session.commit()
        for daily_id in dict.fromkeys(saved_daily_ids):
            daily_record = DailyRecord.query.get(daily_id)
            if not daily_record:
                continue
            db.session.expire(daily_record, ['periods'])
            _ensure_full_point_card_periods(daily_record)
        db.session.commit()
        maybe_auto_submit_point_cards_for_date(record_date)
        
        # Audit: Log period data creation/update
        log_phi_access(
            action='CREATE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='period_records',
            details=f"Period: {period}, Date: {record_date}, Students: {saved_count}",
            ip_address=get_remote_address()
        )
        
        return jsonify({'message': f'Saved {saved_count} student records', 'count': saved_count}), 200
    
    else:
        # GET request - retrieve period data
        record_date = datetime.strptime(request.args.get('date'), '%Y-%m-%d').date()
        period = request.args.get('period')
        maybe_auto_submit_point_cards_for_date(record_date)
        
        # Audit: Log period data access
        log_phi_access(
            action='VIEW',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='period_records',
            details=f"Period: {period}, Date: {record_date}",
            ip_address=get_remote_address()
        )
        
        # Get daily records for this date (filtered by student if student role or Outside Staff)
        query = DailyRecord.query.filter_by(date=record_date)
        if current_user.role == 'student' and current_user.student_id:
            query = query.filter_by(student_id=current_user.student_id)
        elif current_user.role == 'staff' and current_user.is_outside_staff:
            # Outside Staff can only see assigned students
            assigned_student_ids = [assoc.student_id for assoc in 
                                  OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
            if not assigned_student_ids:
                return jsonify([])
            query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
        daily_records = query.all()
        
        result = []
        for daily_record in daily_records:
            # Find period record
            period_record = PeriodRecord.query.filter_by(
                daily_record_id=daily_record.id,
                time_range=period
            ).first()
            
            if period_record:
                result.append({
                    'student_id': daily_record.student_id,
                    'safety_points': period_record.safety_points,
                    'teamwork_points': period_record.teamwork_points,
                    'accountability_points': period_record.accountability_points,
                    'relationships_points': period_record.relationships_points,
                    'info': period_record.info or '',
                    'submitted': bool(daily_record.submitted_at),
                })
        
        return jsonify(result)

@app.route('/api/daily-records', methods=['GET', 'POST'])
@login_required
def daily_records():
    """Get or save daily records"""
    if request.method == 'POST':
        # Only staff and admin can save data
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        
        data = request.json
        student_id = data.get('student_id')
        
        # Verify Outside Staff has access to this student
        if current_user.role == 'staff' and current_user.is_outside_staff:
            if not has_student_access(current_user, student_id):
                return jsonify({'error': 'Access denied to this student'}), 403
        
        attendance_status = data.get('attendance_status')
        
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        if not attendance_status:
            # Migration: convert old present boolean to new attendance_status
            present = data.get('present', True)
            attendance_status = 'present' if present else 'unexcused'

        is_outside = current_user.role == 'staff' and current_user.is_outside_staff
        has_split = _get_student_transition(student_id) is not None
        periods_in = data.get('periods') or []
        writable_periods = [
            period_data for period_data in periods_in
            if isinstance(period_data, dict)
            and user_can_write_student_period(
                current_user,
                student_id,
                (period_data.get('time_range') or '').strip(),
            )
        ]
        
        merge = bool(data.get('merge'))

        daily_record = (
            DailyRecord.query
            .filter_by(student_id=student_id, date=record_date)
            .with_for_update()
            .first()
        )
        existing = daily_record
        
        if existing:
            if not is_outside:
                daily_record.attendance_status = attendance_status
                daily_record.present = (attendance_status == 'present')
        else:
            daily_record = DailyRecord(
                student_id=student_id,
                date=record_date,
                day_of_week=record_date.strftime('%A'),
                attendance_status='present' if is_outside else attendance_status,
                present=True if is_outside else (attendance_status == 'present')
            )
            db.session.add(daily_record)
        
        db.session.flush()

        if merge or has_split:
            # Concurrent saves, and split-day cards: never delete the other
            # side's periods. Only upsert periods this user is allowed to write.
            for period_data in writable_periods:
                _upsert_period_record(daily_record, period_data, merge=True if merge else False)
        else:
            # Full replace used by the dedicated point-card editors that send
            # a complete day snapshot for one student.
            existing_period_ids = [
                period_id for (period_id,) in db.session.query(PeriodRecord.id)
                .filter_by(daily_record_id=daily_record.id)
                .all()
            ]
            if existing_period_ids:
                Infraction.query.filter(Infraction.period_record_id.in_(existing_period_ids)).delete(synchronize_session=False)
                PeriodRecord.query.filter(PeriodRecord.id.in_(existing_period_ids)).delete(synchronize_session=False)
                db.session.flush()

            for period_data in writable_periods:
                period = PeriodRecord(
                    daily_record_id=daily_record.id,
                    time_range=period_data.get('time_range'),
                    location=period_data.get('location'),
                    safety_points=_nullable_star_points(period_data.get('safety_points')),
                    teamwork_points=_nullable_star_points(period_data.get('teamwork_points')),
                    accountability_points=_nullable_star_points(period_data.get('accountability_points')),
                    relationships_points=_nullable_star_points(period_data.get('relationships_points')),
                    points_possible=_points_possible_for_star_values(period_data),
                    reset=period_data.get('reset', False),
                    frenzy=period_data.get('frenzy', False),
                    notes=period_data.get('notes'),
                    reminders=period_data.get('reminders'),
                    info=period_data.get('info')
                )
                db.session.add(period)
                db.session.flush()

                for infraction_data in period_data.get('infractions', []):
                    infraction = Infraction(
                        period_record_id=period.id,
                        infraction_type=infraction_data['type'],
                        count=infraction_data.get('count', 1),
                        is_general=infraction_data.get('is_general', True),
                        is_harmful=infraction_data.get('is_harmful', False)
                    )
                    db.session.add(infraction)

            if not is_outside:
                FrenzyEvent.query.filter_by(daily_record_id=daily_record.id).delete(synchronize_session=False)
                for frenzy_data in data.get('frenzies', []):
                    sev_raw = frenzy_data.get('severity')
                    sev_int = None
                    if sev_raw is not None and sev_raw != '':
                        try:
                            sev_int = int(sev_raw)
                        except (TypeError, ValueError):
                            sev_int = None
                    if sev_int is not None:
                        sev_int = max(1, min(5, sev_int))
                    frenzy = FrenzyEvent(
                        daily_record_id=daily_record.id,
                        time_range=frenzy_data.get('time_range'),
                        location=frenzy_data.get('location'),
                        purpose=frenzy_data.get('purpose'),
                        purpose2=frenzy_data.get('purpose2'),
                        duration_minutes=frenzy_data.get('duration_minutes'),
                        result=frenzy_data.get('result'),
                        severity=sev_int if sev_int is not None else 1,
                    )
                    db.session.add(frenzy)
        
        db.session.flush()
        _ensure_full_point_card_periods(daily_record)
        db.session.flush()
        mark_daily_record_submitted_if_due(daily_record)
        db.session.commit()

        daily_record = DailyRecord.query.get(daily_record.id)
        if daily_record:
            _ensure_full_point_card_periods(daily_record)
            db.session.commit()
        
        # Audit: Log daily record creation/update
        action = 'UPDATE' if existing else 'CREATE'
        log_phi_access(
            action=action,
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='daily_records',
            resource_id=student_id,
            details=f"Date: {record_date}",
            ip_address=get_remote_address()
        )
        
        return jsonify({'id': daily_record.id, 'message': 'Record saved successfully'}), 201
    
    else:
        student_id = request.args.get('student_id', type=int)
        student_ids_param = (request.args.get('student_ids') or '').strip()
        include_details = (request.args.get('include_details', 'true') or 'true').lower() not in ('0', 'false', 'no')

        requested_student_ids = []
        if student_ids_param:
            for raw_id in student_ids_param.split(','):
                raw_id = raw_id.strip()
                if not raw_id:
                    continue
                try:
                    requested_student_ids.append(int(raw_id))
                except ValueError:
                    continue
        if student_id:
            requested_student_ids = [student_id]
        
        # Audit: Log daily record access
        log_phi_access(
            action='VIEW',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='daily_records',
            resource_id=student_id,
            ip_address=get_remote_address()
        )
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        if start_date and end_date and start_date == end_date:
            maybe_auto_submit_point_cards_for_date(datetime.strptime(start_date, '%Y-%m-%d').date())
        staff_id = request.args.get('staff_id', type=int)
        managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
        
        # Get daily records (filtered by role and optional student_id/student_ids)
        query = DailyRecord.query
        if current_user.role == 'student' and current_user.student_id:
            if requested_student_ids and any(sid != current_user.student_id for sid in requested_student_ids):
                return jsonify({'error': 'Access denied'}), 403
            query = query.filter_by(student_id=current_user.student_id)
        elif current_user.role == 'staff' and current_user.is_outside_staff:
            # Outside Staff can only see assigned students
            assigned_student_ids = [assoc.student_id for assoc in 
                                  OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
            if not assigned_student_ids:
                return jsonify([])
            if requested_student_ids:
                allowed_ids = [sid for sid in requested_student_ids if sid in assigned_student_ids]
                if not allowed_ids:
                    return jsonify({'error': 'Access denied to requested students'}), 403
                query = query.filter(DailyRecord.student_id.in_(allowed_ids))
            else:
                query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
        elif requested_student_ids:
            query = query.filter(DailyRecord.student_id.in_(requested_student_ids))
        elif staff_id and current_user.role in ['staff', 'admin']:
            staff_user = User.query.get(staff_id)
            if staff_user:
                staff_name = staff_user.name or ''
                staff_username = staff_user.username or ''
                team_members = TeamMember.query.filter(
                    (db.func.lower(TeamMember.name) == db.func.lower(staff_name)) |
                    (db.func.lower(TeamMember.name) == db.func.lower(staff_username))
                ).all()
                staff_student_ids = list({tm.student_id for tm in team_members if tm.student_id})
                if not staff_student_ids:
                    return jsonify([])
                query = query.filter(DailyRecord.student_id.in_(staff_student_ids))
        elif managed_by_me and current_user.role in ['staff', 'admin']:
            user_name = (current_user.name or current_user.username or '').strip()
            user_username = (current_user.username or '').strip()
            team_members = TeamMember.query.filter(
                db.or_(
                    db.func.lower(TeamMember.name) == db.func.lower(user_name),
                    db.func.lower(TeamMember.name) == db.func.lower(user_username),
                )
            ).all()
            managed_student_ids = list({tm.student_id for tm in team_members if tm.student_id})
            if not managed_student_ids:
                return jsonify([])
            query = query.filter(DailyRecord.student_id.in_(managed_student_ids))
        if start_date:
            query = query.filter(DailyRecord.date >= datetime.strptime(start_date, '%Y-%m-%d').date())
        if end_date:
            query = query.filter(DailyRecord.date <= datetime.strptime(end_date, '%Y-%m-%d').date())
        
        # Eager-load relationships with lightweight mode for daily grid speed.
        if include_details:
            query = query.options(
                selectinload(DailyRecord.periods).selectinload(PeriodRecord.infractions),
                selectinload(DailyRecord.frenzies),
            )
        else:
            query = query.options(selectinload(DailyRecord.periods))

        records = query.order_by(DailyRecord.student_id, DailyRecord.date).all()
        result = []
        for record in records:
            periods = []
            for period in record.periods:
                if include_details:
                    infractions = [{
                        'type': i.infraction_type,
                        'count': i.count,
                        'is_general': i.is_general,
                        'is_harmful': i.is_harmful
                    } for i in period.infractions]

                    periods.append({
                        'id': period.id,
                        'time_range': period.time_range,
                        'location': period.location,
                        'safety_points': period.safety_points,
                        'teamwork_points': period.teamwork_points,
                        'accountability_points': period.accountability_points,
                        'relationships_points': period.relationships_points,
                        'points_possible': period.points_possible,
                        'reset': period.reset,
                        'frenzy': period.frenzy,
                        'notes': period.notes,
                        'reminders': period.reminders,
                        'info': period.info or '',
                        'infractions': infractions
                    })
                else:
                    periods.append({
                        'id': period.id,
                        'time_range': period.time_range,
                        'safety_points': period.safety_points,
                        'teamwork_points': period.teamwork_points,
                        'accountability_points': period.accountability_points,
                        'relationships_points': period.relationships_points,
                        'info': period.info or '',
                    })

            frenzies = []
            if include_details:
                frenzies = [{
                    'id': f.id,
                    'time_range': f.time_range,
                    'location': f.location,
                    'purpose': f.purpose,
                    'purpose2': f.purpose2,
                    'duration_minutes': f.duration_minutes,
                    'result': f.result
                } for f in record.frenzies]
            
            # Get attendance_status, with fallback from present boolean for backward compatibility
            attendance_status = record.attendance_status
            if not attendance_status:
                attendance_status = 'present' if record.present else 'unexcused'
            
            result.append({
                'id': record.id,
                'student_id': record.student_id,
                'date': record.date.isoformat(),
                'day_of_week': record.day_of_week,
                'present': record.present,  # Keep for backward compatibility
                'attendance_status': attendance_status,
                'submitted': bool(record.submitted_at),
                'submitted_at': record.submitted_at.isoformat() if record.submitted_at else None,
                'periods': _expand_serialized_point_card_periods(periods, include_details),
                'frenzies': frenzies
            })
        
        return jsonify(result)


def _parse_student_ids_param(student_ids_param):
    parsed = []
    for raw_id in (student_ids_param or '').split(','):
        raw_id = raw_id.strip()
        if not raw_id:
            continue
        try:
            parsed.append(int(raw_id))
        except ValueError:
            continue
    return list(dict.fromkeys(parsed))


def _resolve_student_scope(student_id=None, student_ids_param='', staff_id=None, managed_by_me=False):
    requested_student_ids = _parse_student_ids_param(student_ids_param)
    if student_id:
        requested_student_ids = [student_id]

    if current_user.role == 'student':
        if current_user.student_id:
            return [current_user.student_id]
        return []

    if current_user.role == 'staff' and current_user.is_outside_staff:
        assigned_student_ids = [assoc.student_id for assoc in OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
        if not assigned_student_ids:
            return []
        if requested_student_ids:
            return [sid for sid in requested_student_ids if sid in assigned_student_ids]
        return sorted(set(assigned_student_ids))

    if requested_student_ids:
        return requested_student_ids

    if staff_id and current_user.role in ['staff', 'admin']:
        staff_user = User.query.get(staff_id)
        if not staff_user:
            return []
        staff_name = staff_user.name or ''
        staff_username = staff_user.username or ''
        team_members = TeamMember.query.filter(
            (db.func.lower(TeamMember.name) == db.func.lower(staff_name)) |
            (db.func.lower(TeamMember.name) == db.func.lower(staff_username))
        ).all()
        return sorted({tm.student_id for tm in team_members if tm.student_id})

    if managed_by_me and current_user.role in ['staff', 'admin']:
        user_name = (current_user.name or current_user.username or '').strip()
        user_username = (current_user.username or '').strip()
        team_members = TeamMember.query.filter(
            db.or_(
                db.func.lower(TeamMember.name) == db.func.lower(user_name),
                db.func.lower(TeamMember.name) == db.func.lower(user_username),
            )
        ).all()
        return sorted({tm.student_id for tm in team_members if tm.student_id})

    # Default to all active student IDs for staff/admin "all students" view.
    student_users = User.query.filter_by(role='student').all()
    return sorted({u.student_id for u in student_users if u.student_id})


def _checkpoint_color_for_type(checkpoint_type, requested_color=None):
    fixed = {
        'intervention': 'orange',
        'transition': 'purple',
        'life_event': 'gray',
    }
    if checkpoint_type in fixed:
        return fixed[checkpoint_type]
    if checkpoint_type == 'card_change':
        color = (requested_color or '').strip().lower()
        if color in {'yellow', 'green', 'blue'}:
            return color
        raise ValueError('Card Change requires color: yellow, green, or blue.')
    raise ValueError('Invalid checkpoint type.')


def _serialize_checkpoint(checkpoint):
    return {
        'id': checkpoint.id,
        'checkpoint_type': checkpoint.checkpoint_type,
        'color': checkpoint.color,
        'date': checkpoint.date.isoformat(),
        'label': checkpoint.label,
        'description': checkpoint.description,
        'student_ids': [row.student_id for row in checkpoint.students],
        'created_by_user_id': checkpoint.created_by_user_id,
        'created_at': utc_isoformat(checkpoint.created_at),
        'updated_at': utc_isoformat(checkpoint.updated_at),
    }


@app.route('/api/trends', methods=['GET'])
@login_required
def api_trends():
    student_id = request.args.get('student_id', type=int)
    student_ids_param = (request.args.get('student_ids') or '').strip()
    staff_id = request.args.get('staff_id', type=int)
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date')

    start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date() if start_date_str else None
    end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date() if end_date_str else None
    if start_date and end_date and end_date < start_date:
        return jsonify({'error': 'end_date must be on or after start_date'}), 400

    selected_ids = _resolve_student_scope(
        student_id=student_id,
        student_ids_param=student_ids_param,
        staff_id=staff_id,
        managed_by_me=managed_by_me,
    )
    if not selected_ids:
        return jsonify({'series': [], 'student_ids': []})

    query = DailyRecord.query.filter(DailyRecord.student_id.in_(selected_ids))
    if start_date:
        query = query.filter(DailyRecord.date >= start_date)
    if end_date:
        query = query.filter(DailyRecord.date <= end_date)
    query = query.options(
        selectinload(DailyRecord.periods),
        selectinload(DailyRecord.frenzies),
    )

    records = query.order_by(DailyRecord.date.asc()).all()
    by_date = {}
    for record in records:
        if record.attendance_status == 'excused':
            continue
        key = record.date.isoformat()
        if key not in by_date:
            by_date[key] = {
                'frenzy_count': 0,
                'safety': 0,
                'teamwork': 0,
                'accountability': 0,
                'relationships': 0,
                'possible': 0,
            }
        entry = by_date[key]
        entry['frenzy_count'] += len(record.frenzies or [])
        for period in (record.periods or []):
            entry['safety'] += _star_point_sum_value(period.safety_points)
            entry['teamwork'] += _star_point_sum_value(period.teamwork_points)
            entry['accountability'] += _star_point_sum_value(period.accountability_points)
            entry['relationships'] += _star_point_sum_value(period.relationships_points)
            entry['possible'] += _period_points_possible(period)

    series = []
    for date_key in sorted(by_date.keys()):
        day = by_date[date_key]
        avg_star_percent = None
        if day['possible'] > 0:
            num_periods = day['possible'] / 4
            max_per_category = num_periods * 2 if num_periods > 0 else 0
            if max_per_category > 0:
                safety_pct = (day['safety'] / max_per_category) * 100
                teamwork_pct = (day['teamwork'] / max_per_category) * 100
                accountability_pct = (day['accountability'] / max_per_category) * 100
                relationships_pct = (day['relationships'] / max_per_category) * 100
                avg_star_percent = round((safety_pct + teamwork_pct + accountability_pct + relationships_pct) / 4, 2)
        series.append({
            'date': date_key,
            'frenzy_count': day['frenzy_count'],
            'average_star_percent': avg_star_percent,
        })

    return jsonify({'series': series, 'student_ids': selected_ids})


@app.route('/api/checkpoints', methods=['GET', 'POST'])
@login_required
def api_checkpoints():
    if request.method == 'POST':
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403

        payload = request.json or {}
        checkpoint_type = (payload.get('checkpoint_type') or '').strip().lower()
        label = (payload.get('label') or '').strip()
        description = (payload.get('description') or '').strip()
        date_str = (payload.get('date') or '').strip()
        student_ids = payload.get('student_ids') or []
        if not isinstance(student_ids, list):
            return jsonify({'error': 'student_ids must be an array'}), 400

        parsed_student_ids = []
        for raw in student_ids:
            try:
                parsed_student_ids.append(int(raw))
            except (TypeError, ValueError):
                continue
        parsed_student_ids = sorted(set(parsed_student_ids))
        if not parsed_student_ids:
            return jsonify({'error': 'Select at least one student'}), 400
        if not label:
            return jsonify({'error': 'Label is required'}), 400
        if len(description) > 2000:
            return jsonify({'error': 'Description must be 2000 characters or fewer'}), 400
        if not date_str:
            return jsonify({'error': 'Date is required'}), 400
        try:
            checkpoint_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Date must be YYYY-MM-DD'}), 400

        try:
            color = _checkpoint_color_for_type(checkpoint_type, payload.get('color'))
        except ValueError as err:
            return jsonify({'error': str(err)}), 400

        allowed_ids = set(_resolve_student_scope())
        if any(sid not in allowed_ids for sid in parsed_student_ids):
            return jsonify({'error': 'One or more students are outside your allowed scope'}), 403

        checkpoint = Checkpoint(
            checkpoint_type=checkpoint_type,
            color=color,
            date=checkpoint_date,
            label=label,
            description=description or None,
            created_by_user_id=current_user.id,
        )
        db.session.add(checkpoint)
        db.session.flush()

        for sid in parsed_student_ids:
            db.session.add(CheckpointStudent(checkpoint_id=checkpoint.id, student_id=sid))

        db.session.commit()
        log_phi_access(
            action='CREATE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='checkpoints',
            resource_id=checkpoint.id,
            details=f"type={checkpoint_type} date={checkpoint_date.isoformat()} students={len(parsed_student_ids)}",
            ip_address=get_remote_address()
        )
        return jsonify(_serialize_checkpoint(checkpoint)), 201

    student_id = request.args.get('student_id', type=int)
    student_ids_param = (request.args.get('student_ids') or '').strip()
    staff_id = request.args.get('staff_id', type=int)
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date')
    # When true, only return checkpoints whose attached students include
    # every selected student. Used by the trends summary card so a checkpoint
    # for a subset of the current scope doesn't appear on a chart that
    # aggregates students it doesn't apply to.
    require_all_students = request.args.get('require_all_students', 'false').lower() == 'true'

    selected_ids = _resolve_student_scope(
        student_id=student_id,
        student_ids_param=student_ids_param,
        staff_id=staff_id,
        managed_by_me=managed_by_me,
    )
    if not selected_ids:
        return jsonify([])

    query = Checkpoint.query.join(CheckpointStudent).filter(CheckpointStudent.student_id.in_(selected_ids))
    if start_date_str:
        query = query.filter(Checkpoint.date >= datetime.strptime(start_date_str, '%Y-%m-%d').date())
    if end_date_str:
        query = query.filter(Checkpoint.date <= datetime.strptime(end_date_str, '%Y-%m-%d').date())
    checkpoints = query.options(selectinload(Checkpoint.students)).order_by(Checkpoint.date.asc(), Checkpoint.id.asc()).distinct().all()

    if require_all_students:
        selected_set = set(selected_ids)
        checkpoints = [
            cp for cp in checkpoints
            if selected_set.issubset({row.student_id for row in cp.students})
        ]

    return jsonify([_serialize_checkpoint(cp) for cp in checkpoints])


@app.route('/api/checkpoints/<int:checkpoint_id>', methods=['PUT', 'DELETE'])
@login_required
def api_checkpoint_item(checkpoint_id):
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403

    checkpoint = Checkpoint.query.options(selectinload(Checkpoint.students)).get(checkpoint_id)
    if not checkpoint:
        return jsonify({'error': 'Checkpoint not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(checkpoint)
        db.session.commit()
        log_phi_access(
            action='DELETE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='checkpoints',
            resource_id=checkpoint_id,
            ip_address=get_remote_address()
        )
        return jsonify({'message': 'Checkpoint deleted'})

    payload = request.json or {}
    checkpoint_type = (payload.get('checkpoint_type') or checkpoint.checkpoint_type).strip().lower()
    label = (payload.get('label') or checkpoint.label).strip()
    description = (payload.get('description') or '').strip() if 'description' in payload else checkpoint.description
    date_str = payload.get('date')
    color_candidate = payload.get('color')

    if date_str:
        try:
            checkpoint.date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Date must be YYYY-MM-DD'}), 400
    if not label:
        return jsonify({'error': 'Label is required'}), 400
    if description and len(description) > 2000:
        return jsonify({'error': 'Description must be 2000 characters or fewer'}), 400

    try:
        checkpoint.color = _checkpoint_color_for_type(checkpoint_type, color_candidate or checkpoint.color)
    except ValueError as err:
        return jsonify({'error': str(err)}), 400

    checkpoint.checkpoint_type = checkpoint_type
    checkpoint.label = label
    checkpoint.description = description or None

    if 'student_ids' in payload:
        incoming_ids = []
        for raw in (payload.get('student_ids') or []):
            try:
                incoming_ids.append(int(raw))
            except (TypeError, ValueError):
                continue
        incoming_ids = sorted(set(incoming_ids))
        if not incoming_ids:
            return jsonify({'error': 'Select at least one student'}), 400
        allowed_ids = set(_resolve_student_scope())
        if any(sid not in allowed_ids for sid in incoming_ids):
            return jsonify({'error': 'One or more students are outside your allowed scope'}), 403
        CheckpointStudent.query.filter_by(checkpoint_id=checkpoint.id).delete()
        for sid in incoming_ids:
            db.session.add(CheckpointStudent(checkpoint_id=checkpoint.id, student_id=sid))

    db.session.commit()
    checkpoint = Checkpoint.query.options(selectinload(Checkpoint.students)).get(checkpoint_id)
    log_phi_access(
        action='UPDATE',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='checkpoints',
        resource_id=checkpoint_id,
        ip_address=get_remote_address()
    )
    return jsonify(_serialize_checkpoint(checkpoint))

def _record_attendance_status_norm(record):
    """Normalize attendance_status using the same fallback as summary()."""
    return record.attendance_status or ('present' if record.present else 'unexcused')


def _unique_dates_present_school_days(all_records_raw):
    """Most recent first: calendar days where the student was marked present (true 'school days' for behavior)."""
    return sorted(
        {r.date for r in all_records_raw if _record_attendance_status_norm(r) == 'present'},
        reverse=True,
    )


def _unique_dates_star_school_days(all_records):
    """Most recent first: non-excused metric days (present + unexcused) used for the STAR % window."""
    return sorted({r.date for r in all_records}, reverse=True)


def _records_star_stats_zero_unexcused(all_records, star_date_set):
    """STAR window includes unexcused days, but they contribute 0 STAR points (no periods / frenzies in the rollup)."""
    rows = []
    for r in all_records:
        if r.date not in star_date_set:
            continue
        st = _record_attendance_status_norm(r)
        if st == 'unexcused':
            rows.append(
                SimpleNamespace(
                    id=r.id,
                    student_id=getattr(r, 'student_id', None),
                    date=r.date,
                    day_of_week=r.day_of_week,
                    attendance_status=st,
                    present=getattr(r, 'present', None),
                    periods=[],
                    frenzies=[],
                )
            )
        else:
            rows.append(r)
    return rows


def _merge_30day_behavior_and_star_stats(stats_behavior, stats_star):
    """Infractions / frenzies / by-time use present-day window; STAR % uses present+unexcused with unexcused at 0%."""
    out = dict(stats_behavior or {})
    if stats_star:
        out['percentages'] = dict(stats_star.get('percentages') or {})
        out['totals'] = dict(stats_star.get('totals') or {})
    # stats_behavior and stats_star are separate lite aggregates; deep-copy frenzy maps so a
    # later STAR-window pass cannot clear behavior-window heatmap slots via shared references.
    sev = (stats_behavior or {}).get('frenzy_severity_by_time_by_day')
    if isinstance(sev, dict):
        out['frenzy_severity_by_time_by_day'] = copy.deepcopy(sev)
    details = (stats_behavior or {}).get('frenzy_cell_details_by_time_by_day')
    if isinstance(details, dict):
        out['frenzy_cell_details_by_time_by_day'] = copy.deepcopy(details)
    # Deep-copy new frenzy card aggregation fields
    for key in ('frenzies_by_severity', 'frenzies_by_time', 'frenzies_by_day',
                'frenzies_by_location', 'frenzies_by_purpose', 'frenzies_by_duration_bucket',
                'frenzies_duration_summary', 'infractions_for_frenzies', 'frenzies_severity_totals'):
        val = (stats_behavior or {}).get(key)
        if val is not None:
            out[key] = copy.deepcopy(val)
    return out


def _chunked_id_list(seq, size=900):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


@app.route('/api/summary', methods=['GET'])
@login_required
@api_json_errors
def summary():
    student_id = request.args.get('student_id', type=int)
    period = request.args.get('period', None)
    timeframe = request.args.get('quarter') or request.args.get('timeframe', None)  # Support both old and new param names
    
    # Audit: Log summary access
    log_phi_access(
        action='VIEW',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='summary',
        resource_id=student_id,
        details=f"Timeframe: {timeframe or period}",
        ip_address=get_remote_address()
    )
    
    # If period is specified, ignore timeframe
    if period:
        timeframe = None
    elif not timeframe:
        timeframe = 'alltime'  # Default if neither is specified
    
    # Get quarter and school year dates from request (sent by frontend)
    quarter_dates_json = request.args.get('quarter_dates', '{}')
    school_year_dates_json = request.args.get('school_year_dates', '{}')
    
    try:
        quarter_dates = json.loads(quarter_dates_json) if quarter_dates_json else {}
        school_year_dates = json.loads(school_year_dates_json) if school_year_dates_json else {}
    except:
        quarter_dates = {}
        school_year_dates = {}
    
    # Default quarter date ranges if not provided
    quarter_ranges = {}
    for q_num in ['1', '2', '3', '4']:
        if q_num in quarter_dates and isinstance(quarter_dates[q_num], dict):
            quarter_ranges[q_num] = {
                'start': quarter_dates[q_num].get('start', '08-01'),
                'end': quarter_dates[q_num].get('end', '10-31')
            }
        else:
            # Defaults
            defaults = {
                '1': {'start': '08-01', 'end': '10-31'},
                '2': {'start': '11-01', 'end': '01-31'},
                '3': {'start': '02-01', 'end': '04-30'},
                '4': {'start': '05-01', 'end': '07-31'}
            }
            quarter_ranges[q_num] = defaults[q_num]
    
    # Default school year dates if not provided
    school_year_start = school_year_dates.get('start', '08-01')
    school_year_end = school_year_dates.get('end', '07-31')
    
    # Staff-based filtering: when staff_id is provided, show aggregated data for that staff member's students
    staff_id = request.args.get('staff_id', type=int)
    staff_context_name = None
    
    # Debug logging
    print(f"Summary API called - student_id: {student_id}, staff_id: {staff_id}, timeframe: {timeframe}")
    
    query = DailyRecord.query
    
    # Check if filtering by "managed by me"
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    lite_mode = request.args.get('lite', 'false').lower() in ('1', 'true', 'yes')
    
    # If staff_id is provided and the current user has permission, filter to that staff member's students
    if staff_id and current_user.role in ['staff', 'admin']:
        staff_user = User.query.get(staff_id)
        if staff_user:
            staff_context_name = staff_user.name or staff_user.username
            staff_name = staff_user.name or ''
            staff_username = staff_user.username or ''
            team_members = TeamMember.query.filter(
                (db.func.lower(TeamMember.name) == db.func.lower(staff_name)) |
                (db.func.lower(TeamMember.name) == db.func.lower(staff_username))
            ).all()
            staff_student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
            if staff_student_ids:
                if student_id:
                    if student_id in staff_student_ids:
                        query = query.filter_by(student_id=student_id)
                    else:
                        return jsonify({
                            'timeframe': timeframe, 'total_days': 0,
                            'averages': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'overall': 0},
                            'totals': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'possible': 0},
                            'infractions': {}, 'total_frenzies': 0,
                            'additional_info': {'infractions': {}, 'total_reminders': 0, 'total_resets': 0},
                            'staff_context': staff_context_name,
                            'starbucks_total': 0,
                        })
                else:
                    query = query.filter(DailyRecord.student_id.in_(staff_student_ids))
            else:
                return jsonify({
                    'timeframe': timeframe, 'total_days': 0,
                    'averages': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'overall': 0},
                    'totals': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'possible': 0},
                    'infractions': {}, 'total_frenzies': 0,
                    'additional_info': {'infractions': {}, 'total_reminders': 0, 'total_resets': 0},
                    'staff_context': staff_context_name,
                    'starbucks_total': 0,
                })
    # Students can only see their own summary
    elif current_user.role == 'student':
        if current_user.student_id:
            query = query.filter_by(student_id=current_user.student_id)
        else:
            return jsonify({'error': 'No student record linked'}), 404
    elif current_user.role == 'staff' and current_user.is_outside_staff:
        # Outside Staff can only see assigned students
        assigned_student_ids = [assoc.student_id for assoc in 
                              OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
        if not assigned_student_ids:
            return jsonify({
                'timeframe': timeframe,
                'total_days': 0,
                'averages': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'overall': 0},
                'totals': {'safety': 0, 'teamwork': 0, 'accountability': 0, 'relationships': 0, 'possible': 0},
                'infractions': {},
                'total_frenzies': 0,
                'additional_info': {'infractions': {}, 'total_reminders': 0, 'total_resets': 0},
                'starbucks_total': 0,
            })
        if student_id:
            # Verify access to requested student
            if student_id not in assigned_student_ids:
                return jsonify({'error': 'Access denied to this student'}), 403
            query = query.filter_by(student_id=student_id)
        else:
            query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
    elif student_id:
        query = query.filter_by(student_id=student_id)
        # If managed_by_me is checked, verify the student is managed by current user
        if managed_by_me:
            # Check both name and username since team members might be stored with either
            user_name = (current_user.name or current_user.username or '').strip()
            user_username = (current_user.username or '').strip()
            team_member = TeamMember.query.filter(
                TeamMember.student_id == student_id,
                db.or_(
                    db.func.lower(TeamMember.name) == db.func.lower(user_name),
                    db.func.lower(TeamMember.name) == db.func.lower(user_username),
                ),
            ).first()
            if not team_member:
                # Student is not managed by this user, return empty summary
                return jsonify({
                    'timeframe': timeframe,
                    'total_days': 0,
                    'averages': {
                        'safety': 0,
                        'teamwork': 0,
                        'accountability': 0,
                        'relationships': 0,
                        'overall': 0
                    },
                    'totals': {
                        'safety': 0,
                        'teamwork': 0,
                        'accountability': 0,
                        'relationships': 0,
                        'possible': 0
                    },
                    'infractions': {},
                    'total_frenzies': 0,
                    'additional_info': {
                        'infractions': {},
                        'total_reminders': 0,
                        'total_resets': 0
                    },
                    'starbucks_total': 0,
                })
    elif managed_by_me:
        # Filter to only students managed by current user (case-insensitive match on support team name)
        user_name = (current_user.name or current_user.username or '').strip()
        user_username = (current_user.username or '').strip()
        team_members = TeamMember.query.filter(
            db.or_(
                db.func.lower(TeamMember.name) == db.func.lower(user_name),
                db.func.lower(TeamMember.name) == db.func.lower(user_username),
            )
        ).all()
        student_ids = list({tm.student_id for tm in team_members if tm.student_id})
        if student_ids:
            query = query.filter(DailyRecord.student_id.in_(student_ids))
        else:
            # No students managed by this user, return empty summary
            return jsonify({
                'timeframe': timeframe,
                'total_days': 0,
                'averages': {
                    'safety': 0,
                    'teamwork': 0,
                    'accountability': 0,
                    'relationships': 0,
                    'overall': 0
                },
                'totals': {
                    'safety': 0,
                    'teamwork': 0,
                    'accountability': 0,
                    'relationships': 0,
                    'possible': 0
                },
                'infractions': {},
                'total_frenzies': 0,
                'additional_info': {
                    'infractions': {},
                    'total_reminders': 0,
                    'total_resets': 0
                },
                'starbucks_total': 0,
            })
    
    # For staff/admin views, restrict to active students only (students with a User account role='student')
    if current_user.role in ['staff', 'admin'] or (current_user.role == 'staff' and current_user.is_outside_staff):
        student_users = User.query.filter_by(role='student').all()
        active_student_ids = {u.student_id for u in student_users if u.student_id}
        if not active_student_ids:
            # No active students -> return empty summary
            return jsonify({
                'timeframe': timeframe,
                'total_days': 0,
                'averages': {
                    'safety': 0,
                    'teamwork': 0,
                    'accountability': 0,
                    'relationships': 0,
                    'overall': 0
                },
                'totals': {
                    'safety': 0,
                    'teamwork': 0,
                    'accountability': 0,
                    'relationships': 0,
                    'possible': 0
                },
                'infractions': {},
                'total_frenzies': 0,
                'additional_info': {
                    'infractions': {},
                    'total_reminders': 0,
                    'total_resets': 0
                },
                'starbucks_total': 0,
            })
        query = query.filter(DailyRecord.student_id.in_(active_student_ids))

    # Pre-limit record window for common dashboard modes to avoid loading full history.
    # Keep enough history for trend comparisons (e.g., prior 30-day / prior week).
    from datetime import date, timedelta
    if period in ('30day',) or timeframe in ('30day', '30day_to_30day'):
        recent_date_rows = (
            query.with_entities(DailyRecord.date)
            .distinct()
            .order_by(DailyRecord.date.desc())
            .limit(60)
            .all()
        )
        recent_dates = [row[0] for row in recent_date_rows if row and row[0] is not None]
        if recent_dates:
            query = query.filter(DailyRecord.date.in_(recent_dates))
    elif period in ('weekly',) or timeframe in ('weekly',):
        today = date.today()
        days_since_monday = today.weekday()
        week_start = today - timedelta(days=days_since_monday)
        week_end = week_start + timedelta(days=6)
        prev_week_start = week_start - timedelta(days=7)
        query = query.filter(DailyRecord.date >= prev_week_start, DailyRecord.date <= week_end)

    # Get records and related data. In lite mode, use compact row fetches to avoid
    # heavy ORM object graph materialization costs.
    summary_query_start = time.perf_counter()
    if lite_mode:
        daily_rows = query.with_entities(
            DailyRecord.id,
            DailyRecord.student_id,
            DailyRecord.date,
            DailyRecord.day_of_week,
            DailyRecord.attendance_status,
            DailyRecord.present,
        ).all()

        daily_ids = [r.id for r in daily_rows]
        periods_by_daily = {}
        frenzies_by_daily = {}
        period_rows = []
        if daily_ids:
            period_rows = db.session.query(
                PeriodRecord.id,
                PeriodRecord.daily_record_id,
                PeriodRecord.time_range,
                PeriodRecord.location,
                PeriodRecord.safety_points,
                PeriodRecord.teamwork_points,
                PeriodRecord.accountability_points,
                PeriodRecord.relationships_points,
                PeriodRecord.points_possible,
                PeriodRecord.frenzy,
                PeriodRecord.info,
            ).filter(PeriodRecord.daily_record_id.in_(daily_ids)).all()

            period_ids = [p.id for p in period_rows]
            infractions_by_period = {}
            if period_ids:
                # SQLite has a hard limit on the number of bound parameters per statement
                # (typically 999). For larger timeframes / multi-student views, `period_ids`
                # can exceed that limit and crash the whole summary request.
                #
                # Batch the IN-list to keep each query under the limit, then merge results.
                def _chunked(seq, size):
                    for i in range(0, len(seq), size):
                        yield seq[i:i + size]

                chunk_size = 900  # keep a margin under SQLite's 999 parameter limit
                for period_id_chunk in _chunked(period_ids, chunk_size):
                    inf_rows = db.session.query(
                        Infraction.period_record_id,
                        Infraction.infraction_type,
                        db.func.sum(Infraction.count),
                    ).filter(
                        Infraction.period_record_id.in_(period_id_chunk)
                    ).group_by(
                        Infraction.period_record_id, Infraction.infraction_type
                    ).all()
                    for pr_id, itype, cnt in inf_rows:
                        infractions_by_period.setdefault(pr_id, []).append(
                            SimpleNamespace(infraction_type=itype, count=int(cnt or 0))
                        )

            for p in period_rows:
                p_obj = SimpleNamespace(
                    id=p.id,
                    daily_record_id=p.daily_record_id,
                    time_range=p.time_range,
                    location=p.location,
                    safety_points=_normalize_star_point(p.safety_points),
                    teamwork_points=_normalize_star_point(p.teamwork_points),
                    accountability_points=_normalize_star_point(p.accountability_points),
                    relationships_points=_normalize_star_point(p.relationships_points),
                    points_possible=int(p.points_possible or 0),
                    frenzy=bool(p.frenzy),
                    info=p.info,
                    infractions=infractions_by_period.get(p.id, []),
                )
                periods_by_daily.setdefault(p.daily_record_id, []).append(p_obj)

            frenzies_by_daily = {}
            for daily_id_chunk in _chunked_id_list(daily_ids):
                frenzy_rows = db.session.query(
                    FrenzyEvent.daily_record_id,
                    FrenzyEvent.time_range,
                    FrenzyEvent.severity,
                    FrenzyEvent.purpose,
                    FrenzyEvent.purpose2,
                ).filter(FrenzyEvent.daily_record_id.in_(daily_id_chunk)).all()
                for fr in frenzy_rows:
                    frenzies_by_daily.setdefault(fr.daily_record_id, []).append(
                        SimpleNamespace(
                            time_range=fr.time_range,
                            severity=fr.severity,
                            purpose=fr.purpose,
                            purpose2=fr.purpose2,
                        )
                    )

        all_records_raw = []
        for r in daily_rows:
            all_records_raw.append(SimpleNamespace(
                id=r.id,
                student_id=r.student_id,
                date=r.date,
                day_of_week=r.day_of_week,
                attendance_status=r.attendance_status,
                present=r.present,
                periods=periods_by_daily.get(r.id, []),
                frenzies=frenzies_by_daily.get(r.id, []) if daily_ids else [],
            ))
    else:
        query = query.options(
            load_only(
                DailyRecord.id,
                DailyRecord.student_id,
                DailyRecord.date,
                DailyRecord.day_of_week,
                DailyRecord.attendance_status,
                DailyRecord.present,
            ),
            selectinload(DailyRecord.periods)
            .load_only(
                PeriodRecord.id,
                PeriodRecord.daily_record_id,
                PeriodRecord.time_range,
                PeriodRecord.location,
                PeriodRecord.safety_points,
                PeriodRecord.teamwork_points,
                PeriodRecord.accountability_points,
                PeriodRecord.relationships_points,
                PeriodRecord.points_possible,
                PeriodRecord.frenzy,
                PeriodRecord.info,
            )
            .            selectinload(PeriodRecord.infractions)
            .load_only(
                Infraction.period_record_id,
                Infraction.infraction_type,
                Infraction.count,
            ),
            selectinload(DailyRecord.frenzies).load_only(
                FrenzyEvent.time_range,
                FrenzyEvent.severity,
                FrenzyEvent.purpose,
                FrenzyEvent.purpose2,
            ),
        )
        all_records_raw = query.all()
    print(f"Found {len(all_records_raw)} total records before filtering")
    
    # Filter out excused records for STAR/frenzy calculations, but keep attendance info on all_records_raw.
    # Also migrate attendance_status for records that don't have it yet (in-memory only; no per-record commit here)
    filtered_records = []
    for record in all_records_raw:
        # Migrate attendance_status if needed
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'
        
        # Exclude excused records from STAR/frenzy calculations
        if record.attendance_status != 'excused':
            filtered_records.append(record)
    
    all_records = filtered_records
    print(f"After filtering out excused records: {len(all_records)} records")

    # Compute Starbucks total for this summary (per-student only; aggregated views use 0)
    starbucks_total = 0
    if student_id:
        starbucks_balance = StarbucksBalance.query.filter_by(student_id=student_id).first()
        if starbucks_balance:
            try:
                starbucks_total = int(starbucks_balance.count or 0)
            except (TypeError, ValueError):
                starbucks_total = 0
    
    # Helper function to check if a date is in a month-day range (handles year boundaries)
    def date_in_range(record_date, start_md, end_md):
        start_month, start_day = map(int, start_md.split('-'))
        end_month, end_day = map(int, end_md.split('-'))
        month = record_date.month
        day = record_date.day
        
        if start_month <= end_month:
            # Range within same year
            if month == start_month and day >= start_day:
                return True
            elif month > start_month and month < end_month:
                return True
            elif month == end_month and day <= end_day:
                return True
        else:
            # Range crosses year boundary
            if month == start_month and day >= start_day:
                return True
            elif month > start_month:
                return True
            elif month <= end_month:
                if month < end_month or (month == end_month and day <= end_day):
                    return True
        return False
    
    # Helper function to get which quarter a date belongs to
    def get_quarter_for_date(record_date):
        for q_num in ['1', '2', '3', '4']:
            q_info = quarter_ranges.get(q_num, {})
            q_start = q_info.get('start', '08-01')
            q_end = q_info.get('end', '10-31')
            if date_in_range(record_date, q_start, q_end):
                return q_num
        return None
    
    # Helper function to get school year for a date (August to August)
    def get_school_year_for_date(record_date):
        """Returns school year string like '2025-2026' for a given date.
        School year runs from August 1 to July 31."""
        year = record_date.year
        month = record_date.month
        if month >= 8:  # August to December
            return f"{year}-{year + 1}"
        else:  # January to July
            return f"{year - 1}-{year}"
    
    # Helper function to format month name
    def format_month_name(year, month):
        """Returns formatted string like 'January 25'."""
        month_names = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December']
        year_short = str(year)[-2:]  # Last 2 digits of year
        return f"{month_names[month - 1]} {year_short}"
    
    # Helper function to get available school years from records
    def get_available_school_years(records):
        """Returns sorted list of unique school years present in the data."""
        school_years = set()
        for record in records:
            school_year = get_school_year_for_date(record.date)
            school_years.add(school_year)
        return sorted(school_years)
    
    def compute_attendance_summary(records):
        """Compute attendance breakdown and percent of days present for a set of records."""
        summary = {
            'present': 0,
            'excused': 0,
            'unexcused': 0,
            'present_pct': 0.0,
        }
        total = 0
        for r in records:
            status = r.attendance_status or ('present' if r.present else 'unexcused')
            if status not in ('present', 'excused', 'unexcused'):
                continue
            summary[status] += 1
            total += 1
        if total > 0:
            summary['present_pct'] = round((summary['present'] / total) * 100, 1)
        return summary

    def compute_attendance_by_day_of_week(records):
        """Compute attendance counts (present / excused / unexcused) per day of week."""
        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        by_day = {day: {'present': 0, 'excused': 0, 'unexcused': 0} for day in days}
        for r in records:
            status = r.attendance_status or ('present' if r.present else 'unexcused')
            if status not in ('present', 'excused', 'unexcused'):
                continue
            day = (r.day_of_week or r.date.strftime('%A')) if hasattr(r, 'day_of_week') else r.date.strftime('%A')
            if day not in by_day:
                continue
            by_day[day][status] += 1
        # Optionally drop days with zero totals to keep payload small
        trimmed = {}
        for day, counts in by_day.items():
            if any(counts.values()):
                trimmed[day] = counts
        return trimmed

    def _info_json_truthy(value):
        return value and value not in (False, None, '', 'false', 'False', '0', 0)

    def _purpose_values_from_info(info_data):
        """Purposes from daily-entry info JSON (array or legacy purpose1/2)."""
        vals = []
        purposes = (info_data or {}).get('purposes')
        if isinstance(purposes, list):
            vals.extend(purposes)
        for key in ('purpose1', 'purpose2'):
            p = (info_data or {}).get(key)
            if p:
                vals.append(p)
        return vals

    def _period_info_frenzy_severity_int(info_data):
        """Severity 1–5 when info marks a frenzy; None if not a frenzy row."""
        if not _info_json_truthy((info_data or {}).get('frenzy')):
            return None
        sev_raw = (info_data or {}).get('severity')
        if sev_raw is not None and sev_raw != '':
            try:
                return max(1, min(5, int(sev_raw)))
            except (TypeError, ValueError):
                pass
        return 1

    def _accumulate_frenzy_severity_for_cell(sev_map, time_label, sev_int, purpose_values=()):
        """Add one frenzy into per-(weekday, time) severity buckets for trigger-time heatmap/table."""
        sev_int = max(1, min(5, int(sev_int)))
        bucket = sev_map.get(time_label)
        if bucket is None:
            bucket = {
                'severity_sum': 0,
                'severity_count': 0,
                'severity_breakdown': {},
                'purpose_breakdown': {},
            }
            sev_map[time_label] = bucket
        bucket['severity_sum'] += sev_int
        bucket['severity_count'] += 1
        sev_key = str(sev_int)
        bucket['severity_breakdown'][sev_key] = bucket['severity_breakdown'].get(sev_key, 0) + 1
        for purpose_val in purpose_values:
            purpose_name = frenzy_label_or_missing(purpose_val)
            bucket['purpose_breakdown'][purpose_name] = (
                bucket['purpose_breakdown'].get(purpose_name, 0) + 1
            )

    def _frenzy_duration_bucket(minutes):
        """Classify frenzy duration into buckets."""
        try:
            m = int(minutes or 0)
        except (TypeError, ValueError):
            m = 0
        if m <= 5:
            return '0-5'
        elif m <= 10:
            return '6-10'
        elif m <= 20:
            return '11-20'
        else:
            return '21+'

    def _period_infraction_counts_for_frenzy(period, info_data):
        """Aggregate infraction type->count from period.infractions + info.infractions + legacy infraction1/2."""
        counts = {}
        for inf in (getattr(period, 'infractions', None) or []):
            inf_type = (getattr(inf, 'type', None) or '').strip()
            if inf_type:
                inf_count = getattr(inf, 'count', 1) or 1
                try:
                    inf_count = int(inf_count)
                except (TypeError, ValueError):
                    inf_count = 1
                counts[inf_type] = counts.get(inf_type, 0) + inf_count
        inf_arr = (info_data or {}).get('infractions')
        if isinstance(inf_arr, list):
            for inf_item in inf_arr:
                if not isinstance(inf_item, dict):
                    continue
                inf_type = (inf_item.get('type') or '').strip()
                if inf_type:
                    try:
                        inf_count = int(inf_item.get('count', 1))
                    except (ValueError, TypeError):
                        inf_count = 1
                    counts[inf_type] = counts.get(inf_type, 0) + inf_count
        legacy1 = (info_data or {}).get('infraction1')
        if legacy1:
            legacy1 = (str(legacy1 or '')).strip()
            if legacy1:
                counts[legacy1] = counts.get(legacy1, 0) + 1
        legacy2 = (info_data or {}).get('infraction2')
        if legacy2:
            legacy2 = (str(legacy2 or '')).strip()
            if legacy2:
                counts[legacy2] = counts.get(legacy2, 0) + 1
        return counts

    def _build_frenzy_card_aggregates(record_list):
        """Build comprehensive frenzy card statistics from FrenzyEvents and info-period frenzies."""
        weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        
        total_frenzies = 0
        frenzies_by_severity = {}
        for s in range(1, 6):
            frenzies_by_severity[str(s)] = {
                'count': 0,
                'total_duration': 0,
                'avg_duration': 0,
                'by_time': {},
                'by_day_of_week': {day: 0 for day in weekdays},
                'by_location': {},
                'purpose_breakdown': {},
                'infractions_breakdown': {},
            }
        
        frenzies_by_time = {}
        frenzies_by_day = {day: {'count': 0, 'total_duration': 0, 'avg_duration': 0, 'severity_breakdown': {}} for day in weekdays}
        frenzies_by_location = {}
        frenzies_by_purpose = {}
        frenzies_by_duration_bucket = {}
        
        total_duration = 0
        total_count = 0
        infractions_for_frenzies = {}
        frenzies_severity_totals = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0}
        
        def ensure_bucket(bucket_dict, key, init_keys=None):
            if key not in bucket_dict:
                bucket_dict[key] = {
                    'count': 0,
                    'total_duration': 0,
                    'avg_duration': 0,
                    'severity_breakdown': {},
                }
                if init_keys:
                    for k in init_keys:
                        bucket_dict[key][k] = {}
            return bucket_dict[key]
        
        for record in record_list:
            day_of_week = record.day_of_week
            is_weekday = day_of_week in weekdays
            
            for frenzy in (getattr(record, 'frenzies', None) or []):
                sev = getattr(frenzy, 'severity', None)
                if sev is None:
                    sev = 1
                try:
                    sev_int = max(1, min(5, int(sev)))
                except (TypeError, ValueError):
                    sev_int = 1
                sev_key = str(sev_int)
                
                duration = getattr(frenzy, 'duration_minutes', None) or 0
                try:
                    duration = int(duration)
                except (TypeError, ValueError):
                    duration = 0
                
                total_frenzies += 1
                total_count += 1
                total_duration += duration
                frenzies_severity_totals[sev_key] = frenzies_severity_totals.get(sev_key, 0) + 1
                
                sev_bucket = frenzies_by_severity[sev_key]
                sev_bucket['count'] += 1
                sev_bucket['total_duration'] += duration
                
                time_label = (getattr(frenzy, 'time_range', None) or '').strip() or FRENZY_MISSING_LABEL
                time_bucket = ensure_bucket(frenzies_by_time, time_label)
                time_bucket['count'] += 1
                time_bucket['total_duration'] += duration
                time_bucket['severity_breakdown'][sev_key] = time_bucket['severity_breakdown'].get(sev_key, 0) + 1
                
                sev_bucket['by_time'][time_label] = sev_bucket['by_time'].get(time_label, 0) + 1
                
                if is_weekday:
                    sev_bucket['by_day_of_week'][day_of_week] += 1
                    day_bucket = frenzies_by_day[day_of_week]
                    day_bucket['count'] += 1
                    day_bucket['total_duration'] += duration
                    day_bucket['severity_breakdown'][sev_key] = day_bucket['severity_breakdown'].get(sev_key, 0) + 1
                
                location = frenzy_location_label(getattr(frenzy, 'location', None))
                loc_bucket = ensure_bucket(frenzies_by_location, location)
                loc_bucket['count'] += 1
                loc_bucket['total_duration'] += duration
                loc_bucket['severity_breakdown'][sev_key] = loc_bucket['severity_breakdown'].get(sev_key, 0) + 1
                sev_bucket['by_location'][location] = sev_bucket['by_location'].get(location, 0) + 1
                
                purpose_labels = frenzy_purpose_labels_from_event(
                    getattr(frenzy, 'purpose', None),
                    getattr(frenzy, 'purpose2', None),
                )
                for purp in purpose_labels:
                    purp_bucket = ensure_bucket(frenzies_by_purpose, purp)
                    purp_bucket['count'] += 1
                    purp_bucket['total_duration'] += duration
                    purp_bucket['severity_breakdown'][sev_key] = purp_bucket['severity_breakdown'].get(sev_key, 0) + 1
                    sev_bucket['purpose_breakdown'][purp] = sev_bucket['purpose_breakdown'].get(purp, 0) + 1
                
                dur_bucket_key = _frenzy_duration_bucket(duration)
                dur_bucket = ensure_bucket(frenzies_by_duration_bucket, dur_bucket_key)
                dur_bucket['count'] += 1
                dur_bucket['total_duration'] += duration
                dur_bucket['severity_breakdown'][sev_key] = dur_bucket['severity_breakdown'].get(sev_key, 0) + 1
            
            for period in (getattr(record, 'periods', None) or []):
                info_data = None
                try:
                    info_raw = getattr(period, 'info', None)
                    if info_raw:
                        info_data = json.loads(info_raw)
                except (TypeError, ValueError, AttributeError):
                    info_data = None
                
                if not _info_json_truthy((info_data or {}).get('frenzy')):
                    continue
                
                info_sev = _period_info_frenzy_severity_int(info_data)
                if info_sev is None:
                    info_sev = 1
                sev_key = str(info_sev)
                
                duration = 0
                try:
                    duration = int((info_data or {}).get('duration_minutes', 0))
                except (TypeError, ValueError):
                    duration = 0
                
                total_frenzies += 1
                total_count += 1
                total_duration += duration
                frenzies_severity_totals[sev_key] = frenzies_severity_totals.get(sev_key, 0) + 1
                
                sev_bucket = frenzies_by_severity[sev_key]
                sev_bucket['count'] += 1
                sev_bucket['total_duration'] += duration
                
                time_label = (getattr(period, 'time_range', None) or '').strip() or FRENZY_MISSING_LABEL
                time_bucket = ensure_bucket(frenzies_by_time, time_label)
                time_bucket['count'] += 1
                time_bucket['total_duration'] += duration
                time_bucket['severity_breakdown'][sev_key] = time_bucket['severity_breakdown'].get(sev_key, 0) + 1
                
                sev_bucket['by_time'][time_label] = sev_bucket['by_time'].get(time_label, 0) + 1
                
                if is_weekday:
                    sev_bucket['by_day_of_week'][day_of_week] += 1
                    day_bucket = frenzies_by_day[day_of_week]
                    day_bucket['count'] += 1
                    day_bucket['total_duration'] += duration
                    day_bucket['severity_breakdown'][sev_key] = day_bucket['severity_breakdown'].get(sev_key, 0) + 1
                
                location = (info_data or {}).get('alternate_location') or (info_data or {}).get('location')
                if not location:
                    location = getattr(period, 'location', None)
                location = frenzy_location_label(location)
                loc_bucket = ensure_bucket(frenzies_by_location, location)
                loc_bucket['count'] += 1
                loc_bucket['total_duration'] += duration
                loc_bucket['severity_breakdown'][sev_key] = loc_bucket['severity_breakdown'].get(sev_key, 0) + 1
                sev_bucket['by_location'][location] = sev_bucket['by_location'].get(location, 0) + 1
                
                for purp in frenzy_purpose_labels_from_info(info_data):
                    purp_bucket = ensure_bucket(frenzies_by_purpose, purp)
                    purp_bucket['count'] += 1
                    purp_bucket['total_duration'] += duration
                    purp_bucket['severity_breakdown'][sev_key] = purp_bucket['severity_breakdown'].get(sev_key, 0) + 1
                    sev_bucket['purpose_breakdown'][purp] = sev_bucket['purpose_breakdown'].get(purp, 0) + 1
                
                dur_bucket_key = _frenzy_duration_bucket(duration)
                dur_bucket = ensure_bucket(frenzies_by_duration_bucket, dur_bucket_key)
                dur_bucket['count'] += 1
                dur_bucket['total_duration'] += duration
                dur_bucket['severity_breakdown'][sev_key] = dur_bucket['severity_breakdown'].get(sev_key, 0) + 1
                
                inf_counts = _period_infraction_counts_for_frenzy(period, info_data)
                for inf_type, inf_count in inf_counts.items():
                    infractions_for_frenzies[inf_type] = infractions_for_frenzies.get(inf_type, 0) + inf_count
                    sev_bucket['infractions_breakdown'][inf_type] = sev_bucket['infractions_breakdown'].get(inf_type, 0) + inf_count
        
        for s in range(1, 6):
            sev_key = str(s)
            sev_bucket = frenzies_by_severity[sev_key]
            if sev_bucket['count'] > 0:
                sev_bucket['avg_duration'] = round(sev_bucket['total_duration'] / sev_bucket['count'], 1)
        
        for time_label, time_bucket in frenzies_by_time.items():
            if time_bucket['count'] > 0:
                time_bucket['avg_duration'] = round(time_bucket['total_duration'] / time_bucket['count'], 1)
        
        for day, day_bucket in frenzies_by_day.items():
            if day_bucket['count'] > 0:
                day_bucket['avg_duration'] = round(day_bucket['total_duration'] / day_bucket['count'], 1)
        
        for loc, loc_bucket in frenzies_by_location.items():
            if loc_bucket['count'] > 0:
                loc_bucket['avg_duration'] = round(loc_bucket['total_duration'] / loc_bucket['count'], 1)
        
        for purp, purp_bucket in frenzies_by_purpose.items():
            if purp_bucket['count'] > 0:
                purp_bucket['avg_duration'] = round(purp_bucket['total_duration'] / purp_bucket['count'], 1)
        
        for dur_key, dur_bucket in frenzies_by_duration_bucket.items():
            if dur_bucket['count'] > 0:
                dur_bucket['avg_duration'] = round(dur_bucket['total_duration'] / dur_bucket['count'], 1)
        
        avg_duration = round(total_duration / total_count, 1) if total_count > 0 else 0
        
        return {
            'total_frenzies': total_frenzies,
            'frenzies_by_severity': frenzies_by_severity,
            'frenzies_by_time': frenzies_by_time,
            'frenzies_by_day': frenzies_by_day,
            'frenzies_by_location': frenzies_by_location,
            'frenzies_by_purpose': frenzies_by_purpose,
            'frenzies_by_duration_bucket': frenzies_by_duration_bucket,
            'frenzies_duration_summary': {
                'total_duration': total_duration,
                'avg_duration': avg_duration,
                'total_count': total_count,
            },
            'infractions_for_frenzies': infractions_for_frenzies,
            'frenzies_severity_totals': frenzies_severity_totals,
        }

    def _attach_frenzy_card_fields(result, stats):
        """Copy frenzy card aggregates from stats into response dict."""
        result['total_frenzies'] = stats.get('total_frenzies', 0)
        result['frenzies_by_severity'] = stats.get('frenzies_by_severity', {})
        result['frenzies_by_time'] = stats.get('frenzies_by_time', {})
        result['frenzies_by_day'] = stats.get('frenzies_by_day', {})
        result['frenzies_by_location'] = stats.get('frenzies_by_location', {})
        result['frenzies_by_purpose'] = stats.get('frenzies_by_purpose', {})
        result['frenzies_by_duration_bucket'] = stats.get('frenzies_by_duration_bucket', {})
        result['frenzies_duration_summary'] = stats.get('frenzies_duration_summary', {})
        result['infractions_for_frenzies'] = stats.get('infractions_for_frenzies', {})
        result['frenzies_severity_totals'] = stats.get('frenzies_severity_totals', {})

    def calculate_summary_stats_lite(record_list):
        """Faster summary aggregation used for dashboard loads."""
        weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

        total_safety = 0
        total_teamwork = 0
        total_accountability = 0
        total_relationships = 0
        total_possible = 0
        total_frenzies = 0
        total_infractions = {}

        additional_info = {
            'infractions': {},
            'total_reminders': 0,
            'total_resets': 0,
            'infractions_for_reminders': {},
            'infractions_for_resets': {},
        }

        by_day_of_week = {
            day: {
                'total_days': 0,
                'safety_points': 0,
                'teamwork_points': 0,
                'accountability_points': 0,
                'relationships_points': 0,
                'possible_points': 0,
                'infractions': {},
                'total_reminders': 0,
                'total_resets': 0,
            } for day in weekdays
        }
        by_class = {}
        by_time = {}
        by_time_by_day = {day: {} for day in weekdays}

        # Per-(day, time) frenzy severity aggregation. Mirrors the heavy
        # summary path so the overview heatmap always has severity data.
        frenzy_severity_by_time_by_day = {day: {} for day in weekdays}

        for record in record_list:
            day_of_week = record.day_of_week
            is_weekday = day_of_week in weekdays
            if is_weekday:
                by_day_of_week[day_of_week]['total_days'] += 1

                for frenzy in (getattr(record, 'frenzies', None) or []):
                    sev = getattr(frenzy, 'severity', None)
                    if sev is None:
                        continue
                    try:
                        sev_int = int(sev)
                    except (TypeError, ValueError):
                        continue
                    time_label = (getattr(frenzy, 'time_range', '') or '').strip() or FRENZY_MISSING_LABEL
                    _accumulate_frenzy_severity_for_cell(
                        frenzy_severity_by_time_by_day[day_of_week],
                        time_label,
                        sev_int,
                        (getattr(frenzy, 'purpose', None), getattr(frenzy, 'purpose2', None)),
                    )

            for period in record.periods:
                sp = _star_point_sum_value(period.safety_points)
                tp = _star_point_sum_value(period.teamwork_points)
                ap = _star_point_sum_value(period.accountability_points)
                rp = _star_point_sum_value(period.relationships_points)
                pp = int(period.points_possible or 0)

                total_safety += sp
                total_teamwork += tp
                total_accountability += ap
                total_relationships += rp
                total_possible += pp

                class_name = period.location or FRENZY_MISSING_LABEL
                time_label = (period.time_range or '').strip() or FRENZY_MISSING_LABEL

                if class_name not in by_class:
                    by_class[class_name] = {
                        'total_days': 0, 'safety_points': 0, 'teamwork_points': 0,
                        'accountability_points': 0, 'relationships_points': 0,
                        'possible_points': 0, 'infractions': {}, 'total_reminders': 0,
                        'total_resets': 0, '_unique_dates': set()
                    }
                cls = by_class[class_name]
                cls['safety_points'] += sp
                cls['teamwork_points'] += tp
                cls['accountability_points'] += ap
                cls['relationships_points'] += rp
                cls['possible_points'] += pp
                if record.date not in cls['_unique_dates']:
                    cls['_unique_dates'].add(record.date)
                    cls['total_days'] += 1

                if time_label not in by_time:
                    by_time[time_label] = {
                        'total_days': 0, 'safety_points': 0, 'teamwork_points': 0,
                        'accountability_points': 0, 'relationships_points': 0,
                        'possible_points': 0, 'infractions': {}, 'total_reminders': 0,
                        'total_resets': 0, '_unique_dates': set(), 'class_counts': {}
                    }
                tm = by_time[time_label]
                tm['safety_points'] += sp
                tm['teamwork_points'] += tp
                tm['accountability_points'] += ap
                tm['relationships_points'] += rp
                tm['possible_points'] += pp
                tm['class_counts'][class_name] = tm['class_counts'].get(class_name, 0) + 1
                if record.date not in tm['_unique_dates']:
                    tm['_unique_dates'].add(record.date)
                    tm['total_days'] += 1

                if is_weekday:
                    d = by_day_of_week[day_of_week]
                    d['safety_points'] += sp
                    d['teamwork_points'] += tp
                    d['accountability_points'] += ap
                    d['relationships_points'] += rp
                    d['possible_points'] += pp

                    day_time_map = by_time_by_day[day_of_week]
                    if time_label not in day_time_map:
                        day_time_map[time_label] = {
                            'total_days': 0,
                            'safety_points': 0,
                            'teamwork_points': 0,
                            'accountability_points': 0,
                            'relationships_points': 0,
                            'possible_points': 0,
                            'infractions': {},
                            'total_reminders': 0,
                            'total_resets': 0,
                            '_unique_dates': set(),
                        }
                    dt_bucket = day_time_map[time_label]
                    dt_bucket['safety_points'] += sp
                    dt_bucket['teamwork_points'] += tp
                    dt_bucket['accountability_points'] += ap
                    dt_bucket['relationships_points'] += rp
                    dt_bucket['possible_points'] += pp
                    if record.date not in dt_bucket['_unique_dates']:
                        dt_bucket['_unique_dates'].add(record.date)
                        dt_bucket['total_days'] += 1

                period_infraction_counts = {}
                for infraction in period.infractions:
                    itype = infraction.infraction_type
                    cnt = int(infraction.count or 0)
                    total_infractions[itype] = total_infractions.get(itype, 0) + cnt
                    additional_info['infractions'][itype] = additional_info['infractions'].get(itype, 0) + cnt
                    cls['infractions'][itype] = cls['infractions'].get(itype, 0) + cnt
                    tm['infractions'][itype] = tm['infractions'].get(itype, 0) + cnt
                    if is_weekday:
                        d = by_day_of_week[day_of_week]
                        d['infractions'][itype] = d['infractions'].get(itype, 0) + cnt
                        day_time_map = by_time_by_day[day_of_week]
                        if time_label not in day_time_map:
                            day_time_map[time_label] = {
                                'total_days': 0,
                                'safety_points': 0,
                                'teamwork_points': 0,
                                'accountability_points': 0,
                                'relationships_points': 0,
                                'possible_points': 0,
                                'infractions': {},
                                'total_reminders': 0,
                                'total_resets': 0,
                                '_unique_dates': set(),
                            }
                        dt_bucket = day_time_map[time_label]
                        dt_bucket['infractions'][itype] = dt_bucket['infractions'].get(itype, 0) + cnt
                    period_infraction_counts[itype] = period_infraction_counts.get(itype, 0) + cnt

                has_reminder_for_period = False
                has_reset_for_period = False
                if period.info:
                    try:
                        info_data = json.loads(period.info)
                    except (json.JSONDecodeError, ValueError, TypeError):
                        info_data = {}

                    for reminder_key in ('reminder1', 'reminder2', 'reminder3'):
                        rv = info_data.get(reminder_key, False)
                        if rv and rv not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            cls['total_reminders'] += 1
                            tm['total_reminders'] += 1
                            has_reminder_for_period = True
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1

                    reset = info_data.get('reset', False)
                    if reset and reset not in [False, None, '', 'false', 'False', '0', 0]:
                        additional_info['total_resets'] += 1
                        cls['total_resets'] += 1
                        tm['total_resets'] += 1
                        has_reset_for_period = True
                        if is_weekday:
                            by_day_of_week[day_of_week]['total_resets'] += 1

                    # Daily-entry frenzies live in period.info (not frenzy_events rows).
                    if is_weekday:
                        info_sev = _period_info_frenzy_severity_int(info_data)
                        if info_sev is not None:
                            info_time_label = (period.time_range or '').strip() or FRENZY_MISSING_LABEL
                            _accumulate_frenzy_severity_for_cell(
                                frenzy_severity_by_time_by_day[day_of_week],
                                info_time_label,
                                info_sev,
                                _purpose_values_from_info(info_data),
                            )

                if has_reminder_for_period and period_infraction_counts:
                    for itype, cnt in period_infraction_counts.items():
                        additional_info['infractions_for_reminders'][itype] = (
                            additional_info['infractions_for_reminders'].get(itype, 0) + cnt
                        )
                if has_reset_for_period and period_infraction_counts:
                    for itype, cnt in period_infraction_counts.items():
                        additional_info['infractions_for_resets'][itype] = (
                            additional_info['infractions_for_resets'].get(itype, 0) + cnt
                        )

        def pct_bundle(points):
            num_periods = points['possible_points'] / 4 if points['possible_points'] > 0 else 0
            max_cat = num_periods * 2 if num_periods > 0 else 0
            if max_cat <= 0:
                return {'safety': 0.0, 'teamwork': 0.0, 'accountability': 0.0, 'relationships': 0.0, 'overall': 0.0}
            s = (points['safety_points'] / max_cat) * 100
            t = (points['teamwork_points'] / max_cat) * 100
            a = (points['accountability_points'] / max_cat) * 100
            r = (points['relationships_points'] / max_cat) * 100
            return {'safety': s, 'teamwork': t, 'accountability': a, 'relationships': r, 'overall': (s + t + a + r) / 4}

        total_num_periods = total_possible / 4 if total_possible > 0 else 0
        total_max_cat = total_num_periods * 2 if total_num_periods > 0 else 0
        safety_percent = (total_safety / total_max_cat * 100) if total_max_cat > 0 else 0
        teamwork_percent = (total_teamwork / total_max_cat * 100) if total_max_cat > 0 else 0
        accountability_percent = (total_accountability / total_max_cat * 100) if total_max_cat > 0 else 0
        relationships_percent = (total_relationships / total_max_cat * 100) if total_max_cat > 0 else 0
        overall_percent = (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4 if total_max_cat > 0 else 0

        by_day_of_week_formatted = {}
        for day, d in by_day_of_week.items():
            p = pct_bundle(d)
            by_day_of_week_formatted[day] = {
                'total_days': d['total_days'],
                'percentages': {k: round(v, 1) for k, v in p.items()},
                'raw_percentages': p,
                'total_infractions': sum(d['infractions'].values()),
                'total_reminders': d['total_reminders'],
                'total_resets': d['total_resets'],
            }

        by_class_formatted = {}
        for class_name, c in by_class.items():
            p = pct_bundle(c)
            by_class_formatted[class_name] = {
                'total_days': c['total_days'],
                'percentages': {k: round(v, 1) for k, v in p.items()},
                'total_infractions': sum(c['infractions'].values()),
                'total_reminders': c['total_reminders'],
                'total_resets': c['total_resets'],
            }

        by_time_formatted = {}
        for time_label, t in by_time.items():
            p = pct_bundle(t)
            top_class_name = None
            top_class_count = 0
            if t['class_counts']:
                top_class_name, top_class_count = max(t['class_counts'].items(), key=lambda kv: kv[1])
            by_time_formatted[time_label] = {
                'total_days': t['total_days'],
                'percentages': {k: round(v, 1) for k, v in p.items()},
                'raw_percentages': p,
                'total_infractions': sum(t['infractions'].values()),
                'infractions': dict(t['infractions']),
                'total_reminders': t['total_reminders'],
                'total_resets': t['total_resets'],
                'top_class': top_class_name,
                'top_class_count': top_class_count,
            }

        by_time_by_day_formatted = {}
        for day, times_map in by_time_by_day.items():
            formatted_times = {}
            for time_label, time_data in times_map.items():
                time_data.pop('_unique_dates', None)
                num_periods_time = time_data['possible_points'] / 4 if time_data['possible_points'] > 0 else 0
                max_per_category_time = num_periods_time * 2 if num_periods_time > 0 else 0
                safety_percent_time = (time_data['safety_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                teamwork_percent_time = (time_data['teamwork_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                accountability_percent_time = (time_data['accountability_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                relationships_percent_time = (time_data['relationships_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                overall_percent_time = (safety_percent_time + teamwork_percent_time + accountability_percent_time + relationships_percent_time) / 4 if max_per_category_time > 0 else 0
                formatted_times[time_label] = {
                    'total_days': time_data['total_days'],
                    'percentages': {
                        'safety': round(safety_percent_time, 1),
                        'teamwork': round(teamwork_percent_time, 1),
                        'accountability': round(accountability_percent_time, 1),
                        'relationships': round(relationships_percent_time, 1),
                        'overall': round(overall_percent_time, 1),
                    },
                    'total_infractions': sum(time_data['infractions'].values()),
                    'infractions': dict(time_data.get('infractions', {})),
                    'total_reminders': time_data['total_reminders'],
                    'total_resets': time_data['total_resets'],
                }
            by_time_by_day_formatted[day] = formatted_times

        # Format frenzy severity per (day, time) cell into average severity.
        frenzy_severity_by_time_by_day_formatted = {}
        frenzy_cell_details_by_time_by_day = {}
        for day, times_map in frenzy_severity_by_time_by_day.items():
            formatted_sev = {}
            formatted_details = {}
            for time_label, bucket in times_map.items():
                count = bucket.get('severity_count') or 0
                if count <= 0:
                    continue
                sev_sum = bucket.get('severity_sum') or 0
                avg_sev = sev_sum / count
                severity_breakdown = {
                    str(level): int((bucket.get('severity_breakdown') or {}).get(str(level), 0))
                    for level in range(1, 6)
                }
                purpose_breakdown = dict(sorted((bucket.get('purpose_breakdown') or {}).items(), key=lambda kv: (-int(kv[1] or 0), str(kv[0]))))
                formatted_sev[time_label] = {
                    'avg_severity': round(avg_sev, 2),
                    'frenzy_count': count,
                }
                formatted_details[time_label] = {
                    'severity_breakdown': severity_breakdown,
                    'purpose_breakdown': purpose_breakdown,
                }
            frenzy_severity_by_time_by_day_formatted[day] = formatted_sev
            frenzy_cell_details_by_time_by_day[day] = formatted_details

        frenzy_card = _build_frenzy_card_aggregates(record_list)

        return {
            'total_days': len(record_list),
            'totals': {
                'safety': total_safety,
                'teamwork': total_teamwork,
                'accountability': total_accountability,
                'relationships': total_relationships,
                'possible': total_possible
            },
            'percentages': {
                'safety': round(safety_percent, 1),
                'teamwork': round(teamwork_percent, 1),
                'accountability': round(accountability_percent, 1),
                'relationships': round(relationships_percent, 1),
                'overall': round(overall_percent, 1)
            },
            'infractions': total_infractions,
            'total_frenzies': frenzy_card['total_frenzies'],
            'additional_info': additional_info,
            'by_day_of_week': by_day_of_week_formatted,
            'by_class': by_class_formatted,
            'by_time': by_time_formatted,
            'by_time_by_day': by_time_by_day_formatted,
            'frenzy_severity_by_time_by_day': frenzy_severity_by_time_by_day_formatted,
            'frenzy_cell_details_by_time_by_day': frenzy_cell_details_by_time_by_day,
            'infractions_by_type': {},
            'frenzies_by_severity': frenzy_card['frenzies_by_severity'],
            'frenzies_by_time': frenzy_card['frenzies_by_time'],
            'frenzies_by_day': frenzy_card['frenzies_by_day'],
            'frenzies_by_location': frenzy_card['frenzies_by_location'],
            'frenzies_by_purpose': frenzy_card['frenzies_by_purpose'],
            'frenzies_by_duration_bucket': frenzy_card['frenzies_by_duration_bucket'],
            'frenzies_duration_summary': frenzy_card['frenzies_duration_summary'],
            'infractions_for_frenzies': frenzy_card['infractions_for_frenzies'],
            'frenzies_severity_totals': frenzy_card['frenzies_severity_totals'],
        }
    
    # Helper function to calculate summary stats for a set of records
    def calculate_summary_stats(record_list):
        total_safety = 0
        total_teamwork = 0
        total_accountability = 0
        total_relationships = 0
        total_possible = 0
        total_infractions = {}
        total_frenzies = 0
        additional_info = {
            'infractions': {},
            'total_reminders': 0,
            'total_resets': 0,
            # New: which infractions most often co-occur with reminders / resets
            'infractions_for_reminders': {},
            'infractions_for_resets': {},
        }
        
        # Initialize day of week statistics (weekdays only)
        weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        by_day_of_week = {}
        for day in weekdays:
            by_day_of_week[day] = {
                'total_days': 0,
                'safety_points': 0,
                'teamwork_points': 0,
                'accountability_points': 0,
                'relationships_points': 0,
                'possible_points': 0,
                'infractions': {},
                'total_reminders': 0,
                'total_resets': 0
            }
        
        # Initialize class statistics
        by_class = {}

        # Initialize time-of-day statistics (time periods as written in point cards)
        # Keyed by PeriodRecord.time_range (e.g., "7:45-8:30")
        by_time = {}
        # Nested time-of-day statistics by day of week:
        # { 'Monday': { '7:45-8:30': bucket, ... }, ... }
        by_time_by_day = {day: {} for day in weekdays}

        # Per-(day, time) frenzy severity aggregation. Each cell tracks the sum
        # and count of frenzy event severities so the overview heatmap can
        # display average severity (1 = Para, 5 = SRO).
        frenzy_severity_by_time_by_day = {day: {} for day in weekdays}

        for record in record_list:
            # Track day of week statistics (weekdays only)
            day_of_week = record.day_of_week
            is_weekday = day_of_week in weekdays

            if is_weekday:
                by_day_of_week[day_of_week]['total_days'] += 1

                # Aggregate frenzy severity per (day, time) cell. Frenzies
                # without a severity recorded are skipped so the average only
                # reflects events with a known level.
                for frenzy in (record.frenzies or []):
                    sev = frenzy.severity
                    if sev is None:
                        continue
                    try:
                        sev_int = int(sev)
                    except (TypeError, ValueError):
                        continue
                    time_label = (frenzy.time_range or '').strip() or FRENZY_MISSING_LABEL
                    _accumulate_frenzy_severity_for_cell(
                        frenzy_severity_by_time_by_day[day_of_week],
                        time_label,
                        sev_int,
                        (frenzy.purpose, frenzy.purpose2),
                    )

            for period in record.periods:
                total_safety += _star_point_sum_value(period.safety_points)
                total_teamwork += _star_point_sum_value(period.teamwork_points)
                total_accountability += _star_point_sum_value(period.accountability_points)
                total_relationships += _star_point_sum_value(period.relationships_points)
                total_possible += (period.points_possible or 0)

                # Normalize time period label (matches point card data tables)
                raw_time_period = (period.time_range or '').strip()
                time_label = raw_time_period or FRENZY_MISSING_LABEL

                # Initialize time bucket if needed
                if time_label not in by_time:
                    by_time[time_label] = {
                        'total_days': 0,
                        'safety_points': 0,
                        'teamwork_points': 0,
                        'accountability_points': 0,
                        'relationships_points': 0,
                        'possible_points': 0,
                        'infractions': {},
                        'total_reminders': 0,
                        'total_resets': 0,
                        '_unique_dates': set(),
                        'class_counts': {},
                    }
                time_data = by_time[time_label]

                time_data['safety_points'] += _star_point_sum_value(period.safety_points)
                time_data['teamwork_points'] += _star_point_sum_value(period.teamwork_points)
                time_data['accountability_points'] += _star_point_sum_value(period.accountability_points)
                time_data['relationships_points'] += _star_point_sum_value(period.relationships_points)
                time_data['possible_points'] += (period.points_possible or 0)

                # Track unique days per time period
                if record.date not in time_data['_unique_dates']:
                    time_data['_unique_dates'].add(record.date)
                    time_data['total_days'] += 1
                
                # Track day-of-week and day+time statistics for this period
                if is_weekday:
                    by_day_of_week[day_of_week]['safety_points'] += _star_point_sum_value(period.safety_points)
                    by_day_of_week[day_of_week]['teamwork_points'] += _star_point_sum_value(period.teamwork_points)
                    by_day_of_week[day_of_week]['accountability_points'] += _star_point_sum_value(period.accountability_points)
                    by_day_of_week[day_of_week]['relationships_points'] += _star_point_sum_value(period.relationships_points)
                    by_day_of_week[day_of_week]['possible_points'] += (period.points_possible or 0)

                    # Nested time-of-day stats for this day of week
                    day_time_map = by_time_by_day[day_of_week]
                    if time_label not in day_time_map:
                        day_time_map[time_label] = {
                            'total_days': 0,
                            'safety_points': 0,
                            'teamwork_points': 0,
                            'accountability_points': 0,
                            'relationships_points': 0,
                            'possible_points': 0,
                            'infractions': {},
                            'total_reminders': 0,
                            'total_resets': 0,
                            '_unique_dates': set(),
                        }
                    dt_bucket = day_time_map[time_label]
                    dt_bucket['safety_points'] += _star_point_sum_value(period.safety_points)
                    dt_bucket['teamwork_points'] += _star_point_sum_value(period.teamwork_points)
                    dt_bucket['accountability_points'] += _star_point_sum_value(period.accountability_points)
                    dt_bucket['relationships_points'] += _star_point_sum_value(period.relationships_points)
                    dt_bucket['possible_points'] += (period.points_possible or 0)
                    if record.date not in dt_bucket['_unique_dates']:
                        dt_bucket['_unique_dates'].add(record.date)
                        dt_bucket['total_days'] += 1
                
                # Track class statistics for this period
                class_name = period.location or FRENZY_MISSING_LABEL
                if class_name not in by_class:
                    by_class[class_name] = {
                        'total_days': 0,
                        'safety_points': 0,
                        'teamwork_points': 0,
                        'accountability_points': 0,
                        'relationships_points': 0,
                        'possible_points': 0,
                        'infractions': {},
                        'total_reminders': 0,
                        'total_resets': 0,
                        '_unique_dates': set()
                    }
                by_class[class_name]['safety_points'] += _star_point_sum_value(period.safety_points)
                by_class[class_name]['teamwork_points'] += _star_point_sum_value(period.teamwork_points)
                by_class[class_name]['accountability_points'] += _star_point_sum_value(period.accountability_points)
                by_class[class_name]['relationships_points'] += _star_point_sum_value(period.relationships_points)
                by_class[class_name]['possible_points'] += (period.points_possible or 0)
                
                # Track unique days per class (count once per date)
                if record.date not in by_class[class_name]['_unique_dates']:
                    by_class[class_name]['_unique_dates'].add(record.date)
                    by_class[class_name]['total_days'] += 1

                # Track which classes most often occur in each time period
                time_data['class_counts'][class_name] = time_data['class_counts'].get(class_name, 0) + 1

                # Count infractions from period.infractions relationship
                # Collect infractions for this period so we can later associate
                # them with reminders / resets when present.
                period_infraction_counts = {}

                for infraction in period.infractions:
                    if infraction.infraction_type not in total_infractions:
                        total_infractions[infraction.infraction_type] = 0
                    total_infractions[infraction.infraction_type] += infraction.count
                    
                    if infraction.infraction_type not in additional_info['infractions']:
                        additional_info['infractions'][infraction.infraction_type] = 0
                    additional_info['infractions'][infraction.infraction_type] += infraction.count
                    
                    # Track infractions by day of week
                    if is_weekday:
                        if infraction.infraction_type not in by_day_of_week[day_of_week]['infractions']:
                            by_day_of_week[day_of_week]['infractions'][infraction.infraction_type] = 0
                        by_day_of_week[day_of_week]['infractions'][infraction.infraction_type] += infraction.count

                        # Track infractions by (day of week, time of day)
                        day_time_map = by_time_by_day[day_of_week]
                        if time_label not in day_time_map:
                            day_time_map[time_label] = {
                                'total_days': 0,
                                'safety_points': 0,
                                'teamwork_points': 0,
                                'accountability_points': 0,
                                'relationships_points': 0,
                                'possible_points': 0,
                                'infractions': {},
                                'total_reminders': 0,
                                'total_resets': 0,
                                '_unique_dates': set(),
                            }
                        dt_bucket = day_time_map[time_label]
                        if infraction.infraction_type not in dt_bucket['infractions']:
                            dt_bucket['infractions'][infraction.infraction_type] = 0
                        dt_bucket['infractions'][infraction.infraction_type] += infraction.count
                    
                    # Track infractions by class
                    class_name = period.location or FRENZY_MISSING_LABEL
                    if infraction.infraction_type not in by_class[class_name]['infractions']:
                        by_class[class_name]['infractions'][infraction.infraction_type] = 0
                    by_class[class_name]['infractions'][infraction.infraction_type] += infraction.count

                    # Track infractions by time period
                    raw_time_period = (period.time_range or '').strip()
                    time_label = raw_time_period or FRENZY_MISSING_LABEL
                    if time_label not in by_time:
                        by_time[time_label] = {
                            'total_days': 0,
                            'safety_points': 0,
                            'teamwork_points': 0,
                            'accountability_points': 0,
                            'relationships_points': 0,
                            'possible_points': 0,
                            'infractions': {},
                            'total_reminders': 0,
                            'total_resets': 0,
                            '_unique_dates': set(),
                            'class_counts': {},
                        }
                    time_data = by_time[time_label]
                    if infraction.infraction_type not in time_data['infractions']:
                        time_data['infractions'][infraction.infraction_type] = 0
                    time_data['infractions'][infraction.infraction_type] += infraction.count

                    # Track on a per-period basis for reminder/reset association
                    period_infraction_counts[infraction.infraction_type] = period_infraction_counts.get(infraction.infraction_type, 0) + infraction.count
                
                # Extract all data from Info column JSON data
                has_reminder_for_period = False
                has_reset_for_period = False

                if period.info:
                    try:
                        info_data = json.loads(period.info)
                        
                        # Extract infraction1
                        infraction1 = info_data.get('infraction1')
                        if infraction1 and str(infraction1).strip():
                            infraction_type = str(infraction1).strip()
                            count = 1
                            try:
                                count = int(info_data.get('infraction1Count', 1))
                            except (ValueError, TypeError):
                                count = 1
                            if infraction_type not in total_infractions:
                                total_infractions[infraction_type] = 0
                            total_infractions[infraction_type] += count
                            
                            if infraction_type not in additional_info['infractions']:
                                additional_info['infractions'][infraction_type] = 0
                            additional_info['infractions'][infraction_type] += count
                            
                            # Track infractions by day of week
                            if is_weekday:
                                if infraction_type not in by_day_of_week[day_of_week]['infractions']:
                                    by_day_of_week[day_of_week]['infractions'][infraction_type] = 0
                                by_day_of_week[day_of_week]['infractions'][infraction_type] += count

                                # Track infractions by (day of week, time of day)
                                day_time_map = by_time_by_day[day_of_week]
                                if time_label not in day_time_map:
                                    day_time_map[time_label] = {
                                        'total_days': 0,
                                        'safety_points': 0,
                                        'teamwork_points': 0,
                                        'accountability_points': 0,
                                        'relationships_points': 0,
                                        'possible_points': 0,
                                        'infractions': {},
                                        'total_reminders': 0,
                                        'total_resets': 0,
                                        '_unique_dates': set(),
                                    }
                                dt_bucket = day_time_map[time_label]
                                if infraction_type not in dt_bucket['infractions']:
                                    dt_bucket['infractions'][infraction_type] = 0
                                dt_bucket['infractions'][infraction_type] += count
                            
                            # Track infractions by class
                            class_name = period.location or FRENZY_MISSING_LABEL
                            if infraction_type not in by_class[class_name]['infractions']:
                                by_class[class_name]['infractions'][infraction_type] = 0
                            by_class[class_name]['infractions'][infraction_type] += count

                            # Track infractions by time period
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            time_data = by_time[time_label]
                            if infraction_type not in time_data['infractions']:
                                time_data['infractions'][infraction_type] = 0
                            time_data['infractions'][infraction_type] += count
                            period_infraction_counts[infraction_type] = period_infraction_counts.get(infraction_type, 0) + count
                        
                        # Extract infraction2
                        infraction2 = info_data.get('infraction2')
                        if infraction2 and str(infraction2).strip():
                            infraction_type = str(infraction2).strip()
                            count = 1
                            try:
                                count = int(info_data.get('infraction2Count', 1))
                            except (ValueError, TypeError):
                                count = 1
                            if infraction_type not in total_infractions:
                                total_infractions[infraction_type] = 0
                            total_infractions[infraction_type] += count
                            
                            if infraction_type not in additional_info['infractions']:
                                additional_info['infractions'][infraction_type] = 0
                            additional_info['infractions'][infraction_type] += count
                            
                            # Track infractions by day of week
                            if is_weekday:
                                if infraction_type not in by_day_of_week[day_of_week]['infractions']:
                                    by_day_of_week[day_of_week]['infractions'][infraction_type] = 0
                                by_day_of_week[day_of_week]['infractions'][infraction_type] += count

                                # Track infractions by (day of week, time of day)
                                day_time_map = by_time_by_day[day_of_week]
                                if time_label not in day_time_map:
                                    day_time_map[time_label] = {
                                        'total_days': 0,
                                        'safety_points': 0,
                                        'teamwork_points': 0,
                                        'accountability_points': 0,
                                        'relationships_points': 0,
                                        'possible_points': 0,
                                        'infractions': {},
                                        'total_reminders': 0,
                                        'total_resets': 0,
                                        '_unique_dates': set(),
                                    }
                                dt_bucket = day_time_map[time_label]
                                if infraction_type not in dt_bucket['infractions']:
                                    dt_bucket['infractions'][infraction_type] = 0
                                dt_bucket['infractions'][infraction_type] += count
                            
                            # Track infractions by class
                            class_name = period.location or FRENZY_MISSING_LABEL
                            if infraction_type not in by_class[class_name]['infractions']:
                                by_class[class_name]['infractions'][infraction_type] = 0
                            by_class[class_name]['infractions'][infraction_type] += count

                            # Track infractions by time period
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            time_data = by_time[time_label]
                            if infraction_type not in time_data['infractions']:
                                time_data['infractions'][infraction_type] = 0
                            time_data['infractions'][infraction_type] += count
                            period_infraction_counts[infraction_type] = period_infraction_counts.get(infraction_type, 0) + count
                        
                        # Extract infractions array (Info column dynamic infractions)
                        for inf_item in info_data.get('infractions') or []:
                            if not isinstance(inf_item, dict):
                                continue
                            infraction_type = (inf_item.get('type') or '').strip()
                            if not infraction_type:
                                continue
                            try:
                                count = int(inf_item.get('count', 1))
                            except (ValueError, TypeError):
                                count = 1
                            if infraction_type not in total_infractions:
                                total_infractions[infraction_type] = 0
                            total_infractions[infraction_type] += count
                            if infraction_type not in additional_info['infractions']:
                                additional_info['infractions'][infraction_type] = 0
                            additional_info['infractions'][infraction_type] += count
                            if is_weekday:
                                if infraction_type not in by_day_of_week[day_of_week]['infractions']:
                                    by_day_of_week[day_of_week]['infractions'][infraction_type] = 0
                                by_day_of_week[day_of_week]['infractions'][infraction_type] += count

                                # Track infractions by (day of week, time of day)
                                day_time_map = by_time_by_day[day_of_week]
                                if time_label not in day_time_map:
                                    day_time_map[time_label] = {
                                        'total_days': 0,
                                        'safety_points': 0,
                                        'teamwork_points': 0,
                                        'accountability_points': 0,
                                        'relationships_points': 0,
                                        'possible_points': 0,
                                        'infractions': {},
                                        'total_reminders': 0,
                                        'total_resets': 0,
                                        '_unique_dates': set(),
                                    }
                                dt_bucket = day_time_map[time_label]
                                if infraction_type not in dt_bucket['infractions']:
                                    dt_bucket['infractions'][infraction_type] = 0
                                dt_bucket['infractions'][infraction_type] += count
                            class_name = period.location or FRENZY_MISSING_LABEL
                            if infraction_type not in by_class[class_name]['infractions']:
                                by_class[class_name]['infractions'][infraction_type] = 0
                            by_class[class_name]['infractions'][infraction_type] += count
                            # Track infractions by time period
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            time_data = by_time[time_label]
                            if infraction_type not in time_data['infractions']:
                                time_data['infractions'][infraction_type] = 0
                            time_data['infractions'][infraction_type] += count
                            period_infraction_counts[infraction_type] = period_infraction_counts.get(infraction_type, 0) + count
                        
                        # Count reminders
                        reminder1 = info_data.get('reminder1', False)
                        reminder2 = info_data.get('reminder2', False)
                        reminder3 = info_data.get('reminder3', False)
                        if reminder1 and reminder1 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            has_reminder_for_period = True
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or FRENZY_MISSING_LABEL
                            by_class[class_name]['total_reminders'] += 1
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            by_time[time_label]['total_reminders'] += 1
                        if reminder2 and reminder2 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            has_reminder_for_period = True
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or FRENZY_MISSING_LABEL
                            by_class[class_name]['total_reminders'] += 1
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            by_time[time_label]['total_reminders'] += 1
                        if reminder3 and reminder3 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            has_reminder_for_period = True
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or FRENZY_MISSING_LABEL
                            by_class[class_name]['total_reminders'] += 1
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            by_time[time_label]['total_reminders'] += 1
                        
                        # Count resets
                        reset = info_data.get('reset', False)
                        if reset and reset not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_resets'] += 1
                            has_reset_for_period = True
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_resets'] += 1
                            class_name = period.location or FRENZY_MISSING_LABEL
                            by_class[class_name]['total_resets'] += 1
                            raw_time_period = (period.time_range or '').strip()
                            time_label = raw_time_period or FRENZY_MISSING_LABEL
                            if time_label not in by_time:
                                by_time[time_label] = {
                                    'total_days': 0,
                                    'safety_points': 0,
                                    'teamwork_points': 0,
                                    'accountability_points': 0,
                                    'relationships_points': 0,
                                    'possible_points': 0,
                                    'infractions': {},
                                    'total_reminders': 0,
                                    'total_resets': 0,
                                    '_unique_dates': set(),
                                    'class_counts': {},
                                }
                            by_time[time_label]['total_resets'] += 1

                        # Daily-entry frenzies live in period.info (not frenzy_events rows).
                        if is_weekday:
                            info_sev = _period_info_frenzy_severity_int(info_data)
                            if info_sev is not None:
                                info_time_label = (period.time_range or '').strip() or FRENZY_MISSING_LABEL
                                _accumulate_frenzy_severity_for_cell(
                                    frenzy_severity_by_time_by_day[day_of_week],
                                    info_time_label,
                                    info_sev,
                                    _purpose_values_from_info(info_data),
                                )

                    except (json.JSONDecodeError, ValueError, TypeError):
                        pass

                # After processing this period's info, attribute its infractions
                # to reminders / resets if they occurred.
                if has_reminder_for_period and period_infraction_counts:
                    for itype, cnt in period_infraction_counts.items():
                        additional_info['infractions_for_reminders'][itype] = (
                            additional_info['infractions_for_reminders'].get(itype, 0) + cnt
                        )
                if has_reset_for_period and period_infraction_counts:
                    for itype, cnt in period_infraction_counts.items():
                        additional_info['infractions_for_resets'][itype] = (
                            additional_info['infractions_for_resets'].get(itype, 0) + cnt
                        )
        
        num_periods = total_possible / 4 if total_possible > 0 else 0
        max_per_category = num_periods * 2 if num_periods > 0 else 0
        
        safety_percent = (total_safety / max_per_category * 100) if max_per_category > 0 else 0
        teamwork_percent = (total_teamwork / max_per_category * 100) if max_per_category > 0 else 0
        accountability_percent = (total_accountability / max_per_category * 100) if max_per_category > 0 else 0
        relationships_percent = (total_relationships / max_per_category * 100) if max_per_category > 0 else 0
        overall_percent = (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4 if max_per_category > 0 else 0
        
        # Calculate percentages for each day of week
        by_day_of_week_formatted = {}
        for day in weekdays:
            day_data = by_day_of_week[day]
            num_periods_day = day_data['possible_points'] / 4 if day_data['possible_points'] > 0 else 0
            max_per_category_day = num_periods_day * 2 if num_periods_day > 0 else 0
            
            safety_percent_day = (day_data['safety_points'] / max_per_category_day * 100) if max_per_category_day > 0 else 0
            teamwork_percent_day = (day_data['teamwork_points'] / max_per_category_day * 100) if max_per_category_day > 0 else 0
            accountability_percent_day = (day_data['accountability_points'] / max_per_category_day * 100) if max_per_category_day > 0 else 0
            relationships_percent_day = (day_data['relationships_points'] / max_per_category_day * 100) if max_per_category_day > 0 else 0
            overall_percent_day = (safety_percent_day + teamwork_percent_day + accountability_percent_day + relationships_percent_day) / 4 if max_per_category_day > 0 else 0
            
            # Calculate total infractions for this day
            total_infractions_day = sum(day_data['infractions'].values())
            
            by_day_of_week_formatted[day] = {
                'total_days': day_data['total_days'],
                'percentages': {
                    'safety': round(safety_percent_day, 1),
                    'teamwork': round(teamwork_percent_day, 1),
                    'accountability': round(accountability_percent_day, 1),
                    'relationships': round(relationships_percent_day, 1),
                    'overall': round(overall_percent_day, 1)
                },
                'raw_percentages': {
                    'safety': safety_percent_day,
                    'teamwork': teamwork_percent_day,
                    'accountability': accountability_percent_day,
                    'relationships': relationships_percent_day,
                    'overall': overall_percent_day
                },
                'total_infractions': total_infractions_day,
                'total_reminders': day_data['total_reminders'],
                'total_resets': day_data['total_resets']
            }
        
        # Calculate percentages for each class
        by_class_formatted = {}
        for class_name, class_data in by_class.items():
            # Remove the internal _unique_dates set before formatting
            if '_unique_dates' in class_data:
                del class_data['_unique_dates']
            
            num_periods_class = class_data['possible_points'] / 4 if class_data['possible_points'] > 0 else 0
            max_per_category_class = num_periods_class * 2 if num_periods_class > 0 else 0
            
            safety_percent_class = (class_data['safety_points'] / max_per_category_class * 100) if max_per_category_class > 0 else 0
            teamwork_percent_class = (class_data['teamwork_points'] / max_per_category_class * 100) if max_per_category_class > 0 else 0
            accountability_percent_class = (class_data['accountability_points'] / max_per_category_class * 100) if max_per_category_class > 0 else 0
            relationships_percent_class = (class_data['relationships_points'] / max_per_category_class * 100) if max_per_category_class > 0 else 0
            overall_percent_class = (safety_percent_class + teamwork_percent_class + accountability_percent_class + relationships_percent_class) / 4 if max_per_category_class > 0 else 0
            
            # Calculate total infractions for this class
            total_infractions_class = sum(class_data['infractions'].values())
            
            by_class_formatted[class_name] = {
                'total_days': class_data['total_days'],
                'percentages': {
                    'safety': round(safety_percent_class, 1),
                    'teamwork': round(teamwork_percent_class, 1),
                    'accountability': round(accountability_percent_class, 1),
                    'relationships': round(relationships_percent_class, 1),
                    'overall': round(overall_percent_class, 1)
                },
                'total_infractions': total_infractions_class,
                'total_reminders': class_data['total_reminders'],
                'total_resets': class_data['total_resets']
            }

        # Calculate percentages for each time period and determine most common class
        by_time_formatted = {}
        for time_label, time_data in by_time.items():
            # Remove internal-only fields before formatting
            unique_dates = time_data.pop('_unique_dates', None)
            class_counts = time_data.pop('class_counts', {})

            num_periods_time = time_data['possible_points'] / 4 if time_data['possible_points'] > 0 else 0
            max_per_category_time = num_periods_time * 2 if num_periods_time > 0 else 0

            safety_percent_time = (time_data['safety_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
            teamwork_percent_time = (time_data['teamwork_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
            accountability_percent_time = (time_data['accountability_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
            relationships_percent_time = (time_data['relationships_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
            overall_percent_time = (safety_percent_time + teamwork_percent_time + accountability_percent_time + relationships_percent_time) / 4 if max_per_category_time > 0 else 0

            total_infractions_time = sum(time_data['infractions'].values())

            top_class_name = None
            top_class_count = 0
            if class_counts:
                top_class_name, top_class_count = max(class_counts.items(), key=lambda kv: kv[1])

            by_time_formatted[time_label] = {
                'total_days': time_data['total_days'],
                'percentages': {
                    'safety': round(safety_percent_time, 1),
                    'teamwork': round(teamwork_percent_time, 1),
                    'accountability': round(accountability_percent_time, 1),
                    'relationships': round(relationships_percent_time, 1),
                    'overall': round(overall_percent_time, 1),
                },
                'raw_percentages': {
                    'safety': safety_percent_time,
                    'teamwork': teamwork_percent_time,
                    'accountability': accountability_percent_time,
                    'relationships': relationships_percent_time,
                    'overall': overall_percent_time,
                },
                'total_infractions': total_infractions_time,
                'infractions': dict(time_data.get('infractions', {})),
                'total_reminders': time_data['total_reminders'],
                'total_resets': time_data['total_resets'],
                'top_class': top_class_name,
                'top_class_count': top_class_count,
            }

        # Calculate percentages for each (day of week, time of day) bucket
        by_time_by_day_formatted = {}
        for day, times_map in by_time_by_day.items():
            formatted_times = {}
            for time_label, time_data in times_map.items():
                unique_dates = time_data.pop('_unique_dates', None)

                num_periods_time = time_data['possible_points'] / 4 if time_data['possible_points'] > 0 else 0
                max_per_category_time = num_periods_time * 2 if num_periods_time > 0 else 0

                safety_percent_time = (time_data['safety_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                teamwork_percent_time = (time_data['teamwork_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                accountability_percent_time = (time_data['accountability_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                relationships_percent_time = (time_data['relationships_points'] / max_per_category_time * 100) if max_per_category_time > 0 else 0
                overall_percent_time = (safety_percent_time + teamwork_percent_time + accountability_percent_time + relationships_percent_time) / 4 if max_per_category_time > 0 else 0

                total_infractions_time = sum(time_data['infractions'].values())

                formatted_times[time_label] = {
                    'total_days': time_data['total_days'],
                    'percentages': {
                        'safety': round(safety_percent_time, 1),
                        'teamwork': round(teamwork_percent_time, 1),
                        'accountability': round(accountability_percent_time, 1),
                        'relationships': round(relationships_percent_time, 1),
                        'overall': round(overall_percent_time, 1),
                    },
                    'total_infractions': total_infractions_time,
                    'infractions': dict(time_data.get('infractions', {})),
                    'total_reminders': time_data['total_reminders'],
                    'total_resets': time_data['total_resets'],
                }
            by_time_by_day_formatted[day] = formatted_times

        # Format frenzy severity per (day, time) cell into average severity.
        frenzy_severity_by_time_by_day_formatted = {}
        frenzy_cell_details_by_time_by_day = {}
        for day, times_map in frenzy_severity_by_time_by_day.items():
            formatted_sev = {}
            formatted_details = {}
            for time_label, bucket in times_map.items():
                count = bucket.get('severity_count') or 0
                if count <= 0:
                    continue
                sev_sum = bucket.get('severity_sum') or 0
                avg_sev = sev_sum / count
                severity_breakdown = {
                    str(level): int((bucket.get('severity_breakdown') or {}).get(str(level), 0))
                    for level in range(1, 6)
                }
                purpose_breakdown = dict(sorted((bucket.get('purpose_breakdown') or {}).items(), key=lambda kv: (-int(kv[1] or 0), str(kv[0]))))
                formatted_sev[time_label] = {
                    'avg_severity': round(avg_sev, 2),
                    'frenzy_count': count,
                }
                formatted_details[time_label] = {
                    'severity_breakdown': severity_breakdown,
                    'purpose_breakdown': purpose_breakdown,
                }
            frenzy_severity_by_time_by_day_formatted[day] = formatted_sev
            frenzy_cell_details_by_time_by_day[day] = formatted_details

        # Build per-infraction breakdowns by time of day and day of week
        infractions_by_type = {}
        # From time-of-day buckets
        for time_label, time_data in by_time.items():
            for itype, cnt in (time_data.get('infractions') or {}).items():
                entry = infractions_by_type.setdefault(itype, {'by_time': {}, 'by_day_of_week': {}})
                entry['by_time'][time_label] = entry['by_time'].get(time_label, 0) + cnt
        # From day-of-week buckets
        for day_label, day_data in by_day_of_week.items():
            for itype, cnt in (day_data.get('infractions') or {}).items():
                entry = infractions_by_type.setdefault(itype, {'by_time': {}, 'by_day_of_week': {}})
                entry['by_day_of_week'][day_label] = entry['by_day_of_week'].get(day_label, 0) + cnt

        frenzy_card = _build_frenzy_card_aggregates(record_list)

        return {
            'total_days': len(record_list),
            'totals': {
                'safety': total_safety,
                'teamwork': total_teamwork,
                'accountability': total_accountability,
                'relationships': total_relationships,
                'possible': total_possible
            },
            'percentages': {
                'safety': round(safety_percent, 1),
                'teamwork': round(teamwork_percent, 1),
                'accountability': round(accountability_percent, 1),
                'relationships': round(relationships_percent, 1),
                'overall': round(overall_percent, 1)
            },
            'infractions': total_infractions,
            'total_frenzies': frenzy_card['total_frenzies'],
            'additional_info': additional_info,
            'by_day_of_week': by_day_of_week_formatted,
            'by_class': by_class_formatted,
            'by_time': by_time_formatted,
            'by_time_by_day': by_time_by_day_formatted,
            'frenzy_severity_by_time_by_day': frenzy_severity_by_time_by_day_formatted,
            'frenzy_cell_details_by_time_by_day': frenzy_cell_details_by_time_by_day,
            'infractions_by_type': infractions_by_type,
            'frenzies_by_severity': frenzy_card['frenzies_by_severity'],
            'frenzies_by_time': frenzy_card['frenzies_by_time'],
            'frenzies_by_day': frenzy_card['frenzies_by_day'],
            'frenzies_by_location': frenzy_card['frenzies_by_location'],
            'frenzies_by_purpose': frenzy_card['frenzies_by_purpose'],
            'frenzies_by_duration_bucket': frenzy_card['frenzies_by_duration_bucket'],
            'frenzies_duration_summary': frenzy_card['frenzies_duration_summary'],
            'infractions_for_frenzies': frenzy_card['infractions_for_frenzies'],
            'frenzies_severity_totals': frenzy_card['frenzies_severity_totals'],
        }

    def _overview_previous_stats_payload(prev_stats):
        """Slim prior-window stats for client-side reminder/reset breakdown deltas."""
        if not prev_stats:
            return None
        ai = prev_stats.get('additional_info') or {}
        return {
            'by_time': prev_stats.get('by_time') or {},
            'by_day_of_week': prev_stats.get('by_day_of_week') or {},
            'additional_info': {
                'total_reminders': int(ai.get('total_reminders') or 0),
                'total_resets': int(ai.get('total_resets') or 0),
                'infractions_for_reminders': dict(ai.get('infractions_for_reminders') or {}),
                'infractions_for_resets': dict(ai.get('infractions_for_resets') or {}),
            },
        }

    def build_overview_trends(cur_stats, prev_stats, cur_attendance, prev_attendance, cur_attendance_by_day=None, prev_attendance_by_day=None):
        """Numeric deltas vs an equal-length prior window (e.g. previous 30 school days)."""

        def inf_total(st):
            d = st.get('infractions') or {}
            return sum(int(v or 0) for v in d.values())

        def classify_infraction_bucket(label):
            txt = str(label or '').strip().lower()
            if (
                'aggression' in txt or
                'property' in txt or
                'sexual' in txt or
                'threat' in txt or
                txt == 'walk' or
                'harmful' in txt or
                'disrespect' in txt
            ):
                return 'Safety'
            if (
                'off task' in txt or
                'attention seeking' in txt or
                'shutdown' in txt or
                'refusal' in txt
            ):
                return 'Attention'
            if (
                'nfd' in txt or
                'self control' in txt or
                txt.startswith('task')
            ):
                return 'Task'
            if (
                'lang' in txt or
                'volume' in txt or
                'myob' in txt or
                'personal' in txt
            ):
                return 'Social'
            return 'Social'

        def bucket_infraction_counts(st):
            buckets = {'Social': 0, 'Task': 0, 'Attention': 0, 'Safety': 0}
            infractions_map = (st or {}).get('infractions') or {}
            for inf_type, count in infractions_map.items():
                bucket = classify_infraction_bucket(inf_type)
                buckets[bucket] += int(count or 0)
            return buckets

        cur_ai = cur_stats.get('additional_info') or {}
        prev_ai = prev_stats.get('additional_info') or {}
        cur_pct = cur_stats.get('percentages') or {}
        prev_pct = prev_stats.get('percentages') or {}
        cur_star = (cur_stats.get('percentages') or {}).get('overall')
        prev_star = (prev_stats.get('percentages') or {}).get('overall')
        cur_present = (cur_attendance or {}).get('present_pct')
        prev_present = (prev_attendance or {}).get('present_pct')
        cur_present_cnt = int((cur_attendance or {}).get('present') or 0)
        prev_present_cnt = int((prev_attendance or {}).get('present') or 0)
        cur_excused = int((cur_attendance or {}).get('excused') or 0)
        prev_excused = int((prev_attendance or {}).get('excused') or 0)
        cur_unexcused = int((cur_attendance or {}).get('unexcused') or 0)
        prev_unexcused = int((prev_attendance or {}).get('unexcused') or 0)
        cur_by_day = cur_attendance_by_day or {}
        prev_by_day = prev_attendance_by_day or {}
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

        def day_absence_total(by_day_map, day_label):
            bucket = by_day_map.get(day_label) or {}
            return int(bucket.get('excused') or 0) + int(bucket.get('unexcused') or 0)

        def bucket_pct(bucket, key):
            if not bucket:
                return None
            pcts = bucket.get('raw_percentages') or bucket.get('percentages') or {}
            val = pcts.get(key)
            if val is None:
                return None
            try:
                return float(val)
            except (TypeError, ValueError):
                return None

        def build_star_delta_map(cur_map, prev_map):
            keys = ('overall', 'safety', 'teamwork', 'accountability', 'relationships')
            labels = set((cur_map or {}).keys()) | set((prev_map or {}).keys())
            result = {}
            for label in labels:
                cur_bucket = (cur_map or {}).get(label) or {}
                prev_bucket = (prev_map or {}).get(label) or {}
                per_key = {}
                for key in keys:
                    cur_v = bucket_pct(cur_bucket, key)
                    prev_v = bucket_pct(prev_bucket, key)
                    per_key[key] = None if cur_v is None or prev_v is None else round(cur_v - prev_v, 1)
                result[label] = per_key
            return result

        day_of_week_absence_deltas = {
            day: day_absence_total(cur_by_day, day) - day_absence_total(prev_by_day, day)
            for day in day_order
        }

        by_time_star_deltas = build_star_delta_map(
            cur_stats.get('by_time') or {},
            prev_stats.get('by_time') or {}
        )
        by_day_star_deltas = build_star_delta_map(
            cur_stats.get('by_day_of_week') or {},
            prev_stats.get('by_day_of_week') or {}
        )

        def norm_slot_label(label):
            """Align time/day labels across API vs merged infractions keys (spacing, dash style)."""
            if label is None:
                return ''
            s = str(label).strip().lower()
            s = s.replace('\u2013', '-').replace('\u2014', '-').replace('\u2212', '-')
            s = re.sub(r'\s*-\s*', '-', s)
            s = re.sub(r'\s+', ' ', s)
            return s.strip()

        def enrich_delta_map_norm_aliases(delta_map):
            """Add normalized-key entries so minor label differences still resolve."""
            base = dict(delta_map or {})
            for k, v in list(base.items()):
                nk = norm_slot_label(k)
                if nk and nk not in base:
                    base[nk] = int(v)
            return base

        def infraction_time_display_totals(st):
            """Same aggregation as static/app.js getOverviewTimeSlots (by_time vs merged by_time)."""
            by_time = st.get('by_time') or {}
            slots = {}
            for label, bucket in by_time.items():
                total = int((bucket or {}).get('total_infractions') or 0)
                if total > 0:
                    slots[label] = total
            if not slots:
                merged = {}
                for _t, entry in (st.get('infractions_by_type') or {}).items():
                    for label, cnt in (entry.get('by_time') or {}).items():
                        n = int(cnt or 0)
                        if n <= 0:
                            continue
                        merged[label] = merged.get(label, 0) + n
                for label, total in merged.items():
                    if total > 0:
                        slots[label] = total
            return slots

        def infraction_day_display_totals(st):
            """Same counts as infractions overview day chart (types first, else by_day_of_week totals)."""
            day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            from_types = {d: 0 for d in day_order}
            for _t, entry in (st.get('infractions_by_type') or {}).items():
                for day, cnt in (entry.get('by_day_of_week') or {}).items():
                    n = int(cnt or 0)
                    if n <= 0:
                        continue
                    if day in from_types:
                        from_types[day] += n
            by_day = st.get('by_day_of_week') or {}
            out = {}
            for day in day_order:
                typ_total = int(from_types.get(day) or 0)
                if typ_total > 0:
                    out[day] = typ_total
                    continue
                bkt = by_day.get(day) or {}
                bt = int(bkt.get('total_infractions') or 0)
                if bt > 0:
                    out[day] = bt
            return out

        def build_infraction_display_delta_map(cur_totals, prev_totals):
            labels = set(cur_totals.keys()) | set(prev_totals.keys())
            return {
                lbl: int(cur_totals.get(lbl, 0)) - int(prev_totals.get(lbl, 0))
                for lbl in labels
            }

        cur_time_tot = infraction_time_display_totals(cur_stats)
        prev_time_tot = infraction_time_display_totals(prev_stats)
        infractions_deltas_by_time = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_time_tot, prev_time_tot)
        )

        cur_day_tot = infraction_day_display_totals(cur_stats)
        prev_day_tot = infraction_day_display_totals(prev_stats)
        infractions_deltas_by_day_of_week = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_day_tot, prev_day_tot)
        )

        def rem_res_time_totals(st, count_field):
            out = {}
            for label, bucket in (st.get('by_time') or {}).items():
                total = int((bucket or {}).get(count_field) or 0)
                if total > 0:
                    out[label] = total
            return out

        def rem_res_day_totals(st, count_field):
            out = {}
            for day, bucket in (st.get('by_day_of_week') or {}).items():
                total = int((bucket or {}).get(count_field) or 0)
                if total > 0:
                    out[day] = total
            return out

        def rem_res_assoc_totals(st, assoc_key):
            assoc = (st.get('additional_info') or {}).get(assoc_key) or {}
            return {
                str(k): int(v or 0)
                for k, v in assoc.items()
                if int(v or 0) > 0
            }

        def build_previous_totals_normalized(prev_totals):
            out = {}
            for lbl, tot in (prev_totals or {}).items():
                nk = norm_slot_label(lbl)
                if nk:
                    out[nk] = out.get(nk, 0) + int(tot)
            return out

        cur_rem_time = rem_res_time_totals(cur_stats, 'total_reminders')
        prev_rem_time = rem_res_time_totals(prev_stats, 'total_reminders')
        reminders_deltas_by_time = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_rem_time, prev_rem_time)
        )

        cur_rem_day = rem_res_day_totals(cur_stats, 'total_reminders')
        prev_rem_day = rem_res_day_totals(prev_stats, 'total_reminders')
        reminders_deltas_by_day_of_week = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_rem_day, prev_rem_day)
        )

        cur_rem_assoc = rem_res_assoc_totals(cur_stats, 'infractions_for_reminders')
        prev_rem_assoc = rem_res_assoc_totals(prev_stats, 'infractions_for_reminders')
        reminders_assoc_deltas = build_infraction_display_delta_map(cur_rem_assoc, prev_rem_assoc)

        cur_rst_time = rem_res_time_totals(cur_stats, 'total_resets')
        prev_rst_time = rem_res_time_totals(prev_stats, 'total_resets')
        resets_deltas_by_time = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_rst_time, prev_rst_time)
        )

        cur_rst_day = rem_res_day_totals(cur_stats, 'total_resets')
        prev_rst_day = rem_res_day_totals(prev_stats, 'total_resets')
        resets_deltas_by_day_of_week = enrich_delta_map_norm_aliases(
            build_infraction_display_delta_map(cur_rst_day, prev_rst_day)
        )

        cur_rst_assoc = rem_res_assoc_totals(cur_stats, 'infractions_for_resets')
        prev_rst_assoc = rem_res_assoc_totals(prev_stats, 'infractions_for_resets')
        resets_assoc_deltas = build_infraction_display_delta_map(cur_rst_assoc, prev_rst_assoc)

        infractions_previous_time_totals_normalized = {}
        for lbl, tot in prev_time_tot.items():
            nk = norm_slot_label(lbl)
            if nk:
                infractions_previous_time_totals_normalized[nk] = (
                    infractions_previous_time_totals_normalized.get(nk, 0) + int(tot)
                )

        infractions_previous_day_totals_normalized = {}
        for lbl, tot in prev_day_tot.items():
            nk = norm_slot_label(lbl)
            if nk:
                infractions_previous_day_totals_normalized[nk] = (
                    infractions_previous_day_totals_normalized.get(nk, 0) + int(tot)
                )

        star_safety_delta = None if cur_pct.get('safety') is None or prev_pct.get('safety') is None else round(
            float(cur_pct.get('safety')) - float(prev_pct.get('safety')), 1)
        star_teamwork_delta = None if cur_pct.get('teamwork') is None or prev_pct.get('teamwork') is None else round(
            float(cur_pct.get('teamwork')) - float(prev_pct.get('teamwork')), 1)
        star_accountability_delta = None if cur_pct.get('accountability') is None or prev_pct.get('accountability') is None else round(
            float(cur_pct.get('accountability')) - float(prev_pct.get('accountability')), 1)
        star_relationships_delta = None if cur_pct.get('relationships') is None or prev_pct.get('relationships') is None else round(
            float(cur_pct.get('relationships')) - float(prev_pct.get('relationships')), 1)
        cur_inf_buckets = bucket_infraction_counts(cur_stats)
        prev_inf_buckets = bucket_infraction_counts(prev_stats)
        cur_inf_types = (cur_stats.get('infractions') or {})
        prev_inf_types = (prev_stats.get('infractions') or {})
        all_infraction_types = set(cur_inf_types.keys()) | set(prev_inf_types.keys())
        cur_inf_total = sum(int(v or 0) for v in cur_inf_buckets.values())
        prev_inf_total = sum(int(v or 0) for v in prev_inf_buckets.values())
        infraction_bucket_deltas = {
            bucket: int(cur_inf_buckets.get(bucket) or 0) - int(prev_inf_buckets.get(bucket) or 0)
            for bucket in ('Social', 'Task', 'Attention', 'Safety')
        }
        infraction_type_deltas = {
            str(inf_type): int(cur_inf_types.get(inf_type) or 0) - int(prev_inf_types.get(inf_type) or 0)
            for inf_type in all_infraction_types
        }
        infraction_bucket_pct_current = {}
        infraction_bucket_pct_previous = {}
        infraction_bucket_pct_deltas = {}
        for bucket in ('Social', 'Task', 'Attention', 'Safety'):
            cur_pct_bucket = (float(cur_inf_buckets.get(bucket) or 0) / float(cur_inf_total) * 100.0) if cur_inf_total > 0 else 0.0
            prev_pct_bucket = (float(prev_inf_buckets.get(bucket) or 0) / float(prev_inf_total) * 100.0) if prev_inf_total > 0 else 0.0
            infraction_bucket_pct_current[bucket] = cur_pct_bucket
            infraction_bucket_pct_previous[bucket] = prev_pct_bucket
            # Preserve precision so small but real share changes do not collapse to 0.0.
            infraction_bucket_pct_deltas[bucket] = (cur_pct_bucket - prev_pct_bucket)

        return {
            'infractions_delta': inf_total(cur_stats) - inf_total(prev_stats),
            'infractions_bucket_deltas': infraction_bucket_deltas,
            'infractions_type_deltas': infraction_type_deltas,
            'infractions_bucket_pct_current': infraction_bucket_pct_current,
            'infractions_bucket_pct_previous': infraction_bucket_pct_previous,
            'infractions_bucket_pct_deltas': infraction_bucket_pct_deltas,
            'reminders_delta': int(cur_ai.get('total_reminders') or 0) - int(prev_ai.get('total_reminders') or 0),
            'resets_delta': int(cur_ai.get('total_resets') or 0) - int(prev_ai.get('total_resets') or 0),
            'present_pct_delta': None if cur_present is None or prev_present is None else round(
                float(cur_present) - float(prev_present), 1),
            'present_count_delta': cur_present_cnt - prev_present_cnt,
            'excused_delta': cur_excused - prev_excused,
            'unexcused_delta': cur_unexcused - prev_unexcused,
            'star_overall_delta': None if cur_star is None or prev_star is None else round(
                float(cur_star) - float(prev_star), 1),
            'star_safety_delta': star_safety_delta,
            'star_teamwork_delta': star_teamwork_delta,
            'star_accountability_delta': star_accountability_delta,
            'star_relationships_delta': star_relationships_delta,
            # Backwards-compatible aliases for any existing frontend consumers.
            'safety_delta': star_safety_delta,
            'teamwork_delta': star_teamwork_delta,
            'accountability_delta': star_accountability_delta,
            'relationships_delta': star_relationships_delta,
            'day_of_week_absence_deltas': day_of_week_absence_deltas,
            'star_deltas_by_time': by_time_star_deltas,
            'star_deltas_by_day_of_week': by_day_star_deltas,
            'infractions_deltas_by_time': infractions_deltas_by_time,
            'infractions_deltas_by_day_of_week': infractions_deltas_by_day_of_week,
            'infractions_previous_time_totals_normalized': infractions_previous_time_totals_normalized,
            'infractions_previous_day_totals_normalized': infractions_previous_day_totals_normalized,
            'reminders_deltas_by_time': reminders_deltas_by_time,
            'reminders_deltas_by_day_of_week': reminders_deltas_by_day_of_week,
            'reminders_assoc_deltas': reminders_assoc_deltas,
            'reminders_previous_time_totals_normalized': build_previous_totals_normalized(prev_rem_time),
            'reminders_previous_day_totals_normalized': build_previous_totals_normalized(prev_rem_day),
            'resets_deltas_by_time': resets_deltas_by_time,
            'resets_deltas_by_day_of_week': resets_deltas_by_day_of_week,
            'resets_assoc_deltas': resets_assoc_deltas,
            'resets_previous_time_totals_normalized': build_previous_totals_normalized(prev_rst_time),
            'resets_previous_day_totals_normalized': build_previous_totals_normalized(prev_rst_day),
            'overview_previous_stats': _overview_previous_stats_payload(prev_stats),
            'has_prior': True,
        }

    summary_stats_fn = calculate_summary_stats_lite if lite_mode else calculate_summary_stats

    def build_overview_trends_from_prior_window(cur_stats, cur_attendance, cur_attendance_by_day, cur_attendance_records):
        """Fallback: compare current window to the immediately preceding set of school days.

        Prefer an equal-length window immediately before the oldest day in the current window.
        If history is shorter, use as many immediately preceding days as exist (partial prior).
        """
        cur_dates = sorted({r.date for r in (cur_attendance_records or [])}, reverse=True)
        if not cur_dates:
            return None

        all_dates_desc = sorted({r.date for r in all_records_raw}, reverse=True)
        oldest_cur_date = cur_dates[-1]
        needed_days = len(cur_dates)
        prior_dates = [d for d in all_dates_desc if d < oldest_cur_date][:needed_days]

        prior_date_set = set(prior_dates)
        prev_attendance_records = [r for r in all_records_raw if r.date in prior_date_set]
        if not prior_dates:
            # No calendar days before the oldest day in this window: compare to empty prior baseline.
            prev_stats = summary_stats_fn([])
            prev_attendance = compute_attendance_summary([])
            prev_attendance_by_day = compute_attendance_by_day_of_week([])
            trends = build_overview_trends(
                cur_stats,
                prev_stats,
                cur_attendance,
                prev_attendance,
                cur_attendance_by_day,
                prev_attendance_by_day,
            )
            trends['has_prior'] = False
            return trends

        if not prev_attendance_records:
            return None

        prev_metric_records = [r for r in prev_attendance_records if r.attendance_status != 'excused']
        prev_stats = summary_stats_fn(prev_metric_records)
        prev_attendance = compute_attendance_summary(prev_attendance_records)
        prev_attendance_by_day = compute_attendance_by_day_of_week(prev_attendance_records)
        trends = build_overview_trends(
            cur_stats,
            prev_stats,
            cur_attendance,
            prev_attendance,
            cur_attendance_by_day,
            prev_attendance_by_day
        )
        # Partial prior window: still useful for day-of-week deltas, but not a full symmetric window.
        trends['has_prior'] = bool(len(prior_dates) >= needed_days)
        return trends

    def build_overview_trends_30day_school_windows(
        cur_stats, cur_attendance, cur_attendance_by_day, ud_present, ud_star
    ):
        """Trends vs the *previous* 30 present / 30 STAR school-day windows (same slices as merged stats).

        Never uses calendar-day fallback before the oldest in-window day (that often had no rows and
        looked like 0 prior infractions).
        """
        n_prior_present_days = max(0, len(ud_present) - 30)
        has_full_symmetric_prior = n_prior_present_days >= 30
        if len(ud_present) > 30:
            prev_present_dates = set(ud_present[30:60])
            prev_star_dates = set(ud_star[30:60])
            prev_metric_records = [r for r in all_records if r.date in prev_present_dates]
            prev_rs_star = _records_star_stats_zero_unexcused(all_records, prev_star_dates)
            prev_stats = _merge_30day_behavior_and_star_stats(
                summary_stats_fn(prev_metric_records),
                summary_stats_fn(prev_rs_star),
            )
            prev_attendance_records = [
                r for r in all_records_raw if r.date in prev_present_dates
            ]
            prev_attendance = compute_attendance_summary(prev_attendance_records)
            prev_attendance_by_day = compute_attendance_by_day_of_week(prev_attendance_records)
            trends = build_overview_trends(
                cur_stats,
                prev_stats,
                cur_attendance,
                prev_attendance,
                cur_attendance_by_day,
                prev_attendance_by_day,
            )
            trends['has_prior'] = has_full_symmetric_prior
            return trends, prev_stats

        empty_prev = _merge_30day_behavior_and_star_stats(
            summary_stats_fn([]),
            summary_stats_fn(_records_star_stats_zero_unexcused(all_records, set())),
        )
        trends = build_overview_trends(
            cur_stats,
            empty_prev,
            cur_attendance,
            compute_attendance_summary([]),
            cur_attendance_by_day,
            compute_attendance_by_day_of_week([]),
        )
        trends['has_prior'] = False
        return trends, empty_prev

    def log_infraction_bucket_trend_values(trends_obj):
        if not trends_obj:
            return
        cur = trends_obj.get('infractions_bucket_pct_current') or {}
        prev = trends_obj.get('infractions_bucket_pct_previous') or {}
        delta = trends_obj.get('infractions_bucket_pct_deltas') or {}
        ordered = ('Social', 'Task', 'Attention', 'Safety')
        cur_view = {k: round(float(cur.get(k) or 0.0), 4) for k in ordered}
        prev_view = {k: round(float(prev.get(k) or 0.0), 4) for k in ordered}
        delta_view = {k: round(float(delta.get(k) or 0.0), 4) for k in ordered}
        print(f"[INFRACTION_BUCKET_PCT] current={cur_view} previous={prev_view} delta={delta_view}", flush=True)

    def extract_top_trigger_from_stats(stats_obj):
        sev_map_by_day = (stats_obj or {}).get('frenzy_severity_by_time_by_day') or {}
        weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        all_times = sorted({t for day_map in sev_map_by_day.values() for t in (day_map or {}).keys()})
        if not all_times:
            return {'time': None, 'day': None}

        def best_label(labels, to_cells):
            winner = None
            winner_avg = None
            winner_count = -1
            for label in labels:
                total = 0.0
                count = 0
                for cell in to_cells(label):
                    avg = (cell or {}).get('avg_severity')
                    c = int((cell or {}).get('frenzy_count') or 0)
                    if avg is None or c <= 0:
                        continue
                    try:
                        avg_n = float(avg)
                    except (TypeError, ValueError):
                        continue
                    total += avg_n * c
                    count += c
                if count <= 0:
                    continue
                mean = total / count
                if (
                    winner_avg is None
                    or mean > winner_avg
                    or (mean == winner_avg and count > winner_count)
                    or (mean == winner_avg and count == winner_count and str(label) < str(winner))
                ):
                    winner = label
                    winner_avg = mean
                    winner_count = count
            return winner

        top_time = best_label(
            all_times,
            lambda time_label: [(sev_map_by_day.get(day) or {}).get(time_label) for day in weekdays]
        )
        top_day = best_label(
            weekdays,
            lambda day: [(sev_map_by_day.get(day) or {}).get(time_label) for time_label in all_times]
        )
        return {'time': top_time, 'day': top_day}

    def get_prior_window_prev_stats(cur_attendance_records):
        cur_dates = sorted({r.date for r in (cur_attendance_records or [])}, reverse=True)
        if not cur_dates:
            return None
        all_dates_desc = sorted({r.date for r in all_records_raw}, reverse=True)
        oldest_cur_date = cur_dates[-1]
        needed_days = len(cur_dates)
        prior_dates = [d for d in all_dates_desc if d < oldest_cur_date][:needed_days]
        if not prior_dates:
            return None
        prior_date_set = set(prior_dates)
        prev_attendance_records = [r for r in all_records_raw if r.date in prior_date_set]
        if not prev_attendance_records:
            return None
        prev_metric_records = [r for r in prev_attendance_records if r.attendance_status != 'excused']
        return summary_stats_fn(prev_metric_records)

    # Filter by period if specified (takes precedence over timeframe)
    if period:
        from datetime import date, timedelta
        today = date.today()
        current_school_year = get_school_year_for_date(today)
        
        metric_records = []
        attendance_records = []
        available_data_points = None
        week_start = None
        week_end = None
        
        if period == 'weekly':
            # Most recent complete week (Monday–Sunday)
            days_since_monday = today.weekday()  # Monday is 0
            week_start = today - timedelta(days=days_since_monday)
            week_end = week_start + timedelta(days=6)
            for record in all_records_raw:
                if week_start <= record.date <= week_end:
                    attendance_records.append(record)
                    if record.attendance_status != 'excused':
                        metric_records.append(record)
        elif period == '30day':
            # 30 "school days" for behavior = 30 most recent present days.
            # STAR % uses the 30 most recent non-excused days (present + unexcused); unexcused days count as 0% STAR.
            ud_star = _unique_dates_star_school_days(all_records)
            ud_present = _unique_dates_present_school_days(all_records_raw)
            unique_dates = ud_present
            selected_dates = set(ud_present[:30])
            available_data_points = min(30, len(ud_present))
            for record in all_records_raw:
                if record.date in selected_dates:
                    attendance_records.append(record)
            metric_records = [r for r in all_records if r.date in selected_dates]
        else:
            for record in all_records_raw:
                record_school_year = get_school_year_for_date(record.date)
                matches = False
                
                if period == 'current_year':
                    # Current school year only
                    matches = (record_school_year == current_school_year)
                elif period == 'quarter1':
                    # Quarter 1
                    q_num = get_quarter_for_date(record.date)
                    matches = (q_num == '1' and record_school_year == current_school_year)
                elif period == 'quarter2':
                    # Quarter 2
                    q_num = get_quarter_for_date(record.date)
                    matches = (q_num == '2' and record_school_year == current_school_year)
                elif period == 'quarter3':
                    # Quarter 3
                    q_num = get_quarter_for_date(record.date)
                    matches = (q_num == '3' and record_school_year == current_school_year)
                elif period == 'quarter4':
                    # Quarter 4
                    q_num = get_quarter_for_date(record.date)
                    matches = (q_num == '4' and record_school_year == current_school_year)
                elif period == 'all_time':
                    # All records (no filtering)
                    matches = True
                elif period == 'previous_years':
                    # All school years except current
                    matches = (record_school_year != current_school_year)

                if matches:
                    attendance_records.append(record)
                    if record.attendance_status != 'excused':
                        metric_records.append(record)
        
        # Calculate single summary for period
        if period == '30day':
            star_dates_cur = set(ud_star[:30])
            rs_star = _records_star_stats_zero_unexcused(all_records, star_dates_cur)
            stats_behavior = summary_stats_fn(metric_records)
            stats_star = summary_stats_fn(rs_star)
            stats = _merge_30day_behavior_and_star_stats(stats_behavior, stats_star)
        else:
            stats = summary_stats_fn(metric_records)
        attendance_summary = compute_attendance_summary(attendance_records)
        attendance_by_day = compute_attendance_by_day_of_week(attendance_records)
        result = {
            'timeframe': period,
            'comparison_mode': False,
            'total_days': stats['total_days'],
            'averages': {
                'safety': stats['percentages']['safety'],
                'teamwork': stats['percentages']['teamwork'],
                'accountability': stats['percentages']['accountability'],
                'relationships': stats['percentages']['relationships'],
                'overall': stats['percentages']['overall']
            },
            'totals': stats['totals'],
            'infractions': stats['infractions'],
            'total_frenzies': stats['total_frenzies'],
            'additional_info': stats['additional_info'],
            'by_day_of_week': stats['by_day_of_week'],
            'by_class': stats['by_class'],
            'by_time': stats.get('by_time', {}),
            'by_time_by_day': stats.get('by_time_by_day', {}),
            'frenzy_severity_by_time_by_day': stats.get('frenzy_severity_by_time_by_day', {}),
            'frenzy_cell_details_by_time_by_day': stats.get('frenzy_cell_details_by_time_by_day', {}),
            'infractions_by_type': stats.get('infractions_by_type', {}),
            'starbucks_total': starbucks_total,
            'attendance_summary': attendance_summary,
            'attendance_by_day_of_week': attendance_by_day,
        }
        _attach_frenzy_card_fields(result, stats)
        overview_trends = None
        prev_stats_for_trigger = None
        if period == '30day':
            overview_trends, prev_stats_for_trigger = build_overview_trends_30day_school_windows(
                stats,
                attendance_summary,
                attendance_by_day,
                ud_present,
                ud_star,
            )
        elif period == 'weekly' and week_start and week_end:
            prev_week_start = week_start - timedelta(days=7)
            prev_week_end = week_end - timedelta(days=7)
            prev_metric_records = []
            prev_attendance_records = []
            for record in all_records_raw:
                if prev_week_start <= record.date <= prev_week_end:
                    prev_attendance_records.append(record)
                    if record.attendance_status != 'excused':
                        prev_metric_records.append(record)
            prev_stats = summary_stats_fn(prev_metric_records)
            prev_stats_for_trigger = prev_stats
            prev_attendance = compute_attendance_summary(prev_attendance_records)
            prev_attendance_by_day = compute_attendance_by_day_of_week(prev_attendance_records)
            overview_trends = build_overview_trends(
                stats,
                prev_stats,
                attendance_summary,
                prev_attendance,
                attendance_by_day,
                prev_attendance_by_day
            )
        if not overview_trends and period != '30day':
            overview_trends = build_overview_trends_from_prior_window(
                stats,
                attendance_summary,
                attendance_by_day,
                attendance_records
            )
        if prev_stats_for_trigger is None and period != '30day':
            prev_stats_for_trigger = get_prior_window_prev_stats(attendance_records)
        if overview_trends:
            result['overview_trends'] = overview_trends
            log_infraction_bucket_trend_values(overview_trends)
            prev_payload = overview_trends.get('overview_previous_stats')
            if not prev_payload and prev_stats_for_trigger:
                prev_payload = _overview_previous_stats_payload(prev_stats_for_trigger)
            if prev_payload:
                result['overview_previous_stats'] = prev_payload
        result['previous_trigger'] = extract_top_trigger_from_stats(prev_stats_for_trigger) if prev_stats_for_trigger else {'time': None, 'day': None}
        # Add metadata for weekly and 30-day periods
        if period == 'weekly' and week_start and week_end:
            result['week_start'] = week_start.isoformat()
            result['week_end'] = week_end.isoformat()
        if period == '30day' and available_data_points is not None:
            result['available_data_points'] = available_data_points
            result['has_full_30_days'] = available_data_points >= 30
        if staff_context_name:
            result['staff_context'] = staff_context_name
        result['api_build'] = SUMMARY_API_BUILD
        try:
            plan_sids = list({r.student_id for r in all_records_raw if r.student_id}) if all_records_raw else []
            if not plan_sids and student_id:
                plan_sids = [student_id]
            result['plan_threshold_stats'] = build_plan_threshold_stats(plan_sids)
        except Exception as _plan_err:
            app.logger.warning(f"plan_threshold_stats failed: {_plan_err}")
            result['plan_threshold_stats'] = empty_plan_threshold_stats()
        resp = jsonify(result)
        resp.headers['X-Summary-Api-Build'] = SUMMARY_API_BUILD
        return resp
    
    def _summary_response(resp_dict):
        if staff_context_name:
            resp_dict['staff_context'] = staff_context_name
        try:
            plan_sids = list({r.student_id for r in all_records_raw if r.student_id}) if all_records_raw else []
            if not plan_sids and student_id:
                plan_sids = [student_id]
            resp_dict['plan_threshold_stats'] = build_plan_threshold_stats(plan_sids)
        except Exception as _plan_err:
            app.logger.warning(f"plan_threshold_stats failed: {_plan_err}")
            resp_dict['plan_threshold_stats'] = empty_plan_threshold_stats()
        return jsonify(resp_dict)

    # Filter by timeframe and handle comparison modes
    if timeframe == 'weekly':
        # Get the most recent complete week (Monday-Sunday)
        from datetime import timedelta
        today = date.today()
        days_since_monday = today.weekday()  # Monday is 0
        most_recent_monday = today - timedelta(days=days_since_monday)
        most_recent_sunday = most_recent_monday + timedelta(days=6)
        
        # Filter records that fall within this week
        records = [r for r in all_records if most_recent_monday <= r.date <= most_recent_sunday]
        print(f"After weekly filtering: {len(records)} records from {most_recent_monday} to {most_recent_sunday}")
        # Calculate single summary
        stats = summary_stats_fn(records)
        attendance_records_cur = [
            r for r in all_records_raw if most_recent_monday <= r.date <= most_recent_sunday
        ]
        attendance_summary_cur = compute_attendance_summary(attendance_records_cur)
        attendance_by_day_cur = compute_attendance_by_day_of_week(attendance_records_cur)

        overview_trends = None
        prev_stats_for_trigger = None
        prev_week_start = most_recent_monday - timedelta(days=7)
        prev_week_end = most_recent_sunday - timedelta(days=7)
        prev_metric_records = [r for r in all_records if prev_week_start <= r.date <= prev_week_end]
        prev_attendance_records = [r for r in all_records_raw if prev_week_start <= r.date <= prev_week_end]
        if prev_metric_records or prev_attendance_records:
            prev_stats = summary_stats_fn(prev_metric_records)
            prev_stats_for_trigger = prev_stats
            prev_attendance = compute_attendance_summary(prev_attendance_records)
            prev_attendance_by_day = compute_attendance_by_day_of_week(prev_attendance_records)
            overview_trends = build_overview_trends(
                stats,
                prev_stats,
                attendance_summary_cur,
                prev_attendance,
                attendance_by_day_cur,
                prev_attendance_by_day
            )
        if not overview_trends:
            overview_trends = build_overview_trends_from_prior_window(
                stats,
                attendance_summary_cur,
                attendance_by_day_cur,
                attendance_records_cur
            )
            if prev_stats_for_trigger is None:
                prev_stats_for_trigger = get_prior_window_prev_stats(attendance_records_cur)

        weekly_resp = {
            'timeframe': timeframe,
            'comparison_mode': False,
            'total_days': stats['total_days'],
            'averages': {
                'safety': stats['percentages']['safety'],
                'teamwork': stats['percentages']['teamwork'],
                'accountability': stats['percentages']['accountability'],
                'relationships': stats['percentages']['relationships'],
                'overall': stats['percentages']['overall']
            },
            'totals': stats['totals'],
            'infractions': stats['infractions'],
            'total_frenzies': stats['total_frenzies'],
            'additional_info': stats['additional_info'],
            'by_day_of_week': stats['by_day_of_week'],
            'by_class': stats.get('by_class', {}),
            'by_time': stats.get('by_time', {}),
            'by_time_by_day': stats.get('by_time_by_day', {}),
            'frenzy_severity_by_time_by_day': stats.get('frenzy_severity_by_time_by_day', {}),
            'frenzy_cell_details_by_time_by_day': stats.get('frenzy_cell_details_by_time_by_day', {}),
            'infractions_by_type': stats.get('infractions_by_type', {}),
            'week_start': most_recent_monday.isoformat(),
            'week_end': most_recent_sunday.isoformat(),
            'starbucks_total': starbucks_total,
            'attendance_summary': attendance_summary_cur,
            'attendance_by_day_of_week': attendance_by_day_cur,
        }
        _attach_frenzy_card_fields(weekly_resp, stats)
        if overview_trends:
            weekly_resp['overview_trends'] = overview_trends
            log_infraction_bucket_trend_values(overview_trends)
            prev_payload = overview_trends.get('overview_previous_stats')
            if not prev_payload and prev_stats_for_trigger:
                prev_payload = _overview_previous_stats_payload(prev_stats_for_trigger)
            if prev_payload:
                weekly_resp['overview_previous_stats'] = prev_payload
        weekly_resp['previous_trigger'] = extract_top_trigger_from_stats(prev_stats_for_trigger) if prev_stats_for_trigger else {'time': None, 'day': None}
        return _summary_response(weekly_resp)
    elif timeframe == '30day':
        # Timeframe "30 School Days" (top-left): behavior metrics use the 30 most recent *present* days.
        # STAR % uses the 30 most recent non-excused days (present + unexcused); unexcused days = 0% STAR.
        ud_star = _unique_dates_star_school_days(all_records)
        ud_present = _unique_dates_present_school_days(all_records_raw)
        total_available_data_points = len(ud_present)
        selected_present_dates = set(ud_present[:30])
        selected_star_dates = set(ud_star[:30])
        available_data_points = min(30, len(ud_present))

        records_behavior = [r for r in all_records if r.date in selected_present_dates]
        rs_star = _records_star_stats_zero_unexcused(all_records, selected_star_dates)
        stats_behavior = summary_stats_fn(records_behavior)
        stats_star = summary_stats_fn(rs_star)
        stats = _merge_30day_behavior_and_star_stats(stats_behavior, stats_star)
        print(
            f"After 30 school days: present_dates={len(selected_present_dates)}, "
            f"star_dates={len(selected_star_dates)}, metric_records={len(records_behavior)}"
        )

        attendance_records_cur = [
            r for r in all_records_raw if r.date in selected_present_dates
        ]
        attendance_summary_cur = compute_attendance_summary(attendance_records_cur)
        attendance_by_day_cur = compute_attendance_by_day_of_week(attendance_records_cur)

        overview_trends, prev_stats_for_trigger = build_overview_trends_30day_school_windows(
            stats,
            attendance_summary_cur,
            attendance_by_day_cur,
            ud_present,
            ud_star,
        )

        tf30_resp = {
            'timeframe': timeframe,
            'comparison_mode': False,
            'total_days': stats['total_days'],
            'averages': {
                'safety': stats['percentages']['safety'],
                'teamwork': stats['percentages']['teamwork'],
                'accountability': stats['percentages']['accountability'],
                'relationships': stats['percentages']['relationships'],
                'overall': stats['percentages']['overall']
            },
            'totals': stats['totals'],
            'infractions': stats['infractions'],
            'total_frenzies': stats['total_frenzies'],
            'additional_info': stats['additional_info'],
            'by_day_of_week': stats['by_day_of_week'],
            'by_class': stats.get('by_class', {}),
            'by_time': stats.get('by_time', {}),
            'by_time_by_day': stats.get('by_time_by_day', {}),
            'frenzy_severity_by_time_by_day': stats.get('frenzy_severity_by_time_by_day', {}),
            'frenzy_cell_details_by_time_by_day': stats.get('frenzy_cell_details_by_time_by_day', {}),
            'infractions_by_type': stats.get('infractions_by_type', {}),
            'available_data_points': available_data_points,
            'has_full_30_days': available_data_points >= 30,
            'starbucks_total': starbucks_total,
            'attendance_summary': attendance_summary_cur,
            'attendance_by_day_of_week': attendance_by_day_cur,
        }
        _attach_frenzy_card_fields(tf30_resp, stats)
        if overview_trends:
            tf30_resp['overview_trends'] = overview_trends
            log_infraction_bucket_trend_values(overview_trends)
            prev_payload = overview_trends.get('overview_previous_stats')
            if not prev_payload and prev_stats_for_trigger:
                prev_payload = _overview_previous_stats_payload(prev_stats_for_trigger)
            if prev_payload:
                tf30_resp['overview_previous_stats'] = prev_payload
        tf30_resp['previous_trigger'] = extract_top_trigger_from_stats(prev_stats_for_trigger) if prev_stats_for_trigger else {'time': None, 'day': None}
        return _summary_response(tf30_resp)
    elif timeframe == '30day_to_30day':
        ud_star = _unique_dates_star_school_days(all_records)
        ud_present = _unique_dates_present_school_days(all_records_raw)
        total_available_dates = len(ud_present)

        most_recent_dates_p = set(ud_present[:30])
        previous_dates_p = set(ud_present[30:60]) if len(ud_present) > 30 else set()
        most_recent_star_dates = set(ud_star[:30])
        previous_star_dates = set(ud_star[30:60]) if len(ud_star) > 30 else set()

        most_recent_data_points = min(30, len(ud_present[:30]))
        previous_data_points = min(30, len(ud_present[30:60])) if len(ud_present) > 30 else 0

        most_recent_records = [r for r in all_records if r.date in most_recent_dates_p]
        previous_records = [r for r in all_records if r.date in previous_dates_p]

        most_recent_stats = _merge_30day_behavior_and_star_stats(
            summary_stats_fn(most_recent_records),
            summary_stats_fn(_records_star_stats_zero_unexcused(all_records, most_recent_star_dates)),
        )
        previous_stats = _merge_30day_behavior_and_star_stats(
            summary_stats_fn(previous_records),
            summary_stats_fn(_records_star_stats_zero_unexcused(all_records, previous_star_dates)),
        )

        most_recent_stats['available_data_points'] = most_recent_data_points
        most_recent_stats['has_full_30_days'] = most_recent_data_points >= 30
        previous_stats['available_data_points'] = previous_data_points
        previous_stats['has_full_30_days'] = previous_data_points >= 30

        comparison_data = {
            'Most Recent 30 Days': most_recent_stats,
            'Previous 30 Days': previous_stats
        }

        return _summary_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'month':
        # Group by month-year for comparison, filtered by school year
        from collections import defaultdict
        from datetime import date
        school_year_param = request.args.get('school_year', None)
        
        # If no school year specified, default to current school year
        if not school_year_param:
            today = date.today()
            school_year_param = get_school_year_for_date(today)
        
        # Filter records by school year
        filtered_records = []
        for record in all_records:
            record_school_year = get_school_year_for_date(record.date)
            if record_school_year == school_year_param:
                filtered_records.append(record)
        
        # Group by month
        month_groups = defaultdict(list)
        for record in filtered_records:
            month_key = format_month_name(record.date.year, record.date.month)
            month_groups[month_key].append(record)
        
        # Sort months chronologically (by date, not alphabetically)
        sorted_months = sorted(month_groups.keys(), key=lambda x: (
            # Extract year and month from "MonthName YY" format
            int('20' + x.split()[-1]),  # Convert YY to YYYY
            ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December'].index(x.split()[0])
        ))
        
        comparison_data = {}
        for month_key in sorted_months:
            month_stats = summary_stats_fn(month_groups[month_key])
            comparison_data[month_key] = month_stats
        
        # Get available school years for dropdown
        available_school_years = get_available_school_years(all_records)
        
        return _summary_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data,
            'available_school_years': available_school_years,
            'selected_school_year': school_year_param
        })
    elif timeframe == 'quarter':
        # Group by quarter for comparison
        from collections import defaultdict
        quarter_groups = defaultdict(list)
        for record in all_records:
            q_num = get_quarter_for_date(record.date)
            if q_num:
                # Include year to handle multiple years
                year = record.date.year
                # Adjust year for quarters that span years (Q2: Nov-Jan)
                q_info = quarter_ranges.get(q_num, {})
                q_start = q_info.get('start', '08-01')
                start_month = int(q_start.split('-')[0])
                if record.date.month < start_month and q_num == '2':
                    # This is likely the end of Q2 from previous year
                    year = record.date.year - 1
                quarter_key = f"Q{q_num} {year}"
                quarter_groups[quarter_key].append(record)
        
        # Sort quarters chronologically
        sorted_quarters = sorted(quarter_groups.keys(), key=lambda x: (int(x.split()[1]), int(x[1])))
        comparison_data = {}
        for quarter_key in sorted_quarters:
            quarter_stats = summary_stats_fn(quarter_groups[quarter_key])
            comparison_data[quarter_key] = quarter_stats
        
        return _summary_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'year':
        # Group by school year for comparison
        from collections import defaultdict
        year_groups = defaultdict(list)
        for record in all_records:
            # Determine which school year this record belongs to
            # School year typically starts in August
            if record.date.month >= 8:  # August or later
                school_year = f"{record.date.year}-{record.date.year + 1}"
            else:  # January through July
                school_year = f"{record.date.year - 1}-{record.date.year}"
            
            # Only include if date is within configured school year range
            if date_in_range(record.date, school_year_start, school_year_end):
                year_groups[school_year].append(record)
        
        # Sort years chronologically
        sorted_years = sorted(year_groups.keys())
        comparison_data = {}
        for year_key in sorted_years:
            year_stats = summary_stats_fn(year_groups[year_key])
            comparison_data[year_key] = year_stats
        
        return _summary_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'custom_range':
        # Custom explicit date range (from X date to Y date)
        start_str = request.args.get('start_date')
        end_str = request.args.get('end_date')
        from datetime import datetime
        try:
            start = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
            end = datetime.strptime(end_str, '%Y-%m-%d').date() if end_str else None
        except Exception:
            return _summary_response({
                'timeframe': timeframe,
                'comparison_mode': True,
                'periods': {}
            })
        if not start or not end or start > end:
            return _summary_response({
                'timeframe': timeframe,
                'comparison_mode': True,
                'periods': {}
            })

        records = [r for r in all_records if start <= r.date <= end]
        stats = summary_stats_fn(records)
        label = f"{start.isoformat()} to {end.isoformat()}"
        comparison_data = {label: stats}

        return _summary_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    else:
        # "alltime" or "all" - use all records, single summary
        records = all_records
        stats = summary_stats_fn(records)
        attendance_records_all = list(all_records_raw)
        attendance_summary_all = compute_attendance_summary(attendance_records_all)
        attendance_by_day_all = compute_attendance_by_day_of_week(attendance_records_all)
        overview_trends_all = build_overview_trends_from_prior_window(
            stats,
            attendance_summary_all,
            attendance_by_day_all,
            attendance_records_all
        )
        resp_alltime = {
            'timeframe': timeframe,
            'comparison_mode': False,
            'total_days': stats['total_days'],
            'averages': {
                'safety': stats['percentages']['safety'],
                'teamwork': stats['percentages']['teamwork'],
                'accountability': stats['percentages']['accountability'],
                'relationships': stats['percentages']['relationships'],
                'overall': stats['percentages']['overall']
            },
            'totals': stats['totals'],
            'infractions': stats['infractions'],
            'total_frenzies': stats['total_frenzies'],
            'additional_info': stats['additional_info'],
            'by_day_of_week': stats['by_day_of_week'],
            'by_class': stats.get('by_class', {}),
            'by_time': stats.get('by_time', {}),
            'by_time_by_day': stats.get('by_time_by_day', {}),
            'frenzy_severity_by_time_by_day': stats.get('frenzy_severity_by_time_by_day', {}),
            'frenzy_cell_details_by_time_by_day': stats.get('frenzy_cell_details_by_time_by_day', {}),
            'infractions_by_type': stats.get('infractions_by_type', {}),
            'starbucks_total': starbucks_total,
            'attendance_summary': attendance_summary_all,
            'attendance_by_day_of_week': attendance_by_day_all,
        }
        _attach_frenzy_card_fields(resp_alltime, stats)
        prev_stats_alltime = get_prior_window_prev_stats(attendance_records_all)
        if overview_trends_all:
            resp_alltime['overview_trends'] = overview_trends_all
            log_infraction_bucket_trend_values(overview_trends_all)
            prev_payload = overview_trends_all.get('overview_previous_stats')
            if not prev_payload and prev_stats_alltime:
                prev_payload = _overview_previous_stats_payload(prev_stats_alltime)
            if prev_payload:
                resp_alltime['overview_previous_stats'] = prev_payload
        resp_alltime['previous_trigger'] = extract_top_trigger_from_stats(prev_stats_alltime) if prev_stats_alltime else {'time': None, 'day': None}
        return _summary_response(resp_alltime)


@app.route('/api/case-manager-comparison', methods=['GET'])
@login_required
def case_manager_comparison():
    """Compare STAR and infraction data across all case managers"""
    # Only staff and admin can access this endpoint
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    timeframe = request.args.get('timeframe')
    if not timeframe:
        return jsonify({'error': 'timeframe parameter is required'}), 400
    
    # Get quarter and school year dates from request
    quarter_dates_json = request.args.get('quarter_dates', '{}')
    school_year_dates_json = request.args.get('school_year_dates', '{}')
    
    try:
        quarter_dates = json.loads(quarter_dates_json) if quarter_dates_json else {}
        school_year_dates = json.loads(school_year_dates_json) if school_year_dates_json else {}
    except:
        quarter_dates = {}
        school_year_dates = {}
    
    # Default quarter date ranges if not provided
    quarter_ranges = {}
    for q_num in ['1', '2', '3', '4']:
        if q_num in quarter_dates and isinstance(quarter_dates[q_num], dict):
            quarter_ranges[q_num] = {
                'start': quarter_dates[q_num].get('start', '08-01'),
                'end': quarter_dates[q_num].get('end', '10-31')
            }
        else:
            defaults = {
                '1': {'start': '08-01', 'end': '10-31'},
                '2': {'start': '11-01', 'end': '01-31'},
                '3': {'start': '02-01', 'end': '04-30'},
                '4': {'start': '05-01', 'end': '07-31'}
            }
            quarter_ranges[q_num] = defaults[q_num]
    
    # Helper functions from summary endpoint
    def date_in_range(record_date, start_md, end_md):
        start_month, start_day = map(int, start_md.split('-'))
        end_month, end_day = map(int, end_md.split('-'))
        month = record_date.month
        day = record_date.day
        
        if start_month <= end_month:
            if month == start_month and day >= start_day:
                return True
            elif month > start_month and month < end_month:
                return True
            elif month == end_month and day <= end_day:
                return True
        else:
            if month == start_month and day >= start_day:
                return True
            elif month > start_month:
                return True
            elif month <= end_month:
                if month < end_month or (month == end_month and day <= end_day):
                    return True
        return False
    
    def get_quarter_for_date(record_date):
        for q_num in ['1', '2', '3', '4']:
            q_info = quarter_ranges.get(q_num, {})
            q_start = q_info.get('start', '08-01')
            q_end = q_info.get('end', '10-31')
            if date_in_range(record_date, q_start, q_end):
                return q_num
        return None
    
    def get_school_year_for_date(record_date):
        year = record_date.year
        month = record_date.month
        if month >= 8:
            return f"{year}-{year + 1}"
        else:
            return f"{year - 1}-{year}"
    
    # Get all case managers and their students
    case_manager_teams = TeamMember.query.filter_by(role='Case Manager').all()
    
    # Group students by case manager name
    case_manager_students = {}
    for team_member in case_manager_teams:
        cm_name = team_member.name
        if cm_name not in case_manager_students:
            case_manager_students[cm_name] = []
        if team_member.student_id:
            case_manager_students[cm_name].append(team_member.student_id)
    
    # Filter records by timeframe (raw includes excused for present-day detection)
    cm_records_raw = DailyRecord.query.all()

    # Filter out excused records
    filtered_records = []
    for record in cm_records_raw:
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'
            db.session.commit()
        if record.attendance_status != 'excused':
            filtered_records.append(record)

    # 30 school days: behavior/infractions = last 30 present days; STAR = last 30 non-excused
    # (unexcused in STAR window contributes 0 points), same as /api/summary.
    cm30_selected_present = cm30_selected_star = None
    if timeframe == '30day':
        ud_present_cm = _unique_dates_present_school_days(cm_records_raw)
        ud_star_cm = _unique_dates_star_school_days(filtered_records)
        cm30_selected_present = set(ud_present_cm[:30])
        cm30_selected_star = set(ud_star_cm[:30])
        cm30_date_union = cm30_selected_present | cm30_selected_star

    # Apply timeframe filtering
    today = date.today()
    current_school_year = get_school_year_for_date(today)
    timeframe_filtered_records = []

    if timeframe == 'weekly':
        from datetime import timedelta
        days_since_monday = today.weekday()
        most_recent_monday = today - timedelta(days=days_since_monday)
        most_recent_sunday = most_recent_monday + timedelta(days=6)
        timeframe_filtered_records = [r for r in filtered_records if most_recent_monday <= r.date <= most_recent_sunday]
    elif timeframe == '30day':
        timeframe_filtered_records = [r for r in filtered_records if r.date in cm30_date_union]
    elif timeframe == 'current_year':
        timeframe_filtered_records = [r for r in filtered_records if get_school_year_for_date(r.date) == current_school_year]
    elif timeframe == 'quarter1':
        timeframe_filtered_records = [r for r in filtered_records if get_quarter_for_date(r.date) == '1' and get_school_year_for_date(r.date) == current_school_year]
    elif timeframe == 'quarter2':
        timeframe_filtered_records = [r for r in filtered_records if get_quarter_for_date(r.date) == '2' and get_school_year_for_date(r.date) == current_school_year]
    elif timeframe == 'quarter3':
        timeframe_filtered_records = [r for r in filtered_records if get_quarter_for_date(r.date) == '3' and get_school_year_for_date(r.date) == current_school_year]
    elif timeframe == 'quarter4':
        timeframe_filtered_records = [r for r in filtered_records if get_quarter_for_date(r.date) == '4' and get_school_year_for_date(r.date) == current_school_year]
    elif timeframe == 'all_time':
        timeframe_filtered_records = filtered_records
    elif timeframe == 'previous_years':
        timeframe_filtered_records = [r for r in filtered_records if get_school_year_for_date(r.date) != current_school_year]
    else:
        timeframe_filtered_records = filtered_records
    
    # Aggregate data by case manager
    case_manager_data = {}
    
    for cm_name, student_ids in case_manager_students.items():
        if not student_ids:
            continue
        
        # Filter records for this case manager's students
        cm_records = [r for r in timeframe_filtered_records if r.student_id in student_ids]
        
        if not cm_records:
            # Skip case managers with no data in this timeframe
            continue
        
        # Initialize aggregation
        total_safety = 0
        total_teamwork = 0
        total_accountability = 0
        total_relationships = 0
        total_possible = 0
        infractions = {}
        unique_students = set()
        unique_dates = set()
        
        # Aggregate STAR data and infractions
        use_30_school_day_rules = cm30_selected_present is not None
        for record in cm_records:
            st = _record_attendance_status_norm(record)
            unique_students.add(record.student_id)
            if use_30_school_day_rules:
                if record.date in cm30_selected_present and st == 'present':
                    unique_dates.add(record.date)
            else:
                unique_dates.add(record.date)

            count_star_points = (not use_30_school_day_rules) or (
                record.date in cm30_selected_star and st == 'present'
            )
            count_infractions_here = (not use_30_school_day_rules) or (
                record.date in cm30_selected_present and st == 'present'
            )

            for period in record.periods:
                if count_star_points:
                    total_safety += _star_point_sum_value(period.safety_points)
                    total_teamwork += _star_point_sum_value(period.teamwork_points)
                    total_accountability += _star_point_sum_value(period.accountability_points)
                    total_relationships += _star_point_sum_value(period.relationships_points)
                    total_possible += (period.points_possible or 0)

                if not count_infractions_here:
                    continue

                # Count infractions from period.infractions relationship
                for infraction in period.infractions:
                    if infraction.infraction_type not in infractions:
                        infractions[infraction.infraction_type] = 0
                    infractions[infraction.infraction_type] += infraction.count

                # Extract infractions from Info column JSON data
                if period.info:
                    try:
                        info_data = json.loads(period.info)
                        for inf_key in ['infraction1', 'infraction2']:
                            infraction_type = info_data.get(inf_key)
                            if infraction_type and str(infraction_type).strip():
                                infraction_type = str(infraction_type).strip()
                                count = 1
                                try:
                                    count_key = f'{inf_key}Count'
                                    count = int(info_data.get(count_key, 1))
                                except (ValueError, TypeError):
                                    count = 1
                                if infraction_type not in infractions:
                                    infractions[infraction_type] = 0
                                infractions[infraction_type] += count
                        # Extract infractions array (Info column dynamic infractions)
                        for inf_item in info_data.get('infractions') or []:
                            if not isinstance(inf_item, dict):
                                continue
                            infraction_type = (inf_item.get('type') or '').strip()
                            if not infraction_type:
                                continue
                            try:
                                count = int(inf_item.get('count', 1))
                            except (ValueError, TypeError):
                                count = 1
                            if infraction_type not in infractions:
                                infractions[infraction_type] = 0
                            infractions[infraction_type] += count
                    except (json.JSONDecodeError, ValueError, TypeError):
                        pass
        
        # Calculate percentages
        num_periods = total_possible / 4 if total_possible > 0 else 0
        max_per_category = num_periods * 2 if num_periods > 0 else 0
        
        safety_percent = round((total_safety / max_per_category * 100) if max_per_category > 0 else 0, 1)
        teamwork_percent = round((total_teamwork / max_per_category * 100) if max_per_category > 0 else 0, 1)
        accountability_percent = round((total_accountability / max_per_category * 100) if max_per_category > 0 else 0, 1)
        relationships_percent = round((total_relationships / max_per_category * 100) if max_per_category > 0 else 0, 1)
        overall_percent = round((safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4 if max_per_category > 0 else 0, 1)
        
        case_manager_data[cm_name] = {
            'student_count': len(unique_students),
            'total_days': len(unique_dates),
            'star_percentages': {
                'safety': safety_percent,
                'teamwork': teamwork_percent,
                'accountability': accountability_percent,
                'relationships': relationships_percent,
                'overall': overall_percent
            },
            'infractions': infractions
        }
    
    sorted_managers = sorted(case_manager_data.keys())
    return jsonify({
        'case_managers': case_manager_data,
        'sorted_managers': sorted_managers
    })


@staff_required
def import_csv():
    """Import data from CSV files"""
    try:
        file = request.files.get('file')
        file_type = request.form.get('type')  # 'point_card', 'summary', 'frenzy'
        
        if not file:
            return jsonify({'error': 'No file provided'}), 400
        
        content = file.read().decode('utf-8')
        csv_reader = csv.reader(StringIO(content))
        rows = list(csv_reader)
        
        if file_type == 'point_card':
            return import_point_card_csv(rows)
        elif file_type == 'frenzy':
            return import_frenzy_csv(rows)
        else:
            return jsonify({'error': 'Invalid file type'}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def import_point_card_csv(rows):
    """Import point card CSV data"""
    # Find the header row (contains "Wednesday" or date)
    header_row = None
    for i, row in enumerate(rows):
        if len(row) > 0 and ('Wednesday' in row[0] or '/' in str(row[0])):
            header_row = i
            break
    
    if header_row is None:
        return jsonify({'error': 'Could not find header row'}), 400
    
    # Parse the CSV structure
    # This is a simplified parser - you may need to adjust based on your exact CSV format
    imported_count = 0
    
    # Look for date rows and period data
    for i in range(header_row + 1, len(rows)):
        row = rows[i]
        if len(row) < 3:
            continue
        
        # Try to find date rows
        date_str = row[0] if row[0] else None
        if date_str and '/' in date_str:
            try:
                # Parse date (format: M/D/YY or M/D/YYYY)
                date_parts = date_str.split('/')
                if len(date_parts) == 3:
                    month, day, year = date_parts
                    year = int(year)
                    if year < 100:
                        year += 2000
                    record_date = date(year, int(month), int(day))
                    
                    # For now, create a default student or use first available
                    student = Student.query.first()
                    if not student:
                        student = Student(name='Imported Student')
                        db.session.add(student)
                        db.session.commit()
                    
                    # Check if record exists
                    existing = DailyRecord.query.filter_by(
                        student_id=student.id,
                        date=record_date
                    ).first()
                    
                    if not existing:
                        daily_record = DailyRecord(
                            student_id=student.id,
                            date=record_date,
                            day_of_week=record_date.strftime('%A'),
                            present=True
                        )
                        db.session.add(daily_record)
                        imported_count += 1
            except:
                continue
    
    db.session.commit()
    return jsonify({'message': f'Imported {imported_count} daily records'}), 200

def import_frenzy_csv(rows):
    """Import frenzy CSV data"""
    # Parse frenzy data from CSV
    # This would need to be customized based on your exact CSV structure
    return jsonify({'message': 'Frenzy import functionality - customize based on your CSV structure'}), 200


def _parse_flexible_date(raw_date: str):
    if not raw_date:
        return None
    cleaned = re.sub(r'[,.\u00A0]+', ' ', str(raw_date)).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)

    numeric_formats = [
        '%m/%d/%Y', '%m/%d/%y',
        '%m-%d-%Y', '%m-%d-%y',
        '%Y-%m-%d'
    ]
    for fmt in numeric_formats:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue

    month_formats = []
    for month_name in _calendar.month_name[1:]:
        month_formats.extend([
            f'{month_name} %d %Y',
            f'{month_name} %d %y',
        ])
    for month_abbr in _calendar.month_abbr[1:]:
        month_formats.extend([
            f'{month_abbr} %d %Y',
            f'{month_abbr} %d %y',
        ])

    for fmt in month_formats:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _extract_date_after_keyword(text: str, keyword_pattern: str):
    if not text:
        return None
    match = re.search(keyword_pattern, text, flags=re.IGNORECASE)
    if not match:
        return None

    start_idx = max(0, match.start() - 40)
    end_idx = min(len(text), match.end() + 180)
    window = text[start_idx:end_idx]

    candidates = re.findall(
        r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*|\s+)\d{2,4})',
        window
    )
    for candidate in candidates:
        parsed = _parse_flexible_date(candidate)
        if parsed:
            return parsed
    return None


def _coerce_year(two_or_four_digit_year: int):
    if two_or_four_digit_year >= 100:
        return two_or_four_digit_year
    return 2000 + two_or_four_digit_year


def _normalize_calendar_text(text: str) -> str:
    """Normalize quote/dash variants so month headers like AUGUST '26 match reliably."""
    if not text:
        return ''
    replacements = {
        '\u2018': "'",
        '\u2019': "'",
        '\u201b': "'",
        '\u2032': "'",
        '\ufffd': "'",
        '\u00b4': "'",
        '`': "'",
        '\u2013': '-',
        '\u2014': '-',
        '\u00a0': ' ',
        '\u202f': ' ',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return text


def _extract_school_year_span(text: str):
    """Return (start_year, end_year) from headers such as '2026-2027 School Year'."""
    if not text:
        return None, None
    match = re.search(r'\b(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})\b', text)
    if match:
        start = int(match.group(1))
        end_raw = int(match.group(2))
        end = end_raw if end_raw >= 100 else _coerce_year(end_raw)
        if end == start:
            end = start + 1
        if end == start + 1:
            return start, end
    match = re.search(
        r'\b(?:SY|school\s*year)\s*(\d{2,4})\s*[-/]\s*(\d{2,4})\b',
        text,
        flags=re.IGNORECASE
    )
    if match:
        start = _coerce_year(int(match.group(1)))
        end = _coerce_year(int(match.group(2)))
        if end == start:
            end = start + 1
        if end == start + 1:
            return start, end
    return None, None


def _year_for_school_month(month: int, start_year: int, end_year: int) -> int:
    # Typical US school year: Aug-Dec belong to the start year, Jan-Jul to the end year.
    return start_year if month >= 8 else end_year


def _month_lookup():
    return {name.upper(): idx for idx, name in enumerate(_calendar.month_name) if name}


def _parse_month_header_year(quoted_year, four_digit_year):
    year_token = quoted_year or four_digit_year
    if not year_token:
        return None
    return _coerce_year(int(year_token))


def _is_plausible_calendar_year(year, start_year=None, end_year=None):
    if year is None:
        return False
    if start_year is not None and end_year is not None:
        return (start_year - 1) <= year <= (end_year + 1)
    return 2000 <= year <= 2100


def _extract_month_markers(text: str):
    markers = []
    month_lookup = _month_lookup()
    month_alt = '|'.join(month_lookup.keys())
    # Month headers at line start. Years must stay on that same line:
    # AUGUST '26 or AUGUST 2026 — never the event day from the following line.
    pattern = re.compile(
        rf'(?im)^\s*({month_alt})\b(?:[^\S\r\n]*\'(\d{{2,4}})|[^\S\r\n]+(20\d{{2}}))?'
    )
    for match in pattern.finditer(text or ''):
        month_name = match.group(1).upper()
        year = _parse_month_header_year(match.group(2), match.group(3))
        markers.append({
            'pos': match.start(),
            'month': month_lookup[month_name],
            'year': year
        })
    return sorted(markers, key=lambda m: m['pos'])


def _backfill_month_marker_years(markers, start_year=None, end_year=None):
    """Fill years on bare month headers using nearby 'MONTH YY' labels or the school-year span."""
    if not markers:
        return markers

    for marker in markers:
        if marker.get('year') is not None and not _is_plausible_calendar_year(
            marker['year'], start_year, end_year
        ):
            marker['year'] = None

    years_present = sorted({m['year'] for m in markers if m.get('year')})
    if start_year is None or end_year is None:
        if len(years_present) >= 2:
            start_year = start_year or years_present[0]
            end_year = end_year or years_present[-1]
        elif len(years_present) == 1:
            only = years_present[0]
            months_with_year = {m['month'] for m in markers if m.get('year') == only}
            if any(month >= 8 for month in months_with_year):
                start_year = start_year or only
                end_year = end_year or (only + 1)
            else:
                end_year = end_year or only
                start_year = start_year or (only - 1)

    for marker in markers:
        if marker.get('year') is not None:
            continue
        closest = None
        closest_dist = None
        for other in markers:
            if other['month'] != marker['month'] or other.get('year') is None:
                continue
            dist = abs(other['pos'] - marker['pos'])
            if closest_dist is None or dist < closest_dist:
                closest = other
                closest_dist = dist
        if closest:
            marker['year'] = closest['year']
        elif start_year is not None and end_year is not None:
            marker['year'] = _year_for_school_month(marker['month'], start_year, end_year)
    return markers


def _closest_month_marker(markers, char_pos: int):
    if not markers:
        return None
    prior = [m for m in markers if m['pos'] <= char_pos]
    if prior:
        # Prefer nearest prior marker that includes a year, because calendars often
        # repeat bare month headers (e.g., "MAY") after "MAY '26".
        for marker in reversed(prior):
            if marker.get('year') is not None:
                return marker
        return prior[-1]
    return markers[0]


def _event_day_near_keyword(text: str, match: re.Match):
    """Prefer the leading day on the keyword line (e.g. '31 First Day of School')."""
    line_start = text.rfind('\n', 0, match.start()) + 1
    line_end = text.find('\n', match.end())
    if line_end == -1:
        line_end = len(text)
    line = text[line_start:line_end]

    leading = re.match(r'^\s*(\d{1,2})(?:\s*[-/]\s*\d{1,2})?\b', line)
    if leading:
        day = int(leading.group(1))
        if 1 <= day <= 31:
            return day

    prev_lines = [ln.strip() for ln in text[:line_start].splitlines() if ln.strip()]
    if prev_lines and re.fullmatch(r'\d{1,2}', prev_lines[-1]):
        day = int(prev_lines[-1])
        if 1 <= day <= 31:
            return day

    left = text[max(0, match.start() - 20):match.start()]
    nums = re.findall(r'\b(\d{1,2})\b', left)
    if nums:
        day = int(nums[-1])
        if 1 <= day <= 31:
            return day
    return None


def _extract_day_for_keyword_with_month_context(text: str, keyword_pattern: str, markers):
    match = re.search(keyword_pattern, text, flags=re.IGNORECASE)
    if not match:
        return None

    day = _event_day_near_keyword(text, match)
    if day is None:
        return None

    marker = _closest_month_marker(markers, match.start())
    if not marker or not marker.get('year'):
        return None

    try:
        return date(marker['year'], marker['month'], day)
    except ValueError:
        return None


def _extract_date_from_patterns(text: str, patterns, markers):
    # Prefer "31 First Day of School" under a month header before hunting for
    # full dates, which can falsely match later stamps such as "Adopted: 01/26/2026".
    for pattern in patterns:
        parsed = _extract_day_for_keyword_with_month_context(text, pattern, markers)
        if parsed:
            return parsed
    for pattern in patterns:
        parsed = _extract_date_after_keyword(text, pattern)
        if parsed:
            return parsed
    return None


def _extract_date_from_line_fallback(text: str, keyword_tokens, start_year=None, end_year=None):
    """
    OCR/layout fallback:
    - Walk line-by-line
    - Keep nearest month/year context
    - When a line looks like target keyword, try to resolve day from same or nearby lines
    """
    month_lookup = _month_lookup()
    month_alt = '|'.join(month_lookup.keys())
    lines = [ln.strip() for ln in (text or '').splitlines() if ln and ln.strip()]
    if not lines:
        return None

    current_month = None
    current_year = None

    def _line_matches_tokens(line: str):
        normalized = re.sub(r'[^a-z0-9 ]+', ' ', line.lower())
        normalized = re.sub(r'\s+', ' ', normalized).strip()
        return all(re.search(rf'\b{re.escape(tok)}\b', normalized) for tok in keyword_tokens)

    for i, line in enumerate(lines):
        header = re.match(
            rf'^({month_alt})\b(?:\s*\'(\d{{2,4}})|\s+(20\d{{2}}))?',
            line.upper()
        )
        if header:
            current_month = month_lookup[header.group(1)]
            parsed_year = _parse_month_header_year(header.group(2), header.group(3))
            if parsed_year and _is_plausible_calendar_year(parsed_year, start_year, end_year):
                current_year = parsed_year
            elif start_year is not None and end_year is not None:
                current_year = _year_for_school_month(current_month, start_year, end_year)

        if not _line_matches_tokens(line):
            continue

        if current_month is None or current_year is None:
            continue

        ordered_candidates = []
        leading = re.match(r'^(\d{1,2})(?:\s*[-/]\s*\d{1,2})?\b', line)
        if leading:
            ordered_candidates.append(int(leading.group(1)))
        for day in [int(d) for d in re.findall(r'\b([0-2]?\d|3[01])\b', line)]:
            if day not in ordered_candidates:
                ordered_candidates.append(day)
        if not ordered_candidates and i > 0 and re.fullmatch(r'\d{1,2}', lines[i - 1]):
            ordered_candidates.append(int(lines[i - 1]))

        for day in ordered_candidates:
            try:
                return date(current_year, current_month, day)
            except ValueError:
                continue
    return None


def _configure_tesseract_path():
    if pytesseract is None:
        return False
    if shutil.which('tesseract'):
        return True

    common_paths = [
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe'
    ]
    for path in common_paths:
        if os.path.isfile(path):
            pytesseract.pytesseract.tesseract_cmd = path
            return True
    return False


def _extract_text_with_ocr(pdf_bytes: bytes):
    if fitz is None or pytesseract is None or Image is None:
        return ''
    if not _configure_tesseract_path():
        return ''

    ocr_pages = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        for page in doc:
            # Render at higher DPI for OCR readability.
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            img = Image.open(BytesIO(pix.tobytes('png')))
            text = pytesseract.image_to_string(img) or ''
            if text.strip():
                ocr_pages.append(text)
        doc.close()
    except Exception:
        return ''

    return '\n'.join(ocr_pages)


def _extract_text_from_pdf_bytes(pdf_bytes: bytes):
    extracted_pages = []

    # Primary extractor: pypdf
    if PdfReader is not None:
        try:
            reader = PdfReader(BytesIO(pdf_bytes))
            for page in reader.pages:
                page_text = page.extract_text() or ''
                if page_text.strip():
                    extracted_pages.append(page_text)
        except Exception:
            pass

    if extracted_pages:
        return '\n'.join(extracted_pages), 'pypdf'

    # Fallback extractor: PyMuPDF (helps on some PDFs where pypdf returns empty text)
    if fitz is not None:
        try:
            doc = fitz.open(stream=pdf_bytes, filetype='pdf')
            for page in doc:
                page_text = page.get_text('text') or ''
                if page_text.strip():
                    extracted_pages.append(page_text)
            doc.close()
        except Exception:
            pass

    if extracted_pages:
        return '\n'.join(extracted_pages), 'pymupdf'

    ocr_text = _extract_text_with_ocr(pdf_bytes)
    if ocr_text.strip():
        return ocr_text, 'ocr'

    return '', None


def _split_school_year_into_quarters(first_day: date, last_day: date):
    total_days = (last_day - first_day).days + 1
    base_len = total_days // 4
    remainder = total_days % 4

    quarter_lengths = [base_len] * 4
    for i in range(remainder):
        quarter_lengths[i] += 1

    quarters = {}
    current_start = first_day
    for idx in range(1, 5):
        q_len = quarter_lengths[idx - 1]
        q_end = current_start + timedelta(days=max(q_len - 1, 0))
        if idx == 4:
            q_end = last_day
        quarters[str(idx)] = {
            'start': current_start.strftime('%m/%d/%Y'),
            'end': q_end.strftime('%m/%d/%Y'),
            'label': f'Quarter {idx}'
        }
        current_start = q_end + timedelta(days=1)
    return quarters


def _build_quarters_from_boundaries(first_day: date, q1_end: date, q2_end: date, q3_end: date, last_day: date):
    q1_start = first_day
    q2_start = q1_end + timedelta(days=1)
    q3_start = q2_end + timedelta(days=1)
    q4_start = q3_end + timedelta(days=1)

    order_ok = (
        q1_start <= q1_end <
        q2_start <= q2_end <
        q3_start <= q3_end <
        q4_start <= last_day
    )
    if not order_ok:
        return None

    return {
        '1': {'start': q1_start.strftime('%m/%d/%Y'), 'end': q1_end.strftime('%m/%d/%Y'), 'label': 'Quarter 1'},
        '2': {'start': q2_start.strftime('%m/%d/%Y'), 'end': q2_end.strftime('%m/%d/%Y'), 'label': 'Quarter 2'},
        '3': {'start': q3_start.strftime('%m/%d/%Y'), 'end': q3_end.strftime('%m/%d/%Y'), 'label': 'Quarter 3'},
        '4': {'start': q4_start.strftime('%m/%d/%Y'), 'end': last_day.strftime('%m/%d/%Y'), 'label': 'Quarter 4'},
    }


def get_school_calendar_config_row():
    row = SchoolCalendarConfig.query.order_by(SchoolCalendarConfig.id.asc()).first()
    if row is None:
        row = SchoolCalendarConfig()
        db.session.add(row)
        db.session.commit()
    return row


def _school_calendar_config_payload():
    row = get_school_calendar_config_row()
    quarters = None
    school_year = None
    if row.quarters_json:
        try:
            quarters = json.loads(row.quarters_json)
        except (TypeError, json.JSONDecodeError):
            quarters = None
    if row.school_year_json:
        try:
            school_year = json.loads(row.school_year_json)
        except (TypeError, json.JSONDecodeError):
            school_year = None
    configured = bool(
        quarters
        and school_year
        and school_year.get('start')
        and school_year.get('end')
    )
    return {
        'configured': configured,
        'quarters': quarters,
        'school_year': school_year,
        'updated_at': row.updated_at.isoformat() if row.updated_at else None,
    }


def _validate_mmddyyyy(date_str):
    if not date_str or not re.fullmatch(r'\d{2}/\d{2}/\d{4}', str(date_str).strip()):
        return False
    try:
        datetime.strptime(str(date_str).strip(), '%m/%d/%Y')
        return True
    except ValueError:
        return False


@app.route('/api/school-calendar-config', methods=['GET'])
@login_required
def get_school_calendar_config():
    return jsonify(_school_calendar_config_payload())


@app.route('/api/admin/school-calendar-config', methods=['PUT'])
@admin_required
def save_school_calendar_config():
    data = request.json or {}
    quarters = data.get('quarters')
    school_year = data.get('school_year')

    if not isinstance(quarters, dict) or not isinstance(school_year, dict):
        return jsonify({'error': 'quarters and school_year are required.'}), 400

    normalized_quarters = {}
    for quarter_num in ('1', '2', '3', '4'):
        quarter_data = quarters.get(quarter_num) or quarters.get(int(quarter_num))
        if not isinstance(quarter_data, dict):
            return jsonify({'error': f'Quarter {quarter_num} is missing or invalid.'}), 400
        start = str(quarter_data.get('start', '')).strip()
        end = str(quarter_data.get('end', '')).strip()
        if not _validate_mmddyyyy(start) or not _validate_mmddyyyy(end):
            return jsonify({'error': f'Quarter {quarter_num} dates must use MM/DD/YYYY format.'}), 400
        normalized_quarters[quarter_num] = {
            'start': start,
            'end': end,
            'label': quarter_data.get('label') or f'Quarter {quarter_num}',
        }

    sy_start = str(school_year.get('start', '')).strip()
    sy_end = str(school_year.get('end', '')).strip()
    if not _validate_mmddyyyy(sy_start) or not _validate_mmddyyyy(sy_end):
        return jsonify({'error': 'School year start and end must use MM/DD/YYYY format.'}), 400

    normalized_school_year = {
        'start': sy_start,
        'end': sy_end,
        'label': school_year.get('label') or f'{sy_start} - {sy_end}',
    }

    row = get_school_calendar_config_row()
    row.quarters_json = json.dumps(normalized_quarters)
    row.school_year_json = json.dumps(normalized_school_year)
    row.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({
        'success': True,
        'configured': True,
        'quarters': normalized_quarters,
        'school_year': normalized_school_year,
        'updated_at': row.updated_at.isoformat(),
    })


@app.route('/api/calendar/extract-school-year', methods=['POST'])
@admin_required
def extract_school_year_from_calendar_pdf():
    if PdfReader is None and fitz is None and pytesseract is None:
        return jsonify({
            'error': 'PDF parsing is unavailable. Install "pypdf", "PyMuPDF", and OCR dependencies.'
        }), 500

    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No PDF file provided.'}), 400
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Please upload a PDF file.'}), 400

    try:
        pdf_bytes = file.read()
        if not pdf_bytes:
            return jsonify({'error': 'Uploaded PDF is empty.'}), 400

        full_text, extractor_used = _extract_text_from_pdf_bytes(pdf_bytes)
        full_text = _normalize_calendar_text(full_text)

        if not full_text.strip():
            return jsonify({
                'error': 'Could not extract text from the PDF. If this is scanned, install Tesseract OCR and retry.'
            }), 400

        school_start_year, school_end_year = _extract_school_year_span(full_text)
        month_markers = _backfill_month_marker_years(
            _extract_month_markers(full_text),
            school_start_year,
            school_end_year
        )

        first_day_patterns = [
            r'first\s*day\s*(?:of\s*)?school',
            r'first\s*day'
        ]
        last_day_patterns = [
            r'last\s*day\s*(?:of\s*)?school',
            r'last\s*day'
        ]
        q1_patterns = [
            r'end\s*(?:of\s*)?quarter\s*1',
            r'quarter\s*1\s*end[s]?',
            r'q1\s*end[s]?'
        ]
        q2_patterns = [
            r'end\s*(?:of\s*)?quarter\s*2',
            r'quarter\s*2\s*end[s]?',
            r'q2\s*end[s]?'
        ]
        q3_patterns = [
            r'end\s*(?:of\s*)?quarter\s*3',
            r'quarter\s*3\s*end[s]?',
            r'q3\s*end[s]?'
        ]

        first_day = _extract_date_from_patterns(full_text, first_day_patterns, month_markers)
        last_day = _extract_date_from_patterns(full_text, last_day_patterns, month_markers)
        q1_end = _extract_date_from_patterns(full_text, q1_patterns, month_markers)
        q2_end = _extract_date_from_patterns(full_text, q2_patterns, month_markers)
        q3_end = _extract_date_from_patterns(full_text, q3_patterns, month_markers)

        if first_day is None:
            first_day = _extract_date_from_line_fallback(
                full_text, ['first', 'day', 'school'], school_start_year, school_end_year
            )
        if last_day is None:
            last_day = _extract_date_from_line_fallback(
                full_text, ['last', 'day', 'school'], school_start_year, school_end_year
            )
        if q1_end is None:
            q1_end = _extract_date_from_line_fallback(
                full_text, ['end', 'quarter', '1'], school_start_year, school_end_year
            )
        if q2_end is None:
            q2_end = _extract_date_from_line_fallback(
                full_text, ['end', 'quarter', '2'], school_start_year, school_end_year
            )
        if q3_end is None:
            q3_end = _extract_date_from_line_fallback(
                full_text, ['end', 'quarter', '3'], school_start_year, school_end_year
            )

        if first_day is None or last_day is None:
            return jsonify({
                'error': 'Could not find both "first day of school" and "last day of school" dates in the PDF.'
            }), 400

        if last_day < first_day:
            return jsonify({'error': '"Last day of school" occurs before "first day of school".'}), 400

        quarter_dates = None
        if all([q1_end, q2_end, q3_end]):
            quarter_dates = _build_quarters_from_boundaries(first_day, q1_end, q2_end, q3_end, last_day)
        if quarter_dates is None:
            quarter_dates = _split_school_year_into_quarters(first_day, last_day)
        school_year = {
            'start': first_day.strftime('%m/%d/%Y'),
            'end': last_day.strftime('%m/%d/%Y'),
            'label': f'{first_day.year}-{last_day.year}'
        }

        return jsonify({
            'school_year': school_year,
            'quarters': quarter_dates,
            'extractor_used': extractor_used
        }), 200
    except Exception as e:
        return jsonify({'error': f'Failed to parse calendar PDF: {str(e)}'}), 500


def _grade_to_int(s: str) -> int | None:
    """Parse a grade token to numeric form. K -> 0, 1-12 -> 1-12. None if invalid."""
    s = s.strip().upper()
    if s == 'K':
        return 0
    try:
        n = int(s)
        return n if 1 <= n <= 12 else None
    except (ValueError, TypeError):
        return None


def _int_to_grade(n: int) -> str:
    """Format numeric grade for display. 0 -> K, 1-12 -> '1'-'12'."""
    return 'K' if n == 0 else str(n)


def normalize_grades_taught(raw: str) -> str:
    """
    Normalize flexible grades-taught input to a consistent comma-separated form.
    Accepts: single grade (e.g. "7", "K"), range (e.g. "6-9", "K-2"), or comma list (e.g. "6, 7, 8").
    K = Kindergarten. Returns: comma-separated grades (e.g. "7" or "K, 1, 2" or "6, 7, 8, 9"). Empty string if invalid/empty.
    """
    if not raw or not raw.strip():
        return ''
    raw = raw.strip()
    seen = set()
    for part in raw.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            lo, hi = _grade_to_int(a), _grade_to_int(b)
            if lo is not None and hi is not None and lo <= hi:
                for g in range(lo, hi + 1):
                    seen.add(g)
            else:
                single = _grade_to_int(part.replace('-', '').strip())
                if single is not None:
                    seen.add(single)
        else:
            n = _grade_to_int(part)
            if n is not None:
                seen.add(n)
    if not seen:
        return ''
    return ', '.join(_int_to_grade(g) for g in sorted(seen))


def generate_staff_username(full_name: str) -> str:
    """Generate a unique staff username based on full name."""
    if not full_name:
        base = 'staff'
    else:
        parts = full_name.strip().split()
        first = parts[0]
        last = parts[-1]
        base = (first[0] + last).lower()
    candidate = base
    # If collision, progressively add more of the first name, then numbers
    idx = 1
    extra_idx = 1
    while User.query.filter_by(username=candidate).first() is not None:
        if full_name and idx < len(parts[0]):
            candidate = (parts[0][: idx + 1] + parts[-1]).lower()
            idx += 1
        else:
            extra_idx += 1
            candidate = f"{base}{extra_idx}"
    return candidate


def generate_student_username(initials: str) -> str:
    """Generate a unique student username from initials."""
    if not initials:
        base = 'student'
    else:
        base = initials.strip().lower()
    candidate = base
    suffix = 2
    while User.query.filter_by(username=candidate).first() is not None:
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate


def normalize_import_identifier(value):
    """Normalize CSV identifiers: trim whitespace and Excel numeric suffixes like '12345.0'."""
    if value is None:
        return ''
    s = str(value).strip()
    if len(s) > 2 and s.endswith('.0'):
        whole = s[:-2]
        if whole.isdigit() or (whole.startswith('-') and whole[1:].isdigit()):
            s = whole
    return s


def _clip_import_field(value, max_len):
    if value is None:
        return ''
    return str(value).strip()[:max_len]


def _import_missing_required_message(row_index, name, missing_what):
    name = (name or '').strip()
    if name:
        return f"Row {row_index} ({name}): missing {missing_what}."
    return f"Row {row_index}: missing {missing_what}."


def _set_imported_password(user, password):
    """Use PBKDF2 for bulk CSV imports. Default scrypt is too slow for a roster-sized file."""
    user.password_hash = generate_password_hash(password, method='pbkdf2:sha256:80000')


def _unique_import_username(base, used_usernames):
    base = (base or 'user').strip().lower() or 'user'
    candidate = base
    suffix = 2
    while candidate in used_usernames:
        candidate = f'{base}{suffix}'
        suffix += 1
    used_usernames.add(candidate)
    return candidate


def _read_uploaded_csv(file_storage):
    """Decode an uploaded CSV with common Excel encodings."""
    raw = file_storage.read()
    if isinstance(raw, str):
        content = raw
    else:
        content = None
        last_error = None
        for encoding in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
            try:
                content = raw.decode(encoding)
                break
            except UnicodeDecodeError as e:
                last_error = e
        if content is None:
            raise UnicodeDecodeError('utf-8', raw or b'', 0, 1, str(last_error or 'unknown encoding'))
    content = content.replace('\x00', '')
    return list(csv.reader(StringIO(content)))


def _import_str_eq(left, right):
    return (left or '').strip() == (right or '').strip()


IMPORT_NAME_MIN_PARTIAL = 4

# Team-member CSV roles mapped from staff designation (same pairing as User.get_designations_list).
STAFF_DESIGNATION_ALIASES = {
    'Case Manager': ('Case Manager', 'Teacher'),
    'Practitioner': ('Practitioner', 'Group Leader'),
    'Paraprofessional': ('Paraprofessional',),
    'Professional': ('Professional',),
    'Admin': ('Admin',),
}


def _import_name_tokens(name):
    if not name:
        return []
    return [part for part in re.split(r'[\s,]+', str(name).strip().lower()) if part]


def _import_letters_only(value):
    return re.sub(r'[^a-z]', '', (value or '').lower())


def _import_name_match_rank(query, candidate_name):
    """Score how well a CSV name matches a stored staff name. Higher is better; 0 is no match.

    Accepts an exact full name, an exact first name of any length, or a partial first-name
    match of at least IMPORT_NAME_MIN_PARTIAL consecutive letters (e.g. Britt -> Brittany).
    Extra tokens in the query (last name) must also match the candidate last name.
    """
    query = (query or '').strip()
    candidate_name = (candidate_name or '').strip()
    if not query or not candidate_name:
        return 0
    if query.lower() == candidate_name.lower():
        return 4

    q_tokens = _import_name_tokens(query)
    c_tokens = _import_name_tokens(candidate_name)
    if not q_tokens or not c_tokens:
        return 0

    q_first = _import_letters_only(q_tokens[0])
    c_first = _import_letters_only(c_tokens[0])
    if not q_first or not c_first:
        return 0

    first_exact = q_first == c_first
    shorter, longer = (q_first, c_first) if len(q_first) <= len(c_first) else (c_first, q_first)
    first_partial = (
        not first_exact
        and len(shorter) >= IMPORT_NAME_MIN_PARTIAL
        and longer.startswith(shorter)
    )
    if not first_exact and not first_partial:
        return 0

    if len(q_tokens) > 1:
        q_last = _import_letters_only(q_tokens[-1])
        c_last = _import_letters_only(c_tokens[-1]) if len(c_tokens) > 1 else ''
        if not q_last or not c_last:
            return 0
        last_exact = q_last == c_last
        last_shorter, last_longer = (q_last, c_last) if len(q_last) <= len(c_last) else (c_last, q_last)
        last_partial = (
            not last_exact
            and len(last_shorter) >= IMPORT_NAME_MIN_PARTIAL
            and last_longer.startswith(last_shorter)
        )
        if not last_exact and not last_partial:
            return 0
        if first_exact and last_exact:
            return 3
        return 2 if first_exact else 1

    return 2 if first_exact else 1


def _best_import_name_matches(query, candidates, name_attr='name'):
    """Return candidates tied at the best match rank. Empty if none match."""
    ranked = []
    for candidate in candidates:
        name = candidate if isinstance(candidate, str) else getattr(candidate, name_attr, None)
        rank = _import_name_match_rank(query, name)
        if rank:
            ranked.append((rank, candidate))
    if not ranked:
        return []
    best = max(rank for rank, _ in ranked)
    return [candidate for rank, candidate in ranked if rank == best]


def _prefer_complete_import_name(existing_name, incoming_name):
    """When a CSV nickname matches a stored full name, keep the more complete one."""
    existing_name = (existing_name or '').strip()
    incoming_name = (incoming_name or '').strip()
    if not existing_name:
        return incoming_name
    if not incoming_name:
        return existing_name
    if _import_str_eq(existing_name, incoming_name):
        return existing_name
    if not _import_name_match_rank(incoming_name, existing_name):
        return incoming_name
    existing_tokens = _import_name_tokens(existing_name)
    incoming_tokens = _import_name_tokens(incoming_name)
    if len(existing_tokens) != len(incoming_tokens):
        return existing_name if len(existing_tokens) > len(incoming_tokens) else incoming_name
    existing_letters = _import_letters_only(existing_name)
    incoming_letters = _import_letters_only(incoming_name)
    return existing_name if len(existing_letters) >= len(incoming_letters) else incoming_name


def _staff_user_matches_team_role(user, team_role):
    if not user or getattr(user, 'role', None) != 'staff' or getattr(user, 'is_outside_staff', False):
        return False
    designation = getattr(user, 'designation', None) or ''
    aliases = STAFF_DESIGNATION_ALIASES.get(designation, (designation,) if designation else ())
    return team_role in aliases or designation == team_role


def _staff_pool_for_team_role(staff_users, team_role):
    return [user for user in staff_users if _staff_user_matches_team_role(user, team_role)]


def _unresolved_staff_name_message(query, matches, role_label):
    if len(matches) > 1:
        names = ', '.join((m.name or '').strip() or '(unnamed)' for m in matches)
        return (
            f"{role_label} '{query}' matched multiple {role_label} staff ({names}). "
            "Assign this person manually in User Management."
        )
    return (
        f"{role_label} '{query}' was not found among {role_label} staff. "
        "You can assign this person manually in User Management."
    )


def _resolve_staff_user_by_name(name, *, designation=None, staff_users=None):
    """Match a CSV name to a unique staff user, optionally limited by designation/role aliases."""
    name = (name or '').strip()
    if not name:
        return None, []
    if staff_users is None:
        query = User.query.filter(User.role == 'staff', User.is_outside_staff == False)
        if designation:
            aliases = [
                primary for primary, names in STAFF_DESIGNATION_ALIASES.items()
                if designation in names or primary == designation
            ]
            query = query.filter(User.designation.in_(aliases or [designation]))
        staff_users = query.all()
    elif designation:
        staff_users = _staff_pool_for_team_role(staff_users, designation)
    matches = _best_import_name_matches(name, staff_users)
    if len(matches) == 1:
        return matches[0], matches
    return None, matches


def _user_number_match_filter(user_number):
    """Match a stored user_number, including Excel-style '12345.0' and extra whitespace."""
    variants = [user_number]
    if user_number and not user_number.endswith('.0'):
        variants.append(f'{user_number}.0')
    return or_(User.user_number.in_(variants), func.trim(User.user_number) == user_number)


def _find_staff_for_import(user_number, name, *, outside_staff=False, designation=None):
    """Match staff by user number; if none, unique first-name/partial name staff with no user number."""
    if user_number:
        by_number = User.query.filter(
            User.role == 'staff',
            User.is_outside_staff == outside_staff,
            _user_number_match_filter(user_number),
        ).first()
        if by_number:
            return by_number
        conflict = User.query.filter(
            _user_number_match_filter(user_number),
            or_(User.role != 'staff', User.is_outside_staff != outside_staff),
        ).first()
        if conflict:
            return conflict
    if not name:
        return None
    unnamed = User.query.filter(
        User.role == 'staff',
        User.is_outside_staff == outside_staff,
        or_(User.user_number.is_(None), User.user_number == ''),
    ).all()
    pool = unnamed
    if designation:
        pool = [user for user in unnamed if (user.designation or '') == designation]
    matches = _best_import_name_matches(name, pool)
    return matches[0] if len(matches) == 1 else None


def _staff_import_conflict(existing, *, outside_staff=False):
    if existing is None:
        return None
    if existing.role != 'staff' or bool(existing.is_outside_staff) != outside_staff:
        kind = 'an outside staff' if existing.is_outside_staff else existing.role
        return f"already exists as {kind} account"
    return None


STUDENT_TEAM_COLUMNS = (
    ('Case Manager', 4),
    ('Case Manager', 5),
    ('Practitioner', 6),
    ('Practitioner', 7),
    ('Professional', 8),
    ('Group Leader', 9),
)
STAFF_EMAIL_COL = 5  # column F
OUTSIDE_STAFF_EMAIL_COL = 4  # column E
STUDENT_EMAIL_COL = 11  # column L
STUDENT_PARENT1_EMAIL_COL = 12  # column M
STUDENT_PARENT2_EMAIL_COL = 13  # column N
PARENT_GUARDIAN_DESIGNATION = 'Parent/Guardian'


def _normalize_import_email(value):
    if value is None:
        return ''
    email = str(value).strip().lower()
    if not email or '@' not in email:
        return ''
    return email[:200]


def _generate_parent_username_from_email(email, used_usernames):
    local = (email.split('@')[0] if email else '') or 'parent'
    base = re.sub(r'[^a-z0-9]', '', local.lower()) or 'parent'
    return _unique_import_username(base, used_usernames)


def _upsert_parent_from_import(email, student, slot, used_usernames, warnings, student_label):
    """Create or update a parent/guardian user linked to a student. Returns True if anything changed."""
    email = _normalize_import_email(email)
    if not email:
        return False

    changed = False
    existing_non_parent = User.query.filter(
        func.lower(User.email) == email,
        User.role != 'parent',
    ).first()
    if existing_non_parent:
        warnings.append(
            f"{student_label}: parent email {email} is already used by {existing_non_parent.username}."
        )
        return False

    parent = User.query.filter(
        func.lower(User.email) == email,
        User.role == 'parent',
    ).first()

    if parent:
        if parent.designation != PARENT_GUARDIAN_DESIGNATION:
            parent.designation = PARENT_GUARDIAN_DESIGNATION
            changed = True
        if not _import_str_eq(parent.email, email):
            parent.email = email
            changed = True
    else:
        username = _generate_parent_username_from_email(email, used_usernames)
        password = f"{username}123"
        parent = User(
            name=f"{PARENT_GUARDIAN_DESIGNATION} ({email})",
            username=username,
            role='parent',
            designation=PARENT_GUARDIAN_DESIGNATION,
            email=email,
            must_change_password=True,
            hidden_from_management=False,
        )
        _set_imported_password(parent, password)
        db.session.add(parent)
        db.session.flush()
        changed = True

    relationship = 'parent' if slot == 1 else 'guardian'
    link = ParentStudent.query.filter_by(parent_user_id=parent.id, student_id=student.id).first()
    if not link:
        db.session.add(ParentStudent(
            parent_user_id=parent.id,
            student_id=student.id,
            relationship=relationship,
            verified=True,
            verified_by_user_id=current_user.id if current_user.is_authenticated else None,
            verified_at=datetime.utcnow(),
        ))
        changed = True
    elif link.relationship != relationship and slot == 1:
        link.relationship = relationship
        changed = True

    return changed


def _sync_parents_from_student_import(student, parent_emails, used_usernames, warnings, student_label):
    changed = False
    seen_emails = set()
    for slot, raw_email in enumerate(parent_emails, start=1):
        email = _normalize_import_email(raw_email)
        if not email or email in seen_emails:
            continue
        seen_emails.add(email)
        if _upsert_parent_from_import(email, student, slot, used_usernames, warnings, student_label):
            changed = True
    return changed


def _parse_student_team_members(row):
    members = []
    for role_name, col_idx in STUDENT_TEAM_COLUMNS:
        if len(row) > col_idx:
            val = _clip_import_field(row[col_idx], 100)
            if val:
                members.append((role_name, val))
    return members


def _resolve_student_team_members(members, staff_users, warnings, student_label):
    """Replace CSV team names with the matched staff user's full name when unique."""
    resolved = []
    for role_name, member_name in members:
        pool = _staff_pool_for_team_role(staff_users, role_name)
        matches = _best_import_name_matches(member_name, pool)
        if len(matches) == 1:
            resolved.append((role_name, matches[0].name))
        else:
            warnings.append(
                f"{student_label}: {_unresolved_staff_name_message(member_name, matches, role_name)}"
            )
            resolved.append((role_name, member_name))
    return resolved


def _sync_student_team_members(student_id, members, existing=None):
    """Replace a student's team members when the CSV set differs. Returns True if changed."""
    if existing is None:
        existing = TeamMember.query.filter_by(student_id=student_id).all()
    existing_pairs = sorted((tm.role or '', tm.name or '') for tm in existing)
    new_pairs = sorted(members)
    if existing_pairs == new_pairs:
        return False
    keep_by_key = {}
    for tm in existing:
        key = (tm.role or '', tm.name or '')
        keep_by_key.setdefault(key, []).append(tm)
    for tm in existing:
        db.session.delete(tm)
    for role_name, name in members:
        key = (role_name, name)
        email = None
        email_status = None
        if keep_by_key.get(key):
            old = keep_by_key[key].pop(0)
            email = old.email
            email_status = old.email_status
        db.session.add(TeamMember(
            student_id=student_id,
            role=role_name,
            name=name,
            email=email,
            email_status=email_status,
        ))
    return True


def _resolve_case_manager_id(case_manager_name, staff_users=None):
    user, _matches = _resolve_staff_user_by_name(
        case_manager_name,
        designation='Case Manager',
        staff_users=staff_users,
    )
    return user


def _apply_staff_import_updates(user, *, user_number, name, role, grades_taught, case_manager_name, email, warnings):
    """Update an existing staff user from CSV. Returns True if any field changed."""
    changed = False
    if not _import_str_eq(user.user_number, user_number):
        user.user_number = user_number
        changed = True
    preferred_name = _prefer_complete_import_name(user.name, name)
    if not _import_str_eq(user.name, preferred_name):
        user.name = preferred_name
        changed = True
    if not _import_str_eq(user.designation, role):
        user.designation = role
        changed = True
    normalized_email = _normalize_import_email(email) or None
    if not _import_str_eq(user.email, normalized_email):
        user.email = normalized_email
        changed = True

    desired_grades = None
    if role == 'Case Manager' and grades_taught:
        desired_grades = normalize_grades_taught(grades_taught) or None
    if not _import_str_eq(user.grades_taught, desired_grades):
        user.grades_taught = desired_grades
        changed = True

    desired_cm_id = None
    if role == 'Paraprofessional':
        if case_manager_name:
            cm, cm_matches = _resolve_staff_user_by_name(
                case_manager_name, designation='Case Manager'
            )
            if cm:
                desired_cm_id = cm.id
            else:
                desired_cm_id = user.linked_case_manager_id
                warnings.append(
                    f"{name}: {_unresolved_staff_name_message(case_manager_name, cm_matches, 'Case Manager')}"
                )
        else:
            desired_cm_id = user.linked_case_manager_id
    if user.linked_case_manager_id != desired_cm_id:
        user.linked_case_manager_id = desired_cm_id
        changed = True
    return changed


def _apply_outside_staff_import_updates(user, *, user_number, name, district, email):
    changed = False
    if not _import_str_eq(user.user_number, user_number):
        user.user_number = user_number
        changed = True
    preferred_name = _prefer_complete_import_name(user.name, name)
    if not _import_str_eq(user.name, preferred_name):
        user.name = preferred_name
        changed = True
    if not _import_str_eq(user.district, district):
        user.district = district or None
        changed = True
    normalized_email = _normalize_import_email(email) or None
    if not _import_str_eq(user.email, normalized_email):
        user.email = normalized_email
        changed = True
    return changed


def _lunch_number_match_filter(lunch_number):
    variants = [lunch_number]
    if lunch_number and not lunch_number.endswith('.0'):
        variants.append(f'{lunch_number}.0')
    return or_(Student.lunch_number.in_(variants), func.trim(Student.lunch_number) == lunch_number)


def _find_student_for_import(lunch_number, initials):
    if lunch_number:
        by_lunch = Student.query.filter(_lunch_number_match_filter(lunch_number)).first()
        if by_lunch:
            return by_lunch
    if not initials:
        return None
    unnamed = Student.query.filter(
        func.lower(Student.name) == initials.strip().lower(),
        or_(Student.lunch_number.is_(None), Student.lunch_number == ''),
    ).all()
    return unnamed[0] if len(unnamed) == 1 else None


def _student_user_for(student):
    return User.query.filter_by(student_id=student.id, role='student').first()


def _apply_student_import_updates(
    student,
    *,
    lunch_number,
    initials,
    grade,
    card_color,
    team_members,
    student_email=None,
    parent_emails=None,
    used_usernames=None,
    warnings=None,
    user=None,
    existing_team=None,
):
    changed = False
    if not _import_str_eq(student.lunch_number, lunch_number):
        student.lunch_number = lunch_number
        changed = True
    if not _import_str_eq(student.name, initials):
        student.name = initials
        changed = True
    if not _import_str_eq(student.grade, grade):
        student.grade = grade or None
        changed = True
    desired_color = card_color or None
    if not _import_str_eq(student.card_color, desired_color):
        student.card_color = desired_color
        changed = True
    normalized_email = _normalize_import_email(student_email) or None
    if not _import_str_eq(student.email, normalized_email):
        student.email = normalized_email
        changed = True
    if user is None:
        user = _student_user_for(student)
    if user:
        if not _import_str_eq(user.name, initials):
            user.name = initials
            changed = True
        if not _import_str_eq(user.email, normalized_email):
            user.email = normalized_email
            changed = True
    if team_members and _sync_student_team_members(student.id, team_members, existing=existing_team):
        changed = True
    if parent_emails and used_usernames is not None:
        if _sync_parents_from_student_import(
            student,
            parent_emails,
            used_usernames,
            warnings or [],
            initials or lunch_number,
        ):
            changed = True
    return changed


def _import_exception_message(e):
    text = str(e).strip()
    name = type(e).__name__
    return f'{name}: {text}' if text else name


def _import_users_payload(success, errors, warnings, updated_names, duplicate_count):
    return {
        'success': success,
        'errors': errors,
        'warnings': warnings,
        'updated_count': len(updated_names),
        'updated_names': updated_names,
        'duplicate_count': duplicate_count,
    }


@app.route('/api/import-users', methods=['POST'])
@login_required
def import_users():
    """Import staff, outside staff, or student users from CSV."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Permission denied'}), 403

    file = request.files.get('file')
    import_type = request.form.get('type')

    if not file or not import_type:
        return jsonify({'error': 'File and type are required'}), 400

    try:
        rows = _read_uploaded_csv(file)
    except Exception as e:
        return jsonify({'error': f'Failed to read CSV: {e}'}), 400

    if not rows:
        return jsonify({'error': 'CSV file is empty'}), 400

    header_offset = 1  # skip header row
    success = []
    errors = []
    warnings = []
    updated_names = []
    duplicate_count = 0
    seen_numbers = set()

    if import_type == 'staff':
        valid_roles = {'Case Manager', 'Practitioner', 'Paraprofessional', 'Professional'}

        # Two-pass: first non-Paraprofessionals, then Paraprofessionals
        staff_rows = rows[header_offset:]
        non_para_rows = [r for r in staff_rows if len(r) > 2 and r[2].strip() != 'Paraprofessional']
        para_rows = [r for r in staff_rows if len(r) > 2 and r[2].strip() == 'Paraprofessional']

        def process_staff_row(row, row_index):
            nonlocal duplicate_count
            if not row or all(not (c or '').strip() for c in row):
                return
            user_number = normalize_import_identifier(row[0] if len(row) > 0 else '')
            name = (row[1] or '').strip() if len(row) > 1 else ''
            role = (row[2] or '').strip() if len(row) > 2 else ''
            grades_taught = (row[3] or '').strip() if len(row) > 3 else ''
            case_manager_name = (row[4] or '').strip() if len(row) > 4 else ''
            email = _clip_import_field(row[STAFF_EMAIL_COL] if len(row) > STAFF_EMAIL_COL else '', 200)

            if not user_number or not name:
                if not user_number and not name:
                    errors.append(_import_missing_required_message(row_index, '', 'User Number and Name'))
                elif not user_number:
                    errors.append(_import_missing_required_message(row_index, name, 'User Number'))
                else:
                    errors.append(_import_missing_required_message(row_index, '', 'Name'))
                return

            if role not in valid_roles:
                errors.append(
                    f"{name} was not added: invalid role '{role}'. "
                    "Role must be one of: Case Manager, Practitioner, Paraprofessional, Professional."
                )
                return

            if user_number in seen_numbers:
                duplicate_count += 1
                return
            seen_numbers.add(user_number)

            existing = _find_staff_for_import(
                user_number, name, outside_staff=False, designation=role or None
            )
            conflict = _staff_import_conflict(existing, outside_staff=False)
            if conflict:
                errors.append(
                    f"{name} was not added: User Number {user_number} {conflict}."
                )
                return

            if existing:
                changed = _apply_staff_import_updates(
                    existing,
                    user_number=user_number,
                    name=name,
                    role=role,
                    grades_taught=grades_taught,
                    case_manager_name=case_manager_name,
                    email=email,
                    warnings=warnings,
                )
                if changed:
                    updated_names.append(name)
                else:
                    duplicate_count += 1
                return

            username = generate_staff_username(name)
            password = f"{username}123"

            normalized_grades = normalize_grades_taught(grades_taught) if role == 'Case Manager' and grades_taught else None
            user = User(
                name=name,
                username=username,
                role='staff',
                designation=role,
                user_number=user_number,
                must_change_password=True,
                grades_taught=normalized_grades if normalized_grades else None,
                email=_normalize_import_email(email) or None,
            )

            if role == 'Paraprofessional' and case_manager_name:
                cm, cm_matches = _resolve_staff_user_by_name(
                    case_manager_name, designation='Case Manager'
                )
                if cm:
                    user.linked_case_manager_id = cm.id
                else:
                    warnings.append(
                        f"{name} was created but their "
                        f"{_unresolved_staff_name_message(case_manager_name, cm_matches, 'Case Manager')}"
                    )

            _set_imported_password(user, password)
            db.session.add(user)
            success.append(
                {
                    'name': name,
                    'username': username,
                    'password': password,
                    'role': 'staff',
                    'user_number': user_number,
                }
            )

        # First pass: non-Paraprofessionals
        for idx, row in enumerate(non_para_rows, start=header_offset + 1):
            process_staff_row(row, idx)
        # Commit so Case Managers exist
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.exception('Staff CSV import failed on first pass')
            return jsonify({'error': f'Import failed: {_import_exception_message(e)}'}), 500

        # Second pass: Paraprofessionals
        for idx, row in enumerate(para_rows, start=header_offset + 1):
            process_staff_row(row, idx)

        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.exception('Staff CSV import failed')
            return jsonify({'error': f'Import failed: {_import_exception_message(e)}'}), 500
        return jsonify(_import_users_payload(success, errors, warnings, updated_names, duplicate_count)), 200

    elif import_type == 'outside_staff':
        # CSV columns: A=User Number, B=Name, C=District, E=Email
        outside_staff_rows = rows[header_offset:]
        for idx, row in enumerate(outside_staff_rows, start=header_offset + 1):
            if not row or all(not (c or '').strip() for c in row):
                continue
            user_number = normalize_import_identifier(row[0] if len(row) > 0 else '')
            name = (row[1] or '').strip() if len(row) > 1 else ''
            district = (row[2] or '').strip() if len(row) > 2 else ''
            email = _clip_import_field(row[OUTSIDE_STAFF_EMAIL_COL] if len(row) > OUTSIDE_STAFF_EMAIL_COL else '', 200)

            if not user_number or not name:
                if not user_number and not name:
                    errors.append(_import_missing_required_message(idx, '', 'User Number and Name'))
                elif not user_number:
                    errors.append(_import_missing_required_message(idx, name, 'User Number'))
                else:
                    errors.append(_import_missing_required_message(idx, '', 'Name'))
                continue

            if user_number in seen_numbers:
                duplicate_count += 1
                continue
            seen_numbers.add(user_number)

            existing = _find_staff_for_import(user_number, name, outside_staff=True)
            conflict = _staff_import_conflict(existing, outside_staff=True)
            if conflict:
                errors.append(
                    f"{name} was not added: User Number {user_number} {conflict}."
                )
                continue

            if existing:
                changed = _apply_outside_staff_import_updates(
                    existing,
                    user_number=user_number,
                    name=name,
                    district=district,
                    email=email,
                )
                if changed:
                    updated_names.append(name)
                else:
                    duplicate_count += 1
                continue

            username = generate_staff_username(name)
            password = f"{username}123"

            user = User(
                name=name,
                username=username,
                role='staff',
                user_number=user_number,
                is_outside_staff=True,
                district=district or None,
                must_change_password=True,
                email=_normalize_import_email(email) or None,
            )
            _set_imported_password(user, password)
            db.session.add(user)
            success.append(
                {
                    'name': name,
                    'username': username,
                    'password': password,
                    'user_number': user_number,
                    'district': district or '',
                }
            )

        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.exception('Outside staff CSV import failed')
            return jsonify({'error': f'Import failed: {_import_exception_message(e)}'}), 500
        return jsonify(_import_users_payload(success, errors, warnings, updated_names, duplicate_count)), 200

    elif import_type == 'student':
        try:
            by_lunch = {}
            unnamed_by_name = {}
            for existing in Student.query.all():
                key = normalize_import_identifier(existing.lunch_number)
                if key:
                    by_lunch.setdefault(key, existing)
                    by_lunch.setdefault(f'{key}.0', existing)
                else:
                    nkey = (existing.name or '').strip().lower()
                    if nkey:
                        unnamed_by_name.setdefault(nkey, []).append(existing)

            users_by_student_id = {
                u.student_id: u
                for u in User.query.filter(User.role == 'student', User.student_id.isnot(None)).all()
            }
            team_by_student_id = {}
            for tm in TeamMember.query.all():
                team_by_student_id.setdefault(tm.student_id, []).append(tm)

            used_usernames = {
                (username or '').lower()
                for (username,) in db.session.query(User.username).all()
                if username
            }
            staff_users = User.query.filter_by(role='staff', is_outside_staff=False).all()

            new_student_items = []
            student_rows = rows[header_offset:]
            for idx, row in enumerate(student_rows, start=header_offset + 1):
                if not row or all(not (c or '').strip() for c in row):
                    continue
                lunch_number = _clip_import_field(normalize_import_identifier(row[0] if len(row) > 0 else ''), 50)
                initials = _clip_import_field(row[1] if len(row) > 1 else '', 100)
                grade = _clip_import_field(row[2] if len(row) > 2 else '', 20)
                card_color = _clip_import_field((row[3] or '').lower() if len(row) > 3 else '', 20)
                student_email = _clip_import_field(row[STUDENT_EMAIL_COL] if len(row) > STUDENT_EMAIL_COL else '', 200)
                parent_emails = [
                    _clip_import_field(row[STUDENT_PARENT1_EMAIL_COL] if len(row) > STUDENT_PARENT1_EMAIL_COL else '', 200),
                    _clip_import_field(row[STUDENT_PARENT2_EMAIL_COL] if len(row) > STUDENT_PARENT2_EMAIL_COL else '', 200),
                ]

                if not lunch_number:
                    errors.append(_import_missing_required_message(idx, initials, 'lunch number'))
                    continue
                if not initials:
                    errors.append(_import_missing_required_message(idx, '', 'initials'))
                    continue

                if lunch_number in seen_numbers:
                    duplicate_count += 1
                    continue
                seen_numbers.add(lunch_number)

                existing_student = by_lunch.get(lunch_number)
                if not existing_student:
                    name_matches = unnamed_by_name.get(initials.lower()) or []
                    if len(name_matches) == 1:
                        existing_student = name_matches[0]

                team_members = _resolve_student_team_members(
                    _parse_student_team_members(row),
                    staff_users,
                    warnings,
                    initials or lunch_number,
                )

                if existing_student:
                    try:
                        changed = _apply_student_import_updates(
                            existing_student,
                            lunch_number=lunch_number,
                            initials=initials,
                            grade=grade,
                            card_color=card_color,
                            team_members=team_members,
                            student_email=student_email,
                            parent_emails=parent_emails,
                            used_usernames=used_usernames,
                            warnings=warnings,
                            user=users_by_student_id.get(existing_student.id),
                            existing_team=team_by_student_id.get(existing_student.id, []),
                        )
                        by_lunch[lunch_number] = existing_student
                        if changed:
                            updated_names.append(initials)
                        else:
                            duplicate_count += 1
                    except Exception as row_err:
                        app.logger.exception('Student CSV row %s failed', idx)
                        errors.append(
                            f"Row {idx} ({initials or lunch_number}) could not be imported: {_import_exception_message(row_err)}"
                        )
                    continue

                username = _unique_import_username(initials.lower(), used_usernames)
                password = f"{initials.upper()}{lunch_number}"
                student = Student(
                    name=initials,
                    grade=grade or None,
                    card_color=card_color or None,
                    lunch_number=lunch_number,
                    directory_info_opt_out=False,
                    email=_normalize_import_email(student_email) or None,
                )
                db.session.add(student)
                new_student_items.append(
                    {
                        'student': student,
                        'initials': initials,
                        'username': username,
                        'password': password,
                        'lunch_number': lunch_number,
                        'grade': grade,
                        'team_members': team_members,
                        'student_email': student_email,
                        'parent_emails': parent_emails,
                    }
                )
                by_lunch[lunch_number] = student

            if new_student_items:
                db.session.flush()
                for item in new_student_items:
                    student = item['student']
                    user = User(
                        name=item['initials'],
                        username=item['username'],
                        role='student',
                        student_id=student.id,
                        is_outside_staff=False,
                        must_change_password=False,
                        email=_normalize_import_email(item.get('student_email')) or None,
                    )
                    _set_imported_password(user, item['password'])
                    db.session.add(user)
                    for role_name, member_name in item['team_members']:
                        db.session.add(TeamMember(student_id=student.id, role=role_name, name=member_name))
                    _sync_parents_from_student_import(
                        student,
                        item.get('parent_emails') or [],
                        used_usernames,
                        warnings,
                        item['initials'] or item['lunch_number'],
                    )
                    success.append(
                        {
                            'initials': item['initials'],
                            'username': item['username'],
                            'password': item['password'],
                            'lunch_number': item['lunch_number'],
                            'grade': item['grade'],
                        }
                    )

            db.session.commit()
            return jsonify(_import_users_payload(success, errors, warnings, updated_names, duplicate_count)), 200
        except Exception as e:
            db.session.rollback()
            app.logger.exception('Student CSV import failed')
            return jsonify({'error': f'Import failed: {_import_exception_message(e)}'}), 500

    else:
        return jsonify({'error': 'Invalid import type'}), 400


# ----- Google Sheets sync (students) -----
# Expected sheet columns (first row = headers): Name, Email, Grade, Card Color, Lunch Number
# Lunch Number is used as the unique key for update vs create. See GOOGLE_SHEETS_SYNC_README.md for setup.

def _get_google_sheets_client():
    """Build a gspread client from env: GOOGLE_SHEETS_CREDENTIALS_JSON (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (path)."""
    if not _GOOGLE_SHEETS_AVAILABLE:
        return None, 'Google Sheets libraries not installed. Add gspread and google-auth to requirements.txt.'
    creds_json = os.environ.get('GOOGLE_SHEETS_CREDENTIALS_JSON')
    creds_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if creds_json:
        try:
            info = json.loads(creds_json)
            creds = Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
            client = gspread.authorize(creds)
            return client, None
        except Exception as e:
            return None, f'Invalid GOOGLE_SHEETS_CREDENTIALS_JSON: {e}'
    if creds_path and os.path.isfile(creds_path):
        try:
            creds = Credentials.from_service_account_file(creds_path, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
            client = gspread.authorize(creds)
            return client, None
        except Exception as e:
            return None, f'Failed to load credentials from file: {e}'
    return None, 'Set GOOGLE_SHEETS_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS.'


def _normalize_header(h):
    """Normalize header for column mapping: strip, lower, replace spaces with underscores."""
    if h is None:
        return ''
    return str(h).strip().lower().replace(' ', '_').replace('-', '_')


def sync_students_from_google_sheet(sheet_id=None, worksheet_name_or_index=None):
    """
    Read students from a Google Sheet and upsert into Student table.
    Sheet must have header row. Columns (case-insensitive): Name, Email, Grade, Card Color, Lunch Number.
    Lunch Number is the unique key; rows with same Lunch Number update existing student.
    Returns: dict with created, updated, errors (list of strings).
    """
    sheet_id = sheet_id or os.environ.get('GOOGLE_SHEET_ID')
    if not sheet_id:
        return {'created': 0, 'updated': 0, 'errors': ['GOOGLE_SHEET_ID not set.']}
    client, err = _get_google_sheets_client()
    if err:
        return {'created': 0, 'updated': 0, 'errors': [err]}
    try:
        workbook = client.open_by_key(sheet_id)
        if worksheet_name_or_index is not None:
            if isinstance(worksheet_name_or_index, int):
                worksheet = workbook.get_worksheet(worksheet_name_or_index)
            else:
                worksheet = workbook.worksheet(worksheet_name_or_index)
        else:
            worksheet = workbook.sheet1
        rows = worksheet.get_all_values()
    except Exception as e:
        return {'created': 0, 'updated': 0, 'errors': [f'Could not open sheet: {e}']}
    if not rows:
        return {'created': 0, 'updated': 0, 'errors': ['Sheet is empty.']}
    headers = [_normalize_header(r) for r in rows[0]]
    name_col = next((i for i, h in enumerate(headers) if h in ('name', 'student_name')), None)
    email_col = next((i for i, h in enumerate(headers) if h == 'email'), None)
    grade_col = next((i for i, h in enumerate(headers) if h == 'grade'), None)
    card_color_col = next((i for i, h in enumerate(headers) if h in ('card_color', 'cardcolor')), None)
    lunch_number_col = next((i for i, h in enumerate(headers) if h in ('lunch_number', 'lunchnumber')), None)
    if name_col is None:
        return {'created': 0, 'updated': 0, 'errors': ['Sheet must have a "Name" (or "Student Name") column.']}
    created = 0
    updated = 0
    errors = []
    for row_index, row in enumerate(rows[1:], start=2):
        name = (row[name_col] or '').strip() if name_col is not None and len(row) > name_col else ''
        if not name:
            continue
        email = (row[email_col] or '').strip() if email_col is not None and len(row) > email_col else None
        grade = (row[grade_col] or '').strip() if grade_col is not None and len(row) > grade_col else None
        card_color = (row[card_color_col] or '').strip() or None if card_color_col is not None and len(row) > card_color_col else None
        lunch_number = (row[lunch_number_col] or '').strip() or None if lunch_number_col is not None and len(row) > lunch_number_col else None
        try:
            if lunch_number:
                existing = Student.query.filter_by(lunch_number=lunch_number).first()
            else:
                existing = None
            if existing:
                existing.name = name
                if email is not None:
                    existing.email = email or None
                if grade is not None:
                    existing.grade = grade or None
                if card_color is not None:
                    existing.card_color = card_color
                if lunch_number is not None:
                    existing.lunch_number = lunch_number
                updated += 1
            else:
                student = Student(
                    name=name,
                    email=email or None,
                    grade=grade or None,
                    card_color=card_color,
                    lunch_number=lunch_number,
                )
                db.session.add(student)
                created += 1
        except Exception as e:
            errors.append(f'Row {row_index} ({name}): {e}')
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        errors.append(f'Commit failed: {e}')
    return {'created': created, 'updated': updated, 'errors': errors}


@app.route('/api/admin/sync-google-sheet', methods=['POST'])
@admin_required
def api_sync_google_sheet():
    """Trigger sync of students from the configured Google Sheet. Admin only."""
    sheet_id = request.json.get('sheet_id') if request.is_json else None
    worksheet = request.json.get('worksheet') if request.is_json else None
    result = sync_students_from_google_sheet(sheet_id=sheet_id, worksheet_name_or_index=worksheet)
    return jsonify(result), 200


@app.route('/api/frenzy-stats', methods=['GET'])
@login_required
def frenzy_stats():
    student_id = request.args.get('student_id', type=int)
    period = request.args.get('period', None)
    timeframe = request.args.get('timeframe', None)  # "30day", "month", "quarter", "year", "alltime"
    staff_id = request.args.get('staff_id', type=int)
    staff_context_name = None
    
    # Audit: Log frenzy stats access
    log_phi_access(
        action='VIEW',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='frenzy_stats',
        resource_id=student_id,
        details=f"Timeframe: {timeframe or period}",
        ip_address=get_remote_address()
    )
    
    # If period is specified, ignore timeframe
    if period:
        timeframe = None
    elif not timeframe:
        timeframe = 'alltime'  # Default if neither is specified
    
    # Get quarter and school year dates from request (sent by frontend)
    quarter_dates_json = request.args.get('quarter_dates', '{}')
    school_year_dates_json = request.args.get('school_year_dates', '{}')
    
    try:
        quarter_dates = json.loads(quarter_dates_json) if quarter_dates_json else {}
        school_year_dates = json.loads(school_year_dates_json) if school_year_dates_json else {}
    except:
        quarter_dates = {}
        school_year_dates = {}
    
    # Default quarter date ranges if not provided
    quarter_ranges = {}
    for q_num in ['1', '2', '3', '4']:
        if q_num in quarter_dates and isinstance(quarter_dates[q_num], dict):
            quarter_ranges[q_num] = {
                'start': quarter_dates[q_num].get('start', '08-01'),
                'end': quarter_dates[q_num].get('end', '10-31')
            }
        else:
            # Defaults
            defaults = {
                '1': {'start': '08-01', 'end': '10-31'},
                '2': {'start': '11-01', 'end': '01-31'},
                '3': {'start': '02-01', 'end': '04-30'},
                '4': {'start': '05-01', 'end': '07-31'}
            }
            quarter_ranges[q_num] = defaults[q_num]
    
    # Default school year dates if not provided
    school_year_start = school_year_dates.get('start', '08-01')
    school_year_end = school_year_dates.get('end', '07-31')
    
    query = DailyRecord.query
    
    # Check if filtering by "managed by me"
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    
    _empty_frenzy = {
        'by_day': {}, 'by_time': {}, 'by_location': {}, 'by_purpose': {},
        'total_count': 0, 'total_duration': 0, 'avg_duration': 0,
        'all_purposes': [], 'all_results': []
    }
    
    # If staff_id is provided and the current user has permission, filter to that staff member's students
    if staff_id and current_user.role in ['staff', 'admin']:
        staff_user = User.query.get(staff_id)
        if staff_user:
            staff_context_name = staff_user.name or staff_user.username
            staff_name = staff_user.name or ''
            staff_username = staff_user.username or ''
            team_members = TeamMember.query.filter(
                (db.func.lower(TeamMember.name) == db.func.lower(staff_name)) |
                (db.func.lower(TeamMember.name) == db.func.lower(staff_username))
            ).all()
            staff_student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
            if staff_student_ids:
                if student_id:
                    if student_id in staff_student_ids:
                        query = query.filter_by(student_id=student_id)
                    else:
                        resp = dict(_empty_frenzy)
                        resp['staff_context'] = staff_context_name
                        return jsonify(resp)
                else:
                    query = query.filter(DailyRecord.student_id.in_(staff_student_ids))
            else:
                resp = dict(_empty_frenzy)
                resp['staff_context'] = staff_context_name
                return jsonify(resp)
    # Students can only see their own frenzy stats
    elif current_user.role == 'student':
        if current_user.student_id:
            query = query.filter_by(student_id=current_user.student_id)
        else:
            return jsonify(_empty_frenzy)
    elif current_user.role == 'staff' and current_user.is_outside_staff:
        # Outside Staff can only see assigned students
        assigned_student_ids = [assoc.student_id for assoc in 
                              OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
        if not assigned_student_ids:
            return jsonify({
                'by_day': {},
                'by_time': {},
                'by_location': {},
                'by_purpose': {},
                'total_count': 0,
                'total_duration': 0,
                'avg_duration': 0,
                'all_purposes': [],
                'all_results': []
            })
        if student_id:
            # Verify access to requested student
            if student_id not in assigned_student_ids:
                return jsonify({'error': 'Access denied to this student'}), 403
            query = query.filter_by(student_id=student_id)
        else:
            query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
    elif student_id:
        query = query.filter_by(student_id=student_id)
        # If managed_by_me is checked, verify the student is managed by current user
        if managed_by_me:
            # Check both name and username since team members might be stored with either
            user_name = (current_user.name or current_user.username or '').strip()
            user_username = (current_user.username or '').strip()
            team_member = TeamMember.query.filter(
                TeamMember.student_id == student_id,
                db.or_(
                    db.func.lower(TeamMember.name) == db.func.lower(user_name),
                    db.func.lower(TeamMember.name) == db.func.lower(user_username),
                ),
            ).first()
            if not team_member:
                # Student is not managed by this user, return empty stats
                return jsonify({
                    'by_day': {},
                    'by_time': {},
                    'by_location': {},
                    'by_purpose': {},
                    'total_count': 0,
                    'total_duration': 0,
                    'avg_duration': 0,
                    'all_purposes': [],
                    'all_results': []
                })
    elif managed_by_me:
        # Filter to only students managed by current user (case-insensitive match on support team name)
        user_name = (current_user.name or current_user.username or '').strip()
        user_username = (current_user.username or '').strip()
        team_members = TeamMember.query.filter(
            db.or_(
                db.func.lower(TeamMember.name) == db.func.lower(user_name),
                db.func.lower(TeamMember.name) == db.func.lower(user_username),
            )
        ).all()
        student_ids = list({tm.student_id for tm in team_members if tm.student_id})
        if student_ids:
            query = query.filter(DailyRecord.student_id.in_(student_ids))
        else:
            # No students managed by this user, return empty stats
            return jsonify({
                'by_day': {},
                'by_time': {},
                'by_location': {},
                'by_purpose': {},
                'total_count': 0,
                'total_duration': 0,
                'avg_duration': 0,
                'all_purposes': [],
                'all_results': []
            })

    # For staff/admin views, restrict to active students only (students with a User account role='student')
    if current_user.role in ['staff', 'admin'] or (current_user.role == 'staff' and current_user.is_outside_staff):
        student_users = User.query.filter_by(role='student').all()
        active_student_ids = {u.student_id for u in student_users if u.student_id}
        if not active_student_ids:
            return jsonify({
                'by_day': {},
                'by_time': {},
                'by_location': {},
                'by_purpose': {},
                'total_count': 0,
                'total_duration': 0,
                'avg_duration': 0,
                'all_purposes': [],
                'all_results': []
            })
        query = query.filter(DailyRecord.student_id.in_(active_student_ids))
    
    # Eager-load related data to avoid N+1 queries while aggregating frenzy stats.
    all_records = query.options(
        selectinload(DailyRecord.periods).selectinload(PeriodRecord.infractions),
        selectinload(DailyRecord.frenzies),
    ).all()
    # Keep a handle to all rows (including excused) for 30 "present school day" windows.
    frenzy_records_raw = all_records

    # Filter out excused records (they should be saved but excluded from calculations).
    # Do not commit inside this read endpoint; treat missing attendance_status in-memory.
    filtered_records = []
    for record in all_records:
        # Backfill attendance status in-memory for consistent calculations.
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'

        # Exclude excused records from calculations
        if record.attendance_status != 'excused':
            filtered_records.append(record)

    all_records = filtered_records
    
    # Helper function to check if a date is in a month-day range (handles year boundaries)
    def date_in_range(record_date, start_md, end_md):
        start_month, start_day = map(int, start_md.split('-'))
        end_month, end_day = map(int, end_md.split('-'))
        month = record_date.month
        day = record_date.day
        
        if start_month <= end_month:
            # Range within same year
            if month == start_month and day >= start_day:
                return True
            elif month > start_month and month < end_month:
                return True
            elif month == end_month and day <= end_day:
                return True
        else:
            # Range crosses year boundary
            if month == start_month and day >= start_day:
                return True
            elif month > start_month:
                return True
            elif month <= end_month:
                if month < end_month or (month == end_month and day <= end_day):
                    return True
        return False
    
    # Helper function to get which quarter a date belongs to
    def get_quarter_for_date(record_date):
        for q_num in ['1', '2', '3', '4']:
            q_info = quarter_ranges.get(q_num, {})
            q_start = q_info.get('start', '08-01')
            q_end = q_info.get('end', '10-31')
            if date_in_range(record_date, q_start, q_end):
                return q_num
        return None
    
    # Helper function to get school year for a date (August to August)
    def get_school_year_for_date(record_date):
        """Returns school year string like '2025-2026' for a given date.
        School year runs from August 1 to July 31."""
        year = record_date.year
        month = record_date.month
        if month >= 8:  # August to December
            return f"{year}-{year + 1}"
        else:  # January to July
            return f"{year - 1}-{year}"
    
    # Helper function to format month name
    def format_month_name(year, month):
        """Returns formatted string like 'January 25'."""
        month_names = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December']
        year_short = str(year)[-2:]  # Last 2 digits of year
        return f"{month_names[month - 1]} {year_short}"
    
    # Helper function to get available school years from records
    def get_available_school_years(records):
        """Returns sorted list of unique school years present in the data."""
        school_years = set()
        for record in records:
            school_year = get_school_year_for_date(record.date)
            school_years.add(school_year)
        return sorted(school_years)
    
    # Helper function to calculate frenzy stats for a set of records
    def calculate_frenzy_stats(record_list):
        stats = {
            'by_day': {},
            'by_time': {},
            'by_location': {},
            'by_purpose': {},
            'total_count': 0,
            'total_duration': 0
        }
        
        # Weekdays only (Monday-Friday)
        weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        
        all_purposes = []
        all_results = []
        
        for record in record_list:
            # Process frenzies from FrenzyEvent table
            for frenzy in record.frenzies:
                stats['total_count'] += 1
                stats['total_duration'] += frenzy.duration_minutes or 0
                
                # By day of week (weekdays only)
                day = record.day_of_week
                if day in weekdays:
                    if day not in stats['by_day']:
                        stats['by_day'][day] = {'count': 0, 'duration': 0}
                    stats['by_day'][day]['count'] += 1
                    stats['by_day'][day]['duration'] += frenzy.duration_minutes or 0
                
                # By time
                time_range = frenzy.time_range or FRENZY_MISSING_LABEL
                if time_range not in stats['by_time']:
                    stats['by_time'][time_range] = {'count': 0, 'duration': 0}
                stats['by_time'][time_range]['count'] += 1
                stats['by_time'][time_range]['duration'] += frenzy.duration_minutes or 0
                
                # By location
                location = frenzy_location_label(frenzy.location)
                if location not in stats['by_location']:
                    stats['by_location'][location] = {'count': 0, 'duration': 0}
                stats['by_location'][location]['count'] += 1
                stats['by_location'][location]['duration'] += frenzy.duration_minutes or 0
                
                # By purpose
                purpose = frenzy.purpose or FRENZY_MISSING_LABEL
                if purpose not in stats['by_purpose']:
                    stats['by_purpose'][purpose] = {'count': 0, 'duration': 0}
                stats['by_purpose'][purpose]['count'] += 1
                stats['by_purpose'][purpose]['duration'] += frenzy.duration_minutes or 0
                
                # Collect purposes and results
                if frenzy.purpose and frenzy.purpose.strip():
                    all_purposes.append(frenzy.purpose.strip())
                if frenzy.purpose2 and frenzy.purpose2.strip():
                    all_purposes.append(frenzy.purpose2.strip())
                if frenzy.result and frenzy.result.strip():
                    all_results.append(frenzy.result.strip())
            
            # Also process frenzies from INFO column in periods
            for period in record.periods:
                if period.info:
                    try:
                        info_data = json.loads(period.info)
                        frenzy = info_data.get('frenzy', False)
                        if frenzy and frenzy not in [False, None, '', 'false', 'False', '0', 0]:
                            stats['total_count'] += 1
                            duration = 0
                            try:
                                duration = int(info_data.get('duration', 0))
                            except (ValueError, TypeError):
                                duration = 0
                            stats['total_duration'] += duration
                            
                            # By day of week (weekdays only)
                            day = record.day_of_week
                            if day in weekdays:
                                if day not in stats['by_day']:
                                    stats['by_day'][day] = {'count': 0, 'duration': 0}
                                stats['by_day'][day]['count'] += 1
                                stats['by_day'][day]['duration'] += duration
                            
                            # By location - check INFO column first, then period.location
                            location = info_data.get('location') or info_data.get('alternate_location')
                            if not location or (isinstance(location, str) and not location.strip()):
                                location = frenzy_location_label(period.location)
                            else:
                                location = frenzy_location_label(location)
                            
                            if location not in stats['by_location']:
                                stats['by_location'][location] = {'count': 0, 'duration': 0}
                            stats['by_location'][location]['count'] += 1
                            stats['by_location'][location]['duration'] += duration
                            
                            # Collect purposes from INFO column
                            info_purpose_labels = frenzy_purpose_labels_from_info(info_data)
                            for purpose_str in info_purpose_labels:
                                all_purposes.append(purpose_str)
                                if purpose_str not in stats['by_purpose']:
                                    stats['by_purpose'][purpose_str] = {'count': 0, 'duration': 0}
                                stats['by_purpose'][purpose_str]['count'] += 1
                                stats['by_purpose'][purpose_str]['duration'] += duration
                            
                            # Collect results from INFO column
                            results = info_data.get('results')
                            if results and str(results).strip():
                                all_results.append(str(results).strip())
                                
                    except (json.JSONDecodeError, ValueError, TypeError):
                        pass
        
        # Calculate averages
        for key in ['by_day', 'by_time', 'by_location', 'by_purpose']:
            for item_key, item_data in stats[key].items():
                if item_data['count'] > 0:
                    item_data['avg_duration'] = item_data['duration'] / item_data['count']
                else:
                    item_data['avg_duration'] = 0
        
        if stats['total_count'] > 0:
            stats['avg_duration'] = stats['total_duration'] / stats['total_count']
        else:
            stats['avg_duration'] = 0
        
        stats['all_purposes'] = all_purposes
        stats['all_results'] = all_results
        
        return stats
    
    # Filter by period if specified (takes precedence over timeframe)
    if period:
        from datetime import date
        today = date.today()
        current_school_year = get_school_year_for_date(today)
        
        filtered_records = []
        available_data_points = None
        
        if period == '30day':
            # Last 30 calendar days on which this cohort had at least one present row (same as /api/summary behavior metrics).
            ud_present = _unique_dates_present_school_days(frenzy_records_raw)
            selected_dates = ud_present[:30]
            available_data_points = len(selected_dates)
            selected_date_set = set(selected_dates)
            filtered_records = [
                r for r in all_records
                if r.date in selected_date_set and _record_attendance_status_norm(r) == 'present'
            ]
        else:
            for record in all_records:
                record_school_year = get_school_year_for_date(record.date)
                
                if period == 'current_year':
                    # Current school year only
                    if record_school_year == current_school_year:
                        filtered_records.append(record)
                elif period == 'quarter1':
                    # Quarter 1
                    q_num = get_quarter_for_date(record.date)
                    if q_num == '1' and record_school_year == current_school_year:
                        filtered_records.append(record)
                elif period == 'quarter2':
                    # Quarter 2
                    q_num = get_quarter_for_date(record.date)
                    if q_num == '2' and record_school_year == current_school_year:
                        filtered_records.append(record)
                elif period == 'quarter3':
                    # Quarter 3
                    q_num = get_quarter_for_date(record.date)
                    if q_num == '3' and record_school_year == current_school_year:
                        filtered_records.append(record)
                elif period == 'quarter4':
                    # Quarter 4
                    q_num = get_quarter_for_date(record.date)
                    if q_num == '4' and record_school_year == current_school_year:
                        filtered_records.append(record)
                elif period == 'all_time':
                    # All records (no filtering)
                    filtered_records.append(record)
                elif period == 'previous_years':
                    # All school years except current
                    if record_school_year != current_school_year:
                        filtered_records.append(record)
        
        all_records = filtered_records
        # Calculate single summary for period
        stats = calculate_frenzy_stats(all_records)
        stats['comparison_mode'] = False
        # Add data points info for 30day period
        if period == '30day' and available_data_points is not None:
            stats['available_data_points'] = available_data_points
            stats['has_full_30_days'] = available_data_points >= 30
        if staff_context_name:
            stats['staff_context'] = staff_context_name
        return jsonify(stats)

    def _frenzy_response(resp_dict):
        if staff_context_name:
            resp_dict['staff_context'] = staff_context_name
        return jsonify(resp_dict)
    
    # Filter by timeframe and handle comparison modes
    if timeframe == '30day':
        ud_present = _unique_dates_present_school_days(frenzy_records_raw)
        selected_dates = ud_present[:30]
        available_data_points = len(selected_dates)
        selected_date_set = set(selected_dates)
        records = [
            r for r in all_records
            if r.date in selected_date_set and _record_attendance_status_norm(r) == 'present'
        ]
        stats = calculate_frenzy_stats(records)
        stats['comparison_mode'] = False
        stats['available_data_points'] = available_data_points
        stats['has_full_30_days'] = available_data_points >= 30
        return _frenzy_response(stats)
    elif timeframe == '30day_to_30day':
        ud_present = _unique_dates_present_school_days(frenzy_records_raw)
        total_available_dates = len(ud_present)
        most_recent_dates = ud_present[:30]
        previous_dates = ud_present[30:60] if len(ud_present) > 30 else []
        most_recent_data_points = len(most_recent_dates)
        previous_data_points = len(previous_dates)
        mr_set, pr_set = set(most_recent_dates), set(previous_dates)
        most_recent_records = [
            r for r in all_records
            if r.date in mr_set and _record_attendance_status_norm(r) == 'present'
        ]
        previous_records = [
            r for r in all_records
            if r.date in pr_set and _record_attendance_status_norm(r) == 'present'
        ]
        most_recent_stats = calculate_frenzy_stats(most_recent_records)
        previous_stats = calculate_frenzy_stats(previous_records)
        most_recent_stats['available_data_points'] = most_recent_data_points
        most_recent_stats['has_full_30_days'] = most_recent_data_points >= 30
        previous_stats['available_data_points'] = previous_data_points
        previous_stats['has_full_30_days'] = previous_data_points >= 30
        comparison_data = {
            'Most Recent 30 Days': most_recent_stats,
            'Previous 30 Days': previous_stats
        }
        return _frenzy_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'month':
        from collections import defaultdict
        from datetime import date
        school_year_param = request.args.get('school_year', None)
        if not school_year_param:
            today = date.today()
            school_year_param = get_school_year_for_date(today)
        filtered_records = []
        for record in all_records:
            record_school_year = get_school_year_for_date(record.date)
            if record_school_year == school_year_param:
                filtered_records.append(record)
        month_groups = defaultdict(list)
        for record in filtered_records:
            month_key = format_month_name(record.date.year, record.date.month)
            month_groups[month_key].append(record)
        sorted_months = sorted(month_groups.keys(), key=lambda x: (
            int('20' + x.split()[-1]),
            ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December'].index(x.split()[0])
        ))
        comparison_data = {}
        for month_key in sorted_months:
            month_stats = calculate_frenzy_stats(month_groups[month_key])
            comparison_data[month_key] = month_stats
        available_school_years = get_available_school_years(all_records)
        return _frenzy_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data,
            'available_school_years': available_school_years,
            'selected_school_year': school_year_param
        })
    elif timeframe == 'quarter':
        from collections import defaultdict
        quarter_groups = defaultdict(list)
        for record in all_records:
            q_num = get_quarter_for_date(record.date)
            if q_num:
                year = record.date.year
                q_info = quarter_ranges.get(q_num, {})
                q_start = q_info.get('start', '08-01')
                start_month = int(q_start.split('-')[0])
                if record.date.month < start_month and q_num == '2':
                    year = record.date.year - 1
                quarter_key = f"Q{q_num} {year}"
                quarter_groups[quarter_key].append(record)
        sorted_quarters = sorted(quarter_groups.keys(), key=lambda x: (int(x.split()[1]), int(x[1])))
        comparison_data = {}
        for quarter_key in sorted_quarters:
            quarter_stats = calculate_frenzy_stats(quarter_groups[quarter_key])
            comparison_data[quarter_key] = quarter_stats
        return _frenzy_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'year':
        from collections import defaultdict
        year_groups = defaultdict(list)
        for record in all_records:
            if record.date.month >= 8:
                school_year = f"{record.date.year}-{record.date.year + 1}"
            else:
                school_year = f"{record.date.year - 1}-{record.date.year}"
            if date_in_range(record.date, school_year_start, school_year_end):
                year_groups[school_year].append(record)
        sorted_years = sorted(year_groups.keys())
        comparison_data = {}
        for year_key in sorted_years:
            year_stats = calculate_frenzy_stats(year_groups[year_key])
            comparison_data[year_key] = year_stats
        return _frenzy_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    elif timeframe == 'custom_range':
        # Custom explicit date range (from X date to Y date)
        start_str = request.args.get('start_date')
        end_str = request.args.get('end_date')
        from datetime import datetime
        try:
            start = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
            end = datetime.strptime(end_str, '%Y-%m-%d').date() if end_str else None
        except Exception:
            return _frenzy_response({
                'timeframe': timeframe,
                'comparison_mode': True,
                'periods': {}
            })
        if not start or not end or start > end:
            return _frenzy_response({
                'timeframe': timeframe,
                'comparison_mode': True,
                'periods': {}
            })

        records = [r for r in all_records if start <= r.date <= end]
        stats = calculate_frenzy_stats(records)
        label = f"{start.isoformat()} to {end.isoformat()}"
        comparison_data = {label: stats}

        return _frenzy_response({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    else:
        records = all_records
        stats = calculate_frenzy_stats(records)
        stats['comparison_mode'] = False
        return _frenzy_response(stats)

@app.route('/api/schedules', methods=['GET', 'POST'])
@login_required
def schedules():
    """Get or save schedules"""
    if request.method == 'POST':
        try:
            # Only staff and admin can save schedules
            if current_user.role not in ['staff', 'admin']:
                return jsonify({'error': 'Permission denied'}), 403
            data = request.json
            schedule_type = data.get('schedule_type')  # 'teacher' or 'student'
            student_id = data.get('student_id')  # Only for student schedules
            teacher_user_id = data.get('user_id')  # Optional: for teacher schedule, which user to save (admin only)
            periods = data.get('periods', [])
            
            # Validate schedule_type
            if schedule_type not in ['teacher', 'student']:
                return jsonify({'error': 'Invalid schedule_type. Must be "teacher" or "student"'}), 400
            
            # Validate periods data
            normalized_periods = []
            for index, period in enumerate(periods):
                time_period = period.get('time_period', '').strip()
                if not time_period:
                    return jsonify({'error': f'Time period is required for period {index + 1}'}), 400
                normalized_periods.append(_period_payload_from_request(period))
            
            # Delete existing schedules
            target_user_id = current_user.id  # for teacher schedule
            is_outside = current_user.role == 'staff' and current_user.is_outside_staff
            if schedule_type == 'teacher':
                if is_outside:
                    return jsonify({'error': 'Outside staff cannot save teacher schedules'}), 403
                # Staff can only save their own; admin can save for any user via user_id
                if teacher_user_id is not None:
                    if current_user.role != 'admin':
                        return jsonify({'error': 'Only admin can save another user\'s teacher schedule'}), 403
                    target_user_id = int(teacher_user_id)
                Schedule.query.filter_by(schedule_type='teacher', user_id=target_user_id).delete()
                for index, period in enumerate(normalized_periods):
                    db.session.add(_create_schedule_row(
                        'teacher',
                        user_id=target_user_id,
                        student_id=None,
                        period=period,
                        sort_order=index,
                    ))
            else:
                if not student_id:
                    return jsonify({'error': 'student_id is required for student schedules'}), 400
                if is_outside and not has_student_access(current_user, student_id):
                    return jsonify({'error': 'Access denied to this student'}), 403
                existing_rows = (
                    Schedule.query
                    .filter_by(schedule_type='student', student_id=student_id)
                    .order_by(Schedule.sort_order, Schedule.id)
                    .all()
                )
                transition = _get_student_transition(student_id)
                if is_outside and not transition:
                    return jsonify({'error': 'Set a transition before editing the other-school schedule'}), 403

                # Group payload entries by time_period (preserve multi-entry + order)
                payload_by_period = {}
                payload_order = []
                for period in normalized_periods:
                    time_period = period['time_period']
                    if time_period not in payload_by_period:
                        payload_order.append(time_period)
                        payload_by_period[time_period] = []
                    payload_by_period[time_period].append(period)

                existing_by_period = {}
                existing_order = []
                for row in existing_rows:
                    if row.time_period not in existing_by_period:
                        existing_order.append(row.time_period)
                        existing_by_period[row.time_period] = []
                    existing_by_period[row.time_period].append(_period_payload_from_row(row))

                if transition:
                    merged = []
                    seen = set()
                    for time_period in existing_order + payload_order:
                        if time_period in seen:
                            continue
                        seen.add(time_period)
                        owns = user_can_write_student_period(current_user, student_id, time_period)
                        if owns:
                            incoming = payload_by_period.get(time_period)
                            if incoming is not None:
                                if incoming:
                                    merged.extend(incoming)
                                else:
                                    merged.append({
                                        'time_period': time_period,
                                        'class_name': None,
                                        'staff_name': None,
                                        'recurrence_type': 'daily',
                                        'weekdays': [],
                                        'month_ordinal': None,
                                        'biweekly_anchor': None,
                                        'effective_start': None,
                                        'effective_end': None,
                                    })
                            # If period omitted from payload, clear owned entries
                        else:
                            for existing in existing_by_period.get(time_period, []):
                                merged.append(existing)
                    Schedule.query.filter_by(schedule_type='student', student_id=student_id).delete()
                    for index, period in enumerate(merged):
                        db.session.add(_create_schedule_row(
                            'student',
                            user_id=None,
                            student_id=student_id,
                            period=period,
                            sort_order=index,
                        ))
                else:
                    Schedule.query.filter_by(schedule_type='student', student_id=student_id).delete()
                    for index, period in enumerate(normalized_periods):
                        db.session.add(_create_schedule_row(
                            'student',
                            user_id=None,
                            student_id=student_id,
                            period=period,
                            sort_order=index,
                        ))
            
            db.session.commit()
            return jsonify({'message': 'Schedule saved successfully'}), 200
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Error saving schedule: {str(e)}', exc_info=True)
            return jsonify({'error': f'Error saving schedule: {str(e)}'}), 500
    
    else:
        # GET request
        schedule_type = request.args.get('schedule_type', 'teacher')
        student_id = request.args.get('student_id', type=int)
        teacher_user_id = request.args.get('user_id', type=int)  # For teacher schedule: whose schedule to load

        # Students may only read their own student schedule (used by Period Entry).
        if current_user.role == 'student':
            if schedule_type != 'student' or not current_user.student_id:
                return jsonify({'error': 'Permission denied'}), 403
            if student_id is not None and student_id != current_user.student_id:
                return jsonify({'error': 'Permission denied'}), 403
            student_id = current_user.student_id
        
        query = Schedule.query.filter_by(schedule_type=schedule_type)
        if schedule_type == 'teacher':
            # Whose teacher schedule to return:
            # - Staff/admin: can view any staff member's schedule via user_id
            # - Default (no user_id): return current user's schedule
            if teacher_user_id is not None:
                if current_user.role not in ['staff', 'admin']:
                    return jsonify({'error': 'Permission denied'}), 403
                query = query.filter_by(user_id=teacher_user_id)
            else:
                if current_user.role not in ['staff', 'admin']:
                    return jsonify({'error': 'Permission denied'}), 403
                query = query.filter_by(user_id=current_user.id)
        elif schedule_type == 'student' and student_id:
            if current_user.role == 'staff' and current_user.is_outside_staff:
                if not has_student_access(current_user, student_id):
                    return jsonify({'error': 'Access denied to this student'}), 403
            query = query.filter_by(student_id=student_id)
        
        # Order by sort_order to maintain the saved order
        schedules = query.order_by(Schedule.sort_order).all()
        
        result = [_serialize_schedule_row(s) for s in schedules]

        if schedule_type == 'student' and student_id:
            return jsonify({
                'periods': result,
                'transition': _serialize_student_transition(_get_student_transition(student_id)),
            })
        
        return jsonify(result)

@app.route('/api/students/<int:student_id>/transition', methods=['GET', 'POST', 'DELETE'])
@login_required
def student_transition(student_id):
    """Get, set, or remove a student's arrive/leave split."""
    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    if not has_student_access(current_user, student_id) and current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    if current_user.role == 'staff' and current_user.is_outside_staff:
        if not has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied to this student'}), 403

    if request.method == 'GET':
        return jsonify({'transition': _serialize_student_transition(_get_student_transition(student_id))})

    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Permission denied'}), 403
    if not user_can_edit_student_transition(current_user, student_id):
        return jsonify({'error': 'Permission denied'}), 403

    if request.method == 'DELETE':
        existing = _get_student_transition(student_id)
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return jsonify({'message': 'Transition removed', 'transition': None})

    data = request.json or {}
    direction = (data.get('direction') or '').strip().lower()
    if direction not in ('arrive', 'leave'):
        return jsonify({'error': 'direction must be "arrive" or "leave"'}), 400
    time_value = _normalize_transition_time(data.get('time'))
    if not time_value:
        return jsonify({'error': 'A valid time is required (e.g. 10:00)'}), 400

    existing = _get_student_transition(student_id)
    if existing:
        existing.direction = direction
        existing.time = time_value
        existing.updated_by = current_user.id
        existing.updated_at = datetime.utcnow()
    else:
        existing = StudentTransition(
            student_id=student_id,
            direction=direction,
            time=time_value,
            updated_by=current_user.id,
        )
        db.session.add(existing)
    db.session.commit()
    return jsonify({
        'message': 'Transition saved',
        'transition': _serialize_student_transition(existing),
    })

@app.route('/api/schedules/locations', methods=['GET'])
@login_required
def get_schedule_locations():
    """Get list of unique class names from teacher schedules"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    # Query all teacher schedules and get unique class_name values
    schedules = Schedule.query.filter_by(schedule_type='teacher').all()
    
    # Extract unique class_name values (excluding None/empty)
    locations = set()
    for schedule in schedules:
        if schedule.class_name and schedule.class_name.strip():
            locations.add(schedule.class_name.strip())
    
    # Return as sorted list
    return jsonify(sorted(list(locations)))

@app.route('/api/schedules/bulk', methods=['GET'])
@login_required
def bulk_student_schedules():
    """Return student schedules grouped by student, for printing."""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403

    student_id = request.args.get('student_id', type=int)
    student_ids_param = request.args.get('student_ids', '')
    staff_id = request.args.get('staff_id', type=int)
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    print_all = request.args.get('all', 'false').lower() == 'true'
    grade_filter = (request.args.get('grade') or '').strip()
    card_color_filter = (request.args.get('card_color') or '').strip().lower()

    has_scope = bool(
        student_id
        or (student_ids_param and student_ids_param.strip())
        or staff_id
        or managed_by_me
        or print_all
        or grade_filter
        or card_color_filter
    )
    if not has_scope:
        return jsonify({'items': []})

    student_ids = _resolve_student_scope(
        student_id=student_id,
        student_ids_param=student_ids_param,
        staff_id=staff_id,
        managed_by_me=bool(managed_by_me and not staff_id and not student_id and not (student_ids_param or '').strip()),
    )
    if not student_ids:
        return jsonify({'items': []})

    students = (
        Student.query.filter(Student.id.in_(student_ids))
        .order_by(Student.name)
        .all()
    )

    active_student_ids = {
        u.student_id for u in User.query.filter_by(role='student').all() if u.student_id
    }
    students = [s for s in students if s.id in active_student_ids]

    if grade_filter:
        wanted = grade_filter.lower()
        students = [s for s in students if (s.grade or '').strip().lower() == wanted]
    if card_color_filter:
        students = [
            s for s in students
            if (s.card_color or '').strip().lower() == card_color_filter
        ]

    students = students[:500]
    if not students:
        return jsonify({'items': []})

    schedules = (
        Schedule.query.filter(
            Schedule.schedule_type == 'student',
            Schedule.student_id.in_([s.id for s in students]),
        )
        .order_by(Schedule.sort_order, Schedule.id)
        .all()
    )

    periods_by_student = {}
    for schedule in schedules:
        periods_by_student.setdefault(schedule.student_id, []).append(
            _serialize_schedule_row(schedule)
        )

    transitions = _transitions_by_student_id([student.id for student in students])

    items = [{
        'student_id': student.id,
        'name': student.name,
        'grade': student.grade,
        'card_color': student.card_color,
        'periods': periods_by_student.get(student.id, []),
        'transition': _serialize_student_transition(transitions.get(student.id)),
    } for student in students]

    return jsonify({'items': items})

@app.route('/api/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
@login_required
def manage_users():
    """Manage user accounts"""
    if request.method == 'GET':
        # Admin can see all users, staff can see all users (read-only), students can only see themselves
        if current_user.role == 'admin':
            users = User.query.all()
        elif current_user.role == 'staff':
            # Staff can see all users (read-only access)
            users = User.query.all()
        else:
            # Students can only see themselves
            users = [current_user]
        users = [u for u in users if not getattr(u, 'hidden_from_management', False)]
        
        # Batch load related data to avoid N+1 queries
        student_ids = list({u.student_id for u in users if u.student_id})
        students_by_id = {}
        if student_ids:
            for s in Student.query.filter(Student.id.in_(student_ids)).all():
                students_by_id[s.id] = s
        team_by_student = {}
        if student_ids:
            for tm in TeamMember.query.filter(TeamMember.student_id.in_(student_ids)).all():
                team_by_student.setdefault(tm.student_id, []).append(tm)
        outside_staff_ids = [u.id for u in users if getattr(u, 'role', None) == 'staff' and getattr(u, 'is_outside_staff', False)]
        assignments_by_user = {}
        assigned_student_ids = set()
        if outside_staff_ids:
            for oss in OutsideStaffStudent.query.filter(OutsideStaffStudent.user_id.in_(outside_staff_ids)).all():
                assignments_by_user.setdefault(oss.user_id, []).append(oss.student_id)
                assigned_student_ids.add(oss.student_id)
        assigned_students_by_id = {}
        if assigned_student_ids:
            for s in Student.query.filter(Student.id.in_(assigned_student_ids)).all():
                assigned_students_by_id[s.id] = {'id': s.id, 'name': s.name}
        parent_user_ids = [u.id for u in users if getattr(u, 'role', None) == 'parent']
        parent_links_by_user = {}
        parent_student_ids = set()
        if parent_user_ids:
            for ps in ParentStudent.query.filter(ParentStudent.parent_user_id.in_(parent_user_ids)).all():
                parent_links_by_user.setdefault(ps.parent_user_id, []).append(ps)
                parent_student_ids.add(ps.student_id)
        parent_students_by_id = {}
        if parent_student_ids:
            for s in Student.query.filter(Student.id.in_(parent_student_ids)).all():
                parent_students_by_id[s.id] = s
        
        result = []
        for user in users:
            user_data = {
                'id': user.id,
                'name': user.name,
                'username': user.username,
                'email': getattr(user, 'email', None),
                'role': user.role,
                'designation': user.designation,
                'student_id': user.student_id,
                'is_outside_staff': user.is_outside_staff if hasattr(user, 'is_outside_staff') else False,
                'district': user.district if hasattr(user, 'district') else None,
                'grades_taught': getattr(user, 'grades_taught', None),
                'linked_case_manager_id': getattr(user, 'linked_case_manager_id', None),
                'created_at': utc_isoformat(user.created_at)
            }
            # Assigned students for Outside Staff (from batch)
            if user.id in assignments_by_user:
                user_data['assigned_students'] = [
                    assigned_students_by_id[sid] for sid in assignments_by_user[user.id]
                    if sid in assigned_students_by_id
                ]
            # Student info and team members (from batch)
            if user.student_id and user.student_id in students_by_id:
                student = students_by_id[user.student_id]
                user_data['student_name'] = student.name
                user_data['grade'] = student.grade
                user_data['card_color'] = student.card_color
                if not user_data['email'] and student.email:
                    user_data['email'] = student.email
                user_data['team_members'] = {
                    'case_manager': [], 'practitioner': [], 'professional': [],
                    'group_leader': [], 'paraprofessional': []
                }
                for tm in team_by_student.get(user.student_id, []):
                    role_key = (tm.role or '').lower().replace(' ', '_')
                    if role_key in user_data['team_members']:
                        user_data['team_members'][role_key].append(tm.name)
            if user.role == 'parent':
                linked_students = []
                for ps in parent_links_by_user.get(user.id, []):
                    student = parent_students_by_id.get(ps.student_id)
                    linked_students.append({
                        'student_id': ps.student_id,
                        'student_name': student.name if student else 'Unknown',
                        'relationship': ps.relationship,
                        'verified': ps.verified,
                    })
                user_data['linked_students'] = linked_students
            result.append(user_data)
        
        return jsonify(result)
    
    elif request.method == 'POST':
        # Create new user
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid request. JSON data required.'}), 400
        
        username = (data.get('username') or '').strip()
        password = data.get('password')
        role = data.get('role')
        
        # Audit: Validate password strength
        is_valid, error_msg = validate_password_strength(password)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        if not username:
            return jsonify({'error': 'Username is required'}), 400
        if not password:
            return jsonify({'error': 'Password is required'}), 400
        if not role:
            return jsonify({'error': 'Role is required'}), 400
        
        # Permission check: Admin can create anyone, staff can only create students
        if current_user.role == 'admin':
            # Admin can create staff, admin, or student users
            if role not in ['student', 'staff', 'admin']:
                return jsonify({'error': 'Invalid role'}), 400
        elif current_user.role == 'staff':
            # Staff can only create student users
            if role != 'student':
                return jsonify({'error': 'Staff can only create student accounts'}), 403
        else:
            return jsonify({'error': 'Permission denied'}), 403
        
        # Check if username already exists
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already exists'}), 400
        
        # Create user
        user = User(
            name=data.get('name', '').strip() if data.get('name') else None,
            username=username,
            role=role,
            designation=data.get('designation'),
            student_id=data.get('student_id'),
            is_outside_staff=data.get('is_outside_staff', False) if role == 'staff' else False,
            district=data.get('district') if (role == 'staff' and data.get('is_outside_staff')) else None,
            grades_taught=(normalize_grades_taught(data.get('grades_taught') or '') or None) if role == 'staff' else None,
            linked_case_manager_id=data.get('linked_case_manager_id') if (role == 'staff' and data.get('designation') == 'Paraprofessional') else None
        )
        user.set_password(password)
        
        db.session.add(user)
        db.session.commit()
        
        # Audit: Log user creation
        log_phi_access(
            action='CREATE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='users',
            resource_id=user.id,
            details=f"Created {role} user: {username}",
            ip_address=get_remote_address()
        )
        
        return jsonify({
            'id': user.id,
            'name': user.name,
            'username': user.username,
            'role': user.role,
            'message': 'User created successfully'
        }), 201
    
    elif request.method == 'PUT':
        # Update user
        data = request.json
        user_id = data.get('id')
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Permission check and field updates
        if current_user.role == 'admin':
            # Admin can update anyone and any field
            if 'name' in data:
                user.name = data['name']
                # Also update the Student table name if this is a student user
                if user.student_id:
                    student = Student.query.get(user.student_id)
                    if student:
                        student.name = data['name']
            if 'username' in data:
                user.username = data['username']
            if 'password' in data:
                # Audit: Validate password strength
                is_valid, error_msg = validate_password_strength(data['password'])
                if not is_valid:
                    return jsonify({'error': error_msg}), 400
                user.set_password(data['password'])
                if hasattr(user, 'must_change_password'):
                    user.must_change_password = False
            if 'role' in data:
                user.role = data['role']
            if 'designation' in data:
                user.designation = data['designation'] if data['designation'] else None
            if 'grades_taught' in data:
                raw = data['grades_taught'] or ''
                user.grades_taught = normalize_grades_taught(raw) or None
            if 'student_id' in data:
                user.student_id = data['student_id']
            if 'is_outside_staff' in data:
                user.is_outside_staff = data['is_outside_staff']
            if 'district' in data:
                user.district = data['district'] if data['district'] else None
            if 'linked_case_manager_id' in data:
                user.linked_case_manager_id = data['linked_case_manager_id'] if data['linked_case_manager_id'] else None
            if 'email' in data:
                email = (data.get('email') or '').strip() or None
                user.email = email
                if user.student_id:
                    student = Student.query.get(user.student_id)
                    if student:
                        student.email = email
            
            # Update student grade if provided and user is a student
            if 'grade' in data and user.student_id:
                student = Student.query.get(user.student_id)
                if student:
                    student.grade = data['grade']
            
            # Update student card_color if provided and user is a student
            if 'card_color' in data and user.student_id:
                student = Student.query.get(user.student_id)
                if student:
                    student.card_color = data['card_color'] if data['card_color'] else None
        
        elif current_user.role == 'staff' and user.role == 'student':
            # Staff can update student accounts (limited fields)
            if 'name' in data:
                user.name = data['name']
                # Also update the Student table name if this is a student user
                if user.student_id:
                    student = Student.query.get(user.student_id)
                    if student:
                        student.name = data['name']
            if 'password' in data:
                # Audit: Validate password strength
                is_valid, error_msg = validate_password_strength(data['password'])
                if not is_valid:
                    return jsonify({'error': error_msg}), 400
                user.set_password(data['password'])
                if hasattr(user, 'must_change_password'):
                    user.must_change_password = False
            
            # Update student grade if provided
            if 'grade' in data and user.student_id:
                student = Student.query.get(user.student_id)
                if student:
                    student.grade = data['grade']
            
            # Update student card_color if provided
            if 'card_color' in data and user.student_id:
                student = Student.query.get(user.student_id)
                if student:
                    student.card_color = data['card_color'] if data['card_color'] else None
        
        elif current_user.role == 'staff' and current_user.id == user_id:
            # Staff can only update their own password
            if 'password' in data:
                # Audit: Validate password strength
                is_valid, error_msg = validate_password_strength(data['password'])
                if not is_valid:
                    return jsonify({'error': error_msg}), 400
                user.set_password(data['password'])
                if hasattr(user, 'must_change_password'):
                    user.must_change_password = False
            else:
                return jsonify({'error': 'Staff can only change their own password'}), 403
        
        elif current_user.id == user_id and user.role == 'student':
            # Students can only update their own password
            if 'password' in data:
                # Audit: Validate password strength
                is_valid, error_msg = validate_password_strength(data['password'])
                if not is_valid:
                    return jsonify({'error': error_msg}), 400
                user.set_password(data['password'])
                if hasattr(user, 'must_change_password'):
                    user.must_change_password = False
            else:
                return jsonify({'error': 'Students can only change their own password'}), 403
        
        else:
            return jsonify({'error': 'Permission denied'}), 403
        
        db.session.commit()
        return jsonify({'message': 'User updated successfully'}), 200
    
    elif request.method == 'DELETE':
        # Delete user
        user_id = request.args.get('id', type=int)
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Permission check - only admin can delete users
        if current_user.role != 'admin':
            return jsonify({'error': 'Permission denied. Only admin users can delete users.'}), 403
        
        # Admin can delete anyone except themselves
        if user_id == current_user.id:
            return jsonify({'error': 'Cannot delete your own account'}), 400
        if getattr(user, 'hidden_from_management', False):
            return jsonify({'error': 'This account cannot be deleted from User Management.'}), 403
        
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted successfully'}), 200


@app.route('/api/user/preferences', methods=['GET', 'POST'])
@login_required
def user_preferences():
    """
    Store and retrieve per-user UI preferences (non-PHI, e.g., hidden sections).
    """
    if request.method == 'GET':
        # Safely decode JSON preferences; fall back to empty dict on error
        prefs = {}
        if getattr(current_user, 'ui_preferences', None):
            try:
                prefs = json.loads(current_user.ui_preferences) or {}
            except Exception as e:
                app.logger.warning(f"Failed to decode ui_preferences for user {current_user.id}: {e}")
                prefs = {}
        return jsonify(prefs)

    # POST: replace the user's preferences document with the provided JSON
    data = request.get_json(silent=True) or {}
    try:
        current_user.ui_preferences = json.dumps(data)
        db.session.commit()
        return jsonify({'status': 'ok'})
    except Exception as e:
        app.logger.error(f"Error saving user preferences for user {current_user.id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error saving preferences'}), 500


@app.route('/api/outside-staff/<int:user_id>/students', methods=['GET', 'POST', 'DELETE'])
@login_required
@admin_required
def outside_staff_students(user_id):
    """Manage student assignments for Outside Staff users (Admin only)"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    if not (user.role == 'staff' and user.is_outside_staff):
        return jsonify({'error': 'User is not an Outside Staff member'}), 400
    
    if request.method == 'GET':
        # Get assigned students for this Outside Staff user
        assignments = OutsideStaffStudent.query.filter_by(user_id=user_id).all()
        students = []
        for assignment in assignments:
            student = Student.query.get(assignment.student_id)
            if student:
                students.append({
                    'id': student.id,
                    'name': student.name,
                    'email': student.email,
                    'grade': student.grade
                })
        return jsonify(students)
    
    elif request.method == 'POST':
        # Assign students to Outside Staff user
        data = request.json
        student_ids = data.get('student_ids', [])
        
        if not isinstance(student_ids, list):
            return jsonify({'error': 'student_ids must be a list'}), 400
        
        assigned_count = 0
        for student_id in student_ids:
            # Check if student exists
            student = Student.query.get(student_id)
            if not student:
                continue
            
            # Check if assignment already exists
            existing = OutsideStaffStudent.query.filter_by(
                user_id=user_id,
                student_id=student_id
            ).first()
            
            if not existing:
                assignment = OutsideStaffStudent(
                    user_id=user_id,
                    student_id=student_id
                )
                db.session.add(assignment)
                assigned_count += 1
        
        db.session.commit()
        return jsonify({'message': f'Assigned {assigned_count} students', 'count': assigned_count}), 200
    
    elif request.method == 'DELETE':
        # Unassign a specific student
        student_id = request.args.get('student_id', type=int)
        if not student_id:
            return jsonify({'error': 'student_id parameter required'}), 400
        
        assignment = OutsideStaffStudent.query.filter_by(
            user_id=user_id,
            student_id=student_id
        ).first()
        
        if not assignment:
            return jsonify({'error': 'Assignment not found'}), 404
        
        db.session.delete(assignment)
        db.session.commit()
        return jsonify({'message': 'Student unassigned successfully'}), 200

@app.route('/api/team-members/<int:student_id>', methods=['GET', 'PUT'])
@login_required
def team_members(student_id):
    """Get or update team members for a student"""
    if request.method == 'GET':
        # Get team members for this student
        team_members = TeamMember.query.filter_by(student_id=student_id).all()
        
        result = {
            'case_manager': [],
            'practitioner': [],
            'professional': [],
            'group_leader': [],
            'paraprofessional': []
        }
        
        for tm in team_members:
            role_key = tm.role.lower().replace(' ', '_')
            if role_key in result:
                result[role_key].append(tm.name)
        
        return jsonify(result)
    
    elif request.method == 'PUT':
        # Only staff and admin can update team members
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        
        data = request.json
        
        # Delete existing team members
        TeamMember.query.filter_by(student_id=student_id).delete()
        
        # Add new team members
        role_mapping = {
            'case_manager': 'Case Manager',
            'practitioner': 'Practitioner',
            'professional': 'Professional',
            'group_leader': 'Group Leader',
            'paraprofessional': 'Paraprofessional'
        }
        
        for key, role_name in role_mapping.items():
            staff_names = data.get(key)
            # Handle both array and single value for backward compatibility
            if not staff_names:
                continue
            if not isinstance(staff_names, list):
                staff_names = [staff_names]
            
            for staff_name in staff_names:
                if staff_name and str(staff_name).strip():
                    team_member = TeamMember(
                        student_id=student_id,
                        role=role_name,
                        name=str(staff_name).strip()
                    )
                    db.session.add(team_member)
        
        db.session.commit()
        return jsonify({'message': 'Team members updated successfully'}), 200

# Amendment Request Endpoints
@app.route('/api/amendment-requests', methods=['GET', 'POST'])
@login_required
def amendment_requests():
    """Create or view amendment requests"""
    if request.method == 'POST':
        # Create amendment request
        data = request.json
        student_id = data.get('student_id')
        record_type = data.get('record_type', 'general')
        record_id = data.get('record_id')
        current_value = data.get('current_value')
        requested_change = data.get('requested_change', '')
        reason = data.get('reason', '')
        
        if not student_id or not requested_change or not reason:
            return jsonify({'error': 'student_id, requested_change, and reason are required'}), 400
        
        # Verify user has access to this student
        if not has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied to this student'}), 403
        
        # Create amendment request
        amendment = AmendmentRequest(
            student_id=student_id,
            requested_by_user_id=current_user.id,
            record_type=record_type,
            record_id=record_id,
            current_value=current_value,
            requested_change=requested_change,
            reason=reason,
            status='pending'
        )
        db.session.add(amendment)
        db.session.commit()
        
        # Log amendment request
        log_phi_access(
            action='CREATE',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='amendment_requests',
            resource_id=amendment.id,
            details=f"Amendment request for student {student_id}, record {record_type}:{record_id}",
            ip_address=get_remote_address()
        )
        
        return jsonify({
            'id': amendment.id,
            'status': amendment.status,
            'message': 'Amendment request submitted successfully'
        }), 201
    
    else:
        # GET: View amendment requests
        if current_user.role in ['staff', 'admin']:
            # Staff/admin can see all requests
            requests = AmendmentRequest.query.order_by(AmendmentRequest.created_at.desc()).all()
        else:
            # Students/parents can only see their own requests
            requests = AmendmentRequest.query.filter_by(
                requested_by_user_id=current_user.id
            ).order_by(AmendmentRequest.created_at.desc()).all()
        
        result = []
        for req in requests:
            result.append({
                'id': req.id,
                'student_id': req.student_id,
                'student_name': req.student.name if req.student else None,
                'record_type': req.record_type,
                'record_id': req.record_id,
                'current_value': req.current_value,
                'requested_change': req.requested_change,
                'reason': req.reason,
                'status': req.status,
                'reviewed_by': req.reviewed_by.username if req.reviewed_by else None,
                'review_notes': req.review_notes,
                'reviewed_at': utc_isoformat(req.reviewed_at),
                'created_at': utc_isoformat(req.created_at)
            })
        
        return jsonify(result)

@app.route('/api/amendment-requests/<int:request_id>/review', methods=['POST'])
@login_required
@staff_required
def review_amendment_request(request_id):
    """Review and approve/deny an amendment request"""
    data = request.json
    status = data.get('status')  # 'approved' or 'denied'
    review_notes = data.get('review_notes', '')
    
    if status not in ['approved', 'denied']:
        return jsonify({'error': 'status must be "approved" or "denied"'}), 400
    
    amendment = AmendmentRequest.query.get(request_id)
    if not amendment:
        return jsonify({'error': 'Amendment request not found'}), 404
    
    amendment.status = status
    amendment.reviewed_by_user_id = current_user.id
    amendment.reviewed_at = datetime.utcnow()
    amendment.review_notes = review_notes
    
    # If approved, apply the change (simplified - you may need to implement specific logic)
    if status == 'approved':
        # Log the change
        log_phi_access(
            action='AMEND',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type=amendment.record_type,
            resource_id=amendment.record_id or amendment.student_id,
            details=f"Approved amendment: {amendment.requested_change}",
            ip_address=get_remote_address()
        )
        # TODO: Implement actual data modification based on record_type and record_id
    
    db.session.commit()
    
    return jsonify({
        'id': amendment.id,
        'status': amendment.status,
        'message': f'Amendment request {status}'
    }), 200

# Directory Information Opt-Out
@app.route('/api/students/<int:student_id>/directory-opt-out', methods=['POST', 'DELETE'])
@login_required
def directory_opt_out(student_id):
    """Opt-out or opt-in to directory information sharing"""
    # Verify user has access
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    
    if request.method == 'POST':
        # Opt-out
        student.directory_info_opt_out = True
        action = 'OPT_OUT'
    else:
        # DELETE = Opt-in
        student.directory_info_opt_out = False
        action = 'OPT_IN'
    
    db.session.commit()
    
    # Log opt-out/opt-in
    log_phi_access(
        action=action,
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='students',
        resource_id=student_id,
        details=f"Directory information opt-{'out' if student.directory_info_opt_out else 'in'}",
        ip_address=get_remote_address()
    )
    
    return jsonify({
        'student_id': student_id,
        'directory_info_opt_out': student.directory_info_opt_out,
        'message': f'Directory information opt-{"out" if student.directory_info_opt_out else "in"} successful'
    }), 200

# Data Export Endpoint
@app.route('/api/export-student-data/<int:student_id>', methods=['GET'])
@login_required
def export_student_data(student_id):
    """Export all student data (parents/students can request copies)"""
    # Verify user has access
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    
    # Get all student data
    daily_records = DailyRecord.query.filter_by(student_id=student_id).order_by(DailyRecord.date.desc()).all()
    
    export_data = {
        'student': {
            'id': student.id,
            'name': student.name,
            'email': student.email,
            'grade': student.grade,
            'directory_info_opt_out': student.directory_info_opt_out,
            'created_at': utc_isoformat(student.created_at)
        },
        'daily_records': []
    }
    
    for record in daily_records:
        periods_data = []
        for period in record.periods:
            periods_data.append({
                'time_range': period.time_range,
                'location': period.location,
                'safety_points': period.safety_points,
                'teamwork_points': period.teamwork_points,
                'accountability_points': period.accountability_points,
                'relationships_points': period.relationships_points,
                'points_possible': period.points_possible,
                'notes': period.notes,
                'reminders': period.reminders,
                'info': period.info,
                'infractions': [{
                    'type': i.infraction_type,
                    'count': i.count,
                    'is_general': i.is_general,
                    'is_harmful': i.is_harmful
                } for i in period.infractions]
            })
        
        export_data['daily_records'].append({
            'date': record.date.isoformat(),
            'day_of_week': record.day_of_week,
            'attendance_status': record.attendance_status,
            'periods': _expand_serialized_point_card_periods(periods_data, include_details=True),
            'frenzy_events': [{
                'time_range': f.time_range,
                'location': f.location,
                'purpose': f.purpose,
                'purpose2': f.purpose2,
                'duration_minutes': f.duration_minutes,
                'result': f.result
            } for f in record.frenzies]
        })
    
    # Log export
    log_phi_access(
        action='EXPORT',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='students',
        resource_id=student_id,
        details='Data export requested',
        ip_address=get_remote_address()
    )
    
    return jsonify(export_data), 200

# Rights Notification Endpoint
@app.route('/api/rights-notification', methods=['GET', 'POST'])
@login_required
def rights_notification():
    """Handle rights notification acknowledgment"""
    if request.method == 'POST':
        # Acknowledge rights notification
        data = request.json or {}
        notification_year = data.get('notification_year')
        student_id = data.get('student_id')  # Optional, for parent users
        
        if not notification_year:
            return jsonify({'error': 'Notification year is required'}), 400
        
        # Check if notification already exists for this year
        existing = RightsNotification.query.filter_by(
            user_id=current_user.id,
            notification_year=notification_year
        ).first()
        
        if existing:
            # Update existing acknowledgment
            existing.acknowledged_at = datetime.utcnow()
            existing.acknowledged_by_user_id = current_user.id
            if student_id:
                existing.student_id = student_id
        else:
            # Create new acknowledgment
            notification = RightsNotification(
                user_id=current_user.id,
                student_id=student_id,
                notification_year=notification_year,
                acknowledged_at=datetime.utcnow(),
                acknowledged_by_user_id=current_user.id
            )
            db.session.add(notification)
        
        db.session.commit()
        
        # Log acknowledgment
        log_phi_access(
            action='RIGHTS_ACKNOWLEDGED',
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            resource_type='rights_notifications',
            details=f'Rights acknowledged for year {notification_year}',
            ip_address=get_remote_address()
        )
        
        return jsonify({'message': 'Rights acknowledgment recorded', 'acknowledged': True}), 200
    
    else:
        # GET: Check if notification has been acknowledged
        notification_year = request.args.get('year', type=int)
        if not notification_year:
            notification_year = datetime.now().year
        
        notification = RightsNotification.query.filter_by(
            user_id=current_user.id,
            notification_year=notification_year
        ).first()
        
        return jsonify({
            'acknowledged': notification is not None and notification.acknowledged_at is not None,
            'acknowledged_at': utc_isoformat(notification.acknowledged_at) if notification else None
        }), 200

# Bank Account Helper Functions
def get_student_case_manager(student_id):
    """Get the case manager user for a student"""
    case_manager_team_member = TeamMember.query.filter_by(
        student_id=student_id,
        role='Case Manager'
    ).first()
    
    if case_manager_team_member and case_manager_team_member.name:
        # Try to find user by name
        case_manager_user = User.query.filter_by(
            name=case_manager_team_member.name,
            designation='Case Manager'
        ).first()
        return case_manager_user
    return None


def create_purchase_notification(student_user_id, notification_type, title, body, purchase_order_id=None, curriculum_assignment_id=None):
    """Create an in-app notification for a user (usually the student's login)."""
    n = Notification(
        user_id=student_user_id,
        type=notification_type,
        title=title,
        body=body,
        purchase_order_id=purchase_order_id,
        curriculum_assignment_id=curriculum_assignment_id,
    )
    db.session.add(n)
    return n


def notify_support_team_purchase_order_pending(student_id, purchase_order_id, item_name):
    """Notify each support-team staff member that a new purchase order needs review."""
    student = Student.query.get(student_id)
    student_name = student.name if student else 'A student'
    for user_id in get_support_team_user_ids(student_id):
        db.session.add(Notification(
            user_id=user_id,
            type='purchase_order_pending',
            title='New purchase order',
            body=f'{student_name} submitted a purchase order for {item_name}.',
            purchase_order_id=purchase_order_id
        ))


def calculate_weekly_star_percent(student_id, start_date, end_date):
    """Calculate average STAR percentage for a date range"""
    records = DailyRecord.query.filter(
        DailyRecord.student_id == student_id,
        DailyRecord.date >= start_date,
        DailyRecord.date <= end_date
    ).all()
    
    if not records:
        return Decimal('0.00')
    
    total_safety = 0
    total_teamwork = 0
    total_accountability = 0
    total_relationships = 0
    total_possible = 0
    
    for record in records:
        for period in record.periods:
            total_safety += _star_point_sum_value(period.safety_points)
            total_teamwork += _star_point_sum_value(period.teamwork_points)
            total_accountability += _star_point_sum_value(period.accountability_points)
            total_relationships += _star_point_sum_value(period.relationships_points)
            total_possible += (period.points_possible or 0)
    
    if total_possible == 0:
        return Decimal('0.00')
    
    num_periods = total_possible / 4
    max_per_category = num_periods * 2
    
    if max_per_category == 0:
        return Decimal('0.00')
    
    safety_percent = (total_safety / max_per_category * 100)
    teamwork_percent = (total_teamwork / max_per_category * 100)
    accountability_percent = (total_accountability / max_per_category * 100)
    relationships_percent = (total_relationships / max_per_category * 100)
    
    overall_percent = (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4
    return Decimal(str(round(overall_percent, 2)))

def _is_reset_infraction(infraction_type):
    """Return True if this infraction type should not count as a citation (e.g. Reset)."""
    if not infraction_type:
        return False
    return str(infraction_type).strip().lower() == 'reset'

def _citations_from_period_info(period):
    """Extract citation labels from period.info JSON (infraction1, infraction2, infractions array). Excludes Reset."""
    labels = []
    if not period.info:
        return labels
    try:
        info_data = json.loads(period.info)
        for inf_key in ['infraction1', 'infraction2']:
            infraction_type = info_data.get(inf_key)
            if infraction_type and str(infraction_type).strip():
                infraction_type = str(infraction_type).strip()
                if _is_reset_infraction(infraction_type):
                    continue
                count = 1
                try:
                    count_key = f'{inf_key}Count'
                    count = int(info_data.get(count_key, 1))
                except (ValueError, TypeError):
                    count = 1
                for _ in range(count):
                    labels.append(infraction_type)
        for inf_item in info_data.get('infractions') or []:
            if not isinstance(inf_item, dict):
                continue
            infraction_type = (inf_item.get('type') or '').strip()
            if not infraction_type or _is_reset_infraction(infraction_type):
                continue
            try:
                count = int(inf_item.get('count', 1))
            except (ValueError, TypeError):
                count = 1
            for _ in range(count):
                labels.append(infraction_type)
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    return labels

def count_weekly_infractions(student_id, start_date, end_date):
    """Count total infractions for a date range. Includes Infraction table and Info column. Excludes Reset."""
    records = DailyRecord.query.filter(
        DailyRecord.student_id == student_id,
        DailyRecord.date >= start_date,
        DailyRecord.date <= end_date
    ).all()
    
    total_count = 0
    for record in records:
        for period in record.periods:
            for infraction in period.infractions:
                if _is_reset_infraction(infraction.infraction_type):
                    continue
                total_count += infraction.count
            total_count += len(_citations_from_period_info(period))
    
    return total_count

def list_weekly_citations(student_id, start_date, end_date):
    """Return a list of citation labels for the date range. Includes Infraction table and Info column. Excludes Reset."""
    records = DailyRecord.query.filter(
        DailyRecord.student_id == student_id,
        DailyRecord.date >= start_date,
        DailyRecord.date <= end_date
    ).order_by(DailyRecord.date, DailyRecord.id).all()
    
    result = []
    for record in records:
        for period in record.periods:
            for infraction in period.infractions:
                if _is_reset_infraction(infraction.infraction_type):
                    continue
                for _ in range(infraction.count):
                    result.append(infraction.infraction_type)
            result.extend(_citations_from_period_info(period))
    return result


def get_or_create_starbucks_balance(student_id):
    """Get or create the Starbucks balance record for a student"""
    balance = StarbucksBalance.query.filter_by(student_id=student_id).first()
    if not balance:
        balance = StarbucksBalance(student_id=student_id, count=0)
        db.session.add(balance)
        db.session.commit()
    return balance

def get_or_create_bank_account(student_id):
    """Get or create a bank account for a student"""
    account = BankAccount.query.filter_by(student_id=student_id).first()
    if not account:
        account = BankAccount(student_id=student_id, balance=Decimal('0.00'))
        db.session.add(account)
        db.session.commit()
    return account

# Bank Account Routes
@app.route('/api/bank-account/<int:student_id>', methods=['GET'])
@login_required
def get_bank_account(student_id):
    """Get student's bank account balance and transaction history"""
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    account = get_or_create_bank_account(student_id)
    starbucks_balance = get_or_create_starbucks_balance(student_id)
    transactions = Transaction.query.filter_by(student_id=student_id).order_by(Transaction.created_at.desc()).limit(50).all()
    
    return jsonify({
        'balance': float(account.balance),
        'starbucks_total': int(starbucks_balance.count or 0),
        'transactions': [{
            'id': t.id,
            'type': t.transaction_type,
            'amount': float(t.amount),
            'balance_after': float(t.balance_after),
            'description': t.description,
            'created_at': utc_isoformat(t.created_at)
        } for t in transactions]
    })

@app.route('/api/paychecks/<int:student_id>', methods=['GET'])
@login_required
def get_paychecks(student_id):
    """Get all paychecks for a student"""
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    paychecks = Paycheck.query.filter_by(student_id=student_id).order_by(Paycheck.created_at.desc()).all()
    
    def paycheck_item(p):
        citation_list = list_weekly_citations(p.student_id, p.pay_period_start, p.pay_period_end)
        live_count = len(citation_list)
        live_deduction = float(Decimal(str(live_count * 2)))
        # For undeposited paychecks, use live STAR percent so popup shows current data (e.g. 100% not stale 0%)
        if not p.is_verified and p.deposited_at is None:
            live_avg = calculate_weekly_star_percent(p.student_id, p.pay_period_start, p.pay_period_end)
            live_base = float((live_avg / 100) * Decimal('100'))
            live_final = live_base - live_deduction
            avg_pct = float(live_avg)
            base_pay_val = live_base
            final_pay_val = live_final
        else:
            avg_pct = float(p.average_star_percent)
            base_pay_val = float(p.base_pay)
            live_final = base_pay_val - live_deduction
            final_pay_val = live_final
        return {
            'id': p.id,
            'pay_period_start': p.pay_period_start.isoformat(),
            'pay_period_end': p.pay_period_end.isoformat(),
            'average_star_percent': avg_pct,
            'base_pay': base_pay_val,
            'citation_count': live_count,
            'citation_list': citation_list,
            'citation_deduction': live_deduction,
            'final_pay': final_pay_val,
            'worksheet_completed': p.worksheet_completed,
            'is_verified': p.is_verified,
            'deposited_at': utc_isoformat(p.deposited_at),
            'created_at': utc_isoformat(p.created_at)
        }
    return jsonify([paycheck_item(p) for p in paychecks])

@app.route('/api/paycheck/<int:paycheck_id>', methods=['GET'])
@login_required
def get_paycheck(paycheck_id):
    """Get specific paycheck details"""
    paycheck = Paycheck.query.get_or_404(paycheck_id)
    
    if not has_student_access(current_user, paycheck.student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    # Use live citation list/count so worksheet shows current infractions (not stale paycheck record)
    citation_list = list_weekly_citations(paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end)
    live_citation_count = len(citation_list)
    live_citation_deduction = Decimal(str(live_citation_count * 2))
    # For undeposited paychecks, use live STAR percent so worksheet shows current data (e.g. 100% not stale 0%)
    if not paycheck.is_verified and paycheck.deposited_at is None:
        live_avg = calculate_weekly_star_percent(paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end)
        live_base_pay = (live_avg / 100) * Decimal('100')
        live_final_pay = live_base_pay - live_citation_deduction
        avg_pct = float(live_avg)
        base_pay_val = float(live_base_pay)
    else:
        avg_pct = float(paycheck.average_star_percent)
        base_pay_val = float(paycheck.base_pay)
        live_final_pay = paycheck.base_pay - live_citation_deduction
    return jsonify({
        'id': paycheck.id,
        'student_id': paycheck.student_id,
        'pay_period_start': paycheck.pay_period_start.isoformat(),
        'pay_period_end': paycheck.pay_period_end.isoformat(),
        'average_star_percent': avg_pct,
        'base_pay': base_pay_val,
        'citation_count': live_citation_count,
        'citation_list': citation_list,
        'citation_deduction': float(live_citation_deduction),
        'final_pay': float(live_final_pay),
        'worksheet_completed': paycheck.worksheet_completed,
        'student_calculated_pay': float(paycheck.student_calculated_pay) if paycheck.student_calculated_pay else None,
        'student_calculated_citations': paycheck.student_calculated_citations,
        'student_calculated_deduction': float(paycheck.student_calculated_deduction) if paycheck.student_calculated_deduction else None,
        'student_calculated_final': float(paycheck.student_calculated_final) if paycheck.student_calculated_final else None,
        'is_verified': paycheck.is_verified,
        'deposited_at': utc_isoformat(paycheck.deposited_at),
        'created_at': utc_isoformat(paycheck.created_at)
    })


def _curriculum_lesson(slug):
    return CurriculumLesson.query.filter_by(slug=slug, is_active=True).first()


def _serialize_curriculum_lesson(lesson):
    if not lesson:
        return None
    return {
        'id': lesson.id,
        'slug': lesson.slug,
        'title': lesson.title,
        'skill_name': lesson.skill_name,
        'student_prompt': lesson.student_prompt,
        'staff_script': lesson.staff_script,
        'teaching': lesson.teaching_body,
        'sort_order': lesson.sort_order,
    }


def _parse_assignment_responses(assignment):
    if not assignment or not assignment.responses_json:
        return None
    try:
        return json.loads(assignment.responses_json)
    except (TypeError, ValueError):
        return None


def _serialize_curriculum_assignment(assignment):
    if not assignment:
        return None
    lesson = assignment.lesson
    return {
        'id': assignment.id,
        'student_id': assignment.student_id,
        'lesson_id': assignment.lesson_id,
        'lesson': _serialize_curriculum_lesson(lesson),
        'assigned_by_user_id': assignment.assigned_by_user_id,
        'source': assignment.source,
        'paycheck_id': assignment.paycheck_id,
        'status': assignment.status,
        'responses': _parse_assignment_responses(assignment),
        'started_at': utc_isoformat(assignment.started_at),
        'completed_at': utc_isoformat(assignment.completed_at),
        'created_at': utc_isoformat(assignment.created_at),
    }


def _paycheck_live_snapshot(paycheck):
    if not paycheck:
        return None
    citation_list = list_weekly_citations(
        paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end
    )
    live_count = len(citation_list)
    live_deduction = Decimal(str(live_count * 2))
    if not paycheck.is_verified and paycheck.deposited_at is None:
        live_avg = calculate_weekly_star_percent(
            paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end
        )
        live_base = (live_avg / 100) * Decimal('100')
        live_final = live_base - live_deduction
        avg_pct = live_avg
        base_pay_val = live_base
    else:
        avg_pct = paycheck.average_star_percent
        base_pay_val = paycheck.base_pay
        live_final = paycheck.base_pay - live_deduction
    return {
        'id': paycheck.id,
        'pay_period_start': paycheck.pay_period_start.isoformat(),
        'pay_period_end': paycheck.pay_period_end.isoformat(),
        'average_star_percent': float(avg_pct or 0),
        'base_pay': float(base_pay_val or 0),
        'citation_count': live_count,
        'citation_list': citation_list,
        'citation_deduction': float(live_deduction),
        'final_pay': float(live_final or 0),
        'is_verified': bool(paycheck.is_verified),
        'deposited_at': utc_isoformat(paycheck.deposited_at),
        'worksheet_completed': bool(paycheck.worksheet_completed),
    }


def ensure_paycheck_curriculum_assignment(paycheck, notify=False):
    """Create the read-paycheck lesson for this paycheck if missing."""
    if not paycheck:
        return None
    lesson = _curriculum_lesson('read_paycheck')
    if not lesson:
        return None
    existing = CurriculumAssignment.query.filter_by(
        student_id=paycheck.student_id,
        lesson_id=lesson.id,
        paycheck_id=paycheck.id,
    ).first()
    if existing:
        return existing
    assignment = CurriculumAssignment(
        student_id=paycheck.student_id,
        lesson_id=lesson.id,
        assigned_by_user_id=None,
        source='paycheck',
        paycheck_id=paycheck.id,
        status='assigned',
    )
    if paycheck.is_verified or paycheck.deposited_at:
        assignment.status = 'completed'
        assignment.completed_at = paycheck.deposited_at or datetime.utcnow()
    db.session.add(assignment)
    db.session.flush()
    if notify and assignment.status != 'completed':
        student_user = User.query.filter_by(
            role='student', student_id=paycheck.student_id
        ).first()
        if student_user:
            start = paycheck.pay_period_start.isoformat()
            end = paycheck.pay_period_end.isoformat()
            create_purchase_notification(
                student_user.id,
                'curriculum_paycheck',
                'Your paycheck is ready',
                f'Complete your paycheck worksheet for {start} to {end}, then your lesson.',
                curriculum_assignment_id=assignment.id,
            )
    return assignment


def complete_read_paycheck_assignments(student_id, paycheck_id):
    lesson = _curriculum_lesson('read_paycheck')
    if not lesson:
        return
    open_rows = CurriculumAssignment.query.filter(
        CurriculumAssignment.student_id == student_id,
        CurriculumAssignment.lesson_id == lesson.id,
        CurriculumAssignment.status != 'completed',
    ).all()
    now = datetime.utcnow()
    for row in open_rows:
        if row.paycheck_id not in (None, paycheck_id):
            continue
        row.status = 'completed'
        row.completed_at = now
        if not row.paycheck_id:
            row.paycheck_id = paycheck_id


def run_paycheck_generation(target_date=None):
    """
    Generate paychecks for all students for a Mon–Fri pay period.
    Used by both the API route and the cron script.

    target_date: optional Monday date as 'YYYY-MM-DD' or date; if None, uses
                 the **previous week** (Monday of the week before the current week).

    Returns:
        tuple: (generated_count, pay_period_start, pay_period_end)
    """
    seed_curriculum_lessons(commit=False)
    if target_date is not None:
        if isinstance(target_date, str):
            target_date = datetime.strptime(target_date, '%Y-%m-%d').date()
    else:
        # Generate for the **previous** Monday–Friday week only.
        # Example: if the button is pressed on Wed 1/29/25, this week's Monday
        # is 1/27, so the previous week is Mon 1/20–Fri 1/24.
        today = date.today()
        this_monday = today - timedelta(days=today.weekday())
        target_date = this_monday - timedelta(days=7)

    pay_period_start = target_date
    pay_period_end = target_date + timedelta(days=4)

    generated_count = 0

    # Only process students who have active user accounts (User Management tab).
    student_users = User.query.filter_by(role='student').all()
    active_student_ids = {u.student_id for u in student_users if u.student_id}

    # 1. Update existing non-deposited paychecks for this period, but only for
    #    students who have an active user account (no updates for students not in User Management).
    existing_pending = Paycheck.query.filter(
        Paycheck.pay_period_start == pay_period_start,
        Paycheck.pay_period_end == pay_period_end,
        Paycheck.deposited_at.is_(None)
    ).all()

    for paycheck in existing_pending:
        if paycheck.student_id not in active_student_ids:
            continue
        avg_star_percent = calculate_weekly_star_percent(paycheck.student_id, pay_period_start, pay_period_end)
        citation_count = count_weekly_infractions(paycheck.student_id, pay_period_start, pay_period_end)
        base_pay = (avg_star_percent / 100) * Decimal('100')
        citation_deduction = Decimal(str(citation_count * 2))
        final_pay = base_pay - citation_deduction
        paycheck.average_star_percent = avg_star_percent
        paycheck.base_pay = base_pay
        paycheck.citation_count = citation_count
        paycheck.citation_deduction = citation_deduction
        paycheck.final_pay = final_pay
        generated_count += 1
        ensure_paycheck_curriculum_assignment(paycheck, notify=False)

    # 2. Create new paychecks only for students who have active user accounts and
    #    do not yet have a paycheck for this period.
    students = Student.query.filter(Student.id.in_(active_student_ids)).all() if active_student_ids else []

    for student in students:
        existing = Paycheck.query.filter_by(
            student_id=student.id,
            pay_period_start=pay_period_start,
            pay_period_end=pay_period_end
        ).first()
        if existing:
            continue  # Already updated in step 1 if not deposited; if deposited, leave as-is
        avg_star_percent = calculate_weekly_star_percent(student.id, pay_period_start, pay_period_end)
        citation_count = count_weekly_infractions(student.id, pay_period_start, pay_period_end)
        base_pay = (avg_star_percent / 100) * Decimal('100')
        citation_deduction = Decimal(str(citation_count * 2))
        final_pay = base_pay - citation_deduction
        paycheck = Paycheck(
            student_id=student.id,
            pay_period_start=pay_period_start,
            pay_period_end=pay_period_end,
            average_star_percent=avg_star_percent,
            base_pay=base_pay,
            citation_count=citation_count,
            citation_deduction=citation_deduction,
            final_pay=final_pay
        )
        db.session.add(paycheck)
        db.session.flush()
        ensure_paycheck_curriculum_assignment(paycheck, notify=True)
        generated_count += 1

    db.session.commit()
    return (generated_count, pay_period_start, pay_period_end)


@app.route('/api/paycheck/generate', methods=['POST'])
@login_required
@staff_required
def generate_paychecks():
    """Manually trigger paycheck generation"""
    data = request.get_json(silent=True) or {}
    target_date = data.get('date')
    try:
        count, start, end = run_paycheck_generation(target_date)
        return jsonify({
            'message': f'Generated {count} paychecks',
            'count': count,
            'pay_period_start': start.isoformat(),
            'pay_period_end': end.isoformat(),
        })
    except Exception as e:
        app.logger.exception('manual paycheck generation error')
        return jsonify({'error': f'Paycheck generation failed: {e}'}), 500


@app.route('/api/paycheck/cron-debug', methods=['GET'])
def cron_debug():
    """
    Debug helper: returns whether X-Cron-Secret is present and length only.
    Use same URL as cron but path .../cron-debug. Remove this route after fixing cron.
    """
    provided = request.headers.get('X-Cron-Secret') or (
        (request.headers.get('Authorization') or '').replace('Bearer ', '').strip()
    )
    secret = os.environ.get('CRON_SECRET')
    return jsonify({
        'x_cron_secret_present': bool(request.headers.get('X-Cron-Secret')),
        'provided_length': len(provided) if provided else 0,
        'cron_secret_configured': bool(secret),
        'expected_length': len(secret) if secret else 0,
        'match': secrets.compare_digest(secret or '', provided) if (secret and provided) else False,
    })


@app.route('/api/paycheck/generate-cron', methods=['GET', 'POST'])
def generate_paychecks_cron():
    """
    Cron endpoint for external schedulers (e.g. cron-job.org).
    Secured by CRON_SECRET env var. No login required.
    """
    secret = os.environ.get('CRON_SECRET')
    if not secret:
        return jsonify({'error': 'CRON_SECRET not configured'}), 503
    provided = request.headers.get('X-Cron-Secret') or (
        request.headers.get('Authorization') or ''
    ).replace('Bearer ', '').strip()
    if not provided or not secrets.compare_digest(secret, provided):
        return jsonify({'error': 'Unauthorized'}), 401
    target_date = None
    if request.method == 'POST' and request.is_json:
        target_date = (request.json or {}).get('date')
    elif request.method == 'GET':
        target_date = request.args.get('date')
    try:
        count, start, end = run_paycheck_generation(target_date)
        return jsonify({
            'message': f'Generated {count} paychecks',
            'count': count,
            'pay_period_start': start.isoformat(),
            'pay_period_end': end.isoformat(),
        })
    except Exception as e:
        app.logger.exception('paycheck cron error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/point-cards/auto-submit-cron', methods=['GET', 'POST'])
def auto_submit_point_cards_cron():
    """
    Nightly point-card submit for cards that have data (after 11:15pm school time).
    Secured by CRON_SECRET. Optional ?date=YYYY-MM-DD.
    """
    secret = os.environ.get('CRON_SECRET')
    if not secret:
        return jsonify({'error': 'CRON_SECRET not configured'}), 503
    provided = request.headers.get('X-Cron-Secret') or (
        request.headers.get('Authorization') or ''
    ).replace('Bearer ', '').strip()
    if not provided or not secrets.compare_digest(secret, provided):
        return jsonify({'error': 'Unauthorized'}), 401
    target_date = None
    if request.method == 'POST' and request.is_json:
        target_date = (request.json or {}).get('date')
    elif request.method == 'GET':
        target_date = request.args.get('date')
    try:
        count = run_point_card_auto_submit(target_date)
        return jsonify({
            'message': f'Auto-submitted {count} point card(s)',
            'count': count,
        })
    except Exception as e:
        app.logger.exception('point card auto-submit cron error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/delete-pre-date-data-cron', methods=['GET', 'POST'])
def delete_pre_date_data_cron():
    """
    One-off admin utility: delete point cards and paychecks before an explicit cutoff date.
    Secured by CRON_SECRET. Requires ?date=YYYY-MM-DD (or JSON date). Optional ?dry_run=1.
    """
    secret = os.environ.get('CRON_SECRET')
    if not secret:
        return jsonify({'error': 'CRON_SECRET not configured'}), 503
    provided = request.headers.get('X-Cron-Secret') or (
        request.headers.get('Authorization') or ''
    ).replace('Bearer ', '').strip()
    if not provided or not secrets.compare_digest(secret, provided):
        return jsonify({'error': 'Unauthorized'}), 401

    cutoff_date = None
    dry_run = False
    if request.method == 'POST' and request.is_json:
        payload = request.json or {}
        cutoff_date = payload.get('date')
        dry_run = bool(payload.get('dry_run'))
    elif request.method == 'GET':
        cutoff_date = request.args.get('date')
        dry_run = (request.args.get('dry_run') or '').lower() in ('1', 'true', 'yes')

    if not cutoff_date:
        return jsonify({'error': 'date is required (YYYY-MM-DD cutoff; records before this date are deleted)'}), 400

    try:
        stats = run_pre_cutoff_data_cleanup(cutoff_date=cutoff_date, dry_run=dry_run)
        return jsonify({
            'message': 'Pre-cutoff data cleanup completed' if not dry_run else 'Dry run completed',
            **stats,
        })
    except Exception as e:
        app.logger.exception('pre-cutoff data cleanup cron error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/paycheck/<int:paycheck_id>/complete-worksheet', methods=['POST'])
@login_required
def complete_paycheck_worksheet(paycheck_id):
    """Student submits completed worksheet - allows unlimited resubmissions until verified"""
    paycheck = Paycheck.query.get_or_404(paycheck_id)
    
    if current_user.role == 'student' and current_user.student_id != paycheck.student_id:
        return jsonify({'error': 'Access denied'}), 403
    
    if not has_student_access(current_user, paycheck.student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    # Don't allow resubmission if already verified
    if paycheck.is_verified:
        return jsonify({'error': 'This paycheck has already been verified and deposited'}), 400
    
    data = request.json
    student_calculated_pay = Decimal(str(data.get('calculated_pay', 0)))
    student_calculated_citations = int(data.get('calculated_citations', 0))
    student_calculated_deduction = Decimal(str(data.get('calculated_deduction', 0)))
    student_calculated_final = Decimal(str(data.get('calculated_final', 0)))
    
    # Update paycheck with student calculations (allows resubmission)
    paycheck.student_calculated_pay = student_calculated_pay
    paycheck.student_calculated_citations = student_calculated_citations
    paycheck.student_calculated_deduction = student_calculated_deduction
    paycheck.student_calculated_final = student_calculated_final
    paycheck.worksheet_completed = True
    
    db.session.commit()
    
    # Auto-verify
    return verify_paycheck(paycheck_id)

@app.route('/api/paycheck/<int:paycheck_id>/verify', methods=['POST'])
@login_required
def verify_paycheck(paycheck_id):
    """Auto-verify worksheet (if correct, deposit)"""
    paycheck = Paycheck.query.get_or_404(paycheck_id)
    
    if not paycheck.worksheet_completed:
        return jsonify({'error': 'Worksheet not completed'}), 400
    
    # Use live citation count so verification matches current infractions (not stale paycheck record)
    live_citation_count = count_weekly_infractions(paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end)
    live_citation_deduction = Decimal(str(live_citation_count * 2))
    # Use live STAR percent for undeposited paychecks so verification matches worksheet display (e.g. 100% not stale 0%)
    live_avg = None
    if not paycheck.is_verified and paycheck.deposited_at is None:
        live_avg = calculate_weekly_star_percent(paycheck.student_id, paycheck.pay_period_start, paycheck.pay_period_end)
        live_base_pay = (live_avg / 100) * Decimal('100')
        live_final_pay = live_base_pay - live_citation_deduction
    else:
        live_base_pay = paycheck.base_pay
        live_final_pay = paycheck.base_pay - live_citation_deduction

    # Verify calculations
    tolerance = Decimal('0.01')  # Allow small rounding differences
    
    pay_correct = abs(paycheck.student_calculated_pay - live_base_pay) <= tolerance
    citations_correct = paycheck.student_calculated_citations == live_citation_count
    deduction_correct = abs(paycheck.student_calculated_deduction - live_citation_deduction) <= tolerance
    final_correct = abs(paycheck.student_calculated_final - live_final_pay) <= tolerance
    
    if pay_correct and citations_correct and deduction_correct and final_correct:
        # Sync paycheck record with live values before depositing so ledger is correct
        if live_avg is not None:
            paycheck.average_star_percent = live_avg
            paycheck.base_pay = (live_avg / 100) * Decimal('100')
        paycheck.citation_count = live_citation_count
        paycheck.citation_deduction = live_citation_deduction
        paycheck.final_pay = live_final_pay
        paycheck.is_verified = True
        paycheck.deposited_at = datetime.utcnow()
        
        # Create deposit transaction
        account = get_or_create_bank_account(paycheck.student_id)
        account.balance += paycheck.final_pay
        account.updated_at = datetime.utcnow()
        
        transaction = Transaction(
            student_id=paycheck.student_id,
            bank_account_id=account.id,
            transaction_type='deposit',
            amount=paycheck.final_pay,
            paycheck_id=paycheck.id,
            balance_after=account.balance,
            description=f'Paycheck deposit for {paycheck.pay_period_start} - {paycheck.pay_period_end}'
        )
        db.session.add(transaction)
        complete_read_paycheck_assignments(paycheck.student_id, paycheck.id)
        db.session.commit()

        return jsonify({
            'verified': True,
            'message': 'Worksheet verified! Deposit completed.',
            'deposited_amount': float(paycheck.final_pay)
        })
    else:
        errors = []
        if not pay_correct:
            errors.append('Please correct base pay calculation.')
        if not citations_correct:
            errors.append('Please correct citation count.')
        if not deduction_correct:
            errors.append('Please correct citation deduction.')
        if not final_correct:
            errors.append('Please correct final pay calculation.')
        
        return jsonify({
            'verified': False,
            'errors': errors,
            'message': 'Some calculations are incorrect. Please review and try again.'
        }), 400

# Curriculum: financial literacy lessons on top of paychecks / bank / marketplace

def _curriculum_resolve_student_id(explicit_id=None):
    if current_user.role == 'student':
        return current_user.student_id
    student_id = explicit_id
    if student_id is None:
        student_id = request.args.get('student_id', type=int)
    if student_id is None and request.is_json:
        student_id = (request.json or {}).get('student_id')
        if student_id is not None:
            try:
                student_id = int(student_id)
            except (TypeError, ValueError):
                student_id = None
    if not student_id:
        return None
    if not has_student_access(current_user, student_id):
        return False
    return student_id


def _serialize_savings_goal(goal, balance=None):
    if not goal:
        return None
    target = float(goal.target_amount or 0)
    bal = float(balance) if balance is not None else None
    item = goal.marketplace_item
    progress = None
    if bal is not None and target > 0:
        progress = min(1.0, max(0.0, bal / target))
    return {
        'id': goal.id,
        'student_id': goal.student_id,
        'marketplace_item_id': goal.marketplace_item_id,
        'item_name': item.name if item else None,
        'item_price': float(item.price) if item else None,
        'custom_label': goal.custom_label,
        'target_amount': target,
        'is_active': bool(goal.is_active),
        'progress': progress,
        'created_at': utc_isoformat(goal.created_at),
        'completed_at': utc_isoformat(goal.completed_at),
    }


def _curriculum_money_story(student_id):
    account = get_or_create_bank_account(student_id)
    since = datetime.utcnow() - timedelta(days=30)
    purchases = Transaction.query.filter(
        Transaction.student_id == student_id,
        Transaction.transaction_type == 'purchase',
        Transaction.created_at >= since,
    ).order_by(Transaction.created_at.desc()).all()
    spent_30d = sum(abs(float(t.amount or 0)) for t in purchases)
    paychecks = Paycheck.query.filter_by(student_id=student_id).order_by(
        Paycheck.pay_period_start.desc(), Paycheck.id.desc()
    ).limit(8).all()
    this_pay = _paycheck_live_snapshot(paychecks[0]) if paychecks else None
    prev_pay = _paycheck_live_snapshot(paychecks[1]) if len(paychecks) > 1 else None
    direction = 'none'
    delta = None
    if this_pay and prev_pay:
        delta = round(this_pay['final_pay'] - prev_pay['final_pay'], 2)
        if delta > 0.009:
            direction = 'up'
        elif delta < -0.009:
            direction = 'down'
        else:
            direction = 'same'
    goal = SavingsGoal.query.filter_by(student_id=student_id, is_active=True).order_by(
        SavingsGoal.created_at.desc()
    ).first()
    weeks_to_goal = None
    if goal and this_pay and this_pay['final_pay'] > 0:
        remaining = max(0.0, float(goal.target_amount) - float(account.balance))
        weeks_to_goal = int((remaining + this_pay['final_pay'] - 0.001) // this_pay['final_pay']) if remaining > 0 else 0
    student = Student.query.get(student_id)
    return {
        'student': {'id': student_id, 'name': student.name if student else ''},
        'balance': float(account.balance or 0),
        'spent_30d': round(spent_30d, 2),
        'this_paycheck': this_pay,
        'previous_paycheck': prev_pay,
        'pay_change': {
            'direction': direction,
            'delta': delta,
            'zero_citation_pay': this_pay['base_pay'] if this_pay else None,
        },
        'goal': _serialize_savings_goal(goal, account.balance),
        'weeks_to_goal': weeks_to_goal,
        'recent_purchases': [{
            'id': t.id,
            'amount': abs(float(t.amount or 0)),
            'description': t.description or 'Purchase',
            'created_at': utc_isoformat(t.created_at),
        } for t in purchases[:12]],
    }


def _upsert_active_goal(student_id, target_amount, marketplace_item_id=None, custom_label=None):
    if target_amount is None or Decimal(str(target_amount)) <= 0:
        return None, 'Enter a target amount greater than zero.'
    item = None
    if marketplace_item_id:
        item = MarketplaceItem.query.get(marketplace_item_id)
        if not item:
            return None, 'Marketplace item not found.'
        if not custom_label:
            custom_label = item.name
        if not target_amount:
            target_amount = item.price
    active = SavingsGoal.query.filter_by(student_id=student_id, is_active=True).all()
    for old in active:
        old.is_active = False
    goal = SavingsGoal(
        student_id=student_id,
        marketplace_item_id=item.id if item else None,
        custom_label=(custom_label or '').strip() or None,
        target_amount=Decimal(str(target_amount)),
        is_active=True,
    )
    db.session.add(goal)
    db.session.flush()
    return goal, None


def _validate_lesson_responses(slug, responses, story):
    responses = responses or {}
    this_pay = story.get('this_paycheck') or {}
    balance = float(story.get('balance') or 0)

    if slug == 'read_paycheck':
        if this_pay.get('is_verified') or this_pay.get('deposited_at'):
            return None
        return 'Finish the paycheck worksheet in Bank Account first.'

    if slug == 'why_pay_changed':
        cause = (responses.get('cause') or '').strip().lower()
        if cause not in ('citations', 'star', 'both', 'same'):
            return 'Pick what moved your pay.'
        why = (responses.get('why') or '').strip()
        if len(why) < 8:
            return 'Write why your pay changed — or why it stayed the same.'
        return None

    if slug == 'save_or_buy':
        decision = (responses.get('decision') or '').strip().lower()
        if decision not in ('buy', 'wait', 'goal'):
            return 'Choose buy, wait, or set as a goal.'
        try:
            item_id = int(responses.get('item_id'))
            price = float(responses.get('item_price'))
        except (TypeError, ValueError):
            return 'Pick a marketplace item.'
        item = MarketplaceItem.query.get(item_id)
        if not item:
            return 'That item is not in the marketplace.'
        if abs(price - float(item.price)) > 0.01:
            return 'Item price does not match the catalog.'
        if decision == 'buy' and balance + 0.001 < float(item.price):
            return 'You do not have enough to buy that yet. Choose wait or set it as a goal.'
        return None

    if slug == 'opportunity_cost':
        try:
            a_id = int(responses.get('item_id_a'))
            b_id = int(responses.get('item_id_b'))
        except (TypeError, ValueError):
            return 'Pick two items.'
        if a_id == b_id:
            return 'Pick two different items.'
        item_a = MarketplaceItem.query.get(a_id)
        item_b = MarketplaceItem.query.get(b_id)
        if not item_a or not item_b:
            return 'One of those items is not in the marketplace.'
        can_both = bool(responses.get('can_buy_both'))
        combined = float(item_a.price) + float(item_b.price)
        actually_can = balance + 0.001 >= combined
        if can_both != actually_can:
            if actually_can:
                return 'Your balance covers both. Mark that you can buy both, or pick more expensive items.'
            return 'Your balance cannot cover both. Uncheck that and choose which one you would buy.'
        if not actually_can:
            choice = responses.get('choice')
            try:
                choice_id = int(choice)
            except (TypeError, ValueError):
                return 'Choose which item you would buy.'
            if choice_id not in (a_id, b_id):
                return 'Your choice has to be one of the two items.'
            reason = (responses.get('reason') or '').strip()
            if len(reason) < 3:
                return 'Say what you are giving up.'
        return None

    if slug == 'needs_vs_wants':
        tags = responses.get('tags')
        if not isinstance(tags, list) or len(tags) < 1:
            return 'Tag at least one item as a need or a want.'
        for tag in tags:
            kind = (tag.get('kind') if isinstance(tag, dict) else None) or ''
            if kind not in ('need', 'want'):
                return 'Each item needs to be tagged need or want.'
        wait_want = (responses.get('wait_want') or '').strip()
        if len(wait_want) < 2:
            return 'Name one want that could wait. If every item is a need, say that.'
        return None

    if slug == 'savings_goal':
        try:
            target = float(responses.get('target_amount'))
        except (TypeError, ValueError):
            return 'Enter a savings target.'
        if target <= 0:
            return 'Target has to be greater than zero.'
        return None

    return None


@app.route('/api/curriculum/me', methods=['GET'])
@login_required
def curriculum_me():
    student_id = _curriculum_resolve_student_id()
    if student_id is False:
        return jsonify({'error': 'Access denied'}), 403
    if not student_id:
        return jsonify({'error': 'Select a student'}), 400
    seed_curriculum_lessons()
    story = _curriculum_money_story(student_id)
    assignments = CurriculumAssignment.query.filter_by(student_id=student_id).order_by(
        CurriculumAssignment.created_at.desc()
    ).all()
    lessons = CurriculumLesson.query.filter_by(is_active=True).order_by(CurriculumLesson.sort_order).all()
    return jsonify({
        'money_story': story,
        'lessons': [_serialize_curriculum_lesson(l) for l in lessons],
        'assignments': [_serialize_curriculum_assignment(a) for a in assignments],
    })


@app.route('/api/curriculum/lessons', methods=['GET'])
@login_required
def curriculum_lessons():
    seed_curriculum_lessons()
    lessons = CurriculumLesson.query.filter_by(is_active=True).order_by(CurriculumLesson.sort_order).all()
    payload = [_serialize_curriculum_lesson(l) for l in lessons]
    if current_user.role not in ('staff', 'admin'):
        for row in payload:
            row.pop('staff_script', None)
    return jsonify(payload)


@app.route('/api/curriculum/assignments', methods=['POST'])
@login_required
@staff_required
def curriculum_assign():
    if current_user.role == 'staff' and current_user.is_outside_staff:
        return jsonify({'error': 'Outside staff cannot assign lessons'}), 403
    data = request.get_json(silent=True) or {}
    slug = (data.get('lesson_slug') or '').strip()
    lesson = _curriculum_lesson(slug)
    if not lesson:
        return jsonify({'error': 'Unknown lesson'}), 400
    raw_ids = data.get('student_ids') or []
    if data.get('student_id') and not raw_ids:
        raw_ids = [data.get('student_id')]
    try:
        student_ids = [int(sid) for sid in raw_ids]
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid student list'}), 400
    student_ids = [sid for sid in student_ids if has_student_access(current_user, sid)]
    if not student_ids:
        return jsonify({'error': 'No students to assign'}), 400

    created = []
    for sid in student_ids:
        paycheck_id = None
        if slug == 'read_paycheck':
            pending = Paycheck.query.filter_by(student_id=sid).filter(
                Paycheck.deposited_at.is_(None)
            ).order_by(Paycheck.pay_period_start.desc()).first()
            if pending:
                existing = CurriculumAssignment.query.filter_by(
                    student_id=sid, lesson_id=lesson.id, paycheck_id=pending.id
                ).first()
                if existing and existing.status != 'completed':
                    created.append(_serialize_curriculum_assignment(existing))
                    continue
                if not existing:
                    paycheck_id = pending.id
        assignment = CurriculumAssignment(
            student_id=sid,
            lesson_id=lesson.id,
            assigned_by_user_id=current_user.id,
            source='staff',
            paycheck_id=paycheck_id,
            status='assigned',
        )
        db.session.add(assignment)
        db.session.flush()
        student_user = User.query.filter_by(role='student', student_id=sid).first()
        if student_user:
            create_purchase_notification(
                student_user.id,
                'curriculum_assigned',
                'New money lesson',
                f'You have a new lesson: {lesson.title}.',
                curriculum_assignment_id=assignment.id,
            )
        created.append(_serialize_curriculum_assignment(assignment))
    db.session.commit()
    return jsonify({'assignments': created, 'count': len(created)})


@app.route('/api/curriculum/roster', methods=['GET'])
@login_required
@staff_required
def curriculum_roster():
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    student_ids = _resolve_student_scope(managed_by_me=managed_by_me)
    if current_user.role == 'staff' and current_user.is_outside_staff:
        assigned = {a.student_id for a in OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()}
        student_ids = [sid for sid in student_ids if sid in assigned]
    students = Student.query.filter(Student.id.in_(student_ids or [-1])).order_by(Student.name).all() if student_ids else []
    lessons = CurriculumLesson.query.filter_by(is_active=True).order_by(CurriculumLesson.sort_order).all()
    lesson_ids = [l.id for l in lessons]
    rows = []
    if students and lesson_ids:
        assignments = CurriculumAssignment.query.filter(
            CurriculumAssignment.student_id.in_([s.id for s in students]),
            CurriculumAssignment.lesson_id.in_(lesson_ids),
        ).order_by(CurriculumAssignment.created_at.desc()).all()
        latest = {}
        for a in assignments:
            key = (a.student_id, a.lesson.slug if a.lesson else a.lesson_id)
            if key not in latest:
                latest[key] = a
        for student in students:
            lesson_status = {}
            open_count = 0
            needs_help = 0
            for lesson in lessons:
                a = latest.get((student.id, lesson.slug))
                status = a.status if a else 'none'
                lesson_status[lesson.slug] = {
                    'status': status,
                    'assignment_id': a.id if a else None,
                }
                if status in ('assigned', 'in_progress'):
                    open_count += 1
                if status == 'needs_help':
                    needs_help += 1
                    open_count += 1
            rows.append({
                'student_id': student.id,
                'student_name': student.name,
                'lessons': lesson_status,
                'open_count': open_count,
                'needs_help': needs_help,
            })
    return jsonify({
        'lessons': [_serialize_curriculum_lesson(l) for l in lessons],
        'students': rows,
    })


@app.route('/api/curriculum/assignments/<int:assignment_id>/start', methods=['POST'])
@login_required
def curriculum_start(assignment_id):
    assignment = CurriculumAssignment.query.get_or_404(assignment_id)
    if not has_student_access(current_user, assignment.student_id):
        return jsonify({'error': 'Access denied'}), 403
    if assignment.status == 'assigned':
        assignment.status = 'in_progress'
        assignment.started_at = datetime.utcnow()
        db.session.commit()
    return jsonify(_serialize_curriculum_assignment(assignment))


@app.route('/api/curriculum/assignments/<int:assignment_id>/needs-help', methods=['POST'])
@login_required
def curriculum_needs_help(assignment_id):
    assignment = CurriculumAssignment.query.get_or_404(assignment_id)
    if not has_student_access(current_user, assignment.student_id):
        return jsonify({'error': 'Access denied'}), 403
    if assignment.status != 'completed':
        assignment.status = 'needs_help'
        db.session.commit()
    return jsonify(_serialize_curriculum_assignment(assignment))


@app.route('/api/curriculum/assignments/<int:assignment_id>/complete', methods=['POST'])
@login_required
def curriculum_complete(assignment_id):
    assignment = CurriculumAssignment.query.get_or_404(assignment_id)
    if not has_student_access(current_user, assignment.student_id):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json(silent=True) or {}
    responses = data.get('responses') or {}
    story = _curriculum_money_story(assignment.student_id)
    slug = assignment.lesson.slug if assignment.lesson else ''
    error = _validate_lesson_responses(slug, responses, story)
    if error:
        return jsonify({'error': error}), 400
    if slug == 'why_pay_changed':
        this_pay = story.get('this_paycheck') or {}
        prev_pay = story.get('previous_paycheck')
        change = story.get('pay_change') or {}
        this_actual = float(this_pay.get('final_pay') or 0)
        if prev_pay:
            compare_actual = float(prev_pay.get('final_pay') or 0)
        else:
            compare_actual = float(change.get('zero_citation_pay') or this_pay.get('base_pay') or 0)
        responses = dict(responses)
        responses['this_take_home'] = round(this_actual, 2)
        responses['compare_take_home'] = round(compare_actual, 2)
        responses['difference'] = round(this_actual - compare_actual, 2)
        responses['this_paycheck'] = this_pay
        responses['previous_paycheck'] = prev_pay or {
            'label': 'Pay with zero citations',
            'final_pay': compare_actual,
        }
    if slug == 'save_or_buy' and (responses.get('decision') or '').lower() == 'goal':
        item_id = responses.get('item_id')
        item = MarketplaceItem.query.get(item_id) if item_id else None
        if item:
            _upsert_active_goal(
                assignment.student_id,
                item.price,
                marketplace_item_id=item.id,
                custom_label=item.name,
            )
    if slug == 'savings_goal':
        _upsert_active_goal(
            assignment.student_id,
            responses.get('target_amount'),
            marketplace_item_id=responses.get('item_id'),
            custom_label=responses.get('custom_label'),
        )
    assignment.responses_json = json.dumps(responses)
    assignment.status = 'completed'
    assignment.completed_at = datetime.utcnow()
    if not assignment.started_at:
        assignment.started_at = assignment.completed_at
    db.session.commit()
    return jsonify(_serialize_curriculum_assignment(assignment))


@app.route('/api/curriculum/goals', methods=['GET', 'POST', 'PATCH'])
@login_required
def curriculum_goals():
    student_id = _curriculum_resolve_student_id()
    if student_id is False:
        return jsonify({'error': 'Access denied'}), 403
    if not student_id:
        return jsonify({'error': 'Select a student'}), 400
    account = get_or_create_bank_account(student_id)

    if request.method == 'GET':
        goal = SavingsGoal.query.filter_by(student_id=student_id, is_active=True).order_by(
            SavingsGoal.created_at.desc()
        ).first()
        return jsonify(_serialize_savings_goal(goal, account.balance))

    data = request.get_json(silent=True) or {}
    if request.method == 'PATCH' and data.get('complete'):
        goal = SavingsGoal.query.filter_by(student_id=student_id, is_active=True).order_by(
            SavingsGoal.created_at.desc()
        ).first()
        if not goal:
            return jsonify({'error': 'No active goal'}), 400
        goal.is_active = False
        goal.completed_at = datetime.utcnow()
        db.session.commit()
        return jsonify(_serialize_savings_goal(goal, account.balance))

    goal, err = _upsert_active_goal(
        student_id,
        data.get('target_amount'),
        marketplace_item_id=data.get('marketplace_item_id') or data.get('item_id'),
        custom_label=data.get('custom_label'),
    )
    if err:
        return jsonify({'error': err}), 400
    db.session.commit()
    return jsonify(_serialize_savings_goal(goal, account.balance))


# Marketplace catalog: grade-filtered for student (or view-as student_id); staff can get all items with staff=1
@app.route('/api/marketplace/catalog', methods=['GET'])
@login_required
def get_marketplace_catalog():
    """Get marketplace items.

    - Staff/admin with staff=1 get all items + hidden_rules (for management views).
    - With student_id (or current student), return items visible to that student based on
      case-manager assignments and school-wide items, excluding any per-student hidden rules.
    """
    staff_catalog = request.args.get('staff', type=lambda x: x == '1' or x == 'true')
    student_id = request.args.get('student_id', type=int)
    if current_user.role == 'student':
        student_id = current_user.student_id
        staff_catalog = False
    elif current_user.role in ['staff', 'admin'] and student_id:
        if not has_student_access(current_user, student_id):
            return jsonify({'error': 'Access denied'}), 403
    else:
        student_id = current_user.student_id if current_user.role == 'student' else None

    # Staff/admin viewing full catalog (no student): return all active items with hidden_rules
    if staff_catalog and current_user.role in ['staff', 'admin']:
        items_query = MarketplaceItem.query.filter_by(is_active=True)
        q = request.args.get('q', '').strip()
        if q:
            items_query = items_query.filter(
                db.or_(
                    MarketplaceItem.name.ilike(f'%{q}%'),
                    MarketplaceItem.description.ilike(f'%{q}%')
                )
            )
        type_id = request.args.get('type_id', type=int)
        if type_id:
            items_query = items_query.filter(MarketplaceItem.item_type_id == type_id)
        category_id = request.args.get('category_id', type=int)
        if category_id:
            items_query = items_query.filter(MarketplaceItem.category_id == category_id)
        min_price = request.args.get('min_price', type=lambda x: Decimal(x) if x is not None else None)
        if min_price is not None:
            items_query = items_query.filter(MarketplaceItem.price >= min_price)
        max_price = request.args.get('max_price', type=lambda x: Decimal(x) if x is not None else None)
        if max_price is not None:
            items_query = items_query.filter(MarketplaceItem.price <= max_price)
        items = items_query.all()
        return jsonify([{
            'id': item.id,
            'name': item.name,
            'description': item.description or '',
            'price': float(item.price),
            'grade_range': getattr(item, 'grade_range', '9_12'),
            'item_type_id': item.item_type_id,
            'item_type_name': item.item_type.name if item.item_type else None,
            'category_id': item.category_id,
            'category_name': item.category.name if item.category else None,
            'image_url': item.image_url,
            'created_at': utc_isoformat(item.created_at),
            'hidden_rules': [{'id': r.id, 'hidden_type': r.hidden_type, 'value': r.value, 'label': marketplace_hidden_rule_label(r)} for r in item.hidden_rules]
        } for item in items])

    if not student_id:
        return jsonify([])

    student = Student.query.get(student_id)
    if not student:
        return jsonify([])

    # Purely case-manager based visibility:
    # - Non–school-wide items: visible if at least one of the student's case managers has
    #   accepted the item and kept it visible_to_students.
    # - School-wide items: visible by default for all students who have at least one
    #   case manager, unless all of their case managers have explicitly hidden the item.
    case_manager_ids = get_case_manager_user_ids_for_student(student.id)
    if not case_manager_ids:
        # No case manager => no marketplace items visible under the new rules.
        return jsonify([])

    def apply_item_filters(query):
        q = request.args.get('q', '').strip()
        if q:
            query = query.filter(
                db.or_(
                    MarketplaceItem.name.ilike(f'%{q}%'),
                    MarketplaceItem.description.ilike(f'%{q}%')
                )
            )
        type_id = request.args.get('type_id', type=int)
        if type_id:
            query = query.filter(MarketplaceItem.item_type_id == type_id)
        category_id = request.args.get('category_id', type=int)
        if category_id:
            query = query.filter(MarketplaceItem.category_id == category_id)
        min_price = request.args.get('min_price', type=lambda x: Decimal(x) if x is not None else None)
        if min_price is not None:
            query = query.filter(MarketplaceItem.price >= min_price)
        max_price = request.args.get('max_price', type=lambda x: Decimal(x) if x is not None else None)
        if max_price is not None:
            query = query.filter(MarketplaceItem.price <= max_price)
        return query

    # Non–school-wide items with accepted, visible assignments for any of the student's case managers
    assigned_query = db.session.query(MarketplaceItem).join(
        MarketplaceItemCaseManager,
        MarketplaceItemCaseManager.item_id == MarketplaceItem.id
    ).filter(
        MarketplaceItem.is_active.is_(True),
        MarketplaceItem.grade_range != 'school_wide',
        MarketplaceItemCaseManager.case_manager_id.in_(case_manager_ids),
        MarketplaceItemCaseManager.status == 'accepted',
        MarketplaceItemCaseManager.visible_to_students.is_(True),
    )
    assigned_query = apply_item_filters(assigned_query)
    assigned_items = assigned_query.all()

    # School-wide items: active items with grade_range == 'school_wide'
    school_wide_query = MarketplaceItem.query.filter(
        MarketplaceItem.is_active.is_(True),
        MarketplaceItem.grade_range == 'school_wide'
    )
    school_wide_query = apply_item_filters(school_wide_query)
    school_wide_items = school_wide_query.all()

    # For school-wide items, each case manager can explicitly hide the item for their students
    # by creating a MarketplaceItemCaseManager row with visible_to_students = False.
    # The item remains visible to a student as long as at least one of their case managers
    # has not hidden it.
    if school_wide_items:
        item_ids = [item.id for item in school_wide_items]
        overrides = MarketplaceItemCaseManager.query.filter(
            MarketplaceItemCaseManager.item_id.in_(item_ids),
            MarketplaceItemCaseManager.case_manager_id.in_(case_manager_ids),
            MarketplaceItemCaseManager.visible_to_students.is_(False)
        ).all()
        hidden_by_item = {}
        for ov in overrides:
            hidden_by_item.setdefault(ov.item_id, set()).add(ov.case_manager_id)
        visible_school_wide_items = []
        for item in school_wide_items:
            hidden_for = hidden_by_item.get(item.id, set())
            # If there exists at least one case manager for this student who has not hidden the item,
            # the item is visible.
            if case_manager_ids - hidden_for:
                visible_school_wide_items.append(item)
    else:
        visible_school_wide_items = []

    # Combine and de-duplicate items
    items_by_id = {}
    for it in assigned_items + visible_school_wide_items:
        items_by_id[it.id] = it
    items = list(items_by_id.values())

    # Exclude items hidden for this specific student (student, grade section, or card color rules)
    q = request.args.get('q', '').strip()
    # (search is already applied above in apply_item_filters; no need to re-apply here)
    items = [item for item in items if not is_item_hidden_for_student(item.id, student)]
    return jsonify([{
        'id': item.id,
        'name': item.name,
        'description': item.description or '',
        'price': float(item.price),
        'grade_range': getattr(item, 'grade_range', '9_12'),
        'item_type_id': item.item_type_id,
        'item_type_name': item.item_type.name if item.item_type else None,
        'category_id': item.category_id,
        'category_name': item.category.name if item.category else None,
        'image_url': item.image_url,
        'created_at': utc_isoformat(item.created_at)
    } for item in items])


def _resolve_marketplace_image_url(raw_url):
    """Convert Drive/Imgur page URLs to direct image URLs. Returns (final_url, content_type_hint) or (None, None)."""
    if not raw_url or not isinstance(raw_url, str):
        return None, None
    u = raw_url.strip()
    parsed = urlparse(u)
    netloc = (parsed.netloc or '').lower().replace('www.', '')
    # Already direct image URLs: pass through
    if 'i.imgur.com' in netloc:
        return u, None
    if 'drive.google.com' in netloc and '/uc' in (parsed.path or ''):
        return u, None
    # Google Drive: .../file/d/FILE_ID/view... -> uc?export=view&id=FILE_ID (ID can end with hyphen)
    if 'drive.google.com' in netloc:
        match = re.match(r'/file/d/([a-zA-Z0-9\-_.]+)', parsed.path or '')
        if match:
            file_id = match.group(1)
            return f'https://drive.google.com/uc?export=view&id={file_id}', 'image/jpeg'
    # Imgur album: imgur.com/a/ALBUM_ID -> fetch page for og:image
    if 'imgur.com' in netloc and '/a/' in (parsed.path or ''):
        album_match = re.search(r'/a/([a-zA-Z0-9]+)', parsed.path or '')
        if album_match:
            album_id = album_match.group(1)
            try:
                req = Request(
                    f'https://imgur.com/a/{album_id}',
                    headers={'User-Agent': 'Mozilla/5.0 (compatible; MarketplaceImageProxy/1.0)'}
                )
                with urlopen(req, timeout=10) as resp:
                    html = resp.read().decode('utf-8', errors='ignore')
                # og:image content
                og = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
                if not og:
                    og = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html, re.I)
                if og:
                    return og.group(1).strip(), None
            except (URLError, HTTPError, OSError):
                pass
        return None, None
    # Imgur single image page: imgur.com/CODE -> i.imgur.com/CODE.jpg
    if 'imgur.com' in netloc and parsed.path:
        single_match = re.match(r'^/([a-zA-Z0-9]+)/?(\?.*)?$', parsed.path)
        if single_match and single_match.group(1) != 'a':
            code = single_match.group(1)
            return f'https://i.imgur.com/{code}.jpg', 'image/jpeg'
    # Already direct (e.g. i.imgur.com/xxx)
    if 'imgur.com' in netloc or 'drive.google.com' in netloc:
        return u, None
    return None, None


@app.route('/api/marketplace/image-proxy', methods=['GET'])
@login_required
def marketplace_image_proxy():
    """Proxy marketplace images from Google Drive and Imgur so they load without CORS/referrer blocks."""
    raw = request.args.get('url')
    if not raw:
        return '', 400
    try:
        from urllib.parse import unquote
        raw_url = unquote(raw)
    except Exception:
        raw_url = raw
    parsed = urlparse(raw_url)
    netloc = (parsed.netloc or '').lower().replace('www.', '')
    if 'drive.google.com' not in netloc and 'imgur.com' not in netloc:
        return '', 403
    final_url, content_type_hint = _resolve_marketplace_image_url(raw_url)
    if not final_url:
        return '', 404
    try:
        req = Request(
            final_url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; MarketplaceImageProxy/1.0)', 'Referer': ''}
        )
        with urlopen(req, timeout=15) as resp:
            data = resp.read(10 * 1024 * 1024)  # max 10MB
        ct = resp.headers.get('Content-Type', content_type_hint or 'image/jpeg')
        if ';' in ct:
            ct = ct.split(';')[0].strip()
        from flask import Response
        return Response(data, mimetype=ct or 'image/jpeg')
    except (URLError, HTTPError, OSError) as e:
        logging.getLogger(__name__).warning('Marketplace image proxy failed for %s: %s', raw_url[:80], e)
        return '', 502


@app.route('/api/marketplace/checkout', methods=['POST'])
@login_required
def marketplace_checkout():
    """Checkout cart: create one purchase order per cart line. Student only (or staff view-as not used for checkout)."""
    if current_user.role != 'student':
        return jsonify({'error': 'Only students can checkout'}), 403
    
    data = request.json or {}
    cart_lines = data.get('cart', [])  # [{ item_id, quantity }, ...]
    if not cart_lines:
        return jsonify({'error': 'Cart is empty'}), 400
    
    student_id = current_user.student_id
    if not student_id:
        return jsonify({'error': 'No student account'}), 400
    
    account = get_or_create_bank_account(student_id)
    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 400
    
    support_team_ids = get_support_team_user_ids(student_id)
    if not support_team_ids:
        return jsonify({'error': 'No support team assigned'}), 400
    
    case_manager = get_student_case_manager(student_id)
    case_manager_id = case_manager.id if case_manager else list(support_team_ids)[0]
    
    total = Decimal('0')
    orders_to_create = []
    for line in cart_lines:
        item_id = line.get('item_id')
        quantity = int(line.get('quantity', 1))
        if quantity < 1:
            continue
        item = MarketplaceItem.query.get(item_id)
        if not item or not item.is_active:
            return jsonify({'error': f'Item {item_id} is not available'}), 400
        if not student_grade_matches_item_grade_range(student.grade, getattr(item, 'grade_range', '9_12')):
            return jsonify({'error': f'Item {item.name} is not available for your grade'}), 400
        if is_item_hidden_for_student(item.id, student):
            return jsonify({'error': f'Item {item.name} is not available for you'}), 400
        line_total = item.price * quantity
        total += line_total
        for _ in range(quantity):
            orders_to_create.append((item, item.price))
    
    if total > account.balance:
        return jsonify({'error': 'Insufficient funds', 'balance': float(account.balance), 'total': float(total)}), 400
    
    created_orders = []
    balance = account.balance
    for (item, price) in orders_to_create:
        balance_after = balance - price
        order = PurchaseOrder(
            student_id=student_id,
            item_id=item.id,
            item_price=price,
            student_balance_before=balance,
            student_calculated_balance_after=balance_after,
            actual_balance_after=balance_after,
            is_calculation_correct=True,
            status='pending',
            case_manager_id=case_manager_id
        )
        db.session.add(order)
        created_orders.append((order, item.name, float(price)))
        balance = balance_after
    db.session.flush()
    running_balance = account.balance
    for (order, item_name, price_float) in created_orders:
        price_decimal = Decimal(str(price_float))
        running_balance = running_balance - price_decimal
        order.actual_balance_after = running_balance
        transaction = Transaction(
            student_id=student_id,
            bank_account_id=account.id,
            transaction_type='purchase',
            amount=-price_decimal,
            purchase_order_id=order.id,
            balance_after=running_balance,
            description=f'Purchase (pending fulfillment): {item_name}'
        )
        db.session.add(transaction)
    account.balance = running_balance
    account.updated_at = datetime.utcnow()
    for order, item_name, _price in created_orders:
        notify_support_team_purchase_order_pending(student_id, order.id, item_name)
    db.session.commit()
    created = [{'id': o.id, 'item_name': name, 'item_price': p} for o, name, p in created_orders]
    return jsonify({'message': 'Purchase orders created', 'orders': created}), 201


# Legacy list (all items for staff; kept for compatibility)
@app.route('/api/marketplace-items', methods=['GET'])
@login_required
def get_marketplace_items():
    """Get marketplace items (all active for staff/admin; for student use catalog)"""
    items_query = MarketplaceItem.query.filter_by(is_active=True)
    
    if current_user.role == 'student':
        student_id = current_user.student_id
        if not student_id:
            return jsonify([])
        student = Student.query.get(student_id)
        if not student:
            return jsonify([])
        grade_ranges_visible = ['school_wide']
        if student_grade_matches_item_grade_range(student.grade, 'k_3'):
            grade_ranges_visible.append('k_3')
        if student_grade_matches_item_grade_range(student.grade, '4_8'):
            grade_ranges_visible.append('4_8')
        if student_grade_matches_item_grade_range(student.grade, '9_12'):
            grade_ranges_visible.append('9_12')
        items_query = items_query.filter(MarketplaceItem.grade_range.in_(grade_ranges_visible))
    
    items = items_query.all()
    return jsonify([{
        'id': item.id,
        'name': item.name,
        'description': item.description or '',
        'price': float(item.price),
        'grade_range': getattr(item, 'grade_range', '9_12'),
        'item_type_id': item.item_type_id,
        'item_type_name': item.item_type.name if item.item_type else None,
        'category_id': item.category_id,
        'category_name': item.category.name if item.category else None,
        'image_url': item.image_url,
        'created_by_user_id': item.created_by_user_id,
        'is_global': item.is_global,
        'is_approved_for_global': item.is_approved_for_global,
        'created_at': utc_isoformat(item.created_at)
    } for item in items])

@app.route('/api/marketplace-items', methods=['POST'])
@login_required
def create_marketplace_item():
    """Create new marketplace item (staff except outside staff, and admin)"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    if current_user.role == 'staff' and getattr(current_user, 'is_outside_staff', False):
        return jsonify({'error': 'Outside staff cannot create marketplace items'}), 403
    
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
    
    try:
        name = data.get('name')
        description = data.get('description', '')
        price = Decimal(str(data.get('price', 0)))
        # Case-manager based visibility: collect target case managers and optional school-wide flag.
        raw_case_manager_ids = data.get('case_manager_ids') or []
        if not isinstance(raw_case_manager_ids, list):
            raw_case_manager_ids = []
        case_manager_ids = []
        for cm_id in raw_case_manager_ids:
            try:
                cid = int(cm_id)
            except (TypeError, ValueError):
                continue
            if cid not in case_manager_ids:
                case_manager_ids.append(cid)

        is_school_wide = bool(data.get('is_school_wide', False))
        if is_school_wide and current_user.role != 'admin':
            return jsonify({'error': 'Only admins can create school-wide items'}, 403)

        # For non–school-wide items, at least one case manager must be selected.
        if not is_school_wide and not case_manager_ids:
            return jsonify({'error': 'Select at least one Case Manager or mark the item as school-wide'}, 400)

        # Validate case managers: must be staff Case Managers, and for staff creators,
        # only case managers they are "on a team with" (share at least one student).
        valid_case_manager_ids = []
        for cid in case_manager_ids:
            cm = User.query.get(cid)
            if not cm or cm.role != 'staff' or getattr(cm, 'designation', None) != 'Case Manager':
                continue
            if current_user.role == 'staff' and current_user.role != 'admin':
                if not are_users_on_same_student_team(current_user, cm):
                    continue
            valid_case_manager_ids.append(cid)

        case_manager_ids = list(dict.fromkeys(valid_case_manager_ids))  # de-duplicate while preserving order
        if not is_school_wide and not case_manager_ids:
            return jsonify({'error': 'You can only assign items to Case Managers you share students with'}, 400)

        # Preserve grade_range column for compatibility, but it no longer drives visibility.
        # Use 'school_wide' to flag true global items; otherwise a default value.
        grade_range = 'school_wide' if is_school_wide else '9_12'
        item_type_id = data.get('item_type_id')
        category_id = data.get('category_id')
        image_url = (data.get('image_url') or '').strip() or None
        
        if not name or price <= 0:
            return jsonify({'error': 'Name and valid price required'}), 400
        
        item = MarketplaceItem(
            name=name,
            description=description,
            price=price,
            created_by_user_id=current_user.id,
            is_global=data.get('is_global', False),
            grade_range=grade_range,
            item_type_id=item_type_id,
            category_id=category_id,
            image_url=image_url
        )
        db.session.add(item)
        db.session.flush()

        # Create per-case-manager assignments for non–school-wide items.
        # - If the creator is a Case Manager and includes themselves, auto-accept that assignment.
        # - Other case managers start in 'pending' state and receive notifications.
        if not is_school_wide and case_manager_ids:
            for cid in case_manager_ids:
                cm = User.query.get(cid)
                if not cm:
                    continue
                if cm.id == current_user.id and getattr(current_user, 'designation', None) == 'Case Manager':
                    status = 'accepted'
                    visible_to_students = True
                else:
                    status = 'pending'
                    visible_to_students = False
                assignment = MarketplaceItemCaseManager(
                    item_id=item.id,
                    case_manager_id=cid,
                    status=status,
                    visible_to_students=visible_to_students,
                    created_by_user_id=current_user.id
                )
                db.session.add(assignment)

                # Notify case managers other than the creator about new assignments.
                if status == 'pending':
                    notif = Notification(
                        user_id=cid,
                        type='marketplace_item_assigned',
                        title='New marketplace item assigned to you',
                        body=f'A new marketplace item "{name}" was assigned to you for review.'
                    )
                    db.session.add(notif)

        db.session.commit()
        
        return jsonify({
            'id': item.id,
            'name': item.name,
            'description': item.description or '',
            'price': float(item.price),
            'grade_range': item.grade_range,
            'item_type_id': item.item_type_id,
            'category_id': item.category_id,
            'image_url': item.image_url,
            'created_by_user_id': item.created_by_user_id,
            'is_global': item.is_global,
            'created_at': utc_isoformat(item.created_at)
        }), 201
    except Exception as e:
        db.session.rollback()
        app.logger.exception("create_marketplace_item failed")
        err_msg = str(e) if str(e) else "Database or server error"
        return jsonify({'error': err_msg}), 500

@app.route('/api/marketplace-items/<int:item_id>', methods=['PUT'])
@login_required
def update_marketplace_item(item_id):
    """Update marketplace item (creator or admin)"""
    item = MarketplaceItem.query.get_or_404(item_id)
    
    if current_user.role != 'admin' and item.created_by_user_id != current_user.id:
        return jsonify({'error': 'Permission denied'}), 403
    
    data = request.json
    if 'name' in data:
        item.name = data['name']
    if 'description' in data:
        item.description = data['description']
    if 'price' in data:
        item.price = Decimal(str(data['price']))
    if 'is_active' in data:
        item.is_active = data['is_active']
    if 'grade_range' in data and data['grade_range'] in ('k_3', '4_8', '9_12', 'school_wide'):
        if data['grade_range'] == 'school_wide' and current_user.role != 'admin':
            pass  # don't allow non-admin to set school_wide
        else:
            item.grade_range = data['grade_range']
    if 'item_type_id' in data:
        item.item_type_id = data['item_type_id']
    if 'category_id' in data:
        item.category_id = data['category_id']
    if 'image_url' in data:
        item.image_url = (data['image_url'] or '').strip() or None
    
    item.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        'id': item.id,
        'name': item.name,
        'description': item.description or '',
        'price': float(item.price),
        'grade_range': item.grade_range,
        'item_type_id': item.item_type_id,
        'category_id': item.category_id,
        'image_url': item.image_url,
        'is_active': item.is_active,
        'updated_at': utc_isoformat(item.updated_at)
    })

@app.route('/api/marketplace-items/<int:item_id>', methods=['DELETE'])
@login_required
def delete_marketplace_item(item_id):
    """Delete marketplace item (creator or admin)"""
    item = MarketplaceItem.query.get_or_404(item_id)
    
    if current_user.role != 'admin' and item.created_by_user_id != current_user.id:
        return jsonify({'error': 'Permission denied'}), 403
    
    # Soft delete by setting is_active to False
    item.is_active = False
    item.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({'message': 'Item deleted successfully'})


@app.route('/api/marketplace-items/<int:item_id>/hidden-rules', methods=['GET'])
@login_required
def get_marketplace_item_hidden_rules(item_id):
    """List hidden rules for an item (staff/admin)."""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    item = MarketplaceItem.query.get_or_404(item_id)
    rules = MarketplaceItemHiddenRule.query.filter_by(item_id=item_id).all()
    return jsonify([{'id': r.id, 'hidden_type': r.hidden_type, 'value': r.value, 'label': marketplace_hidden_rule_label(r), 'created_at': utc_isoformat(r.created_at)} for r in rules])


@app.route('/api/marketplace-items/<int:item_id>/hidden-rules', methods=['POST'])
@login_required
def add_marketplace_item_hidden_rule(item_id):
    """Add a hidden rule: hide item from specific student, card_color, or grade_section (staff/admin)."""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    item = MarketplaceItem.query.get_or_404(item_id)
    data = request.json or {}
    hidden_type = (data.get('hidden_type') or '').strip()
    value = (data.get('value') or '').strip()
    if hidden_type not in ('student', 'card_color', 'grade_section') or not value:
        return jsonify({'error': 'hidden_type must be student, card_color, or grade_section and value is required'}), 400
    # Avoid duplicate rule
    existing = MarketplaceItemHiddenRule.query.filter_by(item_id=item_id, hidden_type=hidden_type, value=value).first()
    if existing:
        return jsonify({'id': existing.id, 'hidden_type': existing.hidden_type, 'value': existing.value}), 200
    rule = MarketplaceItemHiddenRule(item_id=item_id, hidden_type=hidden_type, value=value)
    db.session.add(rule)
    db.session.commit()
    return jsonify({'id': rule.id, 'hidden_type': rule.hidden_type, 'value': rule.value, 'created_at': utc_isoformat(rule.created_at)}), 201


@app.route('/api/marketplace-items/<int:item_id>/hidden-rules/<int:rule_id>', methods=['DELETE'])
@login_required
def remove_marketplace_item_hidden_rule(item_id, rule_id):
    """Remove a hidden rule (staff/admin)."""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    rule = MarketplaceItemHiddenRule.query.filter_by(item_id=item_id, id=rule_id).first_or_404()
    db.session.delete(rule)
    db.session.commit()
    return jsonify({'message': 'Rule removed'})

@app.route('/api/marketplace-items/<int:item_id>/request-global', methods=['POST'])
@login_required
def request_global_marketplace_item(item_id):
    """Request item to be added to global list"""
    item = MarketplaceItem.query.get_or_404(item_id)
    
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    # Check if request already exists
    existing_request = MarketplaceItemRequest.query.filter_by(
        item_id=item_id,
        requested_by_user_id=current_user.id,
        status='pending'
    ).first()
    
    if existing_request:
        return jsonify({'error': 'Request already pending'}), 400
    
    request_obj = MarketplaceItemRequest(
        item_id=item_id,
        requested_by_user_id=current_user.id,
        request_type='add_to_global',
        status='pending'
    )
    db.session.add(request_obj)
    db.session.commit()
    
    return jsonify({
        'id': request_obj.id,
        'item_id': request_obj.item_id,
        'status': request_obj.status,
        'created_at': utc_isoformat(request_obj.created_at)
    }), 201

@app.route('/api/marketplace-item-requests', methods=['GET'])
@login_required
def get_marketplace_item_requests():
    """Get pending requests (admin/case manager)"""
    if current_user.role == 'admin':
        requests = MarketplaceItemRequest.query.filter_by(status='pending').all()
    elif current_user.designation == 'Case Manager':
        # Case managers see requests for items they created
        requests = MarketplaceItemRequest.query.join(MarketplaceItem).filter(
            MarketplaceItemRequest.status == 'pending',
            MarketplaceItem.created_by_user_id == current_user.id
        ).all()
    else:
        return jsonify({'error': 'Permission denied'}), 403
    
    return jsonify([{
        'id': r.id,
        'item_id': r.item_id,
        'item_name': r.item.name,
        'item_description': r.item.description,
        'item_price': float(r.item.price),
        'requested_by_user_id': r.requested_by_user_id,
        'requester_name': r.requester.name if r.requester else None,
        'request_type': r.request_type,
        'status': r.status,
        'created_at': utc_isoformat(r.created_at)
    } for r in requests])

@app.route('/api/marketplace-item-requests/<int:request_id>/approve', methods=['POST'])
@login_required
@admin_required
def approve_marketplace_item_request(request_id):
    """Approve request (admin only)"""
    request_obj = MarketplaceItemRequest.query.get_or_404(request_id)
    
    if request_obj.status != 'pending':
        return jsonify({'error': 'Request already processed'}), 400
    
    request_obj.status = 'approved'
    request_obj.reviewed_at = datetime.utcnow()
    request_obj.reviewed_by_user_id = current_user.id
    
    # Make item global
    request_obj.item.is_approved_for_global = True
    request_obj.item.is_global = True
    request_obj.item.updated_at = datetime.utcnow()
    
    db.session.commit()
    
    return jsonify({'message': 'Request approved', 'status': 'approved'})

@app.route('/api/marketplace-item-requests/<int:request_id>/deny', methods=['POST'])
@login_required
@admin_required
def deny_marketplace_item_request(request_id):
    """Deny request (admin only)"""
    request_obj = MarketplaceItemRequest.query.get_or_404(request_id)
    
    if request_obj.status != 'pending':
        return jsonify({'error': 'Request already processed'}), 400
    
    request_obj.status = 'denied'
    request_obj.reviewed_at = datetime.utcnow()
    request_obj.reviewed_by_user_id = current_user.id
    
    db.session.commit()
    
    return jsonify({'message': 'Request denied', 'status': 'denied'})

# Purchase Order Routes
def _po_to_json(o):
    item = o.item
    return {
        'id': o.id,
        'student_id': o.student_id,
        'student_name': o.student.name,
        'item_id': o.item_id,
        'item_name': item.name if item else '',
        'item_price': float(o.item_price),
        'item_grade_range': getattr(item, 'grade_range', '9_12') if item else '9_12',
        'student_balance_before': float(o.student_balance_before),
        'student_calculated_balance_after': float(o.student_calculated_balance_after),
        'actual_balance_after': float(o.actual_balance_after),
        'is_calculation_correct': o.is_calculation_correct,
        'status': o.status,
        'case_manager_id': o.case_manager_id,
        'approved_by_user_id': o.approved_by_user_id,
        'approved_by_name': o.approved_by.name if o.approved_by else None,
        'denied_by_user_id': o.denied_by_user_id,
        'denied_by_name': o.denied_by.name if o.denied_by else None,
        'denial_reason': o.denial_reason,
        'created_at': utc_isoformat(o.created_at),
        'approved_at': utc_isoformat(o.approved_at),
        'fulfilled_at': utc_isoformat(o.fulfilled_at)
    }


@app.route('/api/purchase-orders', methods=['GET'])
@login_required
def get_purchase_orders():
    """Get purchase orders (student: own; staff: support team students only)"""
    if current_user.role == 'student':
        orders = PurchaseOrder.query.filter_by(student_id=current_user.student_id).order_by(PurchaseOrder.created_at.desc()).all()
    elif current_user.role == 'staff':
        team_student_ids = get_student_ids_for_staff_user(current_user)
        if not team_student_ids:
            orders = []
        else:
            orders = PurchaseOrder.query.filter(
                PurchaseOrder.student_id.in_(team_student_ids)
            ).order_by(PurchaseOrder.created_at.desc()).all()
    else:
        orders = []
    
    return jsonify([_po_to_json(o) for o in orders])

@app.route('/api/purchase-orders', methods=['POST'])
@login_required
def create_purchase_order():
    """Create single purchase order (legacy; prefer checkout for cart)"""
    if current_user.role != 'student':
        return jsonify({'error': 'Only students can create purchase orders'}), 403
    
    data = request.json
    item_id = data.get('item_id')
    student_calculated_balance_after = Decimal(str(data.get('calculated_balance_after', 0)))
    
    if not item_id:
        return jsonify({'error': 'Item ID required'}), 400
    
    item = MarketplaceItem.query.get_or_404(item_id)
    if not item.is_active:
        return jsonify({'error': 'Item is not available'}), 400
    
    student_id = current_user.student_id
    if not student_id:
        return jsonify({'error': 'No student account'}), 400
    student = Student.query.get(student_id)
    if not student_grade_matches_item_grade_range(student.grade, getattr(item, 'grade_range', '9_12')):
        return jsonify({'error': 'Item not available for your grade'}), 400
    
    account = get_or_create_bank_account(student_id)
    student_balance_before = account.balance
    actual_balance_after = student_balance_before - item.price
    
    tolerance = Decimal('0.01')
    is_calculation_correct = abs(student_calculated_balance_after - actual_balance_after) <= tolerance
    
    if actual_balance_after < 0:
        return jsonify({'error': 'Insufficient funds'}), 400
    
    if not is_calculation_correct:
        return jsonify({
            'error': 'Calculation incorrect',
            'expected': float(actual_balance_after),
            'got': float(student_calculated_balance_after)
        }), 400
    
    support_team_ids = get_support_team_user_ids(student_id)
    if not support_team_ids:
        return jsonify({'error': 'No support team assigned'}), 400
    case_manager = get_student_case_manager(student_id)
    case_manager_id = case_manager.id if case_manager else list(support_team_ids)[0]
    
    order = PurchaseOrder(
        student_id=student_id,
        item_id=item_id,
        item_price=item.price,
        student_balance_before=student_balance_before,
        student_calculated_balance_after=student_calculated_balance_after,
        actual_balance_after=actual_balance_after,
        is_calculation_correct=is_calculation_correct,
        status='pending',
        case_manager_id=case_manager_id
    )
    db.session.add(order)
    db.session.flush()
    notify_support_team_purchase_order_pending(student_id, order.id, item.name)
    db.session.commit()
    
    return jsonify({
        'id': order.id,
        'status': order.status,
        'message': 'Purchase order created successfully'
    }), 201

@app.route('/api/purchase-orders/<int:order_id>', methods=['GET'])
@login_required
def get_purchase_order(order_id):
    """Get specific purchase order"""
    order = PurchaseOrder.query.get_or_404(order_id)
    
    if current_user.role == 'student' and order.student_id != current_user.student_id:
        return jsonify({'error': 'Access denied'}), 403
    
    if current_user.role == 'staff' and not user_is_on_student_support_team(current_user, order.student_id):
        return jsonify({'error': 'Access denied'}), 403
    if current_user.role not in ('student', 'staff'):
        return jsonify({'error': 'Access denied'}), 403
    
    return jsonify(_po_to_json(order))

@app.route('/api/purchase-orders/<int:order_id>/status', methods=['PUT'])
@login_required
def update_purchase_order_status(order_id):
    """Fulfill or deny purchase order (any support team member)"""
    order = PurchaseOrder.query.get_or_404(order_id)
    
    support_team_ids = get_support_team_user_ids(order.student_id)
    if current_user.id not in support_team_ids:
        return jsonify({'error': 'Permission denied'}), 403
    
    data = request.json or {}
    new_status = data.get('status')
    denial_reason = (data.get('denial_reason') or '').strip() or None
    
    if new_status not in ('approved', 'denied'):
        return jsonify({'error': 'Invalid status; use approved or denied'}), 400
    
    if order.status != 'pending':
        return jsonify({'error': 'Order is not pending'}), 400
    
    student_user = User.query.filter_by(role='student', student_id=order.student_id).first()
    student_user_id = student_user.id if student_user else None
    
    if new_status == 'denied':
        order.status = 'denied'
        order.denied_by_user_id = current_user.id
        order.denial_reason = denial_reason
        purchase_txn = Transaction.query.filter_by(
            purchase_order_id=order.id, transaction_type='purchase'
        ).first()
        if purchase_txn:
            account = get_or_create_bank_account(order.student_id)
            account.balance += order.item_price
            account.updated_at = datetime.utcnow()
            item_name = order.item.name if order.item else 'item'
            refund_txn = Transaction(
                student_id=order.student_id,
                bank_account_id=account.id,
                transaction_type='refund',
                amount=order.item_price,
                purchase_order_id=order.id,
                balance_after=account.balance,
                description=f'Refund (purchase denied): {item_name}'
            )
            db.session.add(refund_txn)
        if student_user_id:
            item_name = order.item.name if order.item else 'item'
            create_purchase_notification(
                student_user_id, 'purchase_denied',
                'Purchase denied',
                f"Your purchase of {item_name} was denied." + (f" Reason: {denial_reason}" if denial_reason else ""),
                order.id
            )
        db.session.commit()
        return jsonify({'id': order.id, 'status': 'denied', 'message': 'Order denied'})
    
    if new_status == 'approved':
        purchase_txn = Transaction.query.filter_by(
            purchase_order_id=order.id, transaction_type='purchase'
        ).first()
        if purchase_txn:
            order.status = 'approved'
            order.approved_at = datetime.utcnow()
            order.approved_by_user_id = current_user.id
            order.fulfilled_at = datetime.utcnow()
            if student_user_id:
                item_name = order.item.name if order.item else 'item'
                create_purchase_notification(
                    student_user_id, 'purchase_approved',
                    'Purchase fulfilled',
                    f"Your purchase of {item_name} was fulfilled by {current_user.name or current_user.username}.",
                    order.id
                )
            db.session.commit()
            return jsonify({'id': order.id, 'status': 'approved', 'message': 'Order fulfilled'})
        account = get_or_create_bank_account(order.student_id)
        if account.balance < order.item_price:
            order.status = 'denied'
            order.denied_by_user_id = None
            order.denial_reason = 'Insufficient funds at fulfillment time'
            if student_user_id:
                create_purchase_notification(
                    student_user_id, 'purchase_denied',
                    'Purchase denied',
                    'Your purchase was denied due to insufficient funds.',
                    order.id
                )
            db.session.commit()
            return jsonify({'error': 'Insufficient funds', 'status': 'denied'}), 400
        order.status = 'approved'
        order.approved_at = datetime.utcnow()
        order.approved_by_user_id = current_user.id
        order.fulfilled_at = datetime.utcnow()
        account.balance = order.actual_balance_after
        account.updated_at = datetime.utcnow()
        item_name = order.item.name if order.item else 'Purchase'
        transaction = Transaction(
            student_id=order.student_id,
            bank_account_id=account.id,
            transaction_type='purchase',
            amount=-order.item_price,
            purchase_order_id=order.id,
            balance_after=account.balance,
            description=f'Purchase: {item_name}'
        )
        db.session.add(transaction)
        if student_user_id:
            item_name = order.item.name if order.item else 'item'
            create_purchase_notification(
                student_user_id, 'purchase_approved',
                'Purchase fulfilled',
                f"Your purchase of {item_name} was fulfilled by {current_user.name or current_user.username}.",
                order.id
            )
        db.session.commit()
        return jsonify({'id': order.id, 'status': 'approved', 'message': 'Order fulfilled'})
    
    return jsonify({'error': 'Invalid status'}), 400

@app.route('/api/purchase-orders/case-manager/<int:user_id>', methods=['GET'])
@login_required
def get_case_manager_purchase_orders(user_id):
    """Get purchase orders for students on the given staff member's support team."""
    if current_user.role != 'admin' and current_user.id != user_id:
        return jsonify({'error': 'Permission denied'}), 403
    
    target_user = User.query.get_or_404(user_id)
    team_student_ids = get_student_ids_for_staff_user(target_user)
    if not team_student_ids:
        orders = []
    else:
        orders = PurchaseOrder.query.filter(
            PurchaseOrder.student_id.in_(team_student_ids)
        ).order_by(PurchaseOrder.created_at.desc()).all()
    
    return jsonify([{
        'id': o.id,
        'student_id': o.student_id,
        'student_name': o.student.name,
        'item_id': o.item_id,
        'item_name': o.item.name,
        'item_price': float(o.item_price),
        'status': o.status,
        'created_at': utc_isoformat(o.created_at)
    } for o in orders])


# Notifications API
@app.route('/api/notifications', methods=['GET'])
@login_required
def get_notifications():
    """Get current user's notifications (unread first, limit 50)"""
    notifications = Notification.query.filter_by(user_id=current_user.id).order_by(
        Notification.created_at.desc()
    ).limit(50).all()
    return jsonify([{
        'id': n.id,
        'type': n.type,
        'title': n.title,
        'body': n.body,
        'purchase_order_id': n.purchase_order_id,
        'curriculum_assignment_id': n.curriculum_assignment_id,
        'read_at': utc_isoformat(n.read_at),
        'created_at': utc_isoformat(n.created_at)
    } for n in notifications])


@app.route('/api/notifications/<int:notification_id>/read', methods=['PATCH', 'POST'])
@login_required
def mark_notification_read(notification_id):
    """Mark a notification as read"""
    n = Notification.query.get_or_404(notification_id)
    if n.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403
    n.read_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'id': n.id, 'read_at': utc_isoformat(n.read_at)})


@app.route('/api/notifications/read-all', methods=['PATCH', 'POST'])
@login_required
def mark_all_notifications_read():
    """Mark all notifications as read for current user"""
    Notification.query.filter_by(user_id=current_user.id).filter(Notification.read_at.is_(None)).update(
        {'read_at': datetime.utcnow()}
    )
    db.session.commit()
    return jsonify({'message': 'All notifications marked as read'})


# Case managers that the current user can assign marketplace items to (same team for staff, all for admin)
@app.route('/api/marketplace/case-managers', methods=['GET'])
@login_required
def get_marketplace_assignable_case_managers():
    """Return case managers the current user can assign items to. Staff: only those on same student team; Admin: all."""
    if current_user.role not in ('staff', 'admin'):
        return jsonify([])
    case_managers = User.query.filter(
        User.role == 'staff',
        User.designation == 'Case Manager',
        User.is_outside_staff.is_(False)
    ).order_by(User.name, User.username).all()
    if current_user.role == 'admin':
        return jsonify([{'id': u.id, 'name': (u.name or u.username or '').strip() or u.username, 'username': u.username or ''} for u in case_managers])
    # Staff: only case managers with at least one student in common
    assignable = [u for u in case_managers if are_users_on_same_student_team(current_user, u)]
    return jsonify([{'id': u.id, 'name': (u.name or u.username or '').strip() or u.username, 'username': u.username or ''} for u in assignable])


# Marketplace admin: item types and categories
@app.route('/api/marketplace/types', methods=['GET'])
@login_required
def get_marketplace_types():
    """Get all marketplace item types (admin-managed)"""
    types = MarketplaceItemType.query.order_by(MarketplaceItemType.sort_order, MarketplaceItemType.name).all()
    return jsonify([{'id': t.id, 'name': t.name, 'sort_order': t.sort_order} for t in types])


@app.route('/api/marketplace/types', methods=['POST'])
@login_required
@staff_required
def create_marketplace_type():
    """Create item type (staff or admin)"""
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    if MarketplaceItemType.query.filter_by(name=name).first():
        return jsonify({'error': 'Type already exists'}), 400
    t = MarketplaceItemType(name=name, sort_order=data.get('sort_order', 0))
    db.session.add(t)
    db.session.commit()
    return jsonify({'id': t.id, 'name': t.name, 'sort_order': t.sort_order}), 201


@app.route('/api/marketplace/categories', methods=['GET'])
@login_required
def get_marketplace_categories():
    """Get all marketplace categories (admin-managed)"""
    cats = MarketplaceCategory.query.order_by(MarketplaceCategory.sort_order, MarketplaceCategory.name).all()
    return jsonify([{'id': c.id, 'name': c.name, 'sort_order': c.sort_order} for c in cats])


@app.route('/api/marketplace/categories', methods=['POST'])
@login_required
@staff_required
def create_marketplace_category():
    """Create category (staff or admin)"""
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    if MarketplaceCategory.query.filter_by(name=name).first():
        return jsonify({'error': 'Category already exists'}), 400
    c = MarketplaceCategory(name=name, sort_order=data.get('sort_order', 0))
    db.session.add(c)
    db.session.commit()
    return jsonify({'id': c.id, 'name': c.name, 'sort_order': c.sort_order}), 201


@app.route('/api/marketplace/analytics', methods=['GET'])
@login_required
def get_marketplace_analytics():
    """Purchase analytics for staff/admin: most/least purchased, demographics by grade and card color."""
    if current_user.role not in ('staff', 'admin'):
        return jsonify({'error': 'Staff or admin only'}), 403

    from collections import defaultdict
    from sqlalchemy.orm import joinedload

    allowed_student_ids = None
    if current_user.role == 'staff' and current_user.is_outside_staff:
        allowed_student_ids = {
            a.student_id for a in OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()
        }
        if not allowed_student_ids:
            return jsonify({
                'most_purchased': [],
                'least_purchased': [],
                'never_purchased': [],
                'demographics_by_item': {},
                'item_index': {}
            })

    q = PurchaseOrder.query.options(
        joinedload(PurchaseOrder.student),
        joinedload(PurchaseOrder.item),
    ).filter(PurchaseOrder.status.in_(['approved', 'fulfilled']))
    if allowed_student_ids is not None:
        q = q.filter(PurchaseOrder.student_id.in_(allowed_student_ids))
    orders = q.all()

    count_by_item = defaultdict(int)
    by_item_grade = defaultdict(lambda: defaultdict(int))
    by_item_card_color = defaultdict(lambda: defaultdict(int))
    item_names = {}

    for o in orders:
        item_id = o.item_id
        count_by_item[item_id] += 1
        item_names[item_id] = o.item.name if o.item else f'Item #{item_id}'
        g = (o.student.grade or '').strip() or None
        grade_key = g if g else '(none)'
        by_item_grade[item_id][grade_key] += 1
        c = (o.student.card_color or '').strip() or None
        color_key = c if c else 'none'
        by_item_card_color[item_id][color_key] += 1

    sorted_items = sorted(count_by_item.items(), key=lambda x: -x[1])
    top_n = 15
    most_purchased = [
        {'item_id': iid, 'item_name': item_names.get(iid, f'Item #{iid}'), 'purchase_count': c}
        for iid, c in sorted_items[:top_n]
    ]
    purchased_list = [(iid, c) for iid, c in sorted_items]
    least_list = purchased_list[-top_n:] if len(purchased_list) > top_n else purchased_list
    least_purchased = [
        {'item_id': iid, 'item_name': item_names.get(iid, f'Item #{iid}'), 'purchase_count': c}
        for iid, c in least_list
    ]
    least_purchased.reverse()

    active_ids = {i.id for i in MarketplaceItem.query.filter_by(is_active=True).all()}
    purchased_ids = set(count_by_item.keys())
    never_ids = active_ids - purchased_ids
    never_name_map = {i.id: i.name for i in MarketplaceItem.query.filter(MarketplaceItem.id.in_(never_ids)).all()} if never_ids else {}
    never_items = [
        {'item_id': iid, 'item_name': never_name_map.get(iid, f'Item #{iid}'), 'purchase_count': 0}
        for iid in never_ids
    ]
    never_items.sort(key=lambda x: x['item_name'])

    demographics_by_item = {}
    for iid in set(count_by_item.keys()):
        demographics_by_item[iid] = {
            'by_grade': dict(by_item_grade[iid]),
            'by_card_color': dict(by_item_card_color[iid]),
        }

    item_index = {iid: item_names.get(iid, f'Item #{iid}') for iid in item_names}

    return jsonify({
        'most_purchased': most_purchased,
        'least_purchased': least_purchased,
        'never_purchased': never_items,
        'demographics_by_item': demographics_by_item,
        'item_index': item_index,
    })


@app.route('/api/bank-account/search', methods=['GET'])
@login_required
@staff_required
def search_bank_accounts():
    """Search for student bank accounts. Returns only active students (those in Student Users table).
    When no query, uses same access rules as /api/students. With ?q=..., searches by student name or
    case manager; with ?managed_by_me=true, restricts to managed students."""
    query = request.args.get('q', '').strip()
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    
    if query:
        # Search by student name
        students_by_name = Student.query.filter(Student.name.ilike(f'%{query}%')).all()
        
        # Also search by staff name (case manager) - similar to daily entry
        staff_members = User.query.filter(
            db.or_(
                User.name.ilike(f'%{query}%'),
                User.username.ilike(f'%{query}%')
            )
        ).all()
        
        staff_names = [s.name for s in staff_members if s.name]
        team_members = TeamMember.query.filter(
            TeamMember.name.in_(staff_names)
        ).all() if staff_names else []
        
        student_ids_from_staff = list(set([tm.student_id for tm in team_members]))
        
        # Combine results
        all_student_ids = set([s.id for s in students_by_name])
        all_student_ids.update(student_ids_from_staff)
        
        students = Student.query.filter(Student.id.in_(list(all_student_ids))).all() if all_student_ids else []
        if managed_by_me:
            user_name = (current_user.name or current_user.username) or ''
            user_username = (current_user.username or '').strip()
            if not user_name and not user_username:
                students = []
            else:
                team_members = TeamMember.query.filter(
                    (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
                    (db.func.lower(TeamMember.name) == db.func.lower(user_username))
                ).all()
                managed_ids = {tm.student_id for tm in team_members if tm.student_id}
                students = [s for s in students if s.id in managed_ids]
    else:
        # No query: return all students staff can access (same logic as /api/students but without
        # restricting to "student user accounts only"). Staff need to look up any student's bank
        # account; bank accounts are per-Student, not per-User.
        if current_user.role == 'staff' and current_user.is_outside_staff:
            assigned_student_ids = [a.student_id for a in
                                   OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
            if not assigned_student_ids:
                students = []
            else:
                query_obj = Student.query.filter(Student.id.in_(assigned_student_ids))
                if managed_by_me:
                    user_name = (current_user.name or current_user.username) or ''
                    user_username = (current_user.username or '').strip()
                    if not user_name and not user_username:
                        sid_list = []
                    else:
                        team_members = TeamMember.query.filter(
                            (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
                            (db.func.lower(TeamMember.name) == db.func.lower(user_username))
                        ).all()
                        sid_list = list(set([tm.student_id for tm in team_members if tm.student_id]))
                    sid_list = [sid for sid in sid_list if sid in assigned_student_ids]
                    students = query_obj.filter(Student.id.in_(sid_list)).order_by(Student.name).all() if sid_list else []
                else:
                    students = query_obj.order_by(Student.name).all()
        else:
            query_obj = Student.query
            if managed_by_me:
                user_name = (current_user.name or current_user.username) or ''
                user_username = (current_user.username or '').strip()
                if not user_name and not user_username:
                    student_ids = []
                else:
                    team_members = TeamMember.query.filter(
                        (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
                        (db.func.lower(TeamMember.name) == db.func.lower(user_username))
                    ).all()
                    student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
                if student_ids:
                    students = query_obj.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
                else:
                    students = []
            else:
                students = query_obj.order_by(Student.name).all()
        students = filter_directory_info(students, include_opted_out=False)
    
    # Restrict to active students only (those in Student Users / User Management)
    student_users = User.query.filter_by(role='student').all()
    student_user_ids = {u.student_id for u in student_users if u.student_id}
    students = [s for s in students if s.id in student_user_ids]
    
    # When managed_by_me is true, the list is already restricted above to students where the current
    # user appears in any column in that student's row (Case Manager, Practitioner, Professional,
    # Group Leader, Paraprofessional). No further role-based filter.

    # Get bank accounts for these students
    result = []
    for student in students:
        account = BankAccount.query.filter_by(student_id=student.id).first()
        balance = float(account.balance) if account else 0.0
        
        result.append({
            'student_id': student.id,
            'student_name': student.name,
            'balance': balance
        })
    
    msg = (
        'bank-account/search: role=%s outside_staff=%s managed_by_me=%s query=%r students=%d result=%d'
        % (
            getattr(current_user, 'role', None),
            getattr(current_user, 'is_outside_staff', None),
            managed_by_me,
            query or None,
            len(students),
            len(result),
        )
    )
    app.logger.info(msg)
    print(msg)
    resp = jsonify(result)
    resp.headers['X-Accounts-Search-Version'] = 'acc5'
    return resp


@app.route('/api/starbucks', methods=['GET'])
@login_required
@staff_required
def list_starbucks_balances():
    """
    List Starbucks balances for students, using similar access rules to /api/bank-account/search.
    Supports:
      - ?q=... (search by student name or staff/case manager name)
      - ?managed_by_me=true (restrict to students managed by the current user)
    """
    query_text = request.args.get('q', '').strip()
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'

    # Reuse the same student selection logic as /api/bank-account/search
    if query_text:
        students_by_name = Student.query.filter(Student.name.ilike(f'%{query_text}%')).all()

        staff_members = User.query.filter(
            db.or_(
                User.name.ilike(f'%{query_text}%'),
                User.username.ilike(f'%{query_text}%')
            )
        ).all()

        staff_names = [s.name for s in staff_members if s.name]
        team_members = TeamMember.query.filter(
            TeamMember.name.in_(staff_names)
        ).all() if staff_names else []

        student_ids_from_staff = list({tm.student_id for tm in team_members if tm.student_id})

        all_student_ids = {s.id for s in students_by_name}
        all_student_ids.update(student_ids_from_staff)

        students = Student.query.filter(Student.id.in_(list(all_student_ids))).all() if all_student_ids else []
    else:
        if current_user.role == 'staff' and current_user.is_outside_staff:
            assigned_student_ids = [a.student_id for a in
                                   OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
            if not assigned_student_ids:
                students = []
            else:
                query_obj = Student.query.filter(Student.id.in_(assigned_student_ids))
                if managed_by_me:
                    user_name = (current_user.name or current_user.username) or ''
                    user_username = (current_user.username or '').strip()
                    if not user_name and not user_username:
                        sid_list = []
                    else:
                        team_members = TeamMember.query.filter(
                            (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
                            (db.func.lower(TeamMember.name) == db.func.lower(user_username))
                        ).all()
                        sid_list = list({tm.student_id for tm in team_members if tm.student_id})
                    sid_list = [sid for sid in sid_list if sid in assigned_student_ids]
                    students = query_obj.filter(Student.id.in_(sid_list)).order_by(Student.name).all() if sid_list else []
                else:
                    students = query_obj.order_by(Student.name).all()
        else:
            query_obj = Student.query
            if managed_by_me:
                user_name = (current_user.name or current_user.username) or ''
                user_username = (current_user.username or '').strip()
                if not user_name and not user_username:
                    student_ids = []
                else:
                    team_members = TeamMember.query.filter(
                        (db.func.lower(TeamMember.name) == db.func.lower(user_name)) |
                        (db.func.lower(TeamMember.name) == db.func.lower(user_username))
                    ).all()
                    student_ids = list({tm.student_id for tm in team_members if tm.student_id})
                if student_ids:
                    students = query_obj.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
                else:
                    students = []
            else:
                students = query_obj.order_by(Student.name).all()

        students = filter_directory_info(students, include_opted_out=False)

    # Restrict to active students only (those in Student Users / User Management)
    student_users = User.query.filter_by(role='student').all()
    student_user_ids = {u.student_id for u in student_users if u.student_id}
    students = [s for s in students if s.id in student_user_ids]

    # Attach Starbucks balances
    result = []
    for student in students:
        balance = StarbucksBalance.query.filter_by(student_id=student.id).first()
        count = int(balance.count) if balance and balance.count is not None else 0
        result.append({
            'student_id': student.id,
            'student_name': student.name,
            'starbucks_count': count,
        })

    return jsonify(result)


@app.route('/api/starbucks/bulk', methods=['POST'])
@login_required
@staff_required
def update_starbucks_balances_bulk():
    """
    Bulk update Starbucks balances.

    Expects JSON body:
    {
      "rows": [
        {"student_id": 1, "count": 5},
        ...
      ]
    }
    """
    data = request.get_json(silent=True) or {}
    rows = data.get('rows') or []

    if not isinstance(rows, list):
        return jsonify({'error': 'rows must be a list'}), 400

    try:
        for row in rows:
            try:
                student_id = int(row.get('student_id'))
            except (TypeError, ValueError):
                continue
            if student_id <= 0:
                continue

            count_value = row.get('count', 0)
            try:
                count_int = int(count_value)
            except (TypeError, ValueError):
                count_int = 0
            if count_int < 0:
                count_int = 0

            balance = get_or_create_starbucks_balance(student_id)
            balance.count = count_int

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        app.logger.exception("Error updating Starbucks balances")
        return jsonify({'error': 'Failed to update Starbucks balances'}), 500

    return jsonify({'status': 'ok'})


LEVEL_UP_WINDOW_DAYS = 30
LEVEL_UP_AVERAGE_THRESHOLD = 90.0
LEVEL_UP_NEXT_COLOR = {
    'yellow': 'green',
    'green': 'blue',
}
# Short-lived response cache so Overview teaser + restored card share one compute.
_LEVEL_UPS_RESPONSE_CACHE = {}
_LEVEL_UPS_RESPONSE_CACHE_TTL_SEC = 45.0


def _normalize_card_color(card_color):
    color = (card_color or '').strip().lower()
    if color in ('yellow', 'green', 'blue'):
        return color
    # Unset card color is treated as Yellow Card (school starting level).
    return 'yellow'


def _daily_star_overall_percent_from_totals(
    status,
    total_safety,
    total_teamwork,
    total_accountability,
    total_relationships,
    total_possible,
):
    """
    Daily STAR overall % for level-up windows from pre-aggregated period totals.
    Excused days are excluded (None). Unexcused days count as 0%.
    Present days use the same STAR category average as summary/incentive tracking.
    """
    if status == 'excused':
        return None
    if status == 'unexcused':
        return 0.0

    total_safety = int(total_safety or 0)
    total_teamwork = int(total_teamwork or 0)
    total_accountability = int(total_accountability or 0)
    total_relationships = int(total_relationships or 0)
    total_possible = int(total_possible or 0)

    if total_possible <= 0:
        return 0.0

    num_periods = total_possible / 4.0
    max_per_category = num_periods * 2.0
    if max_per_category <= 0:
        return 0.0

    safety_percent = (total_safety / max_per_category) * 100.0
    teamwork_percent = (total_teamwork / max_per_category) * 100.0
    accountability_percent = (total_accountability / max_per_category) * 100.0
    relationships_percent = (total_relationships / max_per_category) * 100.0
    return (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4.0


def _daily_star_overall_percent_for_level_up(record):
    """Daily STAR overall % for level-up windows from a DailyRecord + periods."""
    status = _record_attendance_status_norm(record)
    total_safety = 0
    total_teamwork = 0
    total_accountability = 0
    total_relationships = 0
    total_possible = 0
    for period in getattr(record, 'periods', None) or []:
        total_safety += _star_point_sum_value(period.safety_points)
        total_teamwork += _star_point_sum_value(period.teamwork_points)
        total_accountability += _star_point_sum_value(period.accountability_points)
        total_relationships += _star_point_sum_value(period.relationships_points)
        total_possible += _period_points_possible(period)
    return _daily_star_overall_percent_from_totals(
        status,
        total_safety,
        total_teamwork,
        total_accountability,
        total_relationships,
        total_possible,
    )


def _level_up_attendance_status_from_row(attendance_status, present):
    """Normalize attendance for aggregated level-up rows (mirrors DailyRecord helper)."""
    if attendance_status:
        return attendance_status
    return 'present' if present else 'unexcused'


def _star_point_sum_sql(column):
    """SQL SUM for STAR points, treating E/empty as 0 and U as 0."""
    from sqlalchemy import case, cast, Integer, or_

    normalized = func.upper(func.trim(func.coalesce(cast(column, db.String), '')))
    return func.coalesce(func.sum(case(
        (or_(column.is_(None), normalized == '', normalized == 'E'), 0),
        (normalized == 'U', 0),
        else_=cast(column, Integer),
    )), 0)


def _load_level_up_daily_rows(student_ids, min_date=None):
    """
    Load per-day STAR totals for level-up calc without hydrating PeriodRecord rows.
    Returns rows newest-first: (student_id, date, attendance_status, present, totals...).
    """
    if not student_ids:
        return []

    query = (
        db.session.query(
            DailyRecord.student_id,
            DailyRecord.date,
            DailyRecord.attendance_status,
            DailyRecord.present,
            _star_point_sum_sql(PeriodRecord.safety_points),
            _star_point_sum_sql(PeriodRecord.teamwork_points),
            _star_point_sum_sql(PeriodRecord.accountability_points),
            _star_point_sum_sql(PeriodRecord.relationships_points),
            func.coalesce(func.sum(PeriodRecord.points_possible), 0),
        )
        .outerjoin(PeriodRecord, PeriodRecord.daily_record_id == DailyRecord.id)
        .filter(DailyRecord.student_id.in_(student_ids))
    )
    if min_date is not None:
        # Strictly after reset dates; callers pass the earliest relevant reset.
        query = query.filter(DailyRecord.date > min_date)

    return (
        query.group_by(
            DailyRecord.id,
            DailyRecord.student_id,
            DailyRecord.date,
            DailyRecord.attendance_status,
            DailyRecord.present,
        )
        .order_by(DailyRecord.date.desc())
        .all()
    )


def _level_up_days_with_data_from_rows(rows, reset_at=None):
    """
    Return daily overall percents newest-first for school days with data.
    Only dates after card_level_reset_at are included when a reset exists.
    """
    by_date = {}
    for row in rows or []:
        record_date = row[1]
        if record_date is None:
            continue
        if reset_at and record_date <= reset_at:
            continue
        status = _level_up_attendance_status_from_row(row[2], row[3])
        pct = _daily_star_overall_percent_from_totals(
            status, row[4], row[5], row[6], row[7], row[8]
        )
        if pct is None:
            continue
        # Prefer the latest processed row if duplicates ever appear.
        by_date[record_date] = float(pct)

    ordered_dates = sorted(by_date.keys(), reverse=True)
    return [by_date[d] for d in ordered_dates]


def _level_up_days_with_data(records, reset_at=None):
    """
    Return daily overall percents newest-first for school days with data.
    Only dates after card_level_reset_at are included when a reset exists.
    """
    by_date = {}
    for record in records or []:
        record_date = getattr(record, 'date', None)
        if record_date is None:
            continue
        if reset_at and record_date <= reset_at:
            continue
        pct = _daily_star_overall_percent_for_level_up(record)
        if pct is None:
            continue
        # Prefer the latest processed record if duplicates ever appear.
        by_date[record_date] = float(pct)

    ordered_dates = sorted(by_date.keys(), reverse=True)
    return [by_date[d] for d in ordered_dates]


def _average_or_none(values):
    if not values:
        return None
    return sum(values) / float(len(values))


def _longest_qualifying_day_stretch(daily_pcts_chrono, threshold=LEVEL_UP_AVERAGE_THRESHOLD):
    """
    Longest contiguous stretch of days whose average is >= threshold.

    daily_pcts_chrono: oldest -> newest school days with data.
    Returns (length, average_of_that_stretch, sum_of_that_stretch).
    A later high day can "rescue" earlier weaker days if the full contiguous
    average stays at or above threshold (e.g. a 60% day followed by 130%).

    Uses an O(n log n) longest-subarray search on (value - threshold) prefix
    sums, then picks the highest-average window among that best length.
    """
    values = [float(v) for v in (daily_pcts_chrono or [])]
    n = len(values)
    if n == 0:
        return 0, None, 0.0

    threshold = float(threshold)
    # Transform: avg >= T  <=>  sum(v - T) >= 0 over the window.
    pref = [0.0] * (n + 1)
    for i, value in enumerate(values):
        pref[i + 1] = pref[i] + (value - threshold)

    # Fenwick tree over compressed prefix ranks storing the minimum index seen.
    ranked = {v: i + 1 for i, v in enumerate(sorted(set(pref)))}
    size = len(ranked)
    bit = [n + 5] * (size + 2)

    def bit_update(index, val):
        while index <= size:
            if val < bit[index]:
                bit[index] = val
            index += index & -index

    def bit_query(index):
        best = n + 5
        while index > 0:
            if bit[index] < best:
                best = bit[index]
            index -= index & -index
        return best

    best_len = 0
    for right in range(n + 1):
        left = bit_query(ranked[pref[right]])
        if left <= n:
            length = right - left
            if length > best_len:
                best_len = length
        bit_update(ranked[pref[right]], right)

    if best_len <= 0:
        return 0, None, 0.0

    # Among all windows of best_len with avg >= threshold, prefer the highest avg.
    best_avg = None
    best_sum = 0.0
    window_sum = sum(values[:best_len])
    for start in range(0, n - best_len + 1):
        if start > 0:
            window_sum += values[start + best_len - 1] - values[start - 1]
        avg = window_sum / float(best_len)
        if avg < threshold:
            continue
        if best_avg is None or avg > best_avg:
            best_avg = avg
            best_sum = window_sum

    if best_avg is None:
        return 0, None, 0.0
    return best_len, best_avg, best_sum


def _min_daily_percent_to_finish_level_up(
    qualifying_sum,
    qualifying_len,
    target=LEVEL_UP_WINDOW_DAYS,
    threshold=LEVEL_UP_AVERAGE_THRESHOLD,
):
    """
    Lowest equal daily % for the remaining (target - qualifying_len) days so the
    combined average over `target` days stays >= threshold.
    """
    target = int(target)
    threshold = float(threshold)
    remaining = target - int(qualifying_len)
    if remaining <= 0:
        return 0.0
    # (sum + remaining * x) / target >= threshold
    raw = ((threshold * target) - float(qualifying_sum)) / float(remaining)
    floored = max(0.0, raw)
    # Ceil to 1 decimal so displayed % is enough to stay at/above threshold.
    return math.ceil(floored * 10.0 - 1e-9) / 10.0


def _days_at_percent_to_finish_level_up(
    daily_pcts_chrono,
    daily_percent=100.0,
    target=LEVEL_UP_WINDOW_DAYS,
    threshold=LEVEL_UP_AVERAGE_THRESHOLD,
):
    """
    Fewest future days at `daily_percent` (appended newest) until a contiguous
    qualifying stretch of `target` days exists.
    """
    target = int(target)
    threshold = float(threshold)
    daily_percent = float(daily_percent)
    sim = [float(v) for v in (daily_pcts_chrono or [])]
    length, _, _ = _longest_qualifying_day_stretch(sim, threshold=threshold)
    if length >= target:
        return 0

    max_steps = target * 2
    # Appending more high-% days is monotonic for "has a qualifying stretch",
    # so binary search the minimal day count instead of simulating step-by-step.
    lo, hi = 1, max_steps
    answer = max_steps
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = sim + ([daily_percent] * mid)
        length, _, _ = _longest_qualifying_day_stretch(trial, threshold=threshold)
        if length >= target:
            answer = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return answer


def _compute_level_up_progress(daily_pcts_newest_first):
    # Qualifying days are measured chronologically (oldest -> newest).
    newest_first = list(daily_pcts_newest_first or [])
    chrono = list(reversed(newest_first))
    qualifying_len, qualifying_avg, qualifying_sum = _longest_qualifying_day_stretch(chrono)
    days_logged = min(int(qualifying_len), LEVEL_UP_WINDOW_DAYS)
    eligible = qualifying_len >= LEVEL_UP_WINDOW_DAYS
    days_needed = 0 if eligible else (LEVEL_UP_WINDOW_DAYS - days_logged)
    min_day_percent = None
    days_at_100_needed = 0
    if not eligible:
        # If there is no qualifying stretch yet, remaining days must each average
        # to the threshold (treated as starting from sum 0 / length 0).
        min_day_percent = _min_daily_percent_to_finish_level_up(
            qualifying_sum if qualifying_len > 0 else 0.0,
            days_logged,
        )
        # Quickest path: perfect days going forward may rescue older days into a
        # longer stretch. Extending the current stretch at 100% never takes more
        # than `days_needed` days when the stretch already averages >= threshold.
        simulated_100 = _days_at_percent_to_finish_level_up(chrono, daily_percent=100.0)
        days_at_100_needed = min(int(simulated_100), int(days_needed))

    if qualifying_avg is not None:
        average_percent = round(qualifying_avg, 1)
    else:
        # No qualifying stretch yet: show the current (most recent) 30-day average.
        recent_window = newest_first[:LEVEL_UP_WINDOW_DAYS]
        recent_avg = _average_or_none(recent_window)
        average_percent = round(recent_avg, 1) if recent_avg is not None else None

    return {
        'days_logged': days_logged,
        'days_required': LEVEL_UP_WINDOW_DAYS,
        'average_percent': average_percent,
        'days_at_90_needed': days_needed,
        'min_day_percent': min_day_percent,
        'days_at_100_needed': days_at_100_needed,
        'eligible': eligible,
    }


def _build_level_up_entry(student, daily_pcts):
    color = _normalize_card_color(getattr(student, 'card_color', None))
    if color == 'blue':
        return None

    reset_at = getattr(student, 'card_level_reset_at', None)
    progress = _compute_level_up_progress(daily_pcts)
    next_color = LEVEL_UP_NEXT_COLOR.get(color)
    return {
        'id': student.id,
        'name': student.name,
        'card_color': color,
        'next_card_color': next_color,
        'days_logged': progress['days_logged'],
        'days_required': progress['days_required'],
        'average_percent': progress['average_percent'],
        'days_at_90_needed': progress['days_at_90_needed'],
        'min_day_percent': progress.get('min_day_percent'),
        'days_at_100_needed': progress.get('days_at_100_needed'),
        'eligible': progress['eligible'],
        'card_level_reset_at': reset_at.isoformat() if reset_at else None,
    }


@app.route('/api/level-ups', methods=['GET'])
@login_required
@api_json_errors
def level_ups():
    """
    Level-up progress for selected students (Yellow→Green and Green→Blue).

    Eligibility: a contiguous stretch of 30 school days with data whose average
    STAR % is 90% or higher. Excused days are excluded; unexcused days count as 0%.
    """
    started = time.perf_counter()
    student_id = request.args.get('student_id', type=int)
    staff_id = request.args.get('staff_id', type=int)
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'

    cache_key = (
        getattr(current_user, 'id', None),
        student_id,
        staff_id,
        managed_by_me,
    )
    cached = _LEVEL_UPS_RESPONSE_CACHE.get(cache_key)
    if cached:
        payload, cached_at = cached
        if (time.time() - cached_at) <= _LEVEL_UPS_RESPONSE_CACHE_TTL_SEC:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            print(f"level-ups cache hit in {elapsed_ms}ms", flush=True)
            return jsonify(payload)

    selected_ids = _resolve_student_scope(
        student_id=student_id,
        staff_id=staff_id,
        managed_by_me=managed_by_me,
    )
    if not selected_ids:
        return jsonify({
            'yellow_to_green': [],
            'green_to_blue': [],
            'eligible_count': 0,
            'can_level_up': can_manage_level_ups(current_user),
        })

    students = Student.query.filter(Student.id.in_(selected_ids)).order_by(Student.name).all()
    # Exclude archived students (no active student user), matching "all students" scope.
    active_student_ids = {
        u.student_id
        for u in User.query.filter(User.role == 'student', User.student_id.in_(selected_ids)).all()
        if u.student_id
    }
    students = [s for s in students if s.id in active_student_ids and _normalize_card_color(s.card_color) != 'blue']
    if not students:
        return jsonify({
            'yellow_to_green': [],
            'green_to_blue': [],
            'eligible_count': 0,
            'can_level_up': can_manage_level_ups(current_user),
        })

    student_ids = [s.id for s in students]
    # When every student has a reset date, skip older history entirely.
    reset_dates = [s.card_level_reset_at for s in students if s.card_level_reset_at]
    min_date = min(reset_dates) if reset_dates and len(reset_dates) == len(students) else None

    rows = _load_level_up_daily_rows(student_ids, min_date=min_date)
    rows_by_student = {}
    for row in rows:
        rows_by_student.setdefault(row[0], []).append(row)

    yellow_to_green = []
    green_to_blue = []
    for student in students:
        daily_pcts = _level_up_days_with_data_from_rows(
            rows_by_student.get(student.id, []),
            reset_at=student.card_level_reset_at,
        )
        entry = _build_level_up_entry(student, daily_pcts)
        if not entry:
            continue
        if entry['card_color'] == 'yellow':
            yellow_to_green.append(entry)
        elif entry['card_color'] == 'green':
            green_to_blue.append(entry)

    def sort_key(item):
        # Eligible first, then fewest days remaining at 90%, then name.
        return (0 if item.get('eligible') else 1, item.get('days_at_90_needed', 999), (item.get('name') or '').lower())

    yellow_to_green.sort(key=sort_key)
    green_to_blue.sort(key=sort_key)
    eligible_count = sum(1 for row in yellow_to_green + green_to_blue if row.get('eligible'))

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    print(
        f"level-ups computed in {elapsed_ms}ms "
        f"(students={len(students)} rows={len(rows)} eligible={eligible_count})",
        flush=True,
    )

    payload = {
        'yellow_to_green': yellow_to_green,
        'green_to_blue': green_to_blue,
        'eligible_count': eligible_count,
        'can_level_up': can_manage_level_ups(current_user),
    }
    _LEVEL_UPS_RESPONSE_CACHE[cache_key] = (payload, time.time())
    return jsonify(payload)


@app.route('/api/students/<int:student_id>/level-up', methods=['POST'])
@login_required
@api_json_errors
def level_up_student(student_id):
    """Promote an eligible student to the next card color and restart the 30-day window."""
    if not can_manage_level_ups(current_user):
        return jsonify({'error': 'Only case managers and admins can level up students'}), 403

    allowed_ids = set(_resolve_student_scope())
    if student_id not in allowed_ids:
        return jsonify({'error': 'Access denied to this student'}), 403

    student = Student.query.get(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404

    color = _normalize_card_color(student.card_color)
    next_color = LEVEL_UP_NEXT_COLOR.get(color)
    if not next_color:
        return jsonify({'error': 'Student is already at the highest card level'}), 400

    min_date = student.card_level_reset_at
    rows = _load_level_up_daily_rows([student_id], min_date=min_date)
    daily_pcts = _level_up_days_with_data_from_rows(rows, reset_at=min_date)
    entry = _build_level_up_entry(student, daily_pcts)
    if not entry or not entry.get('eligible'):
        return jsonify({'error': 'Student is not eligible to level up yet'}), 400

    student.card_color = next_color
    # Restart the window: only days after today count toward the next level.
    student.card_level_reset_at = date.today()
    # Keep model in sync if card_color was previously null/invalid.
    db.session.commit()
    _LEVEL_UPS_RESPONSE_CACHE.clear()

    log_phi_access(
        action='UPDATE',
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        resource_type='student_level_up',
        resource_id=student_id,
        details=f"Leveled up from {color} to {next_color}",
        ip_address=get_remote_address(),
    )

    return jsonify({
        'status': 'ok',
        'id': student.id,
        'name': student.name,
        'previous_card_color': color,
        'card_color': next_color,
        'card_level_reset_at': student.card_level_reset_at.isoformat() if student.card_level_reset_at else None,
    })


@app.route('/api/incentive-tracking', methods=['GET'])
@login_required
def incentive_tracking():
    """
    Compute incentive tracking tables for Yellow / Green / Blue card students
    over an explicit date range, based on overall point card averages.
    """
    from collections import defaultdict
    from sqlalchemy.orm import joinedload

    # Parse dates (YYYY-MM-DD)
    start_str = request.args.get('start_date')
    end_str = request.args.get('end_date')
    try:
        start_date = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
        end_date = datetime.strptime(end_str, '%Y-%m-%d').date() if end_str else None
    except ValueError:
        return jsonify({'error': 'Invalid date format. Expected YYYY-MM-DD.'}), 400

    if start_date and end_date and start_date > end_date:
        return jsonify({'error': 'Start date must be on or before end date.'}), 400

    student_id = request.args.get('student_id', type=int)
    staff_id = request.args.get('staff_id', type=int)
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'

    # Base query
    query = DailyRecord.query.join(Student)

    # Role-based access control (mirror summary rules at a high level)
    if staff_id and current_user.role in ['staff', 'admin']:
        staff_user = User.query.get(staff_id)
        if staff_user:
            staff_name = staff_user.name or ''
            staff_username = staff_user.username or ''
            team_members = TeamMember.query.filter(
                (db.func.lower(TeamMember.name) == db.func.lower(staff_name)) |
                (db.func.lower(TeamMember.name) == db.func.lower(staff_username))
            ).all()
            staff_student_ids = list({tm.student_id for tm in team_members if tm.student_id})
            if not staff_student_ids:
                return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})
            if student_id and student_id in staff_student_ids:
                query = query.filter(DailyRecord.student_id == student_id)
            elif student_id and student_id not in staff_student_ids:
                return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})
            else:
                query = query.filter(DailyRecord.student_id.in_(staff_student_ids))
    elif current_user.role == 'student':
        if current_user.student_id:
            query = query.filter(DailyRecord.student_id == current_user.student_id)
        else:
            return jsonify({'error': 'No student record linked'}), 404
    elif current_user.role == 'staff' and current_user.is_outside_staff:
        assigned_student_ids = [
            assoc.student_id for assoc in OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()
        ]
        if not assigned_student_ids:
            return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})
        if student_id:
            if student_id not in assigned_student_ids:
                return jsonify({'error': 'Access denied to this student'}), 403
            query = query.filter(DailyRecord.student_id == student_id)
        else:
            query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
    else:
        if student_id:
            query = query.filter(DailyRecord.student_id == student_id)
            if managed_by_me:
                user_name = (current_user.name or current_user.username or '').strip()
                user_username = (current_user.username or '').strip()
                team_member = TeamMember.query.filter(
                    TeamMember.student_id == student_id,
                    db.or_(
                        db.func.lower(TeamMember.name) == db.func.lower(user_name),
                        db.func.lower(TeamMember.name) == db.func.lower(user_username),
                    ),
                ).first()
                if not team_member:
                    return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})
        elif managed_by_me:
            user_name = (current_user.name or current_user.username or '').strip()
            user_username = (current_user.username or '').strip()
            team_members = TeamMember.query.filter(
                db.or_(
                    db.func.lower(TeamMember.name) == db.func.lower(user_name),
                    db.func.lower(TeamMember.name) == db.func.lower(user_username),
                )
            ).all()
            student_ids = list({tm.student_id for tm in team_members if tm.student_id})
            if not student_ids:
                return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})
            query = query.filter(DailyRecord.student_id.in_(student_ids))

    # Apply date range
    if start_date:
        query = query.filter(DailyRecord.date >= start_date)
    if end_date:
        query = query.filter(DailyRecord.date <= end_date)

    records = query.options(
        joinedload(DailyRecord.periods),
        joinedload(DailyRecord.student),
    ).all()

    if not records:
        return jsonify({'yellow_students': [], 'green_students': [], 'blue_students': []})

    # Aggregate STAR points per student
    per_student = defaultdict(lambda: {
        'student': None,
        'total_safety': 0,
        'total_teamwork': 0,
        'total_accountability': 0,
        'total_relationships': 0,
        'total_possible': 0,
    })

    for record in records:
        student = record.student
        if not student:
            continue
        bucket = per_student[student.id]
        bucket['student'] = student
        for period in record.periods:
            bucket['total_safety'] += _star_point_sum_value(period.safety_points) or 0
            bucket['total_teamwork'] += _star_point_sum_value(period.teamwork_points) or 0
            bucket['total_accountability'] += _star_point_sum_value(period.accountability_points) or 0
            bucket['total_relationships'] += _star_point_sum_value(period.relationships_points) or 0
            bucket['total_possible'] += (period.points_possible or 0) or 0

    yellow_list = []
    green_list = []
    blue_list = []

    for sid, bucket in per_student.items():
        student = bucket['student']
        if not student:
            continue
        total_possible = bucket['total_possible']
        if total_possible <= 0:
            continue

        num_periods = total_possible / 4.0
        max_per_category = num_periods * 2.0 if num_periods > 0 else 0.0
        if max_per_category <= 0:
            continue

        safety_percent = (bucket['total_safety'] / max_per_category * 100.0)
        teamwork_percent = (bucket['total_teamwork'] / max_per_category * 100.0)
        accountability_percent = (bucket['total_accountability'] / max_per_category * 100.0)
        relationships_percent = (bucket['total_relationships'] / max_per_category * 100.0)
        overall_percent = (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4.0
        overall_percent = round(overall_percent, 1)

        color = (student.card_color or '').strip().lower()
        entry = {
            'id': student.id,
            'name': student.name,
            'card_color': color,
            'average_percent': overall_percent,
        }

        if color == 'yellow' and overall_percent >= 85.0:
            yellow_list.append(entry)
        elif color == 'green' and overall_percent >= 90.0:
            green_list.append(entry)
        elif color == 'blue' and overall_percent >= 90.0:
            blue_list.append(entry)

    # Sort each list by descending average, then name
    def sort_key(item):
        return (-item['average_percent'], item['name'] or '')

    yellow_list.sort(key=sort_key)
    green_list.sort(key=sort_key)
    blue_list.sort(key=sort_key)

    return jsonify({
        'yellow_students': yellow_list,
        'green_students': green_list,
        'blue_students': blue_list,
    })


@app.route('/test')
def test():
    return jsonify({'status': 'ok', 'message': 'Server is running'})


@app.route('/api/debug/accounts-search-check', methods=['GET'])
@login_required
@staff_required
def debug_accounts_search_check():
    """Diagnostic endpoint for Accounts tab student dropdown. Returns backend version and student counts."""
    total = Student.query.count()
    ahu = Student.query.filter(Student.name.ilike('%AHu%')).first()
    return jsonify({
        'backend_version': 'acc5',
        'total_students': total,
        'has_ahu': ahu is not None,
        'ahu_id': ahu.id if ahu else None,
    })

@app.route('/admin/backfill-point-card-locations', methods=['POST'])
def admin_backfill_point_card_locations():
    """
    One-off admin endpoint: backfill period locations from student schedules.
    Requires SETUP_TOKEN (same as /setup).
    """
    setup_token = os.environ.get('SETUP_TOKEN')
    if not setup_token:
        return jsonify({'error': 'Setup not configured. SETUP_TOKEN environment variable required.'}), 403

    payload = request.get_json(silent=True) or {}
    provided_token = payload.get('token')
    if provided_token != setup_token:
        return jsonify({'error': 'Invalid setup token'}), 403

    date_str = (payload.get('date') or '2026-08-31').strip()
    try:
        record_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date; use YYYY-MM-DD'}), 400

    dry_run = payload.get('dry_run', True)
    if isinstance(dry_run, str):
        dry_run = dry_run.strip().lower() not in ('0', 'false', 'no')

    try:
        result = backfill_point_card_locations_for_date(record_date, dry_run=bool(dry_run))
        return jsonify(result), 200
    except Exception as e:
        app.logger.exception('Backfill point card locations failed')
        return jsonify({'error': f'Backfill failed: {str(e)}'}), 500


@app.route('/setup', methods=['POST'])
def setup():
    """
    One-time setup endpoint to initialize default users on Render.
    Requires SETUP_TOKEN environment variable for security.
    """
    setup_token = os.environ.get('SETUP_TOKEN')
    if not setup_token:
        return jsonify({'error': 'Setup not configured. SETUP_TOKEN environment variable required.'}), 403
    
    provided_token = request.json.get('token') if request.is_json else request.form.get('token')
    if provided_token != setup_token:
        return jsonify({'error': 'Invalid setup token'}), 403
    
    try:
        with app.app_context():
            # Check if users already exist
            existing_users = User.query.count()
            if existing_users > 0:
                return jsonify({
                    'message': f'Database already has {existing_users} user(s). Setup skipped.',
                    'users_exist': True
                }), 200
            
            # Create default admin user
            admin_user = User(
                username='admin',
                role='admin',
                name='Administrator'
            )
            admin_user.set_password('admin123')
            db.session.add(admin_user)
            
            # Create default staff user
            staff_user = User(
                username='staff',
                role='staff',
                name='Staff User'
            )
            staff_user.set_password('staff123')
            db.session.add(staff_user)
            
            db.session.commit()
            
            return jsonify({
                'message': 'Default users created successfully!',
                'users': [
                    {'username': 'admin', 'password': 'admin123', 'role': 'admin'},
                    {'username': 'staff', 'password': 'staff123', 'role': 'staff'}
                ],
                'warning': 'Please change these default passwords after first login!'
            }), 201
    except Exception as e:
        app.logger.error(f'Setup error: {str(e)}', exc_info=True)
        return jsonify({'error': f'Setup failed: {str(e)}'}), 500

@app.route('/check-users', methods=['GET'])
def check_users():
    """Check if any users exist in the database (for debugging)"""
    try:
        user_count = User.query.count()
        users = User.query.all()
        user_list = [{'id': u.id, 'username': u.username, 'role': u.role} for u in users]
        return jsonify({
            'user_count': user_count,
            'users': user_list
        }), 200
    except Exception as e:
        return jsonify({'error': f'Error checking users: {str(e)}'}), 500

if __name__ == '__main__':
    print("Starting development server (schema checks)...", flush=True)
    with app.app_context():
        db.create_all()
        ensure_daily_query_indexes()
        try:
            ensure_curriculum_schema()
            seed_curriculum_lessons()
        except Exception as seed_err:
            print(f"Note: curriculum seed skipped: {seed_err}", flush=True)
        # Ensure OutsideStaffStudent table exists
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(db.engine)
            # Check if outside_staff_students table exists
            if 'outside_staff_students' not in inspector.get_table_names():
                print("Creating outside_staff_students table...")
                db.create_all()
                # Verify columns exist in users table
                if 'users' in inspector.get_table_names():
                    columns = [col['name'] for col in inspector.get_columns('users')]
                    # Check if we're using PostgreSQL or SQLite
                    is_postgres = 'postgresql' in str(db.engine.url).lower()
                    
                    if 'is_outside_staff' not in columns:
                        print("Adding is_outside_staff column to users table...")
                        with db.engine.connect() as conn:
                            if is_postgres:
                                # PostgreSQL syntax
                                conn.execute(text("ALTER TABLE users ADD COLUMN is_outside_staff BOOLEAN DEFAULT FALSE NOT NULL"))
                            else:
                                # SQLite syntax
                                conn.execute(text("ALTER TABLE users ADD COLUMN is_outside_staff BOOLEAN DEFAULT 0 NOT NULL"))
                            conn.commit()
                    if 'district' not in columns:
                        print("Adding district column to users table...")
                        with db.engine.connect() as conn:
                            conn.execute(text("ALTER TABLE users ADD COLUMN district VARCHAR(100)"))
                            conn.commit()

                # Ensure checkpoints.description exists for hover/table details.
                if 'checkpoints' in table_names:
                    checkpoint_columns = [col['name'] for col in inspector.get_columns('checkpoints')]
                    if 'description' not in checkpoint_columns:
                        print("Adding description column to checkpoints table...")
                        try:
                            with db.engine.connect() as conn:
                                conn.execute(text("ALTER TABLE checkpoints ADD COLUMN description TEXT"))
                                conn.commit()
                        except Exception as cp_migration_error:
                            print(f"Checkpoint description migration warning: {cp_migration_error}")
        except Exception as e:
            print(f"Schema check completed (table may not exist yet or columns already exist): {e}")
        # Migration: Add attendance_status column if it doesn't exist
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(db.engine)
            # Check if daily_records table exists
            if 'daily_records' in inspector.get_table_names():
                columns = [col['name'] for col in inspector.get_columns('daily_records')]
                if 'attendance_status' not in columns:
                    print("Adding attendance_status column to daily_records table...")
                    with db.engine.connect() as conn:
                        conn.execute(text("ALTER TABLE daily_records ADD COLUMN attendance_status VARCHAR(20) DEFAULT 'present'"))
                        conn.commit()
                    print("Migration complete: attendance_status column added")
                else:
                    print("Migration check: attendance_status column already exists")
            else:
                print("Migration check: daily_records table does not exist yet (will be created with schema)")
        except Exception as e:
            print(f"Migration check completed (table may not exist yet or column already exists): {e}")
    port = int(os.environ.get('PORT', 5000))
    print(f"Flask server starting on port {port} (Ctrl+C to stop)...", flush=True)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

