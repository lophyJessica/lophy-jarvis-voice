#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
罗宾语音版 · 百度实时语音识别代理（VPS，端口 8869）

对外契约（与前端 src/api/asrStream.ts v100 契约严格一致）：
    POST  {prefix}/start            -> {"ok": true, "session_id": "..."}
    POST  {prefix}/chunk            -> {"ok": true, "text": "<累积识别文本>", ...}
          请求头 X-Session-Id + body 为 16kHz / mono / s16le 裸 PCM
    POST  {prefix}/end              -> {"ok": true, "text": "<最终文本>", ...}
          body 为 JSON {"session_id": "..."}
    GET   {prefix}/health           -> {"ok": true, "sessions": n}

{prefix} 同时注册 ''、'/asr-stream'、'/p/jarvis/asr-stream' 三种，
因此无论 nginx 是否剥掉 /p/jarvis/asr-stream 前缀都能命中，无需改 nginx。

与百度的协议（wss://vop.baidu.com/realtime_asr?sn=<uuid4>）：
    START(JSON 文本帧) -> 音频(二进制帧) -> FINISH(JSON 文本帧)
    服务端回 MID_TEXT（句中）/ FIN_TEXT（句尾）/ HEARTBEAT（需原样回一个心跳）
    注意：URL 上的 sn 必须带，否则百度返回 HTTP 200 而不升级为 WebSocket。

关键设计：
    1. 服务端累积文本。百度长句会分成多个 FIN_TEXT 句子返回，这里把
       「已定稿句」+「当前句 MID」拼成一个**单调增长的字符串**返回给前端，
       前端只要按前缀扩展展示即可，天然避免碎片叠加与重复。
    2. 断连自动重连。接收循环异常退出时保留已定稿文本，下一个 chunk
       用新的 sn 重新建连并续传，历史文本不丢。
    3. 会话超时清理。后台任务定期回收 SESSION_TTL 内无活动的会话。
    4. 单会话内 chunk 串行（asyncio.Lock），跨会话并发互不影响。
    5. chunk 永不返回 5xx：任何异常都降级为 {"ok": true, "text": <已有文本>}，
       避免前端把流式通道判定为失败而整轮回退到 webm。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from typing import Any, Dict, List, Optional

from aiohttp import web

try:  # websockets >= 13
    from websockets.asyncio.client import connect as ws_connect
except ImportError:  # websockets < 13
    from websockets.client import connect as ws_connect  # type: ignore[no-redef]

from websockets.exceptions import ConnectionClosed, WebSocketException

# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #

HOST = os.getenv("ASR_STREAM_HOST", "127.0.0.1")
PORT = int(os.getenv("ASR_STREAM_PORT", "8869"))

BAIDU_WS_BASE = "wss://vop.baidu.com/realtime_asr"
BAIDU_APPID = int(os.getenv("BAIDU_APPID", "124071057"))
BAIDU_APPKEY = os.getenv("BAIDU_APPKEY", "D0OXex8RYVv2hOKTOUvIZjrd")
BAIDU_DEV_PID = int(os.getenv("BAIDU_DEV_PID", "15372"))
BAIDU_CUID = os.getenv("BAIDU_CUID", "jarvis-voice-vps")

# 百度建议 160ms 一帧：16000Hz * 2byte * 0.16s = 5120 字节
FRAME_BYTES = 5_120
# 建连握手超时
CONNECT_TIMEOUT = 6.0
# 单次 chunk 内最多等待多久新识别结果（拿到就立刻返回，纯粹为了少等一轮）
MID_WAIT_SECONDS = 0.04
# 发 FINISH 后等待最终 FIN_TEXT 的上限
FINISH_WAIT_SECONDS = 6.0
# 会话多久无活动就回收
SESSION_TTL_SECONDS = 60.0
# 回收任务轮询间隔
SWEEP_INTERVAL_SECONDS = 15.0
# 连续建连失败多少次后本会话不再重试（避免每个 chunk 都去撞墙）
MAX_CONNECT_FAILURES = 3

