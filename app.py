from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta
from functools import wraps
from decimal import Decimal
import os
import csv
import json
from io import StringIO
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)

# Database configuration: Use PostgreSQL on Render, SQLite locally
database_url = os.environ.get('DATABASE_URL')
if database_url:
    # Render provides DATABASE_URL with postgres://, but SQLAlchemy needs postgresql+psycopg:// for psycopg3
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql+psycopg://', 1)
    elif database_url.startswith('postgresql://'):
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    # Local development: Use instance folder for database (Flask convention)
    instance_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instance')
    os.makedirs(instance_path, exist_ok=True)
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(instance_path, "behavior_tracking.db")}'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
)

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'


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

# Database Models
class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))  # Full name of the user
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'student', 'staff', or 'admin'
    designation = db.Column(db.String(50))  # 'Case Manager', 'Practitioner', 'Paraprofessional', 'Professional', 'Admin'
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=True)
    is_outside_staff = db.Column(db.Boolean, default=False, nullable=False)  # True for Outside Staff users
    district = db.Column(db.String(100), nullable=True)  # District name for Outside Staff
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship to student (for student users)
    student = db.relationship('Student', backref='user_account', foreign_keys=[student_id])
    
    # Relationship to assigned students (for Outside Staff)
    assigned_students = db.relationship('OutsideStaffStudent', backref='user', lazy=True, cascade='all, delete-orphan')
    
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

class Student(db.Model):
    __tablename__ = 'students'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100))
    grade = db.Column(db.String(20))  # Grade level (e.g., "9", "10", "11", "12")
    card_color = db.Column(db.String(20), nullable=True)  # 'yellow', 'green', 'blue', or None
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    daily_records = db.relationship('DailyRecord', backref='student', lazy=True, cascade='all, delete-orphan')

class DailyRecord(db.Model):
    __tablename__ = 'daily_records'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    day_of_week = db.Column(db.String(20))
    
    # Attendance: 'present', 'excused', or 'unexcused'
    attendance_status = db.Column(db.String(20), default='present')
    # Keep present field for backward compatibility during migration
    present = db.Column(db.Boolean, default=True)
    
    # Relationships
    periods = db.relationship('PeriodRecord', backref='daily_record', lazy=True, cascade='all, delete-orphan')
    frenzies = db.relationship('FrenzyEvent', backref='daily_record', lazy=True, cascade='all, delete-orphan')
    
    __table_args__ = (db.UniqueConstraint('student_id', 'date', name='unique_student_date'),)

class PeriodRecord(db.Model):
    __tablename__ = 'period_records'
    id = db.Column(db.Integer, primary_key=True)
    daily_record_id = db.Column(db.Integer, db.ForeignKey('daily_records.id'), nullable=False)
    
    # Period info
    time_range = db.Column(db.String(20))  # e.g., "7:45-8:30"
    location = db.Column(db.String(50))  # e.g., "English", "Math", "Bus"
    
    # STAR points (Safety, Teamwork, Accountability, Relationships)
    safety_points = db.Column(db.Integer, default=0)
    teamwork_points = db.Column(db.Integer, default=0)
    accountability_points = db.Column(db.Integer, default=0)
    relationships_points = db.Column(db.Integer, default=0)
    points_possible = db.Column(db.Integer, default=4)
    
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
    period_record_id = db.Column(db.Integer, db.ForeignKey('period_records.id'), nullable=False)
    
    # Infraction types
    infraction_type = db.Column(db.String(50), nullable=False)  # e.g., "Lang", "NFD", "Off Task", etc.
    count = db.Column(db.Integer, default=1)
    
    # Categories
    is_general = db.Column(db.Boolean, default=True)  # General vs Harmful
    is_harmful = db.Column(db.Boolean, default=False)

class FrenzyEvent(db.Model):
    __tablename__ = 'frenzy_events'
    id = db.Column(db.Integer, primary_key=True)
    daily_record_id = db.Column(db.Integer, db.ForeignKey('daily_records.id'), nullable=False)
    
    # Event details
    time_range = db.Column(db.String(20))
    location = db.Column(db.String(50))
    purpose = db.Column(db.String(100))
    purpose2 = db.Column(db.String(100))
    duration_minutes = db.Column(db.Integer)
    
    # Result/outcome
    result = db.Column(db.String(100))

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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

class MarketplaceItem(db.Model):
    __tablename__ = 'marketplace_items'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # Case manager who created it
    is_global = db.Column(db.Boolean, default=False, nullable=False)  # If true, visible to all students
    is_approved_for_global = db.Column(db.Boolean, default=False, nullable=False)  # Admin approval for global
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    creator = db.relationship('User', backref='created_marketplace_items')
    purchase_orders = db.relationship('PurchaseOrder', backref='item', lazy=True)

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

class PurchaseOrder(db.Model):
    __tablename__ = 'purchase_orders'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('marketplace_items.id'), nullable=False)
    item_price = db.Column(db.Numeric(10, 2), nullable=False)  # Price at time of purchase
    student_balance_before = db.Column(db.Numeric(10, 2), nullable=False)
    student_calculated_balance_after = db.Column(db.Numeric(10, 2), nullable=False)  # Student's calculation
    actual_balance_after = db.Column(db.Numeric(10, 2), nullable=False)  # Actual calculated balance
    is_calculation_correct = db.Column(db.Boolean, nullable=True)
    status = db.Column(db.String(20), default='pending', nullable=False)  # 'pending', 'approved', 'fulfilled', 'denied'
    case_manager_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # Assigned case manager
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime, nullable=True)
    fulfilled_at = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    student = db.relationship('Student', backref='purchase_orders')
    case_manager = db.relationship('User', backref='managed_purchase_orders')
    transactions = db.relationship('Transaction', backref='purchase_order', lazy=True)

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

# Initialize database tables after all models are defined
def init_db():
    """Initialize database tables if they don't exist"""
    try:
        with app.app_context():
            db.create_all()
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
            except Exception as e:
                print(f"Schema check completed (table may not exist yet or columns already exist): {e}")
    except Exception as e:
        print(f"Database initialization error: {e}")

# Initialize database on app startup (only if not already in app context)
try:
    with app.app_context():
        init_db()
except Exception as e:
    print(f"Initial database setup error (will retry on first request): {e}")

# Routes
@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("5 per minute")
def login():
    if request.method == 'POST':
        try:
            data = request.json
            if not data:
                return jsonify({'success': False, 'error': 'Invalid request. Please provide username and password.'}), 400
            
            username = data.get('username')
            password = data.get('password')
            
            if not username or not password:
                return jsonify({'success': False, 'error': 'Username and password are required.'}), 400
            
            # Check database connection
            try:
                from sqlalchemy import text
                db.session.execute(text('SELECT 1'))
            except Exception as db_error:
                app.logger.error(f'Database connection error: {str(db_error)}', exc_info=True)
                return jsonify({'success': False, 'error': f'Database connection error: {str(db_error)}'}), 500
            
            user = User.query.filter_by(username=username).first()
            
            # Debug logging for Render
            if not user:
                app.logger.warning(f'Login attempt with non-existent username: {username}')
                # Check total user count for debugging
                total_users = User.query.count()
                app.logger.info(f'Total users in database: {total_users}')
            else:
                app.logger.info(f'User found: {username}, checking password...')
                password_check = user.check_password(password)
                app.logger.info(f'Password check result: {password_check}')
            
            if user and user.check_password(password):
                login_user(user)
                return jsonify({'success': True}), 200
            else:
                return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
        except Exception as e:
            # Log the error for debugging
            import traceback
            error_trace = traceback.format_exc()
            app.logger.error(f'Login error: {str(e)}\n{error_trace}')
            print(f'Login error: {str(e)}\n{error_trace}')  # Also print to console
            return jsonify({'success': False, 'error': f'An error occurred during login: {str(e)}'}), 500
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html', user=current_user, date=date)

