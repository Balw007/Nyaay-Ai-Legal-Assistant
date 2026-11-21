"""Turn an uploaded file into text, and say how much to trust it.

Order of attempts for a PDF, page by page:
  1. the text layer inside the PDF
  2. Tesseract OCR (pytesseract), in the languages that are installed (English, Hindi, Marathi)
  3. a local vision model through Ollama (OLLAMA_VISION_MODEL), if one is passed in as `vision`
  4. a clear error that says what to install

Every OCR page carries a confidence score. Pages below OCR_LOW_CONF are flagged so the advocate checks them
against the original; nothing read from a scan is treated as certain.
"""
from __future__ import annotations

import io
import os
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from ..config import OCR_LANG

OCR_LOW_CONF = float(os.getenv("NYAAY_OCR_LOW_CONF", "70"))      # percent; below this a page must be checked
OCR_MAX_PAGES = int(os.getenv("NYAAY_OCR_MAX_PAGES", "80"))      # safety cap per file
OCR_DPI = int(os.getenv("NYAAY_OCR_DPI", "300"))
TEXT_LAYER_MIN = 50                                               # characters that count as "this page has text"
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp")


class UnsupportedFile(ValueError):
    pass


class OCRUnavailable(RuntimeError):
    pass


class NoTextFound(UnsupportedFile):
    pass


@dataclass
class PageInfo:
    page: int
    method: str                      # text-layer | ocr | vision | empty
    chars: int
    confidence: Optional[float]      # 0-100, None when the engine gives none (text layer, vision)
    low: bool = False


@dataclass
class Extraction:
    text: str
    method: str                      # text | pdf-text | ocr | ai-transcription | docx
    confidence: Optional[float] = None
    pages: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    @property
    def low_pages(self) -> list:
        return [p.page for p in self.pages if p.low]

    def summary(self) -> dict:
        return {"method": self.method,
                "confidence": None if self.confidence is None else round(self.confidence, 1),
                "pages": len(self.pages), "low_confidence_pages": self.low_pages, "warnings": self.warnings}


# ------------------------------------------------------------------ engine detection

