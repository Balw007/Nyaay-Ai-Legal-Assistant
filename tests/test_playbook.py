from datetime import date

from app.services import playbook as pbk

PB = pbk.get_playbook("ni138")


def by_id(results):
    return {r.rule_id: r for r in results}


def test_add_months_clamps_to_month_end():
    assert pbk.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert pbk.add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)


def test_all_ni138_deadlines_from_confirmed_facts():
    facts = {
        "cheque_date": date(2026, 1, 10),
        "bank_information_received_date": date(2026, 2, 1),
        "notice_received_date": date(2026, 2, 20),
    }
    r = by_id(pbk.compute_deadlines(PB, facts))
    assert r["ni138_presentation_validity"].due_date == date(2026, 4, 10)
    assert r["ni138_notice_window"].due_date == date(2026, 3, 3)      # 1 Feb + 30 days (2026 is not a leap year)
    assert r["ni138_payment_window"].due_date == date(2026, 3, 7)     # 20 Feb + 15 days
    assert r["ni138_complaint_window"].due_date == date(2026, 4, 8)   # cause of action 8 Mar + 1 month
    assert all(x.needs_confirmation for x in r.values())


def test_missing_inputs_are_reported_not_guessed():
    r = by_id(pbk.compute_deadlines(PB, {"cheque_date": date(2026, 1, 10)}))
    assert r["ni138_presentation_validity"].status == "computed"
    for rid in ("ni138_notice_window", "ni138_payment_window", "ni138_complaint_window"):
        assert r[rid].status == "missing_input" and r[rid].due_date is None
    assert "demand notice" in r["ni138_complaint_window"].note.lower()  # names the root input it needs


def test_alert_window():
    d = date(2026, 3, 3)
    assert pbk.is_alert_due(d, [10, 3, 1], date(2026, 2, 25))
    assert not pbk.is_alert_due(d, [10, 3, 1], date(2026, 2, 1))
    assert pbk.is_alert_due(d, [10, 3, 1], date(2026, 3, 10))  # overdue still alerts


def test_stage_detection():
    assert pbk.detect_stage(PB, "Summons be issued to the accused returnable on 5 May")[0] == "summons"
    stage, conf, _ = pbk.detect_stage(PB, "Accused appeared and furnished bail bond with surety.")
    assert stage == "accused_appears" and conf >= 0.6
    assert pbk.detect_stage(PB, "Nothing relevant here")[0] is None


def test_plan_marks_current_and_next():
    p = pbk.plan(PB, "summons")
    states = {s["id"]: s["state"] for s in p["stages"]}
    assert states["demand_notice"] == "done" and states["summons"] == "current" and states["arguments"] == "upcoming"
    assert p["next_stage"] == "Accused appears"
