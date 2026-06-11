"""Tests for conversation entity helpers."""

from __future__ import annotations

import pytest

from omnigent.entities.conversation import (
    ConversationItem,
    MessageData,
    synthesize_conversation_title,
)


def _message_item(created_by: str | None) -> ConversationItem:
    """Build a persisted user-message item with the given author."""
    return ConversationItem(
        id="msg_1",
        type="message",
        status="completed",
        response_id="resp_1",
        created_at=0,
        data=MessageData(
            role="user",
            content=[{"type": "input_text", "text": "hi"}],
        ),
        created_by=created_by,
    )


def test_to_api_dict_exposes_created_by_when_set() -> None:
    """A human-authored item surfaces ``created_by`` in the API shape."""
    api = _message_item("alice@example.com").to_api_dict()
    assert api["created_by"] == "alice@example.com"


def test_to_api_dict_omits_created_by_when_none() -> None:
    """Agent/system items omit ``created_by`` so they stay distinguishable."""
    api = _message_item(None).to_api_dict()
    assert "created_by" not in api


def test_to_api_dict_exposes_interrupted_assistant_marker() -> None:
    """Interrupted assistant items surface the reload marker in API shape."""
    item = ConversationItem(
        id="msg_interrupted",
        type="message",
        status="completed",
        response_id="codex_turn_123",
        created_at=0,
        data=MessageData(
            role="assistant",
            agent="codex-native-ui",
            interrupted=True,
            content=[{"type": "output_text", "text": "partial answer"}],
        ),
    )

    api = item.to_api_dict()

    assert api["interrupted"] is True
    assert api["model"] == "codex-native-ui"


@pytest.mark.parametrize(
    "content,expected",
    [
        ([{"type": "input_text", "text": "Hello"}], "Hello"),
        ([{"type": "input_text", "text": "  hi   there  "}], "hi there"),
        ([{"type": "input_text", "text": "line one\nline two"}], "line one line two"),
        (
            [
                {"type": "input_text", "text": "first"},
                {"type": "input_text", "text": "second"},
            ],
            "first second",
        ),
        (
            [
                {"type": "input_file", "file_id": "file_123"},
                {"type": "input_text", "text": "real prompt"},
            ],
            "real prompt",
        ),
        ([], None),
        ([{"type": "input_file", "file_id": "file_123"}], None),
        ([{"type": "input_text", "text": "   \n  "}], None),
        ([{"type": "input_text", "text": "a" * 100}], "a" * 59 + "…"),
    ],
)
def test_synthesize_conversation_title(
    content: list[dict[str, object]],
    expected: str | None,
) -> None:
    """Title synthesis collapses, joins, and truncates input text."""
    assert synthesize_conversation_title(content) == expected


def test_synthesize_conversation_title_respects_custom_limit() -> None:
    """Custom ``limit`` is honored."""
    content = [{"type": "input_text", "text": "a" * 50}]
    assert synthesize_conversation_title(content, limit=10) == "a" * 9 + "…"