# --------------------------------------------------------------------------- #
# 日志：显式写 stdout 且关闭块缓冲，确保 journalctl 能实时抓到
# --------------------------------------------------------------------------- #

try:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - 老版本 Python 没有 reconfigure
    pass

logging.basicConfig(
    level=os.getenv("ASR_STREAM_LOG_LEVEL", "INFO").upper(),
    stream=sys.stdout,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    force=True,
)
log = logging.getLogger("asr-stream")
logging.getLogger("websockets.client").setLevel(logging.WARNING)
logging.getLogger("aiohttp.access").setLevel(logging.WARNING)


# --------------------------------------------------------------------------- #
# 文本工具
# --------------------------------------------------------------------------- #

_SENTENCE_END = "，。！？、；：,.!?;: \n\t"


def join_text(head: str, tail: str) -> str:
    """拼接两句识别文本；前句没有结尾标点时补一个逗号，避免糊成一团。"""
    head = head.strip()
    tail = tail.strip()
    if not head:
        return tail
    if not tail:
        return head
    if tail.startswith(head):  # 同一句的增量修订
        return tail
    if head.endswith(tail):
        return head
    separator = "" if head[-1] in _SENTENCE_END else "，"
    return f"{head}{separator}{tail}"


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #


class AsrSession:
    """一个前端录音会话，内部可对应多条（因重连而更换的）百度 WebSocket。"""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.created_at = time.monotonic()
        self.last_active = time.monotonic()

        # 单会话内所有写操作串行，杜绝并发建连 / 并发发送
        self.lock = asyncio.Lock()

        self.ws: Optional[Any] = None
        self.recv_task: Optional[asyncio.Task] = None
        self.baidu_sn: str = ""

        # 已定稿句（每个 FIN_TEXT 一句）与当前句的 MID
        self.finalized: List[str] = []
        self.current_mid: str = ""

        # 识别结果有更新时置位，供 chunk 做「等一小会儿再返回」
        self.text_updated = asyncio.Event()
        # 发过 FINISH 且收到最终 FIN_TEXT / 连接关闭时置位
        self.final_done = asyncio.Event()

        self.finishing = False
        self.closed = False
        self.connect_failures = 0
        self.audio_bytes = 0
        self.chunk_count = 0

    # -- 文本 ------------------------------------------------------------- #

    def cumulative_text(self) -> str:
        """已定稿句 + 当前句 MID，单调增长的完整文本。"""
        text = ""
        for sentence in self.finalized:
            text = join_text(text, sentence)
        return join_text(text, self.current_mid)

    def _flush_current_mid(self) -> None:
        """把当前句 MID 提升为定稿句（断连前保住已识别内容）。"""
        if self.current_mid.strip():
            self.finalized.append(self.current_mid.strip())
        self.current_mid = ""

    def touch(self) -> None:
        self.last_active = time.monotonic()

    # -- 连接 ------------------------------------------------------------- #

    @property
    def connected(self) -> bool:
        return self.ws is not None

    async def ensure_connected(self) -> bool:
        """确保存在可用的百度连接；已连接直接返回。调用方须持有 self.lock。"""
        if self.closed:
            return False
        if self.ws is not None:
            return True
        if self.connect_failures >= MAX_CONNECT_FAILURES:
            return False

        sn = str(uuid.uuid4())
        url = f"{BAIDU_WS_BASE}?sn={sn}"
        try:
            ws = await asyncio.wait_for(
                ws_connect(url, max_size=None, ping_interval=None),
                timeout=CONNECT_TIMEOUT,
            )
        except Exception as error:  # 建连失败不抛给前端，降级为空文本
            self.connect_failures += 1
            log.warning(
                "session=%s 百度建连失败(%s/%s): %r",
                self.session_id, self.connect_failures, MAX_CONNECT_FAILURES, error,
            )
            return False

        start_frame = {
            "type": "START",
            "data": {
                "appid": BAIDU_APPID,
                "appkey": BAIDU_APPKEY,
                "dev_pid": BAIDU_DEV_PID,
                "cuid": BAIDU_CUID,
                "format": "pcm",
                "sample": 16_000,
            },
        }
        try:
            await ws.send(json.dumps(start_frame))
        except Exception as error:
            self.connect_failures += 1
            log.warning("session=%s 发送 START 失败: %r", self.session_id, error)
            await self._close_ws(ws)
            return False

        self.ws = ws
        self.baidu_sn = sn
        self.connect_failures = 0
        self.recv_task = asyncio.create_task(
            self._receive_loop(ws), name=f"asr-recv-{self.session_id[:8]}"
        )
        log.info("session=%s 百度连接就绪 sn=%s", self.session_id, sn)
        return True

    async def _close_ws(self, ws: Any) -> None:
        try:
            await ws.close()
        except Exception:
            pass

    # -- 接收 ------------------------------------------------------------- #

    async def _receive_loop(self, ws: Any) -> None:
        """持续读取百度下行消息；异常退出时保留已识别文本，等待下一次重连。"""
        try:
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    continue
                self._handle_message(ws, raw)
        except ConnectionClosed as error:
            log.info("session=%s 百度连接关闭: %s", self.session_id, error)
        except (WebSocketException, OSError) as error:
            log.warning("session=%s 接收循环网络异常: %r", self.session_id, error)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("session=%s 接收循环未预期异常", self.session_id)
        finally:
            if self.ws is ws:
                self.ws = None
                # 断连时把当前句落定，重连后从新句继续，历史文本不丢
                self._flush_current_mid()
                self.text_updated.set()
            # 处于收尾阶段时，连接结束即视为最终结果已到齐
            if self.finishing:
                self.final_done.set()

    def _handle_message(self, ws: Any, raw: str) -> None:
        try:
            payload: Dict[str, Any] = json.loads(raw)
        except (ValueError, TypeError):
            log.debug("session=%s 非 JSON 下行: %r", self.session_id, raw[:200])
            return

        message_type = str(payload.get("type", "")).upper()
        err_no = payload.get("err_no", 0)

        if message_type == "HEARTBEAT":
            # 百度要求心跳原样回一帧，否则会被判定为静默连接而断开
            asyncio.create_task(self._send_heartbeat(ws))
            return

        if err_no not in (0, None):
            log.warning(
                "session=%s 百度返回错误 err_no=%s err_msg=%s",
                self.session_id, err_no, payload.get("err_msg"),
            )
            return

        result = payload.get("result") or payload.get("text") or ""
        if not isinstance(result, str):
            result = str(result)
        result = result.strip()

        if message_type == "MID_TEXT":
            if result and result != self.current_mid:
                self.current_mid = result
                self.text_updated.set()
            return

        if message_type == "FIN_TEXT":
            if result:
                # 同句的最终版会覆盖该句的 MID，而不是追加
                self.current_mid = result
                self._flush_current_mid()
                self.text_updated.set()
            else:
                self._flush_current_mid()
            if self.finishing:
                self.final_done.set()
            return

        log.debug("session=%s 其他下行 type=%s", self.session_id, message_type)

    async def _send_heartbeat(self, ws: Any) -> None:
        try:
            await ws.send(json.dumps({"type": "HEARTBEAT"}))
        except Exception as error:
            log.debug("session=%s 心跳回发失败: %r", self.session_id, error)

    # -- 发送 ------------------------------------------------------------- #

    async def _send_audio_frames(self, audio: bytes) -> None:
        """按 160ms 分帧发送；连接已断时抛异常交给上层重连重发。"""
        ws = self.ws
        if ws is None:
            raise ConnectionError("baidu websocket not connected")
        for offset in range(0, len(audio), FRAME_BYTES):
            await ws.send(audio[offset:offset + FRAME_BYTES])

    async def push_audio(self, audio: bytes) -> None:
        """发送一批音频；首次失败时重连一次并重发，仍失败则记日志放弃本批。"""
        if not audio:
            return
        self.audio_bytes += len(audio)

        if not await self.ensure_connected():
            return

        try:
            await self._send_audio_frames(audio)
            return
        except (ConnectionClosed, ConnectionError, WebSocketException, OSError) as error:
            log.info("session=%s 发送音频遇到断连，尝试重连: %r", self.session_id, error)

        await self._teardown_connection()
        if not await self.ensure_connected():
            return
        try:
            await self._send_audio_frames(audio)
        except Exception as error:
            log.warning("session=%s 重连后仍发送失败: %r", self.session_id, error)
            await self._teardown_connection()

    async def _teardown_connection(self) -> None:
        """断开当前百度连接（保留已识别文本），供重连使用。"""
        ws, self.ws = self.ws, None
        task, self.recv_task = self.recv_task, None
        self._flush_current_mid()
        if ws is not None:
            await self._close_ws(ws)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    # -- 收尾 ------------------------------------------------------------- #

    async def finish(self) -> str:
        """发 FINISH 并等待最终 FIN_TEXT，返回本会话完整文本。"""
        self.finishing = True
        ws = self.ws
        if ws is not None:
            try:
                await ws.send(json.dumps({"type": "FINISH"}))
            except Exception as error:
                log.info("session=%s 发送 FINISH 失败: %r", self.session_id, error)
                self.final_done.set()
            try:
                await asyncio.wait_for(self.final_done.wait(), timeout=FINISH_WAIT_SECONDS)
            except asyncio.TimeoutError:
                log.warning("session=%s 等待 FIN_TEXT 超时", self.session_id)
        text = self.cumulative_text()
        await self.close()
        return text

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        await self._teardown_connection()


