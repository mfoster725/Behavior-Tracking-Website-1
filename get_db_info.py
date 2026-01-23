#!/usr/bin/env python3
"""
Script to extract PostgreSQL connection details from DATABASE_URL
Can also parse a connection string passed as argument
"""
import os
import sys
from urllib.parse import urlparse

# Check if connection string provided as argument, otherwise use env var
if len(sys.argv) > 1:
    database_url = sys.argv[1]
else:
    database_url = os.environ.get('DATABASE_URL')

if database_url:
    print("=" * 60)
    print("PostgreSQL Connection Details for DBeaver")
    print("=" * 60)
    
    # Parse the URL
    # Handle both postgres:// and postgresql:// formats
    if database_url.startswith('postgres://'):
        parsed = urlparse(database_url.replace('postgres://', 'postgresql://', 1))
    else:
        parsed = urlparse(database_url)
    
    print()
    print("DBeaver Connection Settings:")
    print("-" * 60)
    print(f"Database Type: PostgreSQL")
    print(f"Host:          {parsed.hostname}")
    print(f"Port:          {parsed.port or 5432}")
    print(f"Database:      {parsed.path.lstrip('/')}")
    print(f"Username:      {parsed.username}")
    print(f"Password:      {'*' * len(parsed.password) if parsed.password else 'Not set'}")
    print()
    print("Full Connection String (masked password):")
    if parsed.password:
        masked_url = database_url.replace(parsed.password, '*' * len(parsed.password))
        print(masked_url)
    else:
        print(database_url)
else:
    print("DATABASE_URL not found.")
    print()
    print("Usage:")
    print("  python get_db_info.py")
    print("    (reads from DATABASE_URL environment variable)")
    print()
    print("  python get_db_info.py 'postgresql://user:pass@host:port/db'")
    print("    (parses the provided connection string)")
    print()
    print("To get your Render PostgreSQL connection string:")
    print("1. Go to https://dashboard.render.com")
    print("2. Open your PostgreSQL database")
    print("3. Click 'Connect' tab")
    print("4. Copy the 'External Database URL'")
    print("5. Run: python get_db_info.py 'your_connection_string_here'")
