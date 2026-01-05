from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date
import os
import csv
from io import StringIO

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///behavior_tracking.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Database Models
class Student(db.Model):
    __tablename__ = 'students'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    daily_records = db.relationship('DailyRecord', backref='student', lazy=True, cascade='all, delete-orphan')

class DailyRecord(db.Model):
    __tablename__ = 'daily_records'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('students.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    day_of_week = db.Column(db.String(20))
    
    # Attendance
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

# Routes
@app.route('/')
def index():
    return render_template('index.html', date=date)

@app.route('/api/students', methods=['GET', 'POST'])
def students():
    if request.method == 'POST':
        data = request.json
        student = Student(name=data['name'], email=data.get('email'))
        db.session.add(student)
        db.session.commit()
        return jsonify({'id': student.id, 'name': student.name}), 201
    else:
        students = Student.query.all()
        return jsonify([{'id': s.id, 'name': s.name, 'email': s.email} for s in students])

@app.route('/api/period-data', methods=['GET', 'POST'])
def period_data():
    """Get or save period-based data for all students"""
    if request.method == 'POST':
        data = request.json
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        period = data['period']
        location = data.get('location', period)
        
        saved_count = 0
        
        for student_data in data.get('students', []):
            student_id = student_data['student_id']
            
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
                    present=True
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
                    points_possible=4
                )
                db.session.add(period_record)
            
            saved_count += 1
        
        db.session.commit()
        return jsonify({'message': f'Saved {saved_count} student records', 'count': saved_count}), 200
    
    else:
        # GET request - retrieve period data
        record_date = datetime.strptime(request.args.get('date'), '%Y-%m-%d').date()
        period = request.args.get('period')
        
        # Get all daily records for this date
        daily_records = DailyRecord.query.filter_by(date=record_date).all()
        
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
                    'relationships_points': period_record.relationships_points
                })
        
        return jsonify(result)

@app.route('/api/daily-records', methods=['GET', 'POST'])
def daily_records():
    if request.method == 'POST':
        data = request.json
        student_id = data['student_id']
        record_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        # Check if record exists
        existing = DailyRecord.query.filter_by(
            student_id=student_id, 
            date=record_date
        ).first()
        
        if existing:
            daily_record = existing
        else:
            daily_record = DailyRecord(
                student_id=student_id,
                date=record_date,
                day_of_week=record_date.strftime('%A'),
                present=data.get('present', True)
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
                reminders=period_data.get('reminders')
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
        if student_id:
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
            
            result.append({
                'id': record.id,
                'student_id': record.student_id,
                'date': record.date.isoformat(),
                'day_of_week': record.day_of_week,
                'present': record.present,
                'periods': periods,
                'frenzies': frenzies
            })
        
        return jsonify(result)

@app.route('/api/summary', methods=['GET'])
def summary():
    student_id = request.args.get('student_id', type=int)
    quarter = request.args.get('quarter')  # "1", "2", "3", "4", or "all"
    
    # Define quarter date ranges (adjust as needed)
    quarter_dates = {
        '1': ('2025-09-02', '2025-11-06'),
        '2': ('2025-11-07', '2026-01-15'),
        '3': ('2026-01-16', '2026-03-19'),
        '4': ('2026-03-20', '2026-05-28')
    }
    
    query = DailyRecord.query
    if student_id:
        query = query.filter_by(student_id=student_id)
    
    if quarter and quarter != 'all':
        start, end = quarter_dates[quarter]
        query = query.filter(
            DailyRecord.date >= datetime.strptime(start, '%Y-%m-%d').date(),
            DailyRecord.date <= datetime.strptime(end, '%Y-%m-%d').date()
        )
    
    records = query.all()
    
    # Calculate summaries
    total_safety = 0
    total_teamwork = 0
    total_accountability = 0
    total_relationships = 0
    total_possible = 0
    total_infractions = {}
    total_frenzies = 0
    
    for record in records:
        for period in record.periods:
            total_safety += period.safety_points
            total_teamwork += period.teamwork_points
            total_accountability += period.accountability_points
            total_relationships += period.relationships_points
            total_possible += period.points_possible
            
            if period.frenzy:
                total_frenzies += 1
            
            for infraction in period.infractions:
                if infraction.infraction_type not in total_infractions:
                    total_infractions[infraction.infraction_type] = 0
                total_infractions[infraction.infraction_type] += infraction.count
    
    avg_safety = total_safety / len(records) if records else 0
    avg_teamwork = total_teamwork / len(records) if records else 0
    avg_accountability = total_accountability / len(records) if records else 0
    avg_relationships = total_relationships / len(records) if records else 0
    overall_avg = (avg_safety + avg_teamwork + avg_accountability + avg_relationships) / 4 if records else 0
    
    return jsonify({
        'quarter': quarter,
        'total_days': len(records),
        'averages': {
            'safety': round(avg_safety, 2),
            'teamwork': round(avg_teamwork, 2),
            'accountability': round(avg_accountability, 2),
            'relationships': round(avg_relationships, 2),
            'overall': round(overall_avg, 2)
        },
        'totals': {
            'safety': total_safety,
            'teamwork': total_teamwork,
            'accountability': total_accountability,
            'relationships': total_relationships,
            'possible': total_possible
        },
        'infractions': total_infractions,
        'total_frenzies': total_frenzies
    })

@app.route('/api/import-csv', methods=['POST'])
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
def frenzy_stats():
    student_id = request.args.get('student_id', type=int)
    quarter = request.args.get('quarter')
    
    query = DailyRecord.query
    if student_id:
        query = query.filter_by(student_id=student_id)
    
    records = query.all()
    
    # Aggregate frenzy statistics
    stats = {
        'by_day': {},
        'by_time': {},
        'by_location': {},
        'by_purpose': {},
        'total_count': 0,
        'total_duration': 0
    }
    
    for record in records:
        for frenzy in record.frenzies:
            stats['total_count'] += 1
            stats['total_duration'] += frenzy.duration_minutes or 0
            
            # By day of week
            day = record.day_of_week
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
    
    return jsonify(stats)

@app.route('/test')
def test():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)