# --------------------------------------------------------------------------- #
# 会话表
# --------------------------------------------------------------------------- #

SESSIONS: Dict[str, AsrSession] = {}


def _get_session(session_id: str) -> Optional[AsrSession]:
    session = SESSIONS.get(session_id)
    if session is not None:
        session.touch()
    return session


async def _sweep_sessions() -> None:
    """定期回收长时间无活动的会话，避免连接与内存泄漏。"""
    while True:
        try:
            await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
            now = time.monotonic()
            stale = [
                sid for sid, session in SESSIONS.items()
                if now - session.last_active > SESSION_TTL_SECONDS
            ]
            for sid in stale:
                session = SESSIONS.pop(sid, None)
                if session is None:
                    continue
                log.info(
                    "session=%s 超时回收（%.0fs 无活动，chunk=%d bytes=%d）",
                    sid, now - session.last_active, session.chunk_count, session.audio_bytes,
                )
                try:
                    await session.close()
                except Exception:
                    log.exception("session=%s 回收时关闭失败", sid)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("会话回收任务异常")


# --------------------------------------------------------------------------- #
# HTTP 处理
# --------------------------------------------------------------------------- #


async def handle_start(request: web.Request) -> web.Response:
    session_id = uuid.uuid4().hex
    session = AsrSession(session_id)
    SESSIONS[session_id] = session
    log.info("session=%s 创建（当前活跃 %d）", session_id, len(SESSIONS))

    # 同步等握手 + START 完成再回包：前端 prime 到首个 chunk 只隔几百毫秒，
    # 异步预建连抢不到提前量，反而让第一个 chunk 背上整个握手耗时。
    # 失败也照常返回 session_id，第一个 chunk 会自己重试。
    try:
        async with session.lock:
            await asyncio.wait_for(session.ensure_connected(), timeout=CONNECT_TIMEOUT + 1)
    except asyncio.TimeoutError:
        log.warning("session=%s 预建连超时，交给首个 chunk 重试", session_id)
    except Exception:
        log.exception("session=%s 预建连异常", session_id)

    return web.json_response({"ok": True, "session_id": session_id})


