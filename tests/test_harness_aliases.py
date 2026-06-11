"""Tests for omnigent.harness_aliases."""

from __future__ import annotations

import pytest

from omnigent.harness_aliases import is_native_harness


@pytest.mark.parametrize(
    "harness,expected",
    [
        # Canonical native spellings and their reversed forms.
        ("claude-native", True),
        ("codex-native", True),
        ("native-claude", True),
        ("native-codex", True),
        # SDK harnesses are NOT native — they replay the Omnigent
        # transcript and don't own an on-disk runtime transcript. A
        # regression that classified these as native would wrongly route a
        # fork into the native-rebuild path.
        ("claude-sdk", False),
        ("claude_sdk", False),
        ("openai-agents", False),
        ("agents_sdk", False),
        ("codex", False),
        # The "claude" shorthand canonicalizes to claude-sdk (not native).
        ("claude", False),
        ("some-unknown-harness", False),
        (None, False),
    ],
)
def test_is_native_harness(harness: str | None, expected: bool) -> None:
    """``is_native_harness`` flags only the native CLI harnesses.

    The fork agent-switch gates the native transcript-rebuild path on this:
    only native targets need a rebuild (SDK targets carry history as
    context on their own). Misclassifying either way breaks history
    carry-over on a switch.
    """
    assert is_native_harness(harness) is expected