def _has_module(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def _mupdf():
    """PyMuPDF under its current name, or the older 'fitz' name."""
    try:
        import pymupdf
        return pymupdf
    except Exception:
        try:
            import fitz
            return fitz
        except Exception:
            return None


_WIN_TESSERACT = (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")


def _configure_tesseract() -> None:
    """The Windows installer does not add Tesseract to PATH by default; look in the usual place."""
    import shutil

    cmd = os.getenv("TESSERACT_CMD")
    if not cmd and not shutil.which("tesseract"):
        cmd = next((p for p in _WIN_TESSERACT if os.path.exists(p)), None)
    if cmd:
        try:
            import pytesseract

            pytesseract.pytesseract.tesseract_cmd = cmd
        except Exception:
            pass


def tesseract_languages() -> list:
    try:
        import pytesseract

        _configure_tesseract()

        return sorted(set(pytesseract.get_languages(config="")) - {"osd"})
    except Exception:
        return []


def tesseract_ready() -> bool:
    return _has_module("pytesseract") and _has_module("PIL") and bool(tesseract_languages())


def ocr_lang() -> str:
    """The configured languages that are actually installed, so a missing Marathi pack does not break English."""
    wanted = [x for x in re.split(r"[+,\s]+", OCR_LANG or "eng") if x] or ["eng"]
    if "eng" not in wanted:
        wanted.insert(0, "eng")
    have = set(tesseract_languages())
    use = [x for x in wanted if x in have] if have else wanted
    return "+".join(use or ["eng"])


def engine_status() -> dict:
    langs = tesseract_languages()
    wanted = [x for x in re.split(r"[+,\s]+", OCR_LANG or "eng") if x]
    return {"tesseract": tesseract_ready(), "languages_installed": langs, "languages_in_use": ocr_lang(),
            "languages_missing": [x for x in wanted if langs and x not in langs],
            "rasteriser": "pymupdf" if _mupdf() else ("pdf2image" if _has_module("pdf2image") else None),
            "ready": tesseract_ready() and (bool(_mupdf()) or _has_module("pdf2image"))}


def install_hint() -> str:
    return ("To read scanned files install Tesseract OCR (Windows: https://github.com/UB-Mannheim/tesseract/wiki, tick Hindi and "
            "Marathi), then run: pip install pytesseract pillow pymupdf. Or set OLLAMA_VISION_MODEL (e.g. qwen2.5vl:7b). "
            "You can also paste the text instead.")


# ------------------------------------------------------------------ rasterising and OCR of one image

def _open_image(data: bytes):
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    return img


def _prepare(img):
    from PIL import Image, ImageOps

    img = img.convert("L")
    img = ImageOps.autocontrast(img, cutoff=1)
    if img.width < 1600:                      # phone photos and low-dpi scans read much better when enlarged
        scale = 1600 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img


def _ocr_image_data(img, lang: str) -> tuple:
    """(text, mean_confidence 0-100 or None). Confidence is the mean word confidence reported by Tesseract."""
    import pytesseract

    d = pytesseract.image_to_data(img, lang=lang, output_type=pytesseract.Output.DICT)
    words, confs, lines, last = [], [], [], None
    for i, w in enumerate(d["text"]):
        w = (w or "").strip()
        if not w:
            continue
        try:
            c = float(d["conf"][i])
        except (TypeError, ValueError):
            c = -1
        if c >= 0:
            confs.append(c)
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        if key != last:
            lines.append([])
            last = key
        lines[-1].append(w)
        words.append(w)
    text = "\n".join(" ".join(l) for l in lines)
    return text, (sum(confs) / len(confs) if confs else None)


def _ocr_page_image(img, lang: str) -> tuple:
    img = _prepare(img)
    text, conf = _ocr_image_data(img, lang)
    if (conf is None or conf < OCR_LOW_CONF) and img.width:
        # A sideways or upside-down scan reads as noise. Ask Tesseract for the rotation and try once more.
        try:
            import pytesseract

            osd = pytesseract.image_to_osd(img)
            m = re.search(r"Rotate:\s*(\d+)", osd)
            if m and int(m.group(1)) % 360:
                t2, c2 = _ocr_image_data(img.rotate(-int(m.group(1)), expand=True), lang)
                if (c2 or 0) > (conf or 0):
                    text, conf = t2, c2
        except Exception:
            pass
    return text, conf


def _png(img) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def pdf_page_count(data: bytes) -> int:
    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(data)).pages)


def rasterise_page(data: bytes, index: int):
    """One PDF page as a PIL image. PyMuPDF first (pure pip), then pdf2image (needs poppler)."""
    fz = _mupdf()
    if fz:
        from PIL import Image

        with fz.open(stream=data, filetype="pdf") as doc:
            pix = doc[index].get_pixmap(matrix=fz.Matrix(OCR_DPI / 72, OCR_DPI / 72), alpha=False)
            return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if _has_module("pdf2image"):
        from pdf2image import convert_from_bytes

        return convert_from_bytes(data, dpi=OCR_DPI, first_page=index + 1, last_page=index + 1)[0]
    raise OCRUnavailable("Reading scanned PDFs needs PyMuPDF: pip install pymupdf. " + install_hint())


# ------------------------------------------------------------------ one page, with the fallback chain

def _read_scanned_page(img, lang: Optional[str], vision: Optional[Callable[[bytes], str]]) -> tuple:
    """(text, confidence, method). Tesseract if available, else the vision model. Raises OCRUnavailable if neither."""
    if lang is not None:
        text, conf = _ocr_page_image(img, lang)
        if text.strip() or vision is None:
            return text, conf, "ocr"
    if vision is not None:
        return (vision(_png(img)) or "").strip(), None, "vision"
    raise OCRUnavailable("This file looks scanned and no OCR engine is installed. " + install_hint())


