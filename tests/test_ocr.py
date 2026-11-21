import io

import pytest

from app.services import ocr

reportlab = pytest.importorskip("reportlab")
from reportlab.pdfgen import canvas  # noqa: E402

LINES = ["ORDER dated 12/03/2026 (FICTIONAL TEST ORDER)",
         "Accused appeared and furnished bail bond with one surety.",
         "The matter is adjourned to 25/04/2026 for framing of notice of accusation."]


def _text_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in LINES:
        c.drawString(60, y, line)
        y -= 20
    c.save()
    return buf.getvalue()


def _blank_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.rect(50, 50, 100, 100)
    c.save()
    return buf.getvalue()


def test_text_pdf_is_read_without_ocr():
    text, method = ocr.extract_text("order.pdf", _text_pdf())
    assert method == "pdf-text" and "25/04/2026" in text


def test_blank_scan_fails_clearly_instead_of_returning_empty_text():
    with pytest.raises(ocr.UnsupportedFile):
        ocr.extract_text("scan.pdf", _blank_pdf())


def test_unsupported_type():
    with pytest.raises(ocr.UnsupportedFile):
        ocr.extract_text("order.exe", b"abc")


def test_blank_scan_through_the_api_gives_a_helpful_422(client):
    m = client.post("/matters", json={"title": "OCR test"}).json()
    r = client.post(f"/matters/{m['id']}/orders", files={"file": ("scan.pdf", _blank_pdf())})
    assert r.status_code == 422 and "readable text" in r.json()["detail"]


def test_pdf_upload_through_the_api(client):
    m = client.post("/matters", json={"title": "PDF test"}).json()
    r = client.post(f"/matters/{m['id']}/orders", files={"file": ("order.pdf", _text_pdf())})
    assert r.status_code == 201 and r.json()["order"]["next_date"] == "2026-04-25"


# ---------------------------------------------------------------- scanned files and the fallback chain

PIL = pytest.importorskip("PIL")
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

SCAN_LINES = ["IN THE COURT OF THE METROPOLITAN MAGISTRATE", "ORDER dated 12/03/2026",
              "Accused appeared and furnished bail bond.", "Matter adjourned to 25/04/2026 for evidence."]


def _font(size=42):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf",
                 "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _scan_image(noise=False) -> "Image.Image":
    img = Image.new("RGB", (1700, 700), "white")
    d = ImageDraw.Draw(img)
    f = _font()
    y = 60
    for line in SCAN_LINES:
        d.text((80, y), line, fill="black", font=f)
        y += 100
    if noise:
        import random

        random.seed(1)
        px = img.load()
        for _ in range(250000):
            x, yy = random.randrange(img.width), random.randrange(img.height)
            px[x, yy] = (random.randrange(256),) * 3
    return img


def _scan_png(noise=False) -> bytes:
    buf = io.BytesIO()
    _scan_image(noise).save(buf, format="PNG")
    return buf.getvalue()


def _scan_pdf() -> bytes:
    """A PDF whose only content is a picture of text: no text layer, like a scanned order."""
    buf = io.BytesIO()
    _scan_image().save(buf, format="PDF", resolution=200)
    return buf.getvalue()


needs_tesseract = pytest.mark.skipif(not ocr.tesseract_ready(), reason="Tesseract is not installed")
needs_raster = pytest.mark.skipif(ocr.engine_status()["rasteriser"] is None, reason="PyMuPDF/pdf2image not installed")


@needs_tesseract
@needs_raster
def test_scanned_pdf_is_read_with_ocr_and_confidence():
    r = ocr.extract("order.pdf", _scan_pdf())
    assert r.method == "ocr"
    assert "25/04/2026" in r.text and "adjourned" in r.text.lower()
    assert r.confidence and r.confidence > 70
    assert r.pages[0].method == "ocr" and not r.pages[0].low


@needs_tesseract
def test_photo_of_an_order_is_read():
    r = ocr.extract("photo.png", _scan_png())
    assert r.method == "ocr" and "25/04/2026" in r.text


@needs_tesseract
def test_noisy_scan_is_flagged_for_checking():
    r = ocr.extract_image(_scan_png(noise=True))
    # Heavy noise either lowers confidence or garbles text; in both cases the page must not look trustworthy.
    assert r.pages[0].low or "25/04/2026" not in r.text or r.confidence < 95


@needs_tesseract
def test_missing_language_pack_falls_back_to_installed_languages(monkeypatch):
    monkeypatch.setattr(ocr, "OCR_LANG", "eng+hin+mar+xyz")
    use = ocr.ocr_lang().split("+")
    assert "eng" in use and "xyz" not in use


