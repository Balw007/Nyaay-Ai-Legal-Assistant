"""Client updates in English, Hindi and Marathi. Built from the matter's own confirmed data, never from invention.

Nothing here sends anything. The result becomes a proposed task that an advocate approves; the person
then copies it or opens WhatsApp with it prefilled.
"""
from __future__ import annotations

import re
from datetime import date
from urllib.parse import quote

MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"],
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर",
           "दिसंबर"],
    "mr": ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर",
           "नोव्हेंबर", "डिसेंबर"],
}
LANGS = {"en": "English", "hi": "Hindi", "mr": "Marathi"}


def fmt(d: date, lang: str) -> str:
    return f"{d.day} {MONTHS[lang][d.month - 1]} {d.year}"


def build(lang: str, *, client: str | None, title: str, court: str | None, order_date: date | None,
          next_date: date | None, stage: str | None, deadline: tuple | None, note: str = "",
          advocate: str = "") -> str:
    """deadline: (label_in_english, date) or None. Only facts passed in appear in the text."""
    lang = lang if lang in LANGS else "en"
    t = {
        "en": dict(hello=f"Dear {client}," if client else "Dear client,",
                   intro=f"This is an update on your matter: {title}" + (f" ({court})." if court else "."),
                   order=lambda d: f"The court passed an order on {fmt(d, 'en')}.",
                   nxt=lambda d: f"The next hearing is on {fmt(d, 'en')}.",
                   nonext="We will confirm the next hearing date as soon as we have checked the order.",
                   stage=lambda s: f"Current stage: {s}.",
                   dl=lambda lbl, d: f"Important date: {lbl} - {fmt(d, 'en')}.",
                   close="Please call us if you have any questions.", regards="Regards,"),
        "hi": dict(hello=f"प्रिय {client}," if client else "प्रिय मुवक्किल,",
                   intro=f"आपके मामले की जानकारी: {title}" + (f" ({court})।" if court else "।"),
                   order=lambda d: f"अदालत ने {fmt(d, 'hi')} को आदेश पारित किया।",
                   nxt=lambda d: f"अगली सुनवाई {fmt(d, 'hi')} को है।",
                   nonext="आदेश देखने के बाद हम अगली सुनवाई की तारीख आपको बता देंगे।",
                   stage=lambda s: f"वर्तमान चरण: {s}।",
                   dl=lambda lbl, d: f"महत्वपूर्ण तारीख: {lbl} - {fmt(d, 'hi')}।",
                   close="कोई प्रश्न हो तो कृपया हमें फोन करें।", regards="सादर,"),
        "mr": dict(hello=f"प्रिय {client}," if client else "प्रिय अशील,",
                   intro=f"तुमच्या प्रकरणाची माहिती: {title}" + (f" ({court})." if court else "."),
                   order=lambda d: f"न्यायालयाने {fmt(d, 'mr')} रोजी आदेश दिला.",
                   nxt=lambda d: f"पुढील सुनावणी {fmt(d, 'mr')} रोजी आहे.",
                   nonext="आदेश तपासल्यानंतर आम्ही पुढील सुनावणीची तारीख कळवू.",
                   stage=lambda s: f"सध्याचा टप्पा: {s}.",
                   dl=lambda lbl, d: f"महत्त्वाची तारीख: {lbl} - {fmt(d, 'mr')}.",
                   close="काही प्रश्न असल्यास कृपया आम्हाला फोन करा.", regards="आपला विश्वासू,"),
    }[lang]
    lines = [t["hello"], "", t["intro"]]
    if order_date:
        lines.append(t["order"](order_date))
    lines.append(t["nxt"](next_date) if next_date else t["nonext"])
    if stage:
        lines.append(t["stage"](stage))
    if deadline:
        lines.append(t["dl"](deadline[0], deadline[1]))
    if note.strip():
        lines += ["", note.strip()]
    lines += ["", t["close"], "", t["regards"]]
    if advocate:
        lines.append(advocate)
    return "\n".join(lines)


def whatsapp_link(message: str, phone: str | None = None) -> str:
    digits = re.sub(r"\D", "", phone or "")
    base = f"https://wa.me/{digits}" if digits else "https://wa.me/"
    return f"{base}?text={quote(message)}"
