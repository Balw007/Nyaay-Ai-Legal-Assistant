"""Drafting from templates. Facts come only from the matter; anything missing stays a visible [[placeholder]].

Templates are DRAFTS for an advocate to review. They never invent names, amounts, dates or authorities.
The optional AI polish may only change wording: placeholders must survive and no new citation may appear.
"""
from __future__ import annotations

import io
import re
from datetime import date
from typing import Optional

from .citations import extract_norms
from .llm import LLM

FIELDS = {
    "complainant_name": "Complainant (payee) name",
    "complainant_address": "Complainant address",
    "accused_name": "Accused (drawer) name",
    "accused_address": "Accused address",
    "cheque_no": "Cheque number",
    "cheque_amount": "Cheque amount (Rs.)",
    "drawee_bank": "Drawee bank and branch",
    "liability": "Debt / liability the cheque was given for",
    "return_reason": "Reason on the bank return memo",
    "advocate_name": "Advocate name",
    "advocate_address": "Advocate address / chamber",
    "court_place": "Court and place of filing",
}

TEMPLATES = {
    "ni138_notice": {
        "name": "Demand notice u/s 138(b) NI Act",
        "group": "NI Act s.138",
        "fields": ["complainant_name", "complainant_address", "accused_name", "accused_address", "cheque_no",
                   "cheque_amount", "drawee_bank", "liability", "return_reason", "advocate_name",
                   "advocate_address"],
        "dates": ["cheque_date", "bank_information_received_date"],
    },
    "ni138_complaint": {
        "name": "Complaint u/s 138 r/w s.142 NI Act",
        "group": "NI Act s.138",
        "fields": ["complainant_name", "complainant_address", "accused_name", "accused_address", "cheque_no",
                   "cheque_amount", "drawee_bank", "liability", "return_reason", "court_place", "advocate_name"],
        "dates": ["cheque_date", "bank_information_received_date", "notice_received_date"],
    },
    "sec143a": {
        "name": "Application for interim compensation u/s 143A",
        "group": "NI Act s.138",
        "fields": ["complainant_name", "accused_name", "cheque_no", "cheque_amount", "court_place", "advocate_name"],
        "dates": ["cheque_date"],
    },
    "adjournment": {
        "name": "Application for adjournment",
        "group": "General",
        "fields": ["complainant_name", "accused_name", "court_place", "advocate_name"],
        "dates": [],
    },
    "list_of_dates": {
        "name": "List of dates and events",
        "group": "General",
        "fields": ["complainant_name", "accused_name", "cheque_no", "cheque_amount"],
        "dates": ["cheque_date", "bank_information_received_date", "notice_received_date"],
    },
    "client_update": {
        "name": "Status letter to client",
        "group": "Client",
        "fields": ["advocate_name"],
        "dates": [],
    },
}

PH = re.compile(r"\[\[[^\]]+\]\]")


def _fmt(d: Optional[str]) -> Optional[str]:
    if not d:
        return None
    try:
        return date.fromisoformat(d).strftime("%d %B %Y").lstrip("0")
    except ValueError:
        return None