async def handle_chunk(request: web.Request) -> web.Response:
    session_id = request.headers.get("X-Session-Id", "").strip()
    session = _get_session(session_id)
    if session is None:
        log.warning("chunk 收到未知 session_id=%r", session_id)
        return web.json_response(
            {"ok": False, "text": "", "error": "unknown session"}, status=404
        )

    try:
        body = await request.read()
    except Exception as error:
        log.warning("session=%s 读取 chunk body 失败: %r", session_id, error)
        return web.json_response({"ok": True, "text": session.cumulative_text()})

    content_type = (request.headers.get("Content-Type") or "").lower()
    if body and "pcm" not in content_type and "octet-stream" not in content_type:
        # 流式通道只吃裸 PCM；webm 由前端另走 /asr 兜底
        log.warning(
            "session=%s chunk content-type=%r 非 PCM，已忽略 %d 字节",
            session_id, content_type, len(body),
        )
        return web.json_response({"ok": True, "text": session.cumulative_text()})

    try:
        async with session.lock:
            session.chunk_count += 1
            session.text_updated.clear()
            await session.push_audio(body)

            # 机会式等待：新结果到了立刻返回，没到最多多等 MID_WAIT_SECONDS
            if session.connected:
                try:
                    await asyncio.wait_for(
                        session.text_updated.wait(), timeout=MID_WAIT_SECONDS
                    )
                except asyncio.TimeoutError:
                    pass

            text = session.cumulative_text()
            mid = session.current_mid
            segments = list(session.finalized)
    except asyncio.CancelledError:
        raise
    except Exception:
        # chunk 绝不返回 5xx，否则前端会把整轮判为流式失败
        log.exception("session=%s chunk 处理异常", session_id)
        return web.json_response({"ok": True, "text": session.cumulative_text()})

    session.touch()
    return web.json_response(
        {"ok": True, "text": text, "mid": mid, "segments": segments}
    )


