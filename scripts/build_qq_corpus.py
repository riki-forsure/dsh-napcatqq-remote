#!/usr/bin/env python3
"""Build a local QQ dialogue corpus without loading the whole corpus into a prompt.

The encrypted NT QQ path intentionally follows the procedure recorded in the
project's qq-win-db-key tool:

1. remove the 1024-byte NT database header;
2. open the clean database with SQLCipher using the recorded parameters;
3. export it to a plaintext SQLite database;
4. parse msg_table* rows and the nested text protobuf fields.

JSONL input remains useful when a key is not available. It is preserved as a
lossless, metadata-rich fallback and is marked as partial when it contains one
speaker only.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
DEFAULT_STYLE_LIMIT = 128
DEFAULT_OWNER = ""
DEFAULT_PEER = ""
NT_HEADER_SIZE = 1024
DEFAULT_OWNER_NAME = "owner"
DEFAULT_PEER_NAME = "contact"


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def as_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number


def normalize_timestamp(value: Any) -> int | None:
    """Normalize seconds, milliseconds, and microseconds to Unix seconds."""
    number = as_int(value)
    if number is None or number <= 0:
        return None
    while number >= 10**12:
        number //= 1000
    return number


def timestamp_text(timestamp: int | None) -> str:
    if timestamp is None:
        return ""
    try:
        return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return ""


def strip_ntos_prefix(value: Any) -> str:
    raw = as_text(value)
    return raw[len("::NTOSFull::") :] if raw.startswith("::NTOSFull::") else raw


def json_safe(value: Any) -> Any:
    """Keep source metadata JSON serializable and bounded only by its source."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, bytes):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return str(value)


def attachment_from_content(content: dict[str, Any], kind: str) -> dict[str, Any]:
    fields = {
        "type": kind,
        "name": content.get("name") or content.get("filename") or content.get("file_name"),
        "file": content.get("file") or content.get("local_path") or content.get("path"),
        "url": content.get("url") or content.get("cdn_url") or content.get("download_url"),
        "fileId": content.get("file_id") or content.get("fileId") or content.get("file_uuid"),
        "size": content.get("size") or content.get("filesize") or content.get("file_size"),
        "mediaType": content.get("mime_type") or content.get("mimeType") or content.get("content_type"),
        "md5": content.get("md5_hex") or content.get("md5"),
    }
    result: dict[str, Any] = {"type": kind}
    for key, value in fields.items():
        if key == "type" or value in (None, "", []):
            continue
        if key == "file":
            result["file"] = strip_ntos_prefix(value)
            if as_text(value) != result["file"]:
                result["sourceFile"] = as_text(value)
        elif key == "size":
            number = as_int(value)
            result[key] = number if number is not None and number >= 0 else as_text(value)
        elif key == "mediaType":
            result[key] = as_text(value).lower()
        else:
            result[key] = json_safe(value)
    return result


def content_parts(content: Any) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    """Convert exporter-specific content into stable text/part/attachment fields."""
    if isinstance(content, str):
        return content.strip(), [{"type": "text", "text": content}], []
    if not isinstance(content, dict):
        return "", [], []

    kind = as_text(content.get("type")).lower()
    if kind == "mixed" and isinstance(content.get("segments"), list):
        all_parts: list[dict[str, Any]] = []
        all_attachments: list[dict[str, Any]] = []
        text_chunks: list[str] = []
        for segment in content["segments"]:
            text, parts, attachments = content_parts(segment)
            if text:
                text_chunks.append(text)
            all_parts.extend(parts)
            all_attachments.extend(attachments)
        return "".join(text_chunks).strip(), all_parts, all_attachments

    explicit_text = content.get("text")
    text = as_text(explicit_text)
    if kind == "text":
        return text, ([{"type": "text", "text": as_text(explicit_text)}] if explicit_text is not None else []), []

    if kind in {"image", "file", "record", "video", "audio"}:
        attachment_kind = "image" if kind == "image" else "file" if kind == "file" else kind
        attachment = attachment_from_content(content, attachment_kind)
        label = as_text(attachment.get("name") or attachment.get("file") or attachment_kind)
        fallback = text or as_text(content.get("text_fallback"))
        if not fallback:
            fallback = f"[{attachment_kind}: {label}]" if attachment_kind in {"image", "file"} else f"[{kind}]"
        part = {"type": attachment_kind, "text": fallback, "attachment": attachment}
        return fallback, [part], [attachment]

    if kind in {"face", "emoji"}:
        fallback = text or f"[表情:{as_text(content.get('id'))}]"
        return fallback, [{"type": "text", "text": fallback}], []

    if kind in {"call", "forward", "legacy_forward", "contact", "reply", "miniapp"}:
        fallback = text or as_text(content.get("desc")) or f"[{kind}]"
        return fallback, [{"type": "text", "text": fallback, "sourceType": kind}], []

    if text:
        return text, [{"type": "text", "text": text}], []
    return f"[{kind or 'unknown-message'}]", [{"type": "text", "text": f"[{kind or 'unknown-message'}]"}], []