def _money(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    digits = re.sub(r"[^\d.]", "", str(v))
    if not digits:
        return str(v)
    whole, _, frac = digits.partition(".")
    # Indian grouping: 12,34,56,789
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        head = re.sub(r"(\d)(?=(\d{2})+$)", r"\1,", head)
        whole = f"{head},{tail}"
    return "Rs. " + whole + (f".{frac}" if frac else "") + "/-"


class _V(dict):
    """Template values: missing keys render as a visible placeholder, never as a guess."""

    def __missing__(self, key):
        label = FIELDS.get(key) or key.replace("_", " ").capitalize()
        return f"[[{label}]]"


def values(matter: dict, extra: Optional[dict] = None) -> _V:
    det = dict(matter.get("details") or {})
    det.update({k: v for k, v in (extra or {}).items() if v})
    facts = matter.get("facts") or {}
    v = _V({k: str(x).strip() for k, x in det.items() if x and str(x).strip()})
    if "cheque_amount" in v:
        v["cheque_amount"] = _money(v["cheque_amount"])
    labels = {"cheque_date": "Date of cheque", "bank_information_received_date": "Date of bank intimation",
              "notice_received_date": "Date notice was received"}
    for k, lbl in labels.items():
        f = _fmt(facts.get(k))
        v[k] = f if f else f"[[{lbl}]]"
    v["matter_title"] = matter.get("title") or "[[Matter title]]"
    v["case_number"] = matter.get("case_number") or "[[Case number]]"
    v["court"] = matter.get("court") or v.get("court_place") or "[[Court]]"
    v["client_name"] = matter.get("client_name") or v.get("complainant_name") or "[[Client name]]"
    v["next_date"] = _fmt(matter.get("next_date")) or "[[Next date]]"
    v["today"] = date.today().strftime("%d %B %Y").lstrip("0")
    # Criminal procedure changed on 1 July 2024 (BNSS replaced the CrPC). Pick by the filing date (today).
    bnss = date.today() >= date(2024, 7, 1)
    v["compensation_provision"] = ("Section 395 of the Bharatiya Nagarik Suraksha Sanhita, 2023" if bnss
                                   else "Section 357 of the Code of Criminal Procedure, 1973")
    v["examination_provision"] = ("Section 223 of the Bharatiya Nagarik Suraksha Sanhita, 2023" if bnss
                                  else "Section 200 of the Code of Criminal Procedure, 1973")
    return v


def render(template: str, matter: dict, extra: Optional[dict] = None, plan: Optional[dict] = None,
           orders: Optional[list] = None) -> str:
    if template not in TEMPLATES:
        raise KeyError(template)
    v = values(matter, extra)
    if template == "ni138_notice":
        return NOTICE.format_map(v)
    if template == "ni138_complaint":
        return COMPLAINT.format_map(v)
    if template == "sec143a":
        return S143A.format_map(v)
    if template == "adjournment":
        return ADJOURN.format_map(v)
    if template == "list_of_dates":
        rows = [(matter.get("facts", {}).get("cheque_date"), f"Cheque No. {v['cheque_no']} for {v['cheque_amount']} "
                 f"issued by the accused {v['accused_name']} in favour of the complainant."),
                (matter.get("facts", {}).get("bank_information_received_date"),
                 f"Cheque returned unpaid with the remark '{v['return_reason']}'; intimation received by the complainant."),
                (matter.get("facts", {}).get("notice_received_date"), "Statutory demand notice received by the accused.")]
        for o in sorted(orders or [], key=lambda o: o.get("order_date") or ""):
            if o.get("order_date"):
                rows.append((o["order_date"], f"Order: {o.get('summary', '')[:220]}"))
        lines = []
        for d, ev in rows:
            lines.append(f"{(_fmt(d) or '[[Date]]'):<22} {ev}")
        return LOD_HEAD.format_map(v) + "\n".join(lines) + "\n"
    if template == "client_update":
        stage = (plan or {}).get("current_stage_name") or "[[Current stage]]"
        acts = (plan or {}).get("current_actions") or []
        steps = "\n".join(f"  {i}. {a}" for i, a in enumerate(acts, 1)) or "  [[Next steps]]"
        return CLIENT.format_map(_V({**v, "stage": stage, "steps": steps}))
    raise KeyError(template)


def missing(body: str) -> list:
    return sorted(set(PH.findall(body)))


POLISH_SYSTEM = (
    "You improve the language of an Indian legal draft. Keep every fact, name, number, date and every [[placeholder]] "
    "exactly as written. Do not add facts, case law, citations or sections. Keep the structure and numbering. "
    "Reply with one JSON object: {\"body\": string, \"changes\": [string]}."
)


def polish(body: str, llm: LLM) -> dict:
    data = llm.json(POLISH_SYSTEM, body, max_tokens=3500)
    new = str(data.get("body") or "")
    if not new.strip():
        raise ValueError("empty draft returned")
    lost = set(PH.findall(body)) - set(PH.findall(new))
    added_cites = extract_norms(new) - extract_norms(body)
    nums_before = set(re.findall(r"\d[\d,./-]*\d|\d", body))
    nums_after = set(re.findall(r"\d[\d,./-]*\d|\d", new))
    problems = []
    if lost:
        problems.append(f"placeholders removed: {sorted(lost)}")
    if added_cites:
        problems.append(f"new citations added: {sorted(added_cites)}")
    if nums_after - nums_before:
        problems.append(f"new numbers introduced: {sorted(nums_after - nums_before)[:6]}")
    return {"body": new, "changes": [str(c) for c in data.get("changes", [])][:10], "problems": problems,
            "accepted": not problems}


def to_docx(title: str, body: str) -> bytes:
    from docx import Document
    from docx.shared import Pt

    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "Times New Roman"
    st.font.size = Pt(12)
    doc.add_heading(title, level=1)
    for para in body.split("\n"):
        doc.add_paragraph(para)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


NOTICE = """LEGAL NOTICE
(Under Section 138(b) of the Negotiable Instruments Act, 1881)

Date: {today}

BY REGISTERED POST A.D. / SPEED POST / EMAIL

To,
{accused_name}
{accused_address}

Sub: Notice for dishonour of Cheque No. {cheque_no} dated {cheque_date} for {cheque_amount} drawn on {drawee_bank}

Sir / Madam,

Under instructions from and on behalf of my client, {complainant_name}, residing at / having office at {complainant_address} (hereinafter "my client"), I hereby serve upon you the following legal notice:

1. That you were liable to pay my client towards {liability}, which is a legally enforceable debt / liability.

2. That in discharge of the said liability, you issued Cheque No. {cheque_no} dated {cheque_date} for {cheque_amount}, drawn on {drawee_bank}, in favour of my client.

3. That my client presented the said cheque for encashment within its validity. The cheque was returned unpaid with the remark "{return_reason}", and my client received intimation of the same from the bank on {bank_information_received_date}.

4. That the dishonour of the said cheque for the reason stated amounts to an offence punishable under Section 138 of the Negotiable Instruments Act, 1881.

5. I therefore call upon you to pay the said sum of {cheque_amount} to my client within FIFTEEN DAYS of receipt of this notice.

6. Take notice that if you fail to make the payment within the said period, my client shall be constrained to initiate criminal proceedings against you under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881, and such other proceedings as may be advised, entirely at your risk as to costs and consequences.

A copy of this notice is retained in my office for record and further action.

{advocate_name}
Advocate for the Complainant
{advocate_address}

[DRAFT prepared by Nyaay. Check every fact against the cheque, return memo and records. Send within 30 days of the bank intimation.]
"""

COMPLAINT = """IN THE COURT OF {court_place}

CRIMINAL COMPLAINT No. ______ OF {year_ph}

IN THE MATTER OF:
{complainant_name}
{complainant_address}                                               ... COMPLAINANT

VERSUS

{accused_name}
{accused_address}                                                   ... ACCUSED

COMPLAINT UNDER SECTION 138 READ WITH SECTION 142 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

MOST RESPECTFULLY SHOWETH:

1. That the complainant is {complainant_name}, and is competent to file the present complaint.

2. That the accused was liable to the complainant towards {liability}, a legally enforceable debt / liability.

3. That in discharge of the said liability, the accused issued Cheque No. {cheque_no} dated {cheque_date} for {cheque_amount}, drawn on {drawee_bank}, in favour of the complainant.

4. That the said cheque, on presentation within its validity, was returned unpaid with the remark "{return_reason}". The complainant received intimation of dishonour from the bank on {bank_information_received_date}.

5. That the complainant issued a statutory demand notice under Section 138(b) within thirty days of receipt of the said intimation. The notice was received by the accused on {notice_received_date}.

6. That the accused failed to make payment of the cheque amount within fifteen days of receipt of the notice, and has thereby committed an offence punishable under Section 138 of the Negotiable Instruments Act, 1881.

7. That the cause of action arose on the expiry of fifteen days from {notice_received_date}, and the present complaint is filed within one month thereof, i.e. within the period prescribed by Section 142(1)(b).

8. That this Hon'ble Court has jurisdiction under Section 142(2) of the Act because [[Basis of jurisdiction: branch where the cheque was presented / payee's account is maintained]].

9. That the complainant has not filed any other complaint on the same cause of action.

PRAYER

It is therefore most respectfully prayed that this Hon'ble Court may be pleased to:
(a) take cognizance of the offence under Section 138 of the Negotiable Instruments Act, 1881 and summon the accused;
(b) try and punish the accused in accordance with law;
(c) direct payment of compensation to the complainant under {compensation_provision};
(d) pass such other order as this Hon'ble Court deems fit.

COMPLAINANT
Through
{advocate_name}, Advocate

VERIFICATION
Verified at [[Place]] on [[Date]] that the contents of the above complaint are true and correct to my knowledge and belief.

(The complainant's sworn statement is to be recorded under {examination_provision}.)

COMPLAINANT

LIST OF DOCUMENTS: original cheque; bank return memo; copy of demand notice; postal receipts / proof of delivery; [[other documents]].

[DRAFT prepared by Nyaay. Confirm limitation, jurisdiction, applicable procedure code and all facts before filing.]
"""

S143A = """IN THE COURT OF {court_place}

{matter_title}
Case No. {case_number}

APPLICATION ON BEHALF OF THE COMPLAINANT UNDER SECTION 143A OF THE NEGOTIABLE INSTRUMENTS ACT, 1881 FOR INTERIM COMPENSATION

MOST RESPECTFULLY SHOWETH:

1. That the complainant {complainant_name} has filed the above complaint under Section 138 of the Act against the accused {accused_name} in respect of Cheque No. {cheque_no} dated {cheque_date} for {cheque_amount}.

2. That [[the accused has pleaded not guilty to the accusation / stage at which the application is made]].

3. That Section 143A of the Act empowers this Hon'ble Court to direct the drawer to pay interim compensation to the complainant, which shall not exceed twenty per cent of the amount of the cheque.

4. That the complainant has been deprived of the cheque amount for a considerable period, and the circumstances of the case justify the grant of interim compensation.

PRAYER

It is therefore prayed that this Hon'ble Court may be pleased to direct the accused to pay interim compensation of [[amount, not exceeding 20% of the cheque amount]] to the complainant within sixty days, and pass such other order as deemed fit.

COMPLAINANT
Through {advocate_name}, Advocate
Date: {today}

[DRAFT prepared by Nyaay. Check the stage requirements of Section 143A and recent judgments on its discretionary nature before filing.]
"""

ADJOURN = """IN THE COURT OF {court}

{matter_title}
Case No. {case_number}
Next date: {next_date}

APPLICATION FOR ADJOURNMENT ON BEHALF OF [[Complainant / Accused]]

MOST RESPECTFULLY SHOWETH:

1. That the above matter is listed before this Hon'ble Court on {next_date} for [[purpose of listing]].

2. That [[reason for adjournment, stated truthfully and specifically]].

3. That the adjournment is sought bona fide and not to delay the proceedings, and no prejudice will be caused to the other side.

PRAYER

It is therefore prayed that the matter may kindly be adjourned to a convenient date.

{advocate_name}
Advocate
Date: {today}

[DRAFT prepared by Nyaay.]
"""

LOD_HEAD = """LIST OF DATES AND EVENTS
{matter_title}
Case No. {case_number}

DATE                   EVENT
"""

CLIENT = """Date: {today}

Dear {client_name},

Re: {matter_title} ({case_number}) before {court}

This is an update on your matter.

Current stage: {stage}
Next date of hearing: {next_date}

What we are doing next:
{steps}

Please keep the original documents ready and let us know if any of your contact details change. We will update you after the next hearing.

Regards,
{advocate_name}

[DRAFT prepared by Nyaay. Review before sending to the client.]
"""
COMPLAINT = COMPLAINT.replace("{year_ph}", "[[Year]]")


TEMPLATE_TEXT = {"ni138_notice": NOTICE, "ni138_complaint": COMPLAINT, "sec143a": S143A, "adjournment": ADJOURN,
                 "list_of_dates": LOD_HEAD, "client_update": CLIENT}


def template_version(tid: str) -> str:
    import hashlib
    return hashlib.sha256(TEMPLATE_TEXT[tid].encode()).hexdigest()[:12]
