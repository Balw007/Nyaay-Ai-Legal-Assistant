"""Legal review pack: everything an advocate must sign off, in one document.

    python -m app.review_pack                    # writes nyaay-legal-review-pack.docx
    python -m app.review_pack --format md        # markdown instead
    python -m app.review_pack -o D:\\review.docx

It contains only what is already in the product: the playbook rules and the draft templates, exactly as the
software uses them, plus worked date examples computed by the same code so the arithmetic can be checked by eye.
Nothing is added to the law. The reviewer ticks each item and signs at the end; the same items can then be signed
off inside Nyaay under Settings > Legal review.
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from datetime import date
from pathlib import Path
from typing import Optional

from .services import drafting as dft
from .services import playbook as pbk
from .services import reviews as rev

# Block types: ("h1"|"h2"|"h3", text) ("p", text) ("note", text) ("table", header, rows) ("code", text)
#              ("bullets", [text]) ("check", text) ("pagebreak",)

PERIOD_WORDS = {"days": "day", "months": "month"}


def _period(add: dict) -> str:
    parts = []
    for k, v in add.items():
        w = PERIOD_WORDS.get(k, k)
        parts.append(f"{v} {w}{'' if int(v) == 1 else 's'}")
    return " and ".join(parts) or "0 days"


def _label(pb: dict, name: str) -> str:
    derived = {d["name"]: d for d in pb.get("derived_dates", [])}
    if name in derived:
        d = derived[name]
        return f"{name.replace('_', ' ')} (= {_label(pb, d['from'])} + {_period(d['add'])})"
    for i in pb["inputs"]:
        if i["name"] == name:
            return i["label"]
    return name.replace("_", " ")


def _fmt(d: Optional[date]) -> str:
    return d.strftime("%d %b %Y (%a)") if d else "-"


def _example_sets(pb: dict) -> list:
    """Arithmetic test cases. The dates are made up for checking the counting; they are not real matters."""
    from datetime import timedelta

    names = [i["name"] for i in pb["inputs"]]
    if not names:
        return []

    def chain(start: date, step: int) -> dict:
        return {n: start + timedelta(days=step * i) for i, n in enumerate(names)}

    return [("Ordinary dates", chain(date(2026, 1, 10), 20)),
            ("Month-end start (a 3-month period from 30 Nov ends on the last day of February)", chain(date(2025, 11, 30), 30)),
            ("A leap year (period crossing 29 Feb)", chain(date(2027, 11, 29), 45))]


def build(db=None, firm_id: Optional[int] = None) -> list:
    status = rev.status_map(db, firm_id) if db is not None and firm_id else {}
    cat = {(i["kind"], i["ref"]): i for i in rev.catalogue()}
    B: list = []
    B.append(("title", "Nyaay: legal review pack"))
    B.append(("p", f"Prepared {date.today().strftime('%d %B %Y')}. For review and sign-off by an advocate."))
    B.append(("h2", "What you are being asked to do"))
    B.append(("bullets", [
        "Nyaay computes statutory dates and suggests next steps and draft documents from the rules in this pack. "
        "It does not give legal advice. An advocate must be satisfied that each rule is right before the firm relies on it.",
        "For every numbered item below, tick Approved or Changes needed, and write the correction. "
        "Items you leave blank stay marked as DRAFT inside the product.",
        "The date examples are computed by the same code the product uses. Check a few by hand. "
        "The example dates are made up to test the counting; they are not real matters.",
        "Sign at the end. After that the firm can record each approval in Nyaay (Settings > Legal review), "
        "and an approval applies only to the exact wording shown here: if a rule or template changes, it needs review again.",
    ]))
    n = 0
    sign_items: list = []

    def item(kind: str, ref: str, title: str) -> int:
        nonlocal n
        n += 1
        sign_items.append((n, kind, ref, title))
        return n

    for case in pbk.available_case_types():
        pb = pbk.get_playbook(case)
        B.append(("pagebreak",))
        B.append(("h1", f"Part A. Playbook: {pb['name']}"))
        B.append(("p", f"Playbook id: {pb['case_type']}   Version: {pb['version']}"))
        B.append(("note", f"Status written in the file: {pb['status']}"))
        B.append(("h2", "A1. Facts the advocate enters"))
        B.append(("p", "Deadlines are computed only from dates the advocate has confirmed from the documents. "
                       "Nothing is read from an AI."))
        B.append(("table", ["Name used in the product", "Shown to the user as"],
                  [[i["name"], i["label"]] for i in pb["inputs"]]))
        if pb.get("derived_dates"):
            B.append(("h2", "A2. Dates worked out from those facts"))
            B.append(("table", ["Date", "Starts from", "Plus"],
                      [[d["name"].replace("_", " "), _label(pb, d["from"]), _period(d["add"])] for d in pb["derived_dates"]]))
        B.append(("h2", "A3. Deadline rules"))
        B.append(("p", "Each rule: start date + period = deadline. Months are added by calendar month "
                       "(if the target month is shorter, the last day of that month is used), then days are added."))
        for r in pb["deadline_rules"]:
            k = item("rule", r["rule_id"], r["label"])
            cur = status.get(("rule", r["rule_id"]))
            B.append(("h3", f"Item {k}. {r['label']}"))
            rows = [["Authority cited", r.get("authority", "-")],
                    ["Starts from", _label(pb, r["starts_from"])],
                    ["Period added", _period(r["add"])],
                    ["Reminders sent (days before)", ", ".join(str(x) for x in r.get("alert_days_before", [])) or "-"],
                    ["Stops being relevant once the case reaches stage",
                     next((s["name"] for s in pb["stages"] if s["id"] == r.get("met_at_stage")), "-")],
                    ["Moved to next open court day if the court is closed",
                     "Yes. The product's note cites Section 10, General Clauses Act" if r.get("court_act") else "No"]]
            if cur:
                rows.append(["Sign-off recorded in Nyaay", f"{cur['status']} by {cur['reviewer']}" + (" (outdated)" if cur["status"] == "outdated" else "")])
            B.append(("table", ["", ""], rows))
            B.append(("check", f"Item {k}"))
        if pb.get("deadline_note"):
            B.append(("note", "Note shown to users with every deadline: " + pb["deadline_note"]))
        B.append(("h2", "A4. Worked examples (computed by the product's own code)"))
        B.append(("p", "Check that each result matches what you would count by hand. These dates are for testing the arithmetic only."))
        for title, facts in _example_sets(pb):
            res = pbk.compute_deadlines(pb, facts)
            B.append(("h3", title))
            B.append(("table", ["Fact", "Date"], [[_label(pb, k), _fmt(v)] for k, v in facts.items()]))
            B.append(("table", ["Deadline", "Authority", "Result"], [[r.label, r.authority, _fmt(r.due_date)] for r in res]))
        B.append(("h2", "A5. Stages, detection words, and suggested next steps"))
        B.append(("p", "When an order is read, a stage is suggested if the order contains these words. "
                       "The advocate always confirms the stage. The actions are shown as suggestions, never as instructions."))
        for st in pb["stages"]:
            k = item("stage", st["id"], st["name"])
            B.append(("h3", f"Item {k}. Stage: {st['name']}"))
            B.append(("table", ["", ""], [
                ["Order contains any of", "; ".join(st.get("keywords", [])) or "-"],
                ["Suggested actions", "\n".join(f"- {a}" for a in st.get("actions", [])) or "-"],
                ["Drafts offered at this stage", "; ".join(st.get("drafts", [])) or "-"]]))
            B.append(("check", f"Item {k}"))

    B.append(("pagebreak",))
    B.append(("h1", "Part B. Draft templates"))
    B.append(("p", "Text in [[double square brackets]] is left blank for the advocate to fill. "
                   "The product refuses to export a draft while any blank remains. "
                   "The full wording of each template follows, exactly as the product generates it."))
    for tid, t in dft.TEMPLATES.items():
        k = item("template", tid, t["name"])
        B.append(("h2", f"Item {k}. {t['name']}"))
        B.append(("table", ["", ""], [["Group", t["group"]],
                                      ["Details collected", ", ".join(dft.FIELDS.get(f, f) for f in t["fields"]) or "-"],
                                      ["Dates used", ", ".join(d.replace("_", " ") for d in t["dates"]) or "-"],
                                      ["Version fingerprint", dft.template_version(tid)]]))
        B.append(("code", dft.TEMPLATE_TEXT[tid].strip()))
        B.append(("check", f"Item {k}"))

    B.append(("pagebreak",))
    B.append(("h1", "Part C. Sign-off"))
    B.append(("p", "Summary of items reviewed."))
    B.append(("table", ["Item", "Kind", "What", "Approved", "Changes needed"],
              [[str(k), kind, title, "[  ]", "[  ]"] for k, kind, ref, title in sign_items]))
    B.append(("h3", "Declaration"))
    B.append(("p", "I have reviewed the items marked Approved above and am satisfied that the rules, periods, authorities and "
                   "template wording are correct for use by this firm, subject to the changes written against the items "
                   "marked Changes needed."))
    B.append(("table", ["", ""], [["Name", ""], ["Bar Council enrolment number", ""], ["State Bar Council", ""],
                                  ["Date", ""], ["Signature", ""]]))
    return B


# ------------------------------------------------------------------ renderers

def to_markdown(blocks: list) -> str:
    out = []
    for b in blocks:
        t = b[0]
        if t == "title":
            out.append(f"# {b[1]}\n")
        elif t in ("h1", "h2", "h3"):
            out.append(f"{'#' * {'h1': 1, 'h2': 2, 'h3': 3}[t]} {b[1]}\n")
        elif t == "p":
            out.append(b[1] + "\n")
        elif t == "note":
            out.append(f"> {b[1]}\n")
        elif t == "bullets":
            out.append("\n".join(f"- {x}" for x in b[1]) + "\n")
        elif t == "table":
            head, rows = b[1], b[2]
            if not any(head):
                head = ["Field", "Value"]
            esc = lambda s: str(s).replace("|", "\\|").replace("\n", "<br>")
            out.append("| " + " | ".join(esc(h) for h in head) + " |")
            out.append("|" + "---|" * len(head))
            for r in rows:
                out.append("| " + " | ".join(esc(c) for c in r) + " |")
            out.append("")
        elif t == "code":
            out.append("```\n" + b[1] + "\n```\n")
        elif t == "check":
            out.append(f"**{b[1]}:**  [  ] Approved   [  ] Changes needed   Comments: ____________________________\n")
        elif t == "pagebreak":
            out.append("\n---\n")
    return "\n".join(out)


def to_docx(blocks: list) -> bytes:
    from docx import Document
    from docx.enum.text import WD_BREAK
    from docx.shared import Pt, RGBColor

    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "Calibri"
    st.font.size = Pt(10.5)
    for b in blocks:
        t = b[0]
        if t == "title":
            doc.add_heading(b[1], level=0)
        elif t in ("h1", "h2", "h3"):
            doc.add_heading(b[1], level={"h1": 1, "h2": 2, "h3": 3}[t])
        elif t == "p":
            doc.add_paragraph(b[1])
        elif t == "note":
            p = doc.add_paragraph()
            r = p.add_run(b[1])
            r.italic = True
            r.font.color.rgb = RGBColor(0x8A, 0x4B, 0x00)
        elif t == "bullets":
            for x in b[1]:
                doc.add_paragraph(x, style="List Bullet")
        elif t == "table":
            head, rows = b[1], b[2]
            ncol = len(head)
            tbl = doc.add_table(rows=0, cols=ncol)
            tbl.style = "Table Grid"
            if any(head):
                cells = tbl.add_row().cells
                for i, h in enumerate(head):
                    cells[i].text = ""
                    cells[i].paragraphs[0].add_run(h).bold = True
            for row in rows:
                cells = tbl.add_row().cells
                for i, c in enumerate(row):
                    cells[i].text = str(c)
                if not any(head):
                    for run in cells[0].paragraphs[0].runs:
                        run.bold = True
            doc.add_paragraph()
        elif t == "code":
            for line in b[1].split("\n"):
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(0)
                r = p.add_run(line)
                r.font.name = "Consolas"
                r.font.size = Pt(9)
            doc.add_paragraph()
        elif t == "check":
            p = doc.add_paragraph()
            p.add_run(f"{b[1]}:   ").bold = True
            p.add_run("☐ Approved     ☐ Changes needed     Comments: ______________________________")
        elif t == "pagebreak":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render(fmt: str = "docx", db=None, firm_id: Optional[int] = None) -> tuple:
    """(bytes, media_type, filename)."""
    blocks = build(db, firm_id)
    stamp = date.today().isoformat()
    if fmt == "md":
        return to_markdown(blocks).encode("utf-8"), "text/markdown; charset=utf-8", f"nyaay-legal-review-pack-{stamp}.md"
    return (to_docx(blocks), "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            f"nyaay-legal-review-pack-{stamp}.docx")


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.review_pack", description="Export the rules and templates for advocate sign-off.")
    ap.add_argument("--format", choices=["docx", "md"], default="docx")
    ap.add_argument("-o", "--output", help="file to write (default: ./nyaay-legal-review-pack-<date>.<ext>)")
    a = ap.parse_args(argv)
    data, _, name = render(a.format)
    path = Path(a.output or name)
    path.write_bytes(data)
    print(f"Wrote {path.resolve()}  ({len(data) // 1024} KB). Give it to an advocate to review and sign.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