def direction_and_speaker(row: dict[str, Any], owner_qq: str, peer_qq: str) -> tuple[str, str, str]:
    raw_direction = row.get("direction")
    direction_text = as_text(raw_direction).lower()
    if direction_text in {"out", "outgoing", "sent", "owner", "1"} or raw_direction == 1:
        return "out", "owner", owner_qq
    if direction_text in {"in", "incoming", "received", "contact", "0"} or raw_direction == 0:
        sender = as_text(row.get("sender_qq") or row.get("sender_id") or row.get("sender_uid"))
        if sender == owner_qq:
            return "out", "owner", owner_qq
        return "in", "contact", sender or peer_qq

    sender = as_text(row.get("sender_qq") or row.get("sender_id") or row.get("sender_uid"))
    if sender == owner_qq:
        return "out", "owner", owner_qq
    if sender == peer_qq:
        return "in", "contact", peer_qq
    return "in", "contact", sender or peer_qq


def canonical_from_json(row: dict[str, Any], source: str, line_number: int, owner_qq: str, peer_qq: str) -> dict[str, Any]:
    direction, speaker, sender = direction_and_speaker(row, owner_qq, peer_qq)
    raw_content = row.get("content")
    text = as_text(row.get("text"))
    parts: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []
    if raw_content is not None:
        content_text, content_parts_value, content_attachments = content_parts(raw_content)
        text = text or content_text
        parts = content_parts_value
        attachments = content_attachments
    if isinstance(row.get("parts"), list):
        parts = json_safe(row["parts"])
    if isinstance(row.get("attachments"), list):
        attachments = json_safe(row["attachments"])
    if not parts and text:
        parts = [{"type": "text", "text": text}]
    if not text and attachments:
        text = " ".join(f"[{item.get('type', '附件')}]" for item in attachments)

    timestamp = normalize_timestamp(row.get("timestamp") or row.get("time") or row.get("inner_ts"))
    raw_id = row.get("msg_id") or row.get("message_id") or row.get("id")
    stable_seed = json.dumps([source, line_number, raw_id, timestamp, speaker, text, attachments], ensure_ascii=False, sort_keys=True)
    record_id = as_text(raw_id) or hashlib.sha256(stable_seed.encode("utf-8")).hexdigest()[:24]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": record_id,
        "timestamp": timestamp,
        "time": timestamp_text(timestamp),
        "direction": direction,
        "speaker": speaker,
        "sender": sender,
        "peer": peer_qq,
        "text": text,
        "parts": parts,
        "attachments": attachments,
        "source": {"kind": "jsonl", "path": source, "line": line_number},
        "raw": json_safe(row),
    }


def forward_text_lines(content: Any) -> list[str]:
    """Extract message previews embedded in QQ forward/legacy-forward payloads."""
    if not isinstance(content, dict):
        return []
    kind = as_text(content.get("type")).lower()
    if kind == "legacy_forward":
        xml = as_text(content.get("xml"))
        if not xml:
            return []
        titles = re.findall(r"<title\b[^>]*>(.*?)</title>", xml, flags=re.IGNORECASE | re.DOTALL)
        return [
            re.sub(r"<[^>]+>", "", html.unescape(item)).strip()
            for item in titles
            if re.sub(r"<[^>]+>", "", html.unescape(item)).strip()
        ]

    if kind != "forward":
        return []
    output: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() == "news" and isinstance(item, list):
                    for entry in item:
                        if isinstance(entry, dict):
                            text = as_text(entry.get("text") or entry.get("title"))
                            if text:
                                output.append(text)
                        elif as_text(entry):
                            output.append(as_text(entry))
                    continue
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(content)
    return output


