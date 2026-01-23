#!/usr/bin/env python3
"""
Generate a secure SECRET_KEY for Flask application.
Run this script to generate a new SECRET_KEY for production use.
"""

import secrets

def generate_secret_key():
    """Generate a secure random secret key"""
    return secrets.token_hex(32)

if __name__ == '__main__':
    key = generate_secret_key()
    print("=" * 60)
    print("SECURE SECRET KEY GENERATED")
    print("=" * 60)
    print(f"\nSECRET_KEY={key}\n")
    print("=" * 60)
    print("\nTo use this key:")
    print("\n1. Set as environment variable:")
    print(f"   export SECRET_KEY={key}")
    print("\n2. Or add to your .env file:")
    print(f"   SECRET_KEY={key}")
    print("\n3. For Render.com, add as environment variable in dashboard")
    print("\n⚠️  Keep this key secret! Do not commit it to version control.")
    print("=" * 60)
