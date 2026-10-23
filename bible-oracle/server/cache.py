"""SQLite 鍵值快取：同一個問題永遠得到同一張卡，也讓分享連結可重現。"""
from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any, Optional


class Cache:
    def __init__(self, path: str = ':memory:'):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            self._db.commit()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            row = self._db.execute('SELECT value FROM kv WHERE key = ?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._db.execute('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', (key, json.dumps(value, ensure_ascii=False)))
            self._db.commit()