def test_mixed_pdf_only_ocrs_pages_without_text(monkeypatch):
    """Page 1 has a text layer, page 2 is a picture: only page 2 goes to OCR."""
    fitz = ocr._mupdf()
    if fitz is None:
        pytest.skip("PyMuPDF is not installed")
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text((60, 100), "ORDER dated 12/03/2026 adjourned to 25/04/2026 for evidence of the complainant.")
    doc.new_page().draw_rect(fitz.Rect(50, 50, 150, 150))
    data = doc.tobytes()
    monkeypatch.setattr(ocr, "tesseract_ready", lambda: True)
    monkeypatch.setattr(ocr, "ocr_lang", lambda: "eng")
    seen = []
    monkeypatch.setattr(ocr, "_ocr_page_image", lambda img, lang: (seen.append(1) or "Second page text from the scan", 91.0))
    r = ocr.extract_pdf(data)
    assert len(seen) == 1
    assert [p.method for p in r.pages] == ["text-layer", "ocr"]
    assert "Second page text" in r.text and r.method == "ocr"


def test_low_confidence_page_is_flagged(monkeypatch):
    monkeypatch.setattr(ocr, "tesseract_ready", lambda: True)
    monkeypatch.setattr(ocr, "ocr_lang", lambda: "eng")
    monkeypatch.setattr(ocr, "rasterise_page", lambda data, i: object())
    monkeypatch.setattr(ocr, "_ocr_page_image", lambda img, lang: ("blurry words that are barely readable at all", 41.0))
    r = ocr.extract_pdf(_blank_pdf())
    assert r.pages[0].low and r.low_pages == [1]
    assert r.summary()["low_confidence_pages"] == [1]


def test_fallback_to_vision_model_when_tesseract_is_missing(monkeypatch):
    monkeypatch.setattr(ocr, "tesseract_ready", lambda: False)
    monkeypatch.setattr(ocr, "rasterise_page", lambda data, i: Image.new("RGB", (100, 100), "white"))
    r = ocr.extract_pdf(_blank_pdf(), vision=lambda png: "Order dated 12/03/2026. Next date 25/04/2026 for evidence.")
    assert r.method == "ai-transcription"
    assert r.pages[0].method == "vision" and r.pages[0].low      # AI transcription always needs a human check
    assert r.confidence is None


def test_no_engine_and_no_vision_gives_a_clear_install_message(monkeypatch):
    monkeypatch.setattr(ocr, "tesseract_ready", lambda: False)
    monkeypatch.setattr(ocr, "rasterise_page", lambda data, i: Image.new("RGB", (100, 100), "white"))
    with pytest.raises(ocr.OCRUnavailable) as e:
        ocr.extract_pdf(_blank_pdf())
    assert "Tesseract" in str(e.value) and "OLLAMA_VISION_MODEL" in str(e.value)
    with pytest.raises(ocr.OCRUnavailable):
        ocr.extract_image(b"not needed")


def test_tesseract_failure_with_vision_still_reads(monkeypatch):
    monkeypatch.setattr(ocr, "tesseract_ready", lambda: True)
    monkeypatch.setattr(ocr, "ocr_lang", lambda: "eng")
    monkeypatch.setattr(ocr, "rasterise_page", lambda data, i: Image.new("RGB", (100, 100), "white"))
    monkeypatch.setattr(ocr, "_ocr_page_image", lambda img, lang: ("", 0.0))     # engine found nothing
    r = ocr.extract_pdf(_blank_pdf(), vision=lambda png: "Vision read: adjourned to 25/04/2026 for evidence.")
    assert r.method == "ai-transcription"


@needs_tesseract
@needs_raster
def test_scanned_order_through_the_api_is_flagged_for_review(client):
    m = client.post("/matters", json={"title": "Scanned order"}).json()
    r = client.post(f"/matters/{m['id']}/orders", files={"file": ("scan.pdf", _scan_pdf())})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["order"]["next_date"] == "2026-04-25"
    assert body["ocr"]["method"] == "ocr" and body["ocr"]["confidence"] > 70
    assert any("OCR" in n for n in body["order"]["needs_review"])


@needs_tesseract
@needs_raster
def test_scanned_judgment_is_no_longer_skipped_when_uploaded(tmp_path):
    from app import ingest as ing
    from app.services.store import Store

    # a long scanned judgment: several paragraphs drawn as an image
    img = Image.new("RGB", (1700, 2200), "white")
    d = ImageDraw.Draw(img)
    f = _font(34)
    y = 60
    for n in range(1, 16):
        d.text((80, y), f"{n}. The appellant relied on the settled law that a dishonoured cheque attracts liability.", fill="black", font=f)
        y += 120
    pdf = io.BytesIO()
    img.save(pdf, format="PDF", resolution=200)
    folder = tmp_path / "in"
    folder.mkdir()
    (folder / "scanned-judgment.pdf").write_bytes(pdf.getvalue())
    stats = ing.ingest_files(Store(str(tmp_path / "c.db")), str(folder), progress=lambda m: None)
    assert stats["added"] == 1 and stats["scanned_or_empty"] == 0