def forward_identity(
    label: str,
    owner_qq: str,
    peer_qq: str,
    owner_name: str,
    peer_name: str,
) -> tuple[str, str, str]:
    normalized = re.sub(r"\s+", "", as_text(label)).casefold()
    owner_labels = {re.sub(r"\s+", "", item).casefold() for item in (owner_qq, owner_name) if item}
    peer_labels = {re.sub(r"\s+", "", item).casefold() for item in (peer_qq, peer_name) if item}
    if normalized in owner_labels:
        return "out", "owner", owner_qq
    if normalized in peer_labels:
        return "in", "contact", peer_qq
    return "embedded", "external", as_text(label) or "external"


def split_forward_line(value: str) -> tuple[str, str] | None:
    match = re.match(r"^\s*(.{1,120}?)\s*[:：]\s*(.*?)\s*$", value, flags=re.DOTALL)
    if not match:
        return None
    label, text = match.group(1).strip(), match.group(2).strip()
    return (label, text) if label and text else None


def expand_forward_records(
    row: dict[str, Any],
    parent: dict[str, Any],
    owner_qq: str,
    peer_qq: str,
    owner_name: str,
    peer_name: str,
) -> list[dict[str, Any]]:
    content = row.get("content")
    lines = forward_text_lines(content)
    if as_text(content.get("type") if isinstance(content, dict) else "").lower() == "legacy_forward":
        # The first legacy <title> is the forward-card title, not a message.
        lines = [line for line in lines if split_forward_line(line)]
    expanded: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        split = split_forward_line(line)
        if not split:
            continue
        label, text = split
        direction, speaker, sender = forward_identity(label, owner_qq, peer_qq, owner_name, peer_name)
        expanded.append(
            {
                "schemaVersion": SCHEMA_VERSION,
                "id": f"{parent['id']}:forward-{index}",
                "timestamp": parent.get("timestamp"),
                "time": parent.get("time", ""),
                "direction": direction,
                "speaker": speaker,
                "sender": sender,
                "peer": peer_qq,
                "text": text,
                "parts": [{"type": "text", "text": text}],
                "attachments": [],
                "source": {
                    "kind": "jsonl-forward",
                    "path": parent.get("source", {}).get("path"),
                    "line": parent.get("source", {}).get("line"),
                    "parentId": parent["id"],
                    "forwardIndex": index,
                    "label": label,
                },
                "raw": {"text": line, "label": label, "parentId": parent["id"]},
            }
        )
    return expanded


def read_jsonl(
    path: Path,
    owner_qq: str,
    peer_qq: str,
    owner_name: str = DEFAULT_OWNER_NAME,
    peer_name: str = DEFAULT_PEER_NAME,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                eprint(f"忽略无法解析的 JSONL 行：{path}:{line_number}")
                continue
            if isinstance(row, dict):
                parent = canonical_from_json(row, str(path), line_number, owner_qq, peer_qq)
                records.append(parent)
                records.extend(expand_forward_records(row, parent, owner_qq, peer_qq, owner_name, peer_name))
    return records


def read_varint(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while position < len(data):
        byte = data[position]
        position += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, position
        shift += 7
        if shift > 70:
            break
    raise ValueError("invalid protobuf varint")


def parse_msg_blob(blob: bytes) -> tuple[str, str | None]:
    """Port the recorded msgData parser (fields 45101 and 49154)."""
    texts: list[str] = []
    marker: str | None = None

    def parse_nested(data: bytes) -> None:
        nonlocal marker
        position = 0
        while position < len(data):
            tag, position = read_varint(data, position)
            field, wire = tag >> 3, tag & 7
            if wire == 0:
                _, position = read_varint(data, position)
            elif wire == 2:
                length, position = read_varint(data, position)
                value = data[position : position + length]
                position += length
                if field == 45101:
                    try:
                        texts.append(value.decode("utf-8"))
                    except UnicodeDecodeError:
                        pass
                elif field == 49154:
                    try:
                        marker = value.decode("utf-8")
                    except UnicodeDecodeError:
                        pass
                else:
                    try:
                        parse_nested(value)
                    except (ValueError, IndexError):
                        pass
            elif wire == 1:
                position += 8
            elif wire == 5:
                position += 4
            else:
                raise ValueError("unsupported protobuf wire type")

    try:
        position = 0
        while position < len(blob):
            tag, position = read_varint(blob, position)
            wire = tag & 7
            if wire == 0:
                _, position = read_varint(blob, position)
            elif wire == 2:
                length, position = read_varint(blob, position)
                nested = blob[position : position + length]
                position += length
                parse_nested(nested)
            elif wire == 1:
                position += 8
            elif wire == 5:
                position += 4
            else:
                break
    except (ValueError, IndexError):
        pass
    return "\n".join(item for item in texts if item), marker


def canonical_from_db(timestamp: Any, blob: bytes, table: str, row_number: int, owner_qq: str, peer_qq: str) -> dict[str, Any] | None:
    text, marker = parse_msg_blob(blob)
    if not text.strip():
        return None
    timestamp_value = normalize_timestamp(timestamp)
    is_owner = marker == "nt_2"
    speaker = "owner" if is_owner else "contact"
    direction = "out" if is_owner else "in"
    seed = f"{table}\0{row_number}\0{timestamp_value}\0{marker}\0{text}".encode("utf-8", "replace")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": f"db-{hashlib.sha256(seed).hexdigest()[:24]}",
        "timestamp": timestamp_value,
        "time": timestamp_text(timestamp_value),
        "direction": direction,
        "speaker": speaker,
        "sender": owner_qq if is_owner else peer_qq,
        "peer": peer_qq,
        "text": text,
        "parts": [{"type": "text", "text": text}],
        "attachments": [],
        "source": {"kind": "sqlcipher", "table": table, "row": row_number, "marker": marker},
    }


def read_plain_sqlite(path: Path, owner_qq: str, peer_qq: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%msg_table%' ORDER BY name"
            )
        ]
        if not tables:
            raise RuntimeError("明文库中没有找到 *msg_table* 表")
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            try:
                rows = connection.execute(f"SELECT msgTime, msgData FROM {quoted} ORDER BY msgTime")
                for row_number, (timestamp, blob) in enumerate(rows, 1):
                    if not isinstance(blob, (bytes, bytearray, memoryview)):
                        continue
                    record = canonical_from_db(timestamp, bytes(blob), table, row_number, owner_qq, peer_qq)
                    if record:
                        records.append(record)
            except sqlite3.DatabaseError as error:
                eprint(f"跳过无法读取的表 {table}: {error}")
    finally:
        connection.close()
    return records


