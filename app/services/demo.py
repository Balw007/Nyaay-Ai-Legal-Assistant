"""Demo workspace: FICTIONAL matters with dates relative to today, so every screen has something to show.
Every demo matter title ends with "(Demo)". Nothing here is a real party or case."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..deps import audit
from ..models import Draft, Matter, Note, Order
from . import drafting as dft
from . import playbook as pbk
from .llm import NullLLM
from .order_reader import read_order


def _iso(d: date) -> str:
    return d.isoformat()


def _deadlines(db, firm_id, m, pb):
    from .deadlines import recompute
    db.flush()
    recompute(db, m)


def seed(db: Session, firm_id: int, today: date = None) -> int:
    from ..routes.orders import propose_tasks  # avoid import cycle at module load

    today = today or date.today()
    if db.query(Matter).filter(Matter.firm_id == firm_id, Matter.title.like("%(Demo)")).count():
        return 0
    pb = pbk.get_playbook("ni138")
    adv = {"advocate_name": "Adv. A. Deshmukh", "advocate_address": "Chamber 14, District Court Complex, Pune"}
    specs = [
        dict(title="Shreeji Agro Traders v. Malhotra Steel Works (Demo)", client_name="Shreeji Agro Traders",
             court="JMFC Court No. 4, Pune", case_number="SCC/1182/2026", stage="summons", next_date=today,
             facts={"cheque_date": today - timedelta(days=150), "bank_information_received_date": today - timedelta(days=128),
                    "notice_received_date": today - timedelta(days=112)},
             details={"complainant_name": "Shreeji Agro Traders", "complainant_address": "Market Yard, Gultekdi, Pune",
                      "accused_name": "Malhotra Steel Works", "accused_address": "MIDC Bhosari, Pune",
                      "cheque_no": "004512", "cheque_amount": "485000", "drawee_bank": "Example Co-operative Bank, Bhosari",
                      "liability": "price of agricultural produce supplied under invoices of March 2026",
                      "return_reason": "Funds Insufficient", "court_place": "Judicial Magistrate First Class, Pune", **adv},
             order=("ORDER dated {o}. Complainant present through counsel. Accused absent. Summons returned unserved "
                    "with the remark 'premises locked'. Issue fresh summons to the accused by speed post and also by "
                    "email. Complainant to take steps within seven days. Put up for appearance of accused on {n}."),
             order_date=today - timedelta(days=21),
             note="Accused's director said on phone he wants to settle; insist on a written proposal before the hearing."),
        dict(title="Vardhan Textiles v. R. K. Enterprises (Demo)", client_name="Vardhan Textiles",
             court="Metropolitan Magistrate, 33rd Court, Ballard Pier, Mumbai", case_number="CC/2207/SS/2026",
             stage="plea_evidence", next_date=today + timedelta(days=2),
             facts={"cheque_date": today - timedelta(days=260), "bank_information_received_date": today - timedelta(days=240),
                    "notice_received_date": today - timedelta(days=225)},
             details={"complainant_name": "Vardhan Textiles", "accused_name": "R. K. Enterprises",
                      "cheque_no": "118803", "cheque_amount": "1250000", "drawee_bank": "Sample National Bank, Fort",
                      "liability": "repayment of a business loan advanced in 2025", "return_reason": "Payment Stopped by Drawer",
                      "court_place": "Metropolitan Magistrate, Mumbai", **adv},
             order=("Order dated {o}. Accused present. Particulars of offence explained; accused pleads not guilty and "
                    "claims trial. Complainant to file evidence affidavit. Adjourned to {n} for complainant's evidence."),
             order_date=today - timedelta(days=30),
             note="File evidence affidavit with bank certificate under s.63 BSA. Consider s.143A application."),
        dict(title="Kaveri Fertilisers v. Sunrise Agencies (Demo)", client_name="Kaveri Fertilisers",
             court="JMFC, Nashik", case_number=None, stage="demand_notice", next_date=None,
             facts={"cheque_date": today - timedelta(days=60), "bank_information_received_date": today - timedelta(days=24)},
             details={"complainant_name": "Kaveri Fertilisers", "complainant_address": "Ambad Industrial Area, Nashik",
                      "accused_name": "Sunrise Agencies", "accused_address": "College Road, Nashik",
                      "cheque_no": "220145", "cheque_amount": "312750", "drawee_bank": "Demo Bank Ltd, College Road",
                      "liability": "outstanding dues for fertiliser supplied on credit",
                      "return_reason": "Funds Insufficient", **adv},
             note="Notice must go out this week. Get speed post and email proof."),
        dict(title="Om Sai Builders v. Pradeep Jain (Demo)", client_name="Om Sai Builders",
             court="JMFC, Thane", case_number=None, stage="payment_window", next_date=None,
             facts={"cheque_date": today - timedelta(days=55), "bank_information_received_date": today - timedelta(days=40),
                    "notice_received_date": today - timedelta(days=9)},
             details={"complainant_name": "Om Sai Builders", "accused_name": "Pradeep Jain",
                      "cheque_no": "000981", "cheque_amount": "90000", "drawee_bank": "Example Bank, Naupada",
                      "liability": "balance consideration for flat booking cancellation", "return_reason": "Account Closed",
                      "court_place": "Judicial Magistrate First Class, Thane", **adv},
             note="Watch for payment till the window closes; draft complaint ready."),
        dict(title="Shreeji Agro Traders v. Patil Krishi Kendra (Demo)", client_name="Shreeji Agro Traders",
             court="JMFC Court No. 2, Pune", case_number="SCC/0491/2025", stage="arguments",
             next_date=today + timedelta(days=5),
             facts={}, details={"complainant_name": "Shreeji Agro Traders", "accused_name": "Patil Krishi Kendra", **adv},
             order=("Order dated {o}. Evidence of both sides closed. Statement of accused recorded. Put up for final "
                    "arguments on {n}. Both sides to file written notes of arguments."),
             order_date=today - timedelta(days=16),
             note="Prepare written arguments; rely on presumption under s.139 and the accused's admission of signature."),
    ]
    n = 0
    for s in specs:
        m = Matter(firm_id=firm_id, title=s["title"], client_name=s["client_name"], court=s["court"],
                   case_number=s["case_number"], current_stage=s["stage"], next_date=s["next_date"],
                   facts={k: _iso(v) for k, v in s["facts"].items()}, details=s["details"], case_type="ni138",
                   goal="Recover the cheque amount with compensation")
        db.add(m)
        db.flush()
        _deadlines(db, firm_id, m, pb)
        if s.get("order"):
            nd = s["next_date"] or today + timedelta(days=10)
            text = s["order"].format(o=s["order_date"].strftime("%d.%m.%Y"), n=nd.strftime("%d.%m.%Y"))
            r = read_order(text, pb, NullLLM(), matter_title=m.title, client_name=m.client_name)
            o = Order(firm_id=firm_id, matter_id=m.id, filename=None, text=text, order_date=r["order_date"],
                      next_date=r["next_date"], summary=r["summary"], directions=r["directions"],
                      detected_stage=r["detected_stage"], stage_confidence=r["stage_confidence"],
                      extraction_method=r["extraction_method"], needs_review=r["needs_review"],
                      client_message=r["client_message"])
            db.add(o)
            db.flush()
            propose_tasks(db, firm_id, m, o, pb, r["matched_keywords"])
        if s.get("note"):
            db.add(Note(firm_id=firm_id, matter_id=m.id, body=s["note"]))
        if s["stage"] == "demand_notice":
            body = dft.render("ni138_notice", {"title": m.title, "facts": m.facts, "details": m.details})
            db.add(Draft(firm_id=firm_id, matter_id=m.id, template="ni138_notice",
                         title=f"Demand notice — {m.title}", body=body))
        n += 1
    audit(db, firm_id, "system", "demo_seed", "firm", firm_id, {"matters": n})
    db.commit()
    return n
