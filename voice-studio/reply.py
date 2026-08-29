"""Tiny, dependency-free customer-service responder (English).

The focus of this app is VOICE, so the "brain" is intentionally simple and 100%
offline: a few intent rules + friendly fallbacks. Swap `generate_reply` for a
call into your real assistant/LLM whenever you want - the voice layer does not
care where the text comes from.
"""
from __future__ import annotations

import re

_REPLIES = {
    "greet": "Hi there! Thanks for reaching out. How can I help you today?",
    "bye": "Thank you for calling. Have a wonderful day!",
    "thanks": "You're very welcome! Is there anything else I can help with?",
    "hours": "Our support team is available 24 hours a day, 7 days a week.",
    "refund": "I can help with that refund. Could you share your order number, please?",
    "order": "Sure, I can check your order. What's the order number?",
    "human": "Of course - I'll connect you with a human agent right away. Please hold for a moment.",
    "price": "I'd be happy to go over pricing with you. Which plan are you interested in?",
    "help": "I'm here to help. Could you tell me a little more about what you need?",
    "fallback": "I understand. Let me help you with that - could you tell me a little more?",
}

_PATTERNS = [
    ("greet", r"\b(hi|hello|hey|good morning|good afternoon|good evening)\b"),
    ("bye", r"\b(bye|goodbye|see you|that's all|thats all)\b"),
    ("thanks", r"\b(thanks|thank you|appreciate)\b"),
    ("human", r"\b(human|agent|representative|real person|someone)\b"),
    ("refund", r"\b(refund|money back|return|cancel)\b"),
    ("order", r"\b(order|shipment|delivery|tracking|package)\b"),
    ("price", r"\b(price|cost|pricing|plan|subscription|quote)\b"),
    ("hours", r"\b(hours|open|available|working|when are you)\b"),
    ("help", r"\b(help|support|issue|problem|trouble)\b"),
]


def generate_reply(text: str, lang: str = "en") -> str:
    t = (text or "").lower()
    for intent, pat in _PATTERNS:
        if re.search(pat, t, flags=re.IGNORECASE):
            return _REPLIES[intent]
    return _REPLIES["fallback"]