def copy_without_nt_header(source: Path, destination: Path) -> None:
    if source.resolve() == destination.resolve():
        raise ValueError("clean 数据库不能覆盖原始 nt_msg.db")
    with source.open("rb") as input_file, destination.open("wb") as output_file:
        input_file.seek(NT_HEADER_SIZE)
        shutil.copyfileobj(input_file, output_file, length=1024 * 1024)


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def decrypt_ntqq_database(source: Path, key: str, plaintext: Path, force: bool = False) -> Path:
    if not key.strip():
        raise RuntimeError("缺少密钥：请传 --key 或设置 QQ_DB_KEY；不会从日志猜测密钥")
    executable = shutil.which("sqlcipher")
    if not executable:
        raise RuntimeError("未找到 sqlcipher。请安装 SQLCipher 后再运行解密步骤")
    if plaintext.exists() and not force:
        raise RuntimeError(f"输出已存在：{plaintext}（需要覆盖时显式加 --force）")
    plaintext.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="qq-nt-clean-") as temporary:
        clean = Path(temporary) / "nt_msg.clean.db"
        copy_without_nt_header(source, clean)
        sql = (
            f"PRAGMA key = '{sql_quote(key.strip())}';\n"
            "PRAGMA cipher_page_size = 4096;\n"
            "PRAGMA kdf_iter = 4000;\n"
            "PRAGMA cipher_hmac_algorithm = HMAC_SHA1;\n"
            "PRAGMA cipher_default_kdf_algorithm = PBKDF2_HMAC_SHA512;\n"
            f"ATTACH DATABASE '{sql_quote(str(plaintext))}' AS pt KEY '';\n"
            "SELECT sqlcipher_export('pt');\n"
            "DETACH DATABASE pt;\n"
        )
        result = subprocess.run(
            [executable, str(clean)], input=sql, text=True, capture_output=True, check=False
        )
        if result.returncode != 0 or not plaintext.exists() or plaintext.stat().st_size < 4096:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeError(f"SQLCipher 解密/导出失败（密钥错误或版本不兼容）{(': ' + detail) if detail else ''}")
    try:
        connection = sqlite3.connect(f"file:{plaintext}?mode=ro", uri=True)
        connection.execute("SELECT name FROM sqlite_master LIMIT 1").fetchall()
        connection.close()
    except sqlite3.DatabaseError as error:
        raise RuntimeError(f"导出的明文库无法打开：{error}") from error
    return plaintext


