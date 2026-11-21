from datetime import date

from app.services import playbook as pbk
from app.services.llm import LLM, NullLLM
from app.services.order_reader import find_dates, read_order

PB = pbk.get_playbook("ni138")

ORDER = """IN THE COURT OF THE METROPOLITAN MAGISTRATE (FICTIONAL TEST ORDER)
Complaint Case No. 123/2026 - Sample Finance Ltd v. Demo Traders
ORDER dated 12/03/2026
Complainant present through counsel. Accused appeared through counsel and furnished bail bond with one surety.
Bail bond is accepted. The accused is directed to appear on every date of hearing.
Copy of the complaint and documents be supplied to the accused. The complainant shall file the list of witnesses.
The matter is adjourned to 25/04/2026 for framing of notice of accusation.
"""


def test_date_formats():
    text = "heard on 5th March 2026, then 12-04-2026, and March 7, 2026 and 3 Sept 2026"
    got = [d for d, _, _ in find_dates(text)]
    assert got == [date(2026, 3, 5), date(2026, 4, 12), date(2026, 3, 7), date(2026, 9, 3)] or set(got) == {
        date(2026, 3, 5), date(2026, 4, 12), date(2026, 3, 7), date(2026, 9, 3)}


def test_rules_reading_of_a_realistic_order():
    r = read_order(ORDER, PB, NullLLM(), matter_title="Sample v. Demo", client_name="Mr Test")
    assert r["order_date"] == date(2026, 3, 12)
    assert r["next_date"] == date(2026, 4, 25)
    assert r["detected_stage"] in {"accused_appears", "plea_evidence"}
    assert any("directed" in d or "shall" in d for d in r["directions"])
    assert "25 Apr 2026" in r["client_message"] and "Mr Test" in r["client_message"]
    assert r["extraction_method"] == "rules"


def test_missing_next_date_is_flagged_not_invented():
    r = read_order("ORDER dated 12/03/2026. Matter heard. Accused appeared." + " filler" * 40, PB, NullLLM())
    assert r["next_date"] is None
    assert any("next date" in x.lower() for x in r["needs_review"])


def test_short_text_flags_poor_scan():
    r = read_order("Adjourned to 01/05/2026.", PB, NullLLM())
    assert any("scan" in x.lower() or "little text" in x.lower() for x in r["needs_review"])


def test_hindi_without_llm_falls_back_with_a_flag():
    r = read_order(ORDER, PB, NullLLM(), language="hi")
    assert any("Hindi" in x for x in r["needs_review"])


def test_llm_path_and_failure_fallback():
    class Good(LLM):
        available = True

        def json(self, system, user, max_tokens=1500):
            return {"summary": "Bail bond accepted.", "directions": ["Accused to appear on every date."],
                    "client_message": "Namaste, next hearing is on 25 April."}

    r = read_order(ORDER, PB, Good())
    assert r["extraction_method"] == "llm+rules" and r["summary"] == "Bail bond accepted."
    assert r["next_date"] == date(2026, 4, 25)  # dates still come from rules, not from the model

    class Bad(LLM):
        available = True

        def json(self, system, user, max_tokens=1500):
            raise RuntimeError("down")

    r = read_order(ORDER, PB, Bad())
    assert r["extraction_method"] == "rules"
    assert any("LLM step failed" in x for x in r["needs_review"])
