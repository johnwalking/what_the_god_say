from __future__ import annotations

import shutil
import subprocess

import pytest

from server.textutil import fnv1a, normalize


def test_normalize_strips_punctuation_and_folds_width():
    assert normalize('我老婆，很煩！ ABC') == '我老婆很煩abc'


def test_normalize_handles_none():
    assert normalize(None) == ''


def test_fnv1a_empty_is_offset_basis():
    assert fnv1a('') == 0x811C9DC5


@pytest.mark.skipif(shutil.which('node') is None, reason='需要 node')
def test_fnv1a_matches_frontend():
    text = '我老婆不好'
    js = (
        "import('./assets/match.js').then(m => console.log(m.hashFNV1a(process.argv[1])))"
    )
    out = subprocess.run(['node', '-e', js, text], capture_output=True, text=True, check=True).stdout
    assert fnv1a(text) == int(out.strip())