def deduplicate(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in records:
        key = hashlib.sha256(
            json.dumps(
                [record.get("timestamp"), record.get("speaker"), record.get("text"), record.get("parts"), record.get("attachments")],
                ensure_ascii=False,
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        output.append(record)
    output.sort(
        key=lambda item: (
            item.get("timestamp") or 0,
            item.get("source", {}).get("line", 0),
            item.get("source", {}).get("forwardIndex", -1),
        )
    )
    return output


def style_examples(records: list[dict[str, Any]], limit: int) -> list[str]:
    candidates = []
    for record in records:
        if record.get("speaker") != "contact":
            continue
        text = as_text(record.get("text"))
        if not text or text.startswith("[") or len(text) > 80:
            continue
        candidates.append(text)
    unique = list(dict.fromkeys(candidates))
    if len(unique) <= limit:
        return unique

    counts = Counter(candidates)
    selected: list[str] = []
    selected_set: set[str] = set()
    # Preserve recurring exact utterances because they are useful style anchors.
    for text, _count in counts.most_common(limit // 3):
        selected.append(text)
        selected_set.add(text)

    # Add chronological examples from length buckets so the prompt contains
    # both terse reactions and complete sentence rhythm.
    buckets: dict[str, list[str]] = {"short": [], "medium": [], "long": []}
    for text in unique:
        if text in selected_set:
            continue
        bucket = "short" if len(text) <= 8 else "medium" if len(text) <= 24 else "long"
        buckets[bucket].append(text)
    cursor = 0
    bucket_names = ["short", "medium", "long"]
    while len(selected) < limit and any(buckets.values()):
        bucket = buckets[bucket_names[cursor % len(bucket_names)]]
        cursor += 1
        if not bucket:
            continue
        value = bucket.pop(0)
        if value not in selected_set:
            selected.append(value)
            selected_set.add(value)
    return selected[:limit]


def attachment_stats(records: list[dict[str, Any]]) -> Counter[str]:
    return Counter(item.get("type", "unknown") for record in records for item in record.get("attachments", []))


def render_markdown(records: list[dict[str, Any]], manifest: dict[str, Any]) -> str:
    lines = [
        "# QQ 完整对话语料",
        "",
        f"- 覆盖标记：`{manifest['coverage']}`",
        f"- 消息数：`{manifest['total']}`",
        f"- 时间范围：`{manifest.get('firstTime') or '未知'}` 至 `{manifest.get('lastTime') or '未知'}`",
        "",
    ]
    for record in records:
        stamp = record.get("time") or "未知时间"
        speaker = record.get("speaker", "unknown")
        text = record.get("text") or ""
        lines.append(f"### {stamp} · {speaker}")
        lines.append("")
        lines.append(text.replace("\r\n", "\n"))
        for attachment in record.get("attachments", []):
            details = [f"type={attachment.get('type', 'unknown')}"]
            for key in ("name", "size", "file", "url", "fileId"):
                if attachment.get(key):
                    details.append(f"{key}={attachment[key]}")
            lines.append(f"\n[附件 {'; '.join(details)}]")
        lines.append("")
    return "\n".join(lines)


def build_manifest(records: list[dict[str, Any]], sources: list[str], decrypted: bool) -> dict[str, Any]:
    speakers = Counter(record.get("speaker", "unknown") for record in records)
    directions = Counter(record.get("direction", "unknown") for record in records)
    types = attachment_stats(records)
    direct_records = [
        record for record in records if record.get("speaker") in {"owner", "contact"}
    ]
    direct_speaker_counts = Counter(record.get("speaker", "unknown") for record in direct_records)
    timestamps = [record.get("timestamp") for record in records if record.get("timestamp")]
    coverage_speakers = {
        record.get("speaker")
        for record in records
        if record.get("source", {}).get("kind") != "jsonl-forward"
    }
    if {"owner", "contact"}.issubset(coverage_speakers):
        coverage = "full"
    elif {"owner", "contact"}.issubset(speakers):
        coverage = "embedded_partial"
    elif "contact" in speakers:
        coverage = "contact_only"
    else:
        coverage = "unknown"
    return {
        "schemaVersion": SCHEMA_VERSION,
        "coverage": coverage,
        "total": len(records),
        "speakers": dict(speakers),
        "directions": dict(directions),
        "directMessages": len(direct_records),
        "directSpeakers": dict(direct_speaker_counts),
        "embeddedForwardMessages": sum(
            1 for record in records if record.get("source", {}).get("kind") == "jsonl-forward"
        ),
        "attachments": dict(types),
        "firstTime": timestamp_text(min(timestamps)) if timestamps else "",
        "lastTime": timestamp_text(max(timestamps)) if timestamps else "",
        "sources": sources,
        "decryptedNtDb": decrypted,
        "privacy": "本地文件；原始附件路径和来源元数据按输入保留",
    }


def write_outputs(output_dir: Path, records: list[dict[str, Any]], sources: list[str], decrypted: bool, style_limit: int) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest(records, sources, decrypted)
    manifest["styleExampleCount"] = len(style_examples(records, style_limit))
    with (output_dir / "dialogue.jsonl").open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    direct_records = [
        record for record in records if record.get("speaker") in {"owner", "contact"}
    ]
    with (output_dir / "dialogue-direct.jsonl").open("w", encoding="utf-8") as handle:
        for record in direct_records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output_dir / "dialogue.md").write_text(render_markdown(records, manifest), encoding="utf-8")
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    examples = style_examples(records, style_limit)
    style_lines = [
        "# QQ 语气代表句（从原始消息中抽取）",
        "",
        "只作为措辞和节奏参考，不把这些句子当作事实；需要完整上下文时读取同目录 dialogue.jsonl。",
        "",
    ]
    style_lines.extend(f"> {item}" for item in examples)
    (output_dir / "style-examples.md").write_text("\n".join(style_lines) + "\n", encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建 QQ 完整对话语料和有限语气代表句")
    parser.add_argument("--input-jsonl", action="append", default=[], help="已有 QQ JSONL 记录，可重复指定")
    parser.add_argument("--db", type=Path, help="NT QQ 原始 nt_msg.db（带 1024 字节 QQ_NT DB 头）")
    parser.add_argument("--plain-db", type=Path, help="已经解密的明文 SQLite 数据库")
    parser.add_argument("--key", default=os.environ.get("QQ_DB_KEY", ""), help="NT QQ 密钥；也可用 QQ_DB_KEY 环境变量")
    parser.add_argument("--output-dir", type=Path, required=True, help="输出目录")
    parser.add_argument("--owner-qq", required=True, help="聊天记录所属 QQ 号")
    parser.add_argument("--peer-qq", required=True, help="目标联系人 QQ 号")
    parser.add_argument("--owner-name", default=DEFAULT_OWNER_NAME, help="转发预览中的用户昵称")
    parser.add_argument("--peer-name", default=DEFAULT_PEER_NAME, help="转发预览中的联系人昵称")
    parser.add_argument("--style-limit", type=int, default=DEFAULT_STYLE_LIMIT)
    parser.add_argument("--force", action="store_true", help="允许覆盖 --plain-db")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input_jsonl and not args.db and not args.plain_db:
        eprint("至少指定 --input-jsonl、--db 或 --plain-db")
        return 2
    if args.style_limit < 1:
        eprint("--style-limit 必须大于 0")
        return 2

    records: list[dict[str, Any]] = []
    sources: list[str] = []
    decrypted = False
    try:
        for input_name in args.input_jsonl:
            path = Path(input_name).expanduser().resolve()
            records.extend(
                read_jsonl(
                    path,
                    str(args.owner_qq),
                    str(args.peer_qq),
                    str(args.owner_name),
                    str(args.peer_name),
                )
            )
            sources.append(str(path))

        if args.db:
            source = args.db.expanduser().resolve()
            plain = args.plain_db or args.output_dir / "nt_msg.plain.db"
            plain = plain.expanduser().resolve()
            decrypt_ntqq_database(source, args.key, plain, force=args.force)
            records.extend(read_plain_sqlite(plain, str(args.owner_qq), str(args.peer_qq)))
            sources.append(str(source))
            decrypted = True
        elif args.plain_db:
            plain = args.plain_db.expanduser().resolve()
            records.extend(read_plain_sqlite(plain, str(args.owner_qq), str(args.peer_qq)))
            sources.append(str(plain))
            decrypted = True

        records = deduplicate(records)
        manifest = write_outputs(args.output_dir.expanduser().resolve(), records, sources, decrypted, args.style_limit)
    except (OSError, RuntimeError, ValueError, sqlite3.DatabaseError) as error:
        eprint(str(error))
        return 1

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