async def handle_end(request: web.Request) -> web.Response:
    session_id = ""
    try:
        payload = await request.json()
        if isinstance(payload, dict):
            session_id = str(payload.get("session_id") or "").strip()
    except Exception:
        session_id = ""
    if not session_id:
        session_id = request.headers.get("X-Session-Id", "").strip()

    session = SESSIONS.pop(session_id, None)
    if session is None:
        log.warning("end 收到未知 session_id=%r", session_id)
        return web.json_response({"ok": False, "text": "", "error": "unknown session"})

    try:
        async with session.lock:
            text = await session.finish()
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("session=%s end 处理异常", session_id)
        text = session.cumulative_text()
        try:
            await session.close()
        except Exception:
            pass

    log.info(
        "session=%s 结束 chunk=%d bytes=%d 句数=%d 字数=%d",
        session_id, session.chunk_count, session.audio_bytes,
        len(session.finalized), len(text),
    )
    return web.json_response(
        {"ok": True, "text": text, "segments": list(session.finalized)}
    )


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "sessions": len(SESSIONS)})


# --------------------------------------------------------------------------- #
# 应用装配
# --------------------------------------------------------------------------- #

ROUTE_PREFIXES = ("", "/asr-stream", "/p/jarvis/asr-stream")


async def _on_startup(app: web.Application) -> None:
    app["sweeper"] = asyncio.create_task(_sweep_sessions(), name="asr-session-sweeper")
    log.info("jarvis-asr-stream 启动于 %s:%s（dev_pid=%s）", HOST, PORT, BAIDU_DEV_PID)


async def _on_cleanup(app: web.Application) -> None:
    sweeper: Optional[asyncio.Task] = app.get("sweeper")
    if sweeper is not None:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
    for session in list(SESSIONS.values()):
        try:
            await session.close()
        except Exception:
            pass
    SESSIONS.clear()
    log.info("jarvis-asr-stream 已退出")


def build_app() -> web.Application:
    app = web.Application(client_max_size=32 * 1024 * 1024)
    for prefix in ROUTE_PREFIXES:
        app.router.add_post(f"{prefix}/start", handle_start)
        app.router.add_post(f"{prefix}/chunk", handle_chunk)
        app.router.add_post(f"{prefix}/end", handle_end)
        app.router.add_get(f"{prefix}/health", handle_health)
    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(build_app(), host=HOST, port=PORT, access_log=None)
