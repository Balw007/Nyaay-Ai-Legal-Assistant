from app.config import JUDGMENT_INDEX
from app.services import citations as c
from app.services.llm import LLM, NullLLM

INDEX = c.JudgmentIndex.from_file(JUDGMENT_INDEX)


class Judge(LLM):
    """Fake model: says 'supports' only when the paragraph mentions 'fifteen day'."""
    available = True

    def __init__(self, verdict=None):
        self.verdict = verdict

    def json(self, system, user, max_tokens=1500):
        if self.verdict:
            return {"verdict": self.verdict, "reason": "test"}
        return {"verdict": "supports" if "fifteen day" in user else "does_not_support", "reason": "test"}


GOOD = ("As held in Sample Finance Ltd v. Demo Traders, 2099 INSC 1, the cause of action arises on "
        "the expiry of the fifteen day period after the demand notice.")


def test_extracts_all_citation_formats_and_names():
    text = ("See Sample Finance Ltd v. Demo Traders, (2099) 1 SCC 100; Example Bank v. Test Borrower, "
            "AIR 2099 TEST 55. Also 2099 INSC 7 and 2099 SCC OnLine FICT 12.")
    cits = c.find_citations(text)
    assert [x.normalized for x in cits] == ["(2099) 1 SCC 100", "AIR 2099 TEST 55", "2099 INSC 7",
                                            "2099 SCC OnLine FICT 12"]
    assert "Sample Finance" in cits[0].case_name and "Demo Traders" in cits[0].case_name
    assert "Example Bank" in cits[1].case_name


def test_real_looking_citation_equivalents_resolve_to_same_judgment():
    a = c.find_citations("x 2099 INSC 1 y")[0]
    b = c.find_citations("x (2099) 1 SCC 100 y")[0]
    assert INDEX.resolve(a)[0].id == INDEX.resolve(b)[0].id == "fx-001"


def test_verified_when_llm_confirms():
    items = c.check_text(GOOD, INDEX, Judge())
    assert items[0]["status"] == c.VERIFIED
    assert items[0]["paragraphs"][0]["no"] == 7  # the right paragraph was located
    assert c.summarize(items)["can_export"] is True


def test_without_llm_nothing_is_ever_verified():
    items = c.check_text(GOOD, INDEX, NullLLM())
    assert items[0]["status"] == c.EXISTS_UNCHECKED
    assert c.summarize(items)["can_export"] is False


def test_invented_citation_is_not_found():
    items = c.check_text("Relying on Imaginary Corp v. Nobody, 2099 INSC 999, the claim fails.", INDEX, Judge())
    assert items[0]["status"] == c.NOT_FOUND
    s = c.summarize(items)
    assert not s["can_export"] and s["blockers"][0]["status"] == c.NOT_FOUND


def test_real_citation_with_wrong_case_name_is_flagged():
    items = c.check_text("In Example Bank v. Test Borrower, 2099 INSC 1, the cause of action arises.", INDEX, Judge())
    assert items[0]["status"] == c.CITATION_MISMATCH


def test_right_name_wrong_citation_is_flagged():
    items = c.check_text("In Sample Finance Ltd v. Demo Traders, 2099 INSC 555, the court held so.", INDEX, Judge())
    assert items[0]["status"] == c.CITATION_MISMATCH


def test_citation_exists_but_does_not_support_the_point():
    text = "In Sample Finance Ltd v. Demo Traders, 2099 INSC 1, the court held that bail must always be refused."
    items = c.check_text(text, INDEX, Judge())
    assert items[0]["status"] == c.EXISTS_NOT_SUPPORTED


def test_advocate_confirmation_clears_the_gate():
    items = c.check_text(GOOD, INDEX, NullLLM())
    assert not c.summarize(items)["can_export"]
    items[0]["advocate_confirmed"] = True
    assert c.summarize(items)["can_export"]


def test_text_without_citations():
    s = c.summarize(c.check_text("No authorities are cited here.", INDEX, NullLLM()))
    assert s["total"] == 0 and s["can_export"] and s["note"]
