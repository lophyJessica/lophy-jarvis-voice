#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jarvis-asr-stream 自测脚本：把一段 16k/mono/s16le PCM 按 320ms 切片走完整流程。

用法：
    # 先把任意音频转成裸 PCM
    ffmpeg -i sample.m4a -ar 16000 -ac 1 -f s16le sample.pcm

    # 直连本机服务
    python3 test-asr-stream.py sample.pcm

    # 走 nginx 对外地址
    python3 test-asr-stream.py sample.pcm --base https://pmlophy.com/p/jarvis/asr-stream

预期：chunk 阶段能持续打印逐步变长的 MID 文本，end 返回完整句子。
"""

import argparse
import json
import sys
import time
import urllib.request

CHUNK_BYTES = 10_240  # 320ms @ 16kHz s16le，与前端 AudioWorklet 保持一致


def post(url: str, body: bytes, headers: dict) -> dict:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pcm", help="16k/mono/s16le 裸 PCM 文件")
    parser.add_argument("--base", default="http://127.0.0.1:8869")
    parser.add_argument("--realtime", action="store_true", help="按 320ms 真实节奏发送")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    audio = open(args.pcm, "rb").read()
    print(f"音频 {len(audio)} 字节 ≈ {len(audio) / 32_000:.1f}s")

    started = time.time()
    start_payload = post(f"{base}/start", b"", {"Content-Type": "application/json"})
    print("start ->", start_payload)
    session_id = start_payload.get("session_id")
    if not session_id:
        print("!! start 未返回 session_id")
        return 1

    first_text_at = None
    for index in range(0, len(audio), CHUNK_BYTES):
        piece = audio[index:index + CHUNK_BYTES]
        payload = post(
            f"{base}/chunk",
            piece,
            {"Content-Type": "audio/pcm", "X-Session-Id": session_id},
        )
        text = payload.get("text") or ""
        if text and first_text_at is None:
            first_text_at = time.time() - started
            print(f"** 首字延迟 {first_text_at * 1000:.0f}ms")
        print(f"chunk[{index // CHUNK_BYTES:02d}] ok={payload.get('ok')} 字数={len(text)} :: {text}")
        if args.realtime:
            time.sleep(CHUNK_BYTES / 32_000)

    end_payload = post(
        f"{base}/end",
        json.dumps({"session_id": session_id}).encode("utf-8"),
        {"Content-Type": "application/json"},
    )
    print("end ->", json.dumps(end_payload, ensure_ascii=False))
    final_text = end_payload.get("text") or ""
    print(f"\n最终 {len(final_text)} 字：{final_text}")
    print(f"总耗时 {time.time() - started:.1f}s")
    return 0 if final_text else 2


if __name__ == "__main__":
    sys.exit(main())
