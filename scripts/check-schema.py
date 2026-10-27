#!/usr/bin/env python3
"""Validate data/catalog.json against the published data/catalog.schema.json.

    python3 scripts/check-schema.py          # needs `pip install jsonschema`; pre-commit installs it for you

The schema is only trusted after it has been seen to fail, so the same run
checks the fixtures too: every tests/fixtures/valid/*.json must pass and every
tests/fixtures/invalid/*.json must be rejected.  tests/validate-lib.test.mjs
holds scripts/validate-lib.mjs to the same fixtures, so the two validators
can't drift apart unnoticed.  tests/fixtures/invalid-cross-entry/ is left out
here: duplicates span entries, which JSON Schema can't compare.
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / "data/catalog.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)


def errors(path):
    return list(validator.iter_errors(json.loads(path.read_text(encoding="utf-8"))))


problems = []
for e in errors(root / "data/catalog.json"):
    problems.append(f"data/catalog.json: /{'/'.join(map(str, e.absolute_path))}: {e.message}")
for path in sorted((root / "tests/fixtures/valid").glob("*.json")):
    for e in errors(path):
        problems.append(f"{path.relative_to(root)} should pass but: /{'/'.join(map(str, e.absolute_path))}: {e.message}")
invalid = sorted((root / "tests/fixtures/invalid").glob("*.json"))
for path in invalid:
    if not errors(path):
        problems.append(f"{path.relative_to(root)} should be rejected by the schema, but passes")

for p in problems:
    print(f"✗ {p}", file=sys.stderr)
if problems:
    sys.exit(f"\n{len(problems)} problem(s) found.")
print(f"✓ data/catalog.json matches data/catalog.schema.json; the schema rejects all {len(invalid)} invalid fixtures.")
