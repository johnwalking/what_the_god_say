from __future__ import annotations

import threading
import time

import numpy as np

from server.embedder import BgeM3Embedder


class _StubModel:
    """記錄同時有幾個執行緒在 encode；若沒有鎖，重疊數會大於 1。"""

    def __init__(self):
        self.active = 0
        self.max_active = 0
        self._guard = threading.Lock()

    def encode(self, texts, **kwargs):
        with self._guard:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.02)
        with self._guard:
            self.active -= 1
        return np.ones((len(texts), 4), dtype=np.float64)


def test_encode_is_serialized_across_threads():
    embedder = BgeM3Embedder()
    embedder._model = _StubModel()
    results = []
    threads = [threading.Thread(target=lambda: results.append(embedder.encode(['a', 'b']))) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert embedder._model.max_active == 1
    assert len(results) == 6 and all(r.shape == (2, 4) and r.dtype == np.float32 for r in results)
