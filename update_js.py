import re

# Read the file
with open('static/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Update loadSummary function
pattern1 = r"(const studentId = document\.getElementById\('summary-student-select'\)\.value;\s+const timeframe = document\.getElementById\('quarter-select'\)\.value;)"
replacement1 = """const studentId = document.getElementById('summary-student-select').value;
    const periodSelect = document.getElementById('summary-period-select');
    const timeframeSelect = document.getElementById('quarter-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';"""
content = re.sub(pattern1, replacement1, content)

# Update loadSummary URL building
pattern2 = r"(let url = `/api/summary\?timeframe=\$\{timeframe\}`;\s+if \(studentId\) \{\s+url \+= `&student_id=\$\{studentId\}`;\s+\}\s+if \(managedByMe\) \{\s+url \+= `&managed_by_me=true`;\s+\}\s+// Add school year parameter for month comparison\s+if \(timeframe === 'month'\) \{\s+const schoolYearSelect = document\.getElementById\('summary-school-year-select'\);\s+const selectedSchoolYear = schoolYearSelect \? schoolYearSelect\.value : getCurrentSchoolYear\(\);\s+if \(selectedSchoolYear\) \{\s+url \+= `&school_year=\$\{encodeURIComponent\(selectedSchoolYear\)\}`;\s+\}\s+\}\s+// Send quarter and school year dates to backend\s+url \+= `&quarter_dates=\$\{encodeURIComponent\(JSON\.stringify\(quarterDatesForBackend\)\)\}`;\s+url \+= `&school_year_dates=\$\{encodeURIComponent\(JSON\.stringify\(schoolYearDatesForBackend\)\)\}`;)"
replacement2 = """let url = `/api/summary`;
    const params = [];
    
    // If period is selected, use period and ignore timeframe
    if (period) {
        params.push(`period=${encodeURIComponent(period)}`);
    } else if (timeframe) {
        // Only use timeframe if period is not selected
        params.push(`timeframe=${timeframe}`);
        // Add school year parameter for month comparison
        if (timeframe === 'month') {
            const schoolYearSelect = document.getElementById('summary-school-year-select');
            const selectedSchoolYear = schoolYearSelect ? schoolYearSelect.value : getCurrentSchoolYear();
            if (selectedSchoolYear) {
                params.push(`school_year=${encodeURIComponent(selectedSchoolYear)}`);
            }
        }
    }
    
    if (studentId) {
        params.push(`student_id=${studentId}`);
    }
    if (managedByMe) {
        params.push(`managed_by_me=true`);
    }
    // Send quarter and school year dates to backend
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }"""
content = re.sub(pattern2, replacement2, content, flags=re.DOTALL)

# Update loadFrenzyStats function
pattern3 = r"(const studentId = document\.getElementById\('frenzy-student-select'\)\.value;\s+const timeframe = document\.getElementById\('frenzy-timeframe-select'\)\.value;)"
replacement3 = """const studentId = document.getElementById('frenzy-student-select').value;
    const periodSelect = document.getElementById('frenzy-period-select');
    const timeframeSelect = document.getElementById('frenzy-timeframe-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';"""
content = re.sub(pattern3, replacement3, content)

# Update loadFrenzyStats params
pattern4 = r"(if \(studentId\) \{\s+params\.push\(`student_id=\$\{studentId\}`\);\s+\}\s+if \(timeframe\) \{\s+params\.push\(`timeframe=\$\{timeframe\}`\);\s+\}\s+if \(managedByMe\) \{\s+params\.push\(`managed_by_me=true`\);\s+\}\s+// Add school year parameter for month comparison\s+if \(timeframe === 'month'\) \{)"
replacement4 = """// If period is selected, use period and ignore timeframe
    if (period) {
        params.push(`period=${encodeURIComponent(period)}`);
    } else if (timeframe) {
        // Only use timeframe if period is not selected
        params.push(`timeframe=${timeframe}`);
    }
    
    if (studentId) {
        params.push(`student_id=${studentId}`);
    }
    if (managedByMe) {
        params.push(`managed_by_me=true`);
    }
    // Add school year parameter for month comparison
    if (timeframe === 'month') {"""
content = re.sub(pattern4, replacement4, content, flags=re.DOTALL)

# Write the file
with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("JavaScript file updated successfully")
