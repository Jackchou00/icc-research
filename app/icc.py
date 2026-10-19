from __future__ import annotations

from dataclasses import dataclass

HEADER_SIZE = 128
TABLE_OFFSET = 128
ENTRY_SIZE = 12
MAX_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class HeaderField:
    key: str
    label: str
    offset: int
    size: int
    kind: str = "hex"


HEADER_FIELDS = (
    HeaderField("cmm", "CMM", 4, 4, "text"),
    HeaderField("version", "Version", 8, 4),
    HeaderField("profile_class", "Class", 12, 4, "text"),
    HeaderField("color_space", "Color space", 16, 4, "text"),
    HeaderField("pcs", "PCS", 20, 4, "text"),
    HeaderField("created", "Created", 24, 12),
    HeaderField("signature", "Signature", 36, 4, "text"),
    HeaderField("platform", "Platform", 40, 4, "text"),
    HeaderField("flags", "Flags", 44, 4),
    HeaderField("manufacturer", "Manufacturer", 48, 4, "text"),
    HeaderField("model", "Model", 52, 4, "text"),
    HeaderField("attributes", "Attributes", 56, 8),
    HeaderField("rendering_intent", "Rendering intent", 64, 4),
    HeaderField("illuminant", "Illuminant", 68, 12),
    HeaderField("creator", "Creator", 80, 4, "text"),
    HeaderField("profile_id", "Profile ID", 84, 16),
    HeaderField("reserved", "Reserved", 100, 28),
)


class IccError(ValueError):
    pass


def _read_profile(data: bytes) -> tuple[int, list[dict[str, int | str]]]:
    if len(data) < HEADER_SIZE + 4:
        raise IccError("File is too short.")
    if len(data) > MAX_BYTES:
        raise IccError("File exceeds 64 MB.")

    declared_size = int.from_bytes(data[:4], "big")
    if declared_size < HEADER_SIZE + 4 or declared_size > len(data):
        raise IccError("Profile size is outside the file.")

    count = int.from_bytes(data[TABLE_OFFSET : TABLE_OFFSET + 4], "big")
    table_end = TABLE_OFFSET + 4 + count * ENTRY_SIZE
    if table_end > declared_size:
        raise IccError("Tag table extends beyond the profile.")

    tags = []
    for index in range(count):
        start = TABLE_OFFSET + 4 + index * ENTRY_SIZE
        entry = data[start : start + ENTRY_SIZE]
        offset = int.from_bytes(entry[4:8], "big")
        size = int.from_bytes(entry[8:12], "big")
        if offset > len(data) or size > len(data) - offset:
            raise IccError("Tag range is outside the file.")
        tags.append(
            {
                "index": index,
                "signature": entry[:4].decode("latin-1"),
                "offset": offset,
                "size": size,
            }
        )
    return declared_size, tags


def inspect_profile(data: bytes) -> dict:
    declared_size, tags = _read_profile(data)
    header = {
        field.key: (
            data[field.offset : field.offset + field.size].decode("latin-1")
            if field.kind == "text"
            else data[field.offset : field.offset + field.size].hex().upper()
        )
        for field in HEADER_FIELDS
    }
    return {
        "file_size": len(data),
        "profile_size": declared_size,
        "tag_table_offset": TABLE_OFFSET,
        "header": header,
        "fields": [
            {
                "key": field.key,
                "label": field.label,
                "size": field.size,
                "kind": field.kind,
            }
            for field in HEADER_FIELDS
        ],
        "tags": tags,
    }


def export_profile(data: bytes, order: list[int], header: dict[str, str]) -> bytes:
    _, tags = _read_profile(data)
    count = len(tags)
    if len(order) != len(set(order)) or any(index < 0 or index >= count for index in order):
        raise IccError("Tag table order is invalid.")

    output = bytearray(data)
    for field in HEADER_FIELDS:
        if field.key not in header:
            continue
        value = header[field.key]
        try:
            raw = value.encode("latin-1") if field.kind == "text" else bytes.fromhex(value)
        except (UnicodeEncodeError, ValueError) as exc:
            raise IccError(f"Invalid value for {field.label}.") from exc
        if field.kind == "text":
            if len(raw) > field.size:
                raise IccError(f"{field.label} must be at most {field.size} bytes.")
            raw = raw.ljust(field.size, b" ")
        elif len(raw) != field.size:
            raise IccError(f"{field.label} must contain {field.size} bytes.")
        output[field.offset : field.offset + field.size] = raw

    entry_start = TABLE_OFFSET + 4
    entries = [
        data[entry_start + index * ENTRY_SIZE : entry_start + (index + 1) * ENTRY_SIZE]
        for index in order
    ]
    output[TABLE_OFFSET : TABLE_OFFSET + 4] = len(entries).to_bytes(4, "big")
    for position, entry in enumerate(entries):
        start = entry_start + position * ENTRY_SIZE
        output[start : start + ENTRY_SIZE] = entry
    output[:4] = len(output).to_bytes(4, "big")
    return bytes(output)