@app.route('/api/students', methods=['GET', 'POST'])
@limiter.limit("30 per minute")
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
            
            user = User(
                name=data['name'],
                username=data['username'],
                role='student',
                student_id=student.id
            )
            user.set_password(data['password'])
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
        return jsonify({'id': student.id, 'name': student.name}), 201
    else:
        # Students can only see themselves, staff/admin can see all
        if current_user.role == 'student':
            if current_user.student_id:
                student = Student.query.get(current_user.student_id)
                return jsonify([{'id': student.id, 'name': student.name, 'email': student.email}])
            return jsonify([])
        else:
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
                # Get current user's name and username - team members might be stored with either
                user_name = current_user.name or current_user.username
                user_username = current_user.username
                
                # Find all students where this user is a team member
                # Check both name and username since team members might be stored with either
                team_members = TeamMember.query.filter(
                    (TeamMember.name == user_name) | (TeamMember.name == user_username)
                ).all()
                student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
                
                if student_ids:
                    # Intersect with Outside Staff assignments if applicable
                    if current_user.role == 'staff' and current_user.is_outside_staff:
                        assigned_student_ids = [assoc.student_id for assoc in 
                                              OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
                        student_ids = [sid for sid in student_ids if sid in assigned_student_ids]
                    
                    if student_ids:
                        students = query.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
                    else:
                        students = []
                else:
                    students = []
            else:
                students = query.order_by(Student.name).all()
            
            return jsonify([{'id': s.id, 'name': s.name, 'email': s.email, 'card_color': s.card_color} for s in students])

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
@limiter.limit("30 per minute")
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
    
    return jsonify({'message': 'Student deleted successfully'}), 200

@app.route('/api/students/by-staff-period', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def students_by_staff_period():
    """Get students who have the current staff member in their schedule for a given period and optionally class"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    period = request.args.get('period')
    class_name = request.args.get('class_name', '').strip()  # Optional class name filter
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
    
    matching_schedules = query.all()
    
    # Get unique student IDs
    student_ids = list(set([s.student_id for s in matching_schedules if s.student_id]))
    
    # Get student details
    if student_ids:
        students = Student.query.filter(Student.id.in_(student_ids)).order_by(Student.name).all()
        return jsonify([{'id': s.id, 'name': s.name, 'email': s.email} for s in students])
    else:
        return jsonify([])

@app.route('/api/students/by-staff-name', methods=['GET'])
@limiter.limit("60 per minute")
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
        print(f"Returning {len(students)} students: {[s.name for s in students]}")
        return jsonify([{'id': s.id, 'name': s.name, 'email': s.email} for s in students])
    else:
        print("No students found for this staff member")
        # Debug: Show all team members to help troubleshoot
        all_team_members = TeamMember.query.all()
        if all_team_members:
            unique_names = list(set([tm.name for tm in all_team_members]))
            print(f"All team member names in database: {unique_names}")
        return jsonify([])

@app.route('/api/period-data', methods=['GET', 'POST'])
@limiter.limit("60 per minute")
@login_required
def period_data():
    """Get or save period-based data for all students"""
    if request.method == 'POST':
        # Only staff and admin can save data
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        data = request.json
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        period = data['period']
        location = data.get('location', period)
        
        saved_count = 0
        
        for student_data in data.get('students', []):
            student_id = student_data['student_id']
            
            # Verify Outside Staff has access to this student
            if current_user.role == 'staff' and current_user.is_outside_staff:
                if not has_student_access(current_user, student_id):
                    continue  # Skip this student if no access
            
            # Get or create daily record
            daily_record = DailyRecord.query.filter_by(
                student_id=student_id,
                date=record_date
            ).first()
            
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
            
            # Check if period record exists
            period_record = PeriodRecord.query.filter_by(
                daily_record_id=daily_record.id,
                time_range=period
            ).first()
            
            if period_record:
                # Update existing
                period_record.location = location
                period_record.safety_points = student_data.get('safety_points', 0)
                period_record.teamwork_points = student_data.get('teamwork_points', 0)
                period_record.accountability_points = student_data.get('accountability_points', 0)
                period_record.relationships_points = student_data.get('relationships_points', 0)
                period_record.points_possible = 4
                period_record.info = student_data.get('info')
            else:
                # Create new
                period_record = PeriodRecord(
                    daily_record_id=daily_record.id,
                    time_range=period,
                    location=location,
                    safety_points=student_data.get('safety_points', 0),
                    teamwork_points=student_data.get('teamwork_points', 0),
                    accountability_points=student_data.get('accountability_points', 0),
                    relationships_points=student_data.get('relationships_points', 0),
                    points_possible=4,
                    info=student_data.get('info')
                )
                db.session.add(period_record)
            
            saved_count += 1
        
        db.session.commit()
        return jsonify({'message': f'Saved {saved_count} student records', 'count': saved_count}), 200
    
    else:
        # GET request - retrieve period data
        record_date = datetime.strptime(request.args.get('date'), '%Y-%m-%d').date()
        period = request.args.get('period')
        
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
                    'info': period_record.info or ''
                })
        
        return jsonify(result)

@app.route('/api/daily-records', methods=['GET', 'POST'])
@limiter.limit("60 per minute")
@login_required
def daily_records():
    if request.method == 'POST':
        # Only staff and admin can save records
        if current_user.role not in ['staff', 'admin']:
            return jsonify({'error': 'Permission denied'}), 403
        data = request.json
        student_id = data['student_id']
        
        # Verify Outside Staff has access to this student
        if current_user.role == 'staff' and current_user.is_outside_staff:
            if not has_student_access(current_user, student_id):
                return jsonify({'error': 'Access denied to this student'}), 403
        
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        # Check if record exists
        existing = DailyRecord.query.filter_by(
            student_id=student_id, 
            date=record_date
        ).first()
        
        # Get attendance_status from request, or derive from present boolean for backward compatibility
        attendance_status = data.get('attendance_status')
        if not attendance_status:
            # Migration: convert old present boolean to new attendance_status
            present = data.get('present', True)
            attendance_status = 'present' if present else 'unexcused'
        
        if existing:
            daily_record = existing
            # Update attendance_status
            daily_record.attendance_status = attendance_status
            # Keep present field updated for backward compatibility
            daily_record.present = (attendance_status == 'present')
        else:
            daily_record = DailyRecord(
                student_id=student_id,
                date=record_date,
                day_of_week=record_date.strftime('%A'),
                attendance_status=attendance_status,
                present=(attendance_status == 'present')  # Keep for backward compatibility
            )
            db.session.add(daily_record)
        
        # Clear existing periods
        PeriodRecord.query.filter_by(daily_record_id=daily_record.id).delete()
        
        # Add periods
        for period_data in data.get('periods', []):
            period = PeriodRecord(
                daily_record_id=daily_record.id,
                time_range=period_data.get('time_range'),
                location=period_data.get('location'),
                safety_points=period_data.get('safety_points', 0),
                teamwork_points=period_data.get('teamwork_points', 0),
                accountability_points=period_data.get('accountability_points', 0),
                relationships_points=period_data.get('relationships_points', 0),
                points_possible=period_data.get('points_possible', 4),
                reset=period_data.get('reset', False),
                frenzy=period_data.get('frenzy', False),
                notes=period_data.get('notes'),
                reminders=period_data.get('reminders'),
                info=period_data.get('info')
            )
            db.session.add(period)
            
            # Add infractions
            for infraction_data in period_data.get('infractions', []):
                infraction = Infraction(
                    period_record_id=period.id,
                    infraction_type=infraction_data['type'],
                    count=infraction_data.get('count', 1),
                    is_general=infraction_data.get('is_general', True),
                    is_harmful=infraction_data.get('is_harmful', False)
                )
                db.session.add(infraction)
        
        # Add frenzy events
        FrenzyEvent.query.filter_by(daily_record_id=daily_record.id).delete()
        for frenzy_data in data.get('frenzies', []):
            frenzy = FrenzyEvent(
                daily_record_id=daily_record.id,
                time_range=frenzy_data.get('time_range'),
                location=frenzy_data.get('location'),
                purpose=frenzy_data.get('purpose'),
                purpose2=frenzy_data.get('purpose2'),
                duration_minutes=frenzy_data.get('duration_minutes'),
                result=frenzy_data.get('result')
            )
            db.session.add(frenzy)
        
        db.session.commit()
        return jsonify({'id': daily_record.id, 'message': 'Record saved successfully'}), 201
    
    else:
        student_id = request.args.get('student_id', type=int)
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        query = DailyRecord.query
        
        # Students can only see their own data
        if current_user.role == 'student':
            if current_user.student_id:
                query = query.filter_by(student_id=current_user.student_id)
            else:
                return jsonify([])
        elif current_user.role == 'staff' and current_user.is_outside_staff:
            # Outside Staff can only see assigned students
            assigned_student_ids = [assoc.student_id for assoc in 
                                  OutsideStaffStudent.query.filter_by(user_id=current_user.id).all()]
            if not assigned_student_ids:
                return jsonify([])
            if student_id:
                # Verify access to requested student
                if student_id not in assigned_student_ids:
                    return jsonify({'error': 'Access denied to this student'}), 403
                query = query.filter_by(student_id=student_id)
            else:
                query = query.filter(DailyRecord.student_id.in_(assigned_student_ids))
        elif student_id:
            query = query.filter_by(student_id=student_id)
        if start_date:
            query = query.filter(DailyRecord.date >= datetime.strptime(start_date, '%Y-%m-%d').date())
        if end_date:
            query = query.filter(DailyRecord.date <= datetime.strptime(end_date, '%Y-%m-%d').date())
        
        records = query.all()
        result = []
        for record in records:
            periods = []
            for period in record.periods:
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
            
            frenzies = [{
                'id': f.id,
                'time_range': f.time_range,
                'location': f.location,
                'purpose': f.purpose,
                'purpose2': f.purpose2,
                'duration_minutes': f.duration_minutes,
                'result': f.result
            } for f in record.frenzies]
            
            # Get attendance_status, migrate from present boolean if needed
            attendance_status = record.attendance_status
            if not attendance_status:
                # Migration: convert old present boolean to new attendance_status
                attendance_status = 'present' if record.present else 'unexcused'
                # Update the record for future queries
                record.attendance_status = attendance_status
                db.session.commit()
            
            result.append({
                'id': record.id,
                'student_id': record.student_id,
                'date': record.date.isoformat(),
                'day_of_week': record.day_of_week,
                'present': record.present,  # Keep for backward compatibility
                'attendance_status': attendance_status,
                'periods': periods,
                'frenzies': frenzies
            })
        
        return jsonify(result)

@app.route('/api/summary', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def summary():
    student_id = request.args.get('student_id', type=int)
    period = request.args.get('period', None)
    timeframe = request.args.get('quarter') or request.args.get('timeframe', None)  # Support both old and new param names
    
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
    
    # Debug logging
    print(f"Summary API called - student_id: {student_id}, timeframe: {timeframe}")
    
    query = DailyRecord.query
    
    # Check if filtering by "managed by me"
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    
    # Students can only see their own summary
    if current_user.role == 'student':
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
                'additional_info': {'infractions': {}, 'total_reminders': 0, 'total_resets': 0}
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
            user_name = current_user.name or current_user.username
            user_username = current_user.username
            team_member = TeamMember.query.filter(
                TeamMember.student_id == student_id,
                ((TeamMember.name == user_name) | (TeamMember.name == user_username))
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
                    }
                })
    elif managed_by_me:
        # Filter to only students managed by current user
        # Check both name and username since team members might be stored with either
        user_name = current_user.name or current_user.username
        user_username = current_user.username
        team_members = TeamMember.query.filter(
            (TeamMember.name == user_name) | (TeamMember.name == user_username)
        ).all()
        student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
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
                }
            })
    
    # Get all records first, then filter in Python for more reliable date handling
    all_records = query.all()
    print(f"Found {len(all_records)} total records before filtering")
    
    # Filter out excused records (they should be saved but excluded from calculations)
    # Also migrate attendance_status for records that don't have it yet
    filtered_records = []
    for record in all_records:
        # Migrate attendance_status if needed
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'
            db.session.commit()
        
        # Exclude excused records from calculations
        if record.attendance_status != 'excused':
            filtered_records.append(record)
    
    all_records = filtered_records
    print(f"After filtering out excused records: {len(all_records)} records")
    
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
            'total_resets': 0
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
        
        for record in record_list:
            # Track day of week statistics (weekdays only)
            day_of_week = record.day_of_week
            is_weekday = day_of_week in weekdays
            
            if is_weekday:
                by_day_of_week[day_of_week]['total_days'] += 1
            for period in record.periods:
                total_safety += period.safety_points
                total_teamwork += period.teamwork_points
                total_accountability += period.accountability_points
                total_relationships += period.relationships_points
                total_possible += period.points_possible
                
                # Track day of week statistics for this period
                if is_weekday:
                    by_day_of_week[day_of_week]['safety_points'] += period.safety_points
                    by_day_of_week[day_of_week]['teamwork_points'] += period.teamwork_points
                    by_day_of_week[day_of_week]['accountability_points'] += period.accountability_points
                    by_day_of_week[day_of_week]['relationships_points'] += period.relationships_points
                    by_day_of_week[day_of_week]['possible_points'] += period.points_possible
                
                # Track class statistics for this period
                class_name = period.location or 'Unknown'
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
                by_class[class_name]['safety_points'] += period.safety_points
                by_class[class_name]['teamwork_points'] += period.teamwork_points
                by_class[class_name]['accountability_points'] += period.accountability_points
                by_class[class_name]['relationships_points'] += period.relationships_points
                by_class[class_name]['possible_points'] += period.points_possible
                
                # Track unique days per class (count once per date)
                if record.date not in by_class[class_name]['_unique_dates']:
                    by_class[class_name]['_unique_dates'].add(record.date)
                    by_class[class_name]['total_days'] += 1
                
                if period.frenzy:
                    total_frenzies += 1
                
                # Count infractions from period.infractions relationship
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
                    
                    # Track infractions by class
                    class_name = period.location or 'Unknown'
                    if infraction.infraction_type not in by_class[class_name]['infractions']:
                        by_class[class_name]['infractions'][infraction.infraction_type] = 0
                    by_class[class_name]['infractions'][infraction.infraction_type] += infraction.count
                
                # Extract all data from Info column JSON data
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
                            
                            # Track infractions by class
                            class_name = period.location or 'Unknown'
                            if infraction_type not in by_class[class_name]['infractions']:
                                by_class[class_name]['infractions'][infraction_type] = 0
                            by_class[class_name]['infractions'][infraction_type] += count
                        
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
                            
                            # Track infractions by class
                            class_name = period.location or 'Unknown'
                            if infraction_type not in by_class[class_name]['infractions']:
                                by_class[class_name]['infractions'][infraction_type] = 0
                            by_class[class_name]['infractions'][infraction_type] += count
                        
                        # Count reminders
                        reminder1 = info_data.get('reminder1', False)
                        reminder2 = info_data.get('reminder2', False)
                        reminder3 = info_data.get('reminder3', False)
                        if reminder1 and reminder1 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or 'Unknown'
                            by_class[class_name]['total_reminders'] += 1
                        if reminder2 and reminder2 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or 'Unknown'
                            by_class[class_name]['total_reminders'] += 1
                        if reminder3 and reminder3 not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_reminders'] += 1
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_reminders'] += 1
                            class_name = period.location or 'Unknown'
                            by_class[class_name]['total_reminders'] += 1
                        
                        # Count resets
                        reset = info_data.get('reset', False)
                        if reset and reset not in [False, None, '', 'false', 'False', '0', 0]:
                            additional_info['total_resets'] += 1
                            if is_weekday:
                                by_day_of_week[day_of_week]['total_resets'] += 1
                            class_name = period.location or 'Unknown'
                            by_class[class_name]['total_resets'] += 1
                            
                    except (json.JSONDecodeError, ValueError, TypeError):
                        pass
        
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
            'total_frenzies': total_frenzies,
            'additional_info': additional_info,
            'by_day_of_week': by_day_of_week_formatted,
            'by_class': by_class_formatted
        }
    
    # Filter by period if specified (takes precedence over timeframe)
    if period:
        from datetime import date
        today = date.today()
        current_school_year = get_school_year_for_date(today)
        
        filtered_records = []
        available_data_points = None
        
        if period == '30day':
            # Get unique dates that have data, sorted descending
            unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
            # Take the first 30 dates
            selected_dates = unique_dates[:30]
            # Track actual number of data points used
            available_data_points = len(selected_dates)
            # Filter records to only those dates
            filtered_records = [r for r in all_records if r.date in selected_dates]
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
        stats = calculate_summary_stats(all_records)
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
            'by_class': stats['by_class']
        }
        # Add data points info for 30day period
        if period == '30day' and available_data_points is not None:
            result['available_data_points'] = available_data_points
            result['has_full_30_days'] = available_data_points >= 30
        return jsonify(result)
    
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
        stats = calculate_summary_stats(records)
        return jsonify({
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
            'week_start': most_recent_monday.isoformat(),
            'week_end': most_recent_sunday.isoformat()
        })
    elif timeframe == '30day':
        # Get unique dates that have data, sorted descending
        unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
        # Track number of available data points
        total_available_data_points = len(unique_dates)
        # Take the first 30 dates
        selected_dates = unique_dates[:30]
        # Track actual number of data points used
        available_data_points = len(selected_dates)
        # Filter records to only those dates
        records = [r for r in all_records if r.date in selected_dates]
        print(f"After 30 day filtering: {len(records)} records from {len(selected_dates)} unique dates")
        # Calculate single summary
        stats = calculate_summary_stats(records)
        return jsonify({
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
            'available_data_points': available_data_points,
            'has_full_30_days': available_data_points >= 30
        })
    elif timeframe == '30day_to_30day':
        # Get unique dates that have data, sorted descending
        unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
        total_available_dates = len(unique_dates)
        
        # Take first 30 dates for "Most Recent 30 Days"
        most_recent_dates = unique_dates[:30]
        # Take next 30 dates for "Previous 30 Days"
        previous_dates = unique_dates[30:60] if len(unique_dates) > 30 else []
        
        # Track data points for each period
        most_recent_data_points = len(most_recent_dates)
        previous_data_points = len(previous_dates)
        
        # Filter records for each period
        most_recent_records = [r for r in all_records if r.date in most_recent_dates]
        previous_records = [r for r in all_records if r.date in previous_dates]
        
        # Calculate stats for each period
        most_recent_stats = calculate_summary_stats(most_recent_records)
        previous_stats = calculate_summary_stats(previous_records)
        
        # Add data points info to each period's stats
        most_recent_stats['available_data_points'] = most_recent_data_points
        most_recent_stats['has_full_30_days'] = most_recent_data_points >= 30
        previous_stats['available_data_points'] = previous_data_points
        previous_stats['has_full_30_days'] = previous_data_points >= 30
        
        # Build comparison data
        comparison_data = {
            'Most Recent 30 Days': most_recent_stats,
            'Previous 30 Days': previous_stats
        }
        
        return jsonify({
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
            month_stats = calculate_summary_stats(month_groups[month_key])
            comparison_data[month_key] = month_stats
        
        # Get available school years for dropdown
        available_school_years = get_available_school_years(all_records)
        
        return jsonify({
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
            quarter_stats = calculate_summary_stats(quarter_groups[quarter_key])
            comparison_data[quarter_key] = quarter_stats
        
        return jsonify({
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
            year_stats = calculate_summary_stats(year_groups[year_key])
            comparison_data[year_key] = year_stats
        
        return jsonify({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    else:
        # "alltime" or "all" - use all records, single summary
        records = all_records
        stats = calculate_summary_stats(records)
        return jsonify({
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
            'by_day_of_week': stats['by_day_of_week']
        })

@app.route('/api/case-manager-comparison', methods=['GET'])
@limiter.limit("30 per minute")
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
    
    # Filter records by timeframe
    all_records = DailyRecord.query.all()
    
    # Filter out excused records
    filtered_records = []
    for record in all_records:
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'
            db.session.commit()
        if record.attendance_status != 'excused':
            filtered_records.append(record)
    
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
        unique_dates = sorted(set([r.date for r in filtered_records]), reverse=True)
        selected_dates = unique_dates[:30]
        timeframe_filtered_records = [r for r in filtered_records if r.date in selected_dates]
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
        for record in cm_records:
            unique_students.add(record.student_id)
            unique_dates.add(record.date)
            
            for period in record.periods:
                total_safety += period.safety_points
                total_teamwork += period.teamwork_points
                total_accountability += period.accountability_points
                total_relationships += period.relationships_points
                total_possible += period.points_possible
                
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
    
    # Sort case managers by overall STAR percent (highest to lowest)
    sorted_managers = sorted(case_manager_data.keys(), key=lambda x: case_manager_data[x]['star_percentages']['overall'], reverse=True)
    
    return jsonify({
        'timeframe': timeframe,
        'case_managers': case_manager_data,
        'sorted_managers': sorted_managers
    })

@app.route('/api/import-csv', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
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

@app.route('/api/frenzy-stats', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def frenzy_stats():
    student_id = request.args.get('student_id', type=int)
    period = request.args.get('period', None)
    timeframe = request.args.get('timeframe', None)  # "30day", "month", "quarter", "year", "alltime"
    
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
    
    # Students can only see their own frenzy stats
    if current_user.role == 'student':
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
            user_name = current_user.name or current_user.username
            user_username = current_user.username
            team_member = TeamMember.query.filter(
                TeamMember.student_id == student_id,
                ((TeamMember.name == user_name) | (TeamMember.name == user_username))
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
        # Filter to only students managed by current user
        # Check both name and username since team members might be stored with either
        user_name = current_user.name or current_user.username
        user_username = current_user.username
        team_members = TeamMember.query.filter(
            (TeamMember.name == user_name) | (TeamMember.name == user_username)
        ).all()
        student_ids = list(set([tm.student_id for tm in team_members if tm.student_id]))
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
    
    # Get all records first
    all_records = query.all()
    
    # Filter out excused records (they should be saved but excluded from calculations)
    # Also migrate attendance_status for records that don't have it yet
    filtered_records = []
    for record in all_records:
        # Migrate attendance_status if needed
        if not record.attendance_status:
            record.attendance_status = 'present' if record.present else 'unexcused'
            db.session.commit()
        
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
                time_range = frenzy.time_range or 'Unknown'
                if time_range not in stats['by_time']:
                    stats['by_time'][time_range] = {'count': 0, 'duration': 0}
                stats['by_time'][time_range]['count'] += 1
                stats['by_time'][time_range]['duration'] += frenzy.duration_minutes or 0
                
                # By location
                location = frenzy.location or 'Unknown'
                if location not in stats['by_location']:
                    stats['by_location'][location] = {'count': 0, 'duration': 0}
                stats['by_location'][location]['count'] += 1
                stats['by_location'][location]['duration'] += frenzy.duration_minutes or 0
                
                # By purpose
                purpose = frenzy.purpose or 'Unknown'
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
                                location = period.location or 'Unknown'
                            else:
                                location = str(location).strip() if location else 'Unknown'
                            
                            if location not in stats['by_location']:
                                stats['by_location'][location] = {'count': 0, 'duration': 0}
                            stats['by_location'][location]['count'] += 1
                            stats['by_location'][location]['duration'] += duration
                            
                            # Collect purposes from INFO column
                            purpose1 = info_data.get('purpose1')
                            if purpose1 and str(purpose1).strip():
                                all_purposes.append(str(purpose1).strip())
                                purpose_str = str(purpose1).strip()
                                if purpose_str not in stats['by_purpose']:
                                    stats['by_purpose'][purpose_str] = {'count': 0, 'duration': 0}
                                stats['by_purpose'][purpose_str]['count'] += 1
                                stats['by_purpose'][purpose_str]['duration'] += duration
                            
                            purpose2 = info_data.get('purpose2')
                            if purpose2 and str(purpose2).strip():
                                all_purposes.append(str(purpose2).strip())
                                purpose_str = str(purpose2).strip()
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
            # Get unique dates that have data, sorted descending
            unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
            # Take the first 30 dates
            selected_dates = unique_dates[:30]
            # Track actual number of data points used
            available_data_points = len(selected_dates)
            # Filter records to only those dates
            filtered_records = [r for r in all_records if r.date in selected_dates]
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
        return jsonify(stats)
    
    # Filter by timeframe and handle comparison modes
    if timeframe == '30day':
        # Get unique dates that have data, sorted descending
        unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
        # Track number of available data points
        total_available_data_points = len(unique_dates)
        # Take the first 30 dates
        selected_dates = unique_dates[:30]
        # Track actual number of data points used
        available_data_points = len(selected_dates)
        # Filter records to only those dates
        records = [r for r in all_records if r.date in selected_dates]
        stats = calculate_frenzy_stats(records)
        stats['comparison_mode'] = False
        stats['available_data_points'] = available_data_points
        stats['has_full_30_days'] = available_data_points >= 30
        return jsonify(stats)
    elif timeframe == '30day_to_30day':
        # Get unique dates that have data, sorted descending
        unique_dates = sorted(set([r.date for r in all_records]), reverse=True)
        total_available_dates = len(unique_dates)
        
        # Take first 30 dates for "Most Recent 30 Days"
        most_recent_dates = unique_dates[:30]
        # Take next 30 dates for "Previous 30 Days"
        previous_dates = unique_dates[30:60] if len(unique_dates) > 30 else []
        
        # Track data points for each period
        most_recent_data_points = len(most_recent_dates)
        previous_data_points = len(previous_dates)
        
        # Filter records for each period
        most_recent_records = [r for r in all_records if r.date in most_recent_dates]
        previous_records = [r for r in all_records if r.date in previous_dates]
        
        # Calculate stats for each period
        most_recent_stats = calculate_frenzy_stats(most_recent_records)
        previous_stats = calculate_frenzy_stats(previous_records)
        
        # Add data points info to each period's stats
        most_recent_stats['available_data_points'] = most_recent_data_points
        most_recent_stats['has_full_30_days'] = most_recent_data_points >= 30
        previous_stats['available_data_points'] = previous_data_points
        previous_stats['has_full_30_days'] = previous_data_points >= 30
        
        # Build comparison data
        comparison_data = {
            'Most Recent 30 Days': most_recent_stats,
            'Previous 30 Days': previous_stats
        }
        
        return jsonify({
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
            month_stats = calculate_frenzy_stats(month_groups[month_key])
            comparison_data[month_key] = month_stats
        
        # Get available school years for dropdown
        available_school_years = get_available_school_years(all_records)
        
        return jsonify({
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
            quarter_stats = calculate_frenzy_stats(quarter_groups[quarter_key])
            comparison_data[quarter_key] = quarter_stats
        
        return jsonify({
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
            year_stats = calculate_frenzy_stats(year_groups[year_key])
            comparison_data[year_key] = year_stats
        
        return jsonify({
            'timeframe': timeframe,
            'comparison_mode': True,
            'periods': comparison_data
        })
    else:
        # "alltime" or "all" - use all records, single summary
        records = all_records
        stats = calculate_frenzy_stats(records)
        stats['comparison_mode'] = False
        return jsonify(stats)

@app.route('/api/schedules', methods=['GET', 'POST'])
@limiter.limit("60 per minute")
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
            periods = data.get('periods', [])
            
            # Validate schedule_type
            if schedule_type not in ['teacher', 'student']:
                return jsonify({'error': 'Invalid schedule_type. Must be "teacher" or "student"'}), 400
            
            # Validate periods data
            for index, period in enumerate(periods):
                time_period = period.get('time_period', '').strip()
                if not time_period:
                    return jsonify({'error': f'Time period is required for period {index + 1}'}), 400
            
            # Delete existing schedules
            if schedule_type == 'teacher':
                # Delete only the current user's teacher schedule
                Schedule.query.filter_by(schedule_type='teacher', user_id=current_user.id).delete()
            else:
                if not student_id:
                    return jsonify({'error': 'student_id is required for student schedules'}), 400
                Schedule.query.filter_by(schedule_type='student', student_id=student_id).delete()
            
            # Add new schedules with explicit sort order
            for index, period in enumerate(periods):
                schedule = Schedule(
                    schedule_type=schedule_type,
                    user_id=current_user.id if schedule_type == 'teacher' else None,
                    student_id=student_id if schedule_type == 'student' else None,
                    time_period=period.get('time_period', '').strip(),
                    class_name=period.get('class_name', '').strip() or None,
                    staff_name=period.get('staff_name', '').strip() or None,
                    sort_order=index  # Maintain the order
                )
                db.session.add(schedule)
            
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
        
        query = Schedule.query.filter_by(schedule_type=schedule_type)
        if schedule_type == 'teacher':
            # Filter teacher schedules by current user
            query = query.filter_by(user_id=current_user.id)
        elif schedule_type == 'student' and student_id:
            query = query.filter_by(student_id=student_id)
        
        # Order by sort_order to maintain the saved order
        schedules = query.order_by(Schedule.sort_order).all()
        
        result = [{
            'id': s.id,
            'time_period': s.time_period,
            'class_name': s.class_name,
            'staff_name': s.staff_name
        } for s in schedules]
        
        return jsonify(result)

@app.route('/api/schedules/all-locations', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def all_schedule_locations():
    """Get all unique class_name values from all staff schedules"""
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

@app.route('/api/users', methods=['GET', 'POST', 'PUT', 'DELETE'])
@limiter.limit("30 per minute")
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
        
        result = []
        for user in users:
            user_data = {
                'id': user.id,
                'name': user.name,
                'username': user.username,
                'role': user.role,
                'designation': user.designation,
                'student_id': user.student_id,
                'is_outside_staff': user.is_outside_staff if hasattr(user, 'is_outside_staff') else False,
                'district': user.district if hasattr(user, 'district') else None,
                'created_at': user.created_at.isoformat() if user.created_at else None
            }
            
            # Include assigned students for Outside Staff users
            if user.role == 'staff' and (hasattr(user, 'is_outside_staff') and user.is_outside_staff):
                assignments = OutsideStaffStudent.query.filter_by(user_id=user.id).all()
                assigned_students = []
                for assignment in assignments:
                    student = Student.query.get(assignment.student_id)
                    if student:
                        assigned_students.append({
                            'id': student.id,
                            'name': student.name
                        })
                user_data['assigned_students'] = assigned_students
            
            # Include student info and team members if available
            if user.student_id:
                student = Student.query.get(user.student_id)
                if student:
                    user_data['student_name'] = student.name
                    user_data['grade'] = student.grade
                    user_data['card_color'] = student.card_color
                    
                    # Get team members
                    team_members = TeamMember.query.filter_by(student_id=user.student_id).all()
                    user_data['team_members'] = {
                        'case_manager': [],
                        'practitioner': [],
                        'professional': [],
                        'group_leader': [],
                        'paraprofessional': []
                    }
                    for tm in team_members:
                        role_key = tm.role.lower().replace(' ', '_')
                        if role_key in user_data['team_members']:
                            user_data['team_members'][role_key].append(tm.name)
            result.append(user_data)
        
        return jsonify(result)
    
    elif request.method == 'POST':
        # Create new user
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid request. JSON data required.'}), 400
        
        # Validate required fields
        username = data.get('username', '').strip() if data.get('username') else ''
        password = data.get('password', '')
        role = data.get('role', '').strip() if data.get('role') else ''
        
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
            district=data.get('district') if (role == 'staff' and data.get('is_outside_staff')) else None
        )
        user.set_password(password)
        
        db.session.add(user)
        db.session.commit()
        
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
                user.set_password(data['password'])
            if 'role' in data:
                user.role = data['role']
            if 'designation' in data:
                user.designation = data['designation'] if data['designation'] else None
            if 'student_id' in data:
                user.student_id = data['student_id']
            if 'is_outside_staff' in data:
                user.is_outside_staff = data['is_outside_staff']
            if 'district' in data:
                user.district = data['district'] if data['district'] else None
            
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
                user.set_password(data['password'])
            
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
                user.set_password(data['password'])
            else:
                return jsonify({'error': 'Staff can only change their own password'}), 403
        
        elif current_user.id == user_id and user.role == 'student':
            # Students can only update their own password
            if 'password' in data:
                user.set_password(data['password'])
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
        
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted successfully'}), 200

@app.route('/api/outside-staff/<int:user_id>/students', methods=['GET', 'POST', 'DELETE'])
@limiter.limit("30 per minute")
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
@limiter.limit("30 per minute")
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
            total_safety += period.safety_points
            total_teamwork += period.teamwork_points
            total_accountability += period.accountability_points
            total_relationships += period.relationships_points
            total_possible += period.points_possible
    
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

def count_weekly_infractions(student_id, start_date, end_date):
    """Count total infractions for a date range"""
    records = DailyRecord.query.filter(
        DailyRecord.student_id == student_id,
        DailyRecord.date >= start_date,
        DailyRecord.date <= end_date
    ).all()
    
    total_count = 0
    for record in records:
        for period in record.periods:
            for infraction in period.infractions:
                total_count += infraction.count
    
    return total_count

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
@limiter.limit("30 per minute")
@login_required
def get_bank_account(student_id):
    """Get student's bank account balance and transaction history"""
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    account = get_or_create_bank_account(student_id)
    transactions = Transaction.query.filter_by(student_id=student_id).order_by(Transaction.created_at.desc()).limit(50).all()
    
    return jsonify({
        'balance': float(account.balance),
        'transactions': [{
            'id': t.id,
            'type': t.transaction_type,
            'amount': float(t.amount),
            'balance_after': float(t.balance_after),
            'description': t.description,
            'created_at': t.created_at.isoformat()
        } for t in transactions]
    })

@app.route('/api/paychecks/<int:student_id>', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_paychecks(student_id):
    """Get all paychecks for a student"""
    if not has_student_access(current_user, student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    paychecks = Paycheck.query.filter_by(student_id=student_id).order_by(Paycheck.created_at.desc()).all()
    
    return jsonify([{
        'id': p.id,
        'pay_period_start': p.pay_period_start.isoformat(),
        'pay_period_end': p.pay_period_end.isoformat(),
        'average_star_percent': float(p.average_star_percent),
        'base_pay': float(p.base_pay),
        'citation_count': p.citation_count,
        'citation_deduction': float(p.citation_deduction),
        'final_pay': float(p.final_pay),
        'worksheet_completed': p.worksheet_completed,
        'is_verified': p.is_verified,
        'deposited_at': p.deposited_at.isoformat() if p.deposited_at else None,
        'created_at': p.created_at.isoformat()
    } for p in paychecks])

@app.route('/api/paycheck/<int:paycheck_id>', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_paycheck(paycheck_id):
    """Get specific paycheck details"""
    paycheck = Paycheck.query.get_or_404(paycheck_id)
    
    if not has_student_access(current_user, paycheck.student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    return jsonify({
        'id': paycheck.id,
        'student_id': paycheck.student_id,
        'pay_period_start': paycheck.pay_period_start.isoformat(),
        'pay_period_end': paycheck.pay_period_end.isoformat(),
        'average_star_percent': float(paycheck.average_star_percent),
        'base_pay': float(paycheck.base_pay),
        'citation_count': paycheck.citation_count,
        'citation_deduction': float(paycheck.citation_deduction),
        'final_pay': float(paycheck.final_pay),
        'worksheet_completed': paycheck.worksheet_completed,
        'student_calculated_pay': float(paycheck.student_calculated_pay) if paycheck.student_calculated_pay else None,
        'student_calculated_citations': paycheck.student_calculated_citations,
        'student_calculated_deduction': float(paycheck.student_calculated_deduction) if paycheck.student_calculated_deduction else None,
        'student_calculated_final': float(paycheck.student_calculated_final) if paycheck.student_calculated_final else None,
        'is_verified': paycheck.is_verified,
        'deposited_at': paycheck.deposited_at.isoformat() if paycheck.deposited_at else None,
        'created_at': paycheck.created_at.isoformat()
    })

@app.route('/api/paycheck/generate', methods=['POST'])
@limiter.limit("10 per minute")
@login_required
@staff_required
def generate_paychecks():
    """Manually trigger paycheck generation"""
    data = request.json or {}
    target_date = data.get('date')  # Optional: specific Monday date to generate for
    
    if target_date:
        target_date = datetime.strptime(target_date, '%Y-%m-%d').date()
    else:
        # Default to previous Monday
        today = date.today()
        days_since_monday = (today.weekday()) % 7
        if days_since_monday == 0:  # Today is Monday
            target_date = today - timedelta(days=7)
        else:
            target_date = today - timedelta(days=days_since_monday)
    
    # Calculate Monday-Friday range
    pay_period_start = target_date  # Monday
    pay_period_end = target_date + timedelta(days=4)  # Friday
    
    # Get all students
    students = Student.query.all()
    generated_count = 0
    
    for student in students:
        # Check if paycheck already exists for this period
        existing = Paycheck.query.filter_by(
            student_id=student.id,
            pay_period_start=pay_period_start,
            pay_period_end=pay_period_end
        ).first()
        
        if existing:
            continue
        
        # Calculate STAR percent and infractions
        avg_star_percent = calculate_weekly_star_percent(student.id, pay_period_start, pay_period_end)
        citation_count = count_weekly_infractions(student.id, pay_period_start, pay_period_end)
        
        # Calculate pay
        base_pay = avg_star_percent * Decimal('100')
        citation_deduction = Decimal(str(citation_count * 2))
        final_pay = base_pay - citation_deduction
        
        # Create paycheck
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
        generated_count += 1
    
    db.session.commit()
    return jsonify({'message': f'Generated {generated_count} paychecks', 'count': generated_count})

@app.route('/api/paycheck/<int:paycheck_id>/complete-worksheet', methods=['POST'])
@limiter.limit("30 per minute")
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
@limiter.limit("30 per minute")
@login_required
def verify_paycheck(paycheck_id):
    """Auto-verify worksheet (if correct, deposit)"""
    paycheck = Paycheck.query.get_or_404(paycheck_id)
    
    if not paycheck.worksheet_completed:
        return jsonify({'error': 'Worksheet not completed'}), 400
    
    # Verify calculations
    tolerance = Decimal('0.01')  # Allow small rounding differences
    
    pay_correct = abs(paycheck.student_calculated_pay - paycheck.base_pay) <= tolerance
    citations_correct = paycheck.student_calculated_citations == paycheck.citation_count
    deduction_correct = abs(paycheck.student_calculated_deduction - paycheck.citation_deduction) <= tolerance
    final_correct = abs(paycheck.student_calculated_final - paycheck.final_pay) <= tolerance
    
    if pay_correct and citations_correct and deduction_correct and final_correct:
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
        db.session.commit()
        
        return jsonify({
            'verified': True,
            'message': 'Worksheet verified! Deposit completed.',
            'deposited_amount': float(paycheck.final_pay)
        })
    else:
        errors = []
        if not pay_correct:
            errors.append(f'Base pay calculation incorrect. Expected: {paycheck.base_pay}, Got: {paycheck.student_calculated_pay}')
        if not citations_correct:
            errors.append(f'Citation count incorrect. Expected: {paycheck.citation_count}, Got: {paycheck.student_calculated_citations}')
        if not deduction_correct:
            errors.append(f'Citation deduction incorrect. Expected: {paycheck.citation_deduction}, Got: {paycheck.student_calculated_deduction}')
        if not final_correct:
            errors.append(f'Final pay calculation incorrect. Expected: {paycheck.final_pay}, Got: {paycheck.student_calculated_final}')
        
        return jsonify({
            'verified': False,
            'errors': errors,
            'message': 'Some calculations are incorrect. Please review and try again.'
        }), 400

# Marketplace Routes
@app.route('/api/marketplace-items', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_marketplace_items():
    """Get marketplace items (filtered by user role and case manager)"""
    items_query = MarketplaceItem.query.filter_by(is_active=True)
    
    if current_user.role == 'student':
        # Students see global items and items from their case manager
        student_id = current_user.student_id
        case_manager = get_student_case_manager(student_id)
        
        if case_manager:
            items_query = items_query.filter(
                db.or_(
                    MarketplaceItem.is_global == True,
                    MarketplaceItem.is_approved_for_global == True,
                    MarketplaceItem.created_by_user_id == case_manager.id
                )
            )
        else:
            # Only global items if no case manager
            items_query = items_query.filter(
                db.or_(
                    MarketplaceItem.is_global == True,
                    MarketplaceItem.is_approved_for_global == True
                )
            )
    elif current_user.role in ['staff', 'admin']:
        # Staff and admin see all items
        pass
    
    items = items_query.all()
    
    return jsonify([{
        'id': item.id,
        'name': item.name,
        'description': item.description,
        'price': float(item.price),
        'created_by_user_id': item.created_by_user_id,
        'is_global': item.is_global,
        'is_approved_for_global': item.is_approved_for_global,
        'created_at': item.created_at.isoformat()
    } for item in items])

@app.route('/api/marketplace-items', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def create_marketplace_item():
    """Create new marketplace item (case manager only)"""
    if current_user.role not in ['staff', 'admin']:
        return jsonify({'error': 'Permission denied'}), 403
    
    # Check if user is a case manager
    if current_user.designation != 'Case Manager' and current_user.role != 'admin':
        return jsonify({'error': 'Only case managers can create marketplace items'}), 403
    
    data = request.json
    name = data.get('name')
    description = data.get('description', '')
    price = Decimal(str(data.get('price', 0)))
    
    if not name or price <= 0:
        return jsonify({'error': 'Name and valid price required'}), 400
    
    item = MarketplaceItem(
        name=name,
        description=description,
        price=price,
        created_by_user_id=current_user.id,
        is_global=data.get('is_global', False)
    )
    db.session.add(item)
    db.session.commit()
    
    return jsonify({
        'id': item.id,
        'name': item.name,
        'description': item.description,
        'price': float(item.price),
        'created_by_user_id': item.created_by_user_id,
        'is_global': item.is_global,
        'created_at': item.created_at.isoformat()
    }), 201

@app.route('/api/marketplace-items/<int:item_id>', methods=['PUT'])
@limiter.limit("20 per minute")
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
    
    item.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        'id': item.id,
        'name': item.name,
        'description': item.description,
        'price': float(item.price),
        'is_active': item.is_active,
        'updated_at': item.updated_at.isoformat()
    })

@app.route('/api/marketplace-items/<int:item_id>', methods=['DELETE'])
@limiter.limit("20 per minute")
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

@app.route('/api/marketplace-items/<int:item_id>/request-global', methods=['POST'])
@limiter.limit("20 per minute")
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
        'created_at': request_obj.created_at.isoformat()
    }), 201

@app.route('/api/marketplace-item-requests', methods=['GET'])
@limiter.limit("30 per minute")
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
        'created_at': r.created_at.isoformat()
    } for r in requests])

@app.route('/api/marketplace-item-requests/<int:request_id>/approve', methods=['POST'])
@limiter.limit("20 per minute")
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
@limiter.limit("20 per minute")
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
@app.route('/api/purchase-orders', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_purchase_orders():
    """Get purchase orders (filtered by user role)"""
    if current_user.role == 'student':
        orders = PurchaseOrder.query.filter_by(student_id=current_user.student_id).order_by(PurchaseOrder.created_at.desc()).all()
    elif current_user.designation == 'Case Manager':
        # Case managers see orders for their students
        orders = PurchaseOrder.query.filter_by(case_manager_id=current_user.id).order_by(PurchaseOrder.created_at.desc()).all()
    elif current_user.role == 'admin':
        orders = PurchaseOrder.query.order_by(PurchaseOrder.created_at.desc()).all()
    else:
        orders = []
    
    return jsonify([{
        'id': o.id,
        'student_id': o.student_id,
        'student_name': o.student.name,
        'item_id': o.item_id,
        'item_name': o.item.name,
        'item_price': float(o.item_price),
        'student_balance_before': float(o.student_balance_before),
        'student_calculated_balance_after': float(o.student_calculated_balance_after),
        'actual_balance_after': float(o.actual_balance_after),
        'is_calculation_correct': o.is_calculation_correct,
        'status': o.status,
        'case_manager_id': o.case_manager_id,
        'created_at': o.created_at.isoformat(),
        'approved_at': o.approved_at.isoformat() if o.approved_at else None,
        'fulfilled_at': o.fulfilled_at.isoformat() if o.fulfilled_at else None
    } for o in orders])

@app.route('/api/purchase-orders', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def create_purchase_order():
    """Create purchase order (student submits purchase with calculation)"""
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
    
    # Get student's bank account
    account = get_or_create_bank_account(current_user.student_id)
    student_balance_before = account.balance
    
    # Calculate actual balance after
    actual_balance_after = student_balance_before - item.price
    
    # Verify calculation
    tolerance = Decimal('0.01')
    is_calculation_correct = abs(student_calculated_balance_after - actual_balance_after) <= tolerance
    
    # Check if balance would be negative
    if actual_balance_after < 0:
        return jsonify({'error': 'Insufficient funds'}), 400
    
    if not is_calculation_correct:
        return jsonify({
            'error': 'Calculation incorrect',
            'expected': float(actual_balance_after),
            'got': float(student_calculated_balance_after)
        }), 400
    
    # Get case manager
    case_manager = get_student_case_manager(current_user.student_id)
    if not case_manager:
        return jsonify({'error': 'No case manager assigned'}), 400
    
    # Create purchase order
    order = PurchaseOrder(
        student_id=current_user.student_id,
        item_id=item_id,
        item_price=item.price,
        student_balance_before=student_balance_before,
        student_calculated_balance_after=student_calculated_balance_after,
        actual_balance_after=actual_balance_after,
        is_calculation_correct=is_calculation_correct,
        status='pending',
        case_manager_id=case_manager.id
    )
    db.session.add(order)
    db.session.commit()
    
    return jsonify({
        'id': order.id,
        'status': order.status,
        'message': 'Purchase order created successfully'
    }), 201

@app.route('/api/purchase-orders/<int:order_id>', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_purchase_order(order_id):
    """Get specific purchase order"""
    order = PurchaseOrder.query.get_or_404(order_id)
    
    if current_user.role == 'student' and order.student_id != current_user.student_id:
        return jsonify({'error': 'Access denied'}), 403
    
    if not has_student_access(current_user, order.student_id):
        return jsonify({'error': 'Access denied'}), 403
    
    return jsonify({
        'id': order.id,
        'student_id': order.student_id,
        'student_name': order.student.name,
        'item_id': order.item_id,
        'item_name': order.item.name,
        'item_description': order.item.description,
        'item_price': float(order.item_price),
        'student_balance_before': float(order.student_balance_before),
        'student_calculated_balance_after': float(order.student_calculated_balance_after),
        'actual_balance_after': float(order.actual_balance_after),
        'is_calculation_correct': order.is_calculation_correct,
        'status': order.status,
        'case_manager_id': order.case_manager_id,
        'case_manager_name': order.case_manager.name if order.case_manager else None,
        'created_at': order.created_at.isoformat(),
        'approved_at': order.approved_at.isoformat() if order.approved_at else None,
        'fulfilled_at': order.fulfilled_at.isoformat() if order.fulfilled_at else None
    })

@app.route('/api/purchase-orders/<int:order_id>/status', methods=['PUT'])
@limiter.limit("20 per minute")
@login_required
def update_purchase_order_status(order_id):
    """Update purchase order status (case manager/admin)"""
    order = PurchaseOrder.query.get_or_404(order_id)
    
    if current_user.role == 'admin':
        pass  # Admin can update any order
    elif current_user.designation == 'Case Manager' and order.case_manager_id == current_user.id:
        pass  # Case manager can update their orders
    else:
        return jsonify({'error': 'Permission denied'}), 403
    
    data = request.json
    new_status = data.get('status')
    
    if new_status not in ['pending', 'approved', 'fulfilled', 'denied']:
        return jsonify({'error': 'Invalid status'}), 400
    
    old_status = order.status
    order.status = new_status
    
    if new_status == 'approved' and old_status == 'pending':
        order.approved_at = datetime.utcnow()
    elif new_status == 'fulfilled' and old_status == 'approved':
        order.fulfilled_at = datetime.utcnow()
        
        # Create transaction and update balance
        account = get_or_create_bank_account(order.student_id)
        account.balance = order.actual_balance_after
        account.updated_at = datetime.utcnow()
        
        transaction = Transaction(
            student_id=order.student_id,
            bank_account_id=account.id,
            transaction_type='purchase',
            amount=-order.item_price,  # Negative for purchase
            purchase_order_id=order.id,
            balance_after=account.balance,
            description=f'Purchase: {order.item.name}'
        )
        db.session.add(transaction)
    
    db.session.commit()
    
    return jsonify({
        'id': order.id,
        'status': order.status,
        'message': f'Order status updated to {new_status}'
    })

@app.route('/api/purchase-orders/case-manager/<int:user_id>', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
def get_case_manager_purchase_orders(user_id):
    """Get orders for a case manager's students"""
    if current_user.role != 'admin' and current_user.id != user_id:
        return jsonify({'error': 'Permission denied'}), 403
    
    orders = PurchaseOrder.query.filter_by(case_manager_id=user_id).order_by(PurchaseOrder.created_at.desc()).all()
    
    return jsonify([{
        'id': o.id,
        'student_id': o.student_id,
        'student_name': o.student.name,
        'item_id': o.item_id,
        'item_name': o.item.name,
        'item_price': float(o.item_price),
        'status': o.status,
        'created_at': o.created_at.isoformat()
    } for o in orders])

@app.route('/api/bank-account/search', methods=['GET'])
@limiter.limit("30 per minute")
@login_required
@staff_required
def search_bank_accounts():
    """Search for student bank accounts (same search logic as daily entry)"""
    query = request.args.get('q', '').strip()
    managed_by_me = request.args.get('managed_by_me', 'false').lower() == 'true'
    
    # Get all students
    students_query = Student.query
    
    if query:
        # Search by student name
        students_by_name = students_query.filter(Student.name.ilike(f'%{query}%')).all()
        
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
    else:
        students = students_query.all()
    
    # Filter by managed by me if requested
    if managed_by_me and current_user.designation == 'Case Manager':
        managed_student_ids = [
            tm.student_id for tm in TeamMember.query.filter_by(
                role='Case Manager',
                name=current_user.name
            ).all()
        ]
        students = [s for s in students if s.id in managed_student_ids]
    
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
    
    return jsonify(result)

@app.route('/test')
def test():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

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
    with app.app_context():
        db.create_all()
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
    app.run(host='0.0.0.0', port=port, debug=False)

