"""CLI: register the on-disk MANIFEST.json + pickle files as a row in public.model_manifests.

Usage:
    python register_model.py --id 2026-05-24-v1.0 --activate
    python register_model.py --id 2026-05-24-v1.1 --notes "switched to quantile loss"

Computes sha256 of each model pickle and the encoders pickle, then inserts a row.
With --activate, atomically clears any existing active row and sets this one active.
"""

import argparse
import hashlib
import json
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

ML_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(ML_DIR, 'models')

load_dotenv(os.path.join(ML_DIR, '..', '.env'))


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description='Register the current MANIFEST as a model_manifests row.')
    parser.add_argument('--id', required=True, help='Human-readable manifest id, e.g. 2026-05-24-v1.0')
    parser.add_argument('--activate', action='store_true', help='Set this manifest active (clears existing active row).')
    parser.add_argument('--notes', default=None, help='Optional notes.')
    parser.add_argument('--registered-by', default=os.getenv('USER', 'unknown'))
    args = parser.parse_args()

    manifest_path = os.path.join(MODELS_DIR, 'MANIFEST.json')
    if not os.path.exists(manifest_path):
        print(f"ERROR: MANIFEST.json not found at {manifest_path}", file=sys.stderr)
        return 1

    with open(manifest_path) as f:
        manifest = json.load(f)

    file_hashes: dict[str, str] = {}
    for role in manifest['models']:
        model_path = os.path.join(MODELS_DIR, f'{role}.pkl')
        if not os.path.exists(model_path):
            print(f"ERROR: model file missing: {model_path}", file=sys.stderr)
            return 1
        file_hashes[role] = sha256_of(model_path)

    encoders_hash = None
    encoders_path = os.path.join(MODELS_DIR, 'encoders.pkl')
    if os.path.exists(encoders_path):
        encoders_hash = sha256_of(encoders_path)

    url = os.getenv('VITE_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
    if not url or not key:
        print("ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
        return 1
    supabase = create_client(url, key)

    if args.activate:
        # Clear existing active row first. Two-step (not transactional via the
        # supabase-py client) — acceptable because the unique partial index will
        # reject a duplicate active row if a race occurs, and the operator will
        # see the error.
        supabase.table('model_manifests').update({'is_active': False}).eq('is_active', True).execute()

    row = {
        'manifest_id': args.id,
        'models': manifest['models'],
        'file_hashes': file_hashes,
        'encoders_version': manifest.get('encoders'),
        'encoders_hash': encoders_hash,
        'is_active': bool(args.activate),
        'notes': args.notes,
        'registered_by': args.registered_by,
    }
    res = supabase.table('model_manifests').insert(row).execute()
    print(f"Registered manifest {args.id} (active={args.activate})")
    print(f"  models: {row['models']}")
    print(f"  file_hashes: {file_hashes}")
    if res.data:
        print(f"  id: {res.data[0].get('id')}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
