"""Print the backend's OpenAPI schema as JSON — no server needed.

Used by `make api-types` to regenerate frontend/src/api/schema.d.ts.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
# Importing the app reads config; give it what validation needs, touch nothing.
os.environ.setdefault("JWT_SECRET", "openapi-dump-only-secret-long-enough")

import app  # noqa: E402

json.dump(app.app.openapi(), sys.stdout, indent=1, sort_keys=True)
