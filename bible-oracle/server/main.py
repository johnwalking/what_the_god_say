"""FastAPI 入口。啟動：uvicorn server.main:app --port 8000（同時提供前端靜態檔）。"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Deque, Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from server.cache import Cache
from server.pipeline import Pipeline

log = logging.getLogger('oracle')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CONTROL_CHARS = re.compile(r'[\u0000-\u001f\u007f]')


class AskBody(BaseModel):
    q: str = Field(min_length=1, max_length=100)
    n: int = Field(default=0, ge=0, le=1000)


class RateLimiter:
    """每個 IP 在時間窗內最多 limit 次的滑動視窗。"""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > self.window:
                self._last_sweep = now
                for stale in [k for k, q in self._hits.items()
                              if not q or now - q[-1] > self.window]:
                    del self._hits[stale]
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


def warm_up(pipeline) -> None:
    """預載 embedding 模型與 Ollama 模型，避免第一位訪客等冷啟動。絕不拋出例外。"""
    try:
        pipeline.retriever.embedder.encode(['暖機'])
    except Exception:
        log.warning('embedder 暖機失敗', exc_info=True)
    if getattr(pipeline, 'llm', None) is None:
        return
    try:
        pipeline.llm.generate_json(
            '只回傳 JSON。', '回傳 ok 為 true。',
            {'type': 'object', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok']},
        )
    except Exception:
        log.warning('LLM 暖機失敗', exc_info=True)


def build_default_pipeline(cache: Optional[Cache] = None) -> Pipeline:
    from server.corpus import load_corpus
    from server.embedder import BgeM3Embedder
    from server.llm import OllamaLLM
    from server.quip import load_examples
    from server.retrieve import HybridRetriever, curated_ids_from_topics, load_index

    with open(os.path.join(ROOT, 'data', 'topics.json'), encoding='utf-8') as handle:
        topics_file = json.load(handle)
    corpus = load_corpus()
    retriever = HybridRetriever(
        corpus, load_index(), BgeM3Embedder(), curated_ids_from_topics(topics_file)
    )
    return Pipeline(
        corpus, retriever, OllamaLLM(),
        examples=load_examples(topics_file), wrappers=topics_file['wrappers'],
        cache=cache or Cache(os.path.join(ROOT, 'data', 'cache.sqlite')),
    )


def create_app(pipeline=None, rate_limit: Tuple[int, float] = (20, 60.0)) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if _app.state.pipeline is None:
            _app.state.pipeline = build_default_pipeline()
            await run_in_threadpool(warm_up, _app.state.pipeline)
        yield

    app = FastAPI(title='主的旨意', lifespan=lifespan)
    app.state.pipeline = pipeline
    limiter = RateLimiter(*rate_limit)

    @app.get('/api/health')
    def health():
        return {'ok': True}

    @app.post('/api/oracle')
    def oracle(body: AskBody, request: Request):
        client = request.client.host if request.client else 'unknown'
        if not limiter.allow(client):
            raise HTTPException(status_code=429, detail='太多次了，請稍後再問。')
        question = CONTROL_CHARS.sub('', body.q).strip()
        if not question:
            raise HTTPException(status_code=422, detail='問題不可為空')
        try:
            return asdict(app.state.pipeline.ask(question, body.n))
        except Exception:
            log.exception('pipeline 失敗')
            raise HTTPException(status_code=503, detail='暫時無法回答')

    @app.get('/')
    def index():
        return FileResponse(os.path.join(ROOT, 'index.html'))

    for name in ('topics.json', 'fallback.json'):
        app.add_api_route(
            f'/data/{name}',
            (lambda path: (lambda: FileResponse(path)))(os.path.join(ROOT, 'data', name)),
            methods=['GET'],
        )
    app.mount('/assets', StaticFiles(directory=os.path.join(ROOT, 'assets')), name='assets')
    return app


app = create_app()