def extract_pdf(data: bytes, vision: Optional[Callable[[bytes], str]] = None, max_pages: int = OCR_MAX_PAGES) -> Extraction:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    layer = [(p.extract_text() or "") for p in reader.pages]
    pages, out, warnings = [], [], []
    lang = ocr_lang() if tesseract_ready() else None
    used = set()
    for i, t in enumerate(layer):
        if len(t.strip()) >= TEXT_LAYER_MIN:
            pages.append(PageInfo(i + 1, "text-layer", len(t), None))
            out.append(t)
            continue
        if i >= max_pages:
            pages.append(PageInfo(i + 1, "empty", 0, None, low=True))
            out.append("")
            continue
        text, conf, how = _read_scanned_page(rasterise_page(data, i), lang, vision)
        used.add(how)
        low = len(text.strip()) < 20 or how == "vision" or (conf is not None and conf < OCR_LOW_CONF)
        pages.append(PageInfo(i + 1, how if text.strip() else "empty", len(text), conf, low=low))
        out.append(text)
    if len(layer) > max_pages:
        warnings.append(f"Only the first {max_pages} pages were read by OCR; the rest were skipped.")
    confs = [p.confidence for p in pages if p.method == "ocr" and p.confidence is not None]
    method = ("ai-transcription" if used == {"vision"} else "ocr") if used else "pdf-text"
    if used == {"ocr", "vision"}:
        method = "ocr"
    return Extraction("\x0c".join(out), method, (sum(confs) / len(confs)) if confs else None, pages, warnings)


def extract_image(data: bytes, vision: Optional[Callable[[bytes], str]] = None) -> Extraction:
    lang = ocr_lang() if tesseract_ready() else None
    if lang is None and vision is None:
        raise OCRUnavailable("This photo needs OCR, which is not installed. " + install_hint())
    img = _open_image(data)
    text, conf, how = _read_scanned_page(img, lang, vision)
    low = len(text.strip()) < 20 or how == "vision" or (conf is not None and conf < OCR_LOW_CONF)
    return Extraction(text, "ocr" if how == "ocr" else "ai-transcription", conf,
                      [PageInfo(1, how, len(text), conf, low=low)])


def _docx_text(data: bytes) -> str:
    try:
        import docx  # python-docx
    except ImportError as exc:
        raise OCRUnavailable("Install python-docx to read .docx files, or paste the text.") from exc
    return "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)


def _require_text(text: str) -> str:
    if len(text.strip()) < 20:
        raise NoTextFound("No readable text was found in this file. The scan may be blank or too poor to read. "
                          "Upload a clearer scan or paste the text.")
    return text


def extract(filename: str, data: bytes, vision: Optional[Callable[[bytes], str]] = None) -> Extraction:
    """Full result: text plus method, confidence and low-confidence pages."""
    name = (filename or "").lower()
    if name.endswith((".txt", ".md")):
        return Extraction(_require_text(data.decode("utf-8", errors="replace")), "text")
    if name.endswith(".pdf"):
        r = extract_pdf(data, vision)
        _require_text(r.text.replace("\x0c", "\n"))
        return r
    if name.endswith(IMAGE_EXT):
        r = extract_image(data, vision)
        _require_text(r.text)
        return r
    if name.endswith(".docx"):
        return Extraction(_require_text(_docx_text(data)), "docx")
    raise UnsupportedFile(f"Unsupported file type: {filename}")


def extract_text(filename: str, data: bytes) -> tuple:
    """Return (text, method). method is one of text | pdf-text | ocr | ai-transcription | docx."""
    r = extract(filename, data)
    return r.text.replace("\x0c", "\n"), r.method


def ocr_pdf_for_ingest(data: bytes, vision: Optional[Callable[[bytes], str]] = None) -> Optional[str]:
    """Text of a scanned judgment PDF with pages separated by a form feed (what the cleaning pipeline expects).
    Returns None when no OCR engine is available or nothing readable came out."""
    if not tesseract_ready() and vision is None:
        return None
    try:
        r = extract_pdf(data, vision)
    except (OCRUnavailable, Exception):
        return None
    return r.text if len(r.text.replace("\x0c", "").strip()) >= 200 else None
