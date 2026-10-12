/**
 * PDF to DOCX Worker (via Pyodide + pdf2docx)
 */

import { loadPyodide } from '/pymupdf-wasm/pyodide.js';

let pyodide = null;
let initPromise = null;

async function init() {
  if (pyodide) return pyodide;

  self.postMessage({ type: 'status', message: 'Loading Python environment...' });

  // Initialize Pyodide
  pyodide = await loadPyodide({
    indexURL: '/pymupdf-wasm/',
    fullStdLib: false
  });

  self.postMessage({ type: 'status', message: 'Installing dependencies...' });

  const basePath = '/pymupdf-wasm/';

  // Mock missing non-critical dependencies
  pyodide.runPython(`
    import sys
    from types import ModuleType
    
    # Mock tqdm (used for progress bars)
    tqdm_mod = ModuleType("tqdm")
    def tqdm(iterable=None, *args, **kwargs):
        return iterable if iterable else []
    tqdm_mod.tqdm = tqdm
    sys.modules["tqdm"] = tqdm_mod
    
    # Mock fire (CLI tool, not needed for library usage)
    fire_mod = ModuleType("fire")
    sys.modules["fire"] = fire_mod
  `);

  // Group 1: Load independent packages in parallel (no inter-dependencies)
  self.postMessage({ type: 'status', message: 'Loading core packages...' });
  await Promise.all([
    pyodide.loadPackage(basePath + 'numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl'),
    pyodide.loadPackage(basePath + 'typing_extensions-4.12.2-py3-none-any.whl'),
    pyodide.loadPackage(basePath + 'packaging-24.1-py3-none-any.whl').catch(e =>
      console.warn("Failed to load packaging, fonttools might fail:", e)
    ),
    pyodide.loadPackage(basePath + 'lxml-5.4.0-cp313-cp313-pyodide_2025_0_wasm32.whl'),
    pyodide.loadPackage(basePath + 'pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl'),
  ]);

  // Group 2: Load packages that depend on Group 1, in parallel
  self.postMessage({ type: 'status', message: 'Loading converters...' });
  await Promise.all([
    pyodide.loadPackage(basePath + 'fonttools-4.56.0-py3-none-any.whl'),
    pyodide.loadPackage(basePath + 'python_docx-1.2.0-py3-none-any.whl'),
    pyodide.loadPackage(basePath + 'opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl'),
  ]);

  // Group 3: pdf2docx depends on all above
  self.postMessage({ type: 'status', message: 'Installing pdf2docx...' });
  await pyodide.loadPackage(basePath + 'pdf2docx-0.5.8-py3-none-any.whl');

  self.postMessage({ type: 'status', message: 'Initializing converter...' });

  // Define Python helper functions
  pyodide.runPython(`
import os
import fitz  # PyMuPDF

# Monkey-patch Pixmap.tobytes to handle unsupported colorspaces (e.g. CMYK)
_original_tobytes = fitz.Pixmap.tobytes

def _patched_tobytes(self, output="png", *args, **kwargs):
    try:
        return _original_tobytes(self, output, *args, **kwargs)
    except ValueError as e:
        if "unsupported colorspace" in str(e):
            rgb_pix = fitz.Pixmap(fitz.csRGB, self)
            result = _original_tobytes(rgb_pix, output, *args, **kwargs)
            rgb_pix = None
            return result
        raise

fitz.Pixmap.tobytes = _patched_tobytes

from pdf2docx import Converter

def pdf_write_input(input_obj):
    """Write PDF bytes to virtual filesystem."""
    if hasattr(input_obj, "to_py"):
        input_bytes = input_obj.to_py()
    else:
        input_bytes = input_obj

    with open("input.pdf", "wb") as f:
        f.write(input_bytes)

# --- Arabic/Hebrew (right-to-left) post-processing -------------------------------------
#
# pdf2docx has no concept of right-to-left text at all - confirmed by reading its source
# (pdf2docx/text/TextSpan.py sets w:ascii/w:hAnsi/w:eastAsia on every run but never w:cs,
# and nowhere in the package is w:bidi or w:rtl ever written). Word renders a character
# using whichever font slot its Unicode script maps to; Arabic and Hebrew map to w:cs, so
# with that slot never set, Word falls back to the document's inherited default complex-
# script font - almost never Arabic-capable - and draws empty boxes. The paragraph also
# stays left-to-right (no w:bidi), so a right-to-left line is laid out and aligned as if
# it were English. This is the same single attribute src/lib/libreoffice/arabic-font.ts
# forces in the opposite direction (Word/PowerPoint -> PDF); here it is applied to the
# already-generated document instead, since this engine does not control the PDF going in.
import unicodedata
from docx import Document
from docx.oxml.ns import qn

# Direct-formatting w:pPr children that the OOXML schema places after w:bidi - inserting
# bidi right before the first one present keeps a schema-valid element order instead of
# just appending, which would land bidi after things like w:jc or w:sectPr and risk Word
# repairing (or silently ignoring part of) the document.
_PPR_AFTER_BIDI = {qn(t) for t in (
    "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing",
    "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment",
    "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr",
    "w:pPrChange",
)}

def _is_rtl_char(ch):
    """True for a character the Unicode Bidirectional Algorithm itself classifies as
    strongly right-to-left (Arabic or Hebrew letters) - the same test a real bidi engine
    uses, rather than guessing from a fixed script code-point range."""
    try:
        return unicodedata.bidirectional(ch) in ("AL", "R")
    except (TypeError, ValueError):
        return False

def _has_rtl_text(text):
    return any(_is_rtl_char(ch) for ch in text)

def _fold_presentation_forms(text):
    """Arabic Presentation Forms (the isolated/initial/medial/final shaped glyphs a PDF's
    own font/ToUnicode table sometimes exposes instead of logical letters, U+FB50-FDFF and
    U+FE70-FEFF) fold back to their base letters under NFKC - the form correctly-encoded
    Arabic text is already in. Only run when such code points are actually present, so
    text that was already fine is never touched."""
    if any(0xFB50 <= ord(ch) <= 0xFDFF or 0xFE70 <= ord(ch) <= 0xFEFF for ch in text):
        return unicodedata.normalize("NFKC", text)
    return text

def _insert_bidi(pPr):
    if pPr.find(qn("w:bidi")) is not None:
        return
    bidi = pPr.makeelement(qn("w:bidi"), {})
    for child in pPr:
        if child.tag in _PPR_AFTER_BIDI:
            child.addprevious(bidi)
            return
    pPr.append(bidi)

def fix_rtl_runs(path):
    """Walks every run in the generated .docx - including inside tables and hyperlinks,
    via the raw element tree rather than python-docx's own .paragraphs (which skips table
    cells) - and for any run that actually contains right-to-left text: mirrors its already-
    correct w:ascii font (chosen from the source PDF's own embedded font, so it is the font
    most likely to actually hold that text's glyphs) into w:cs, marks the run w:rtl and its
    paragraph w:bidi, and folds any Arabic presentation-form glyphs back to logical letters.
    """
    doc = Document(path)
    fixed_runs = 0

    for p in doc.element.body.iter(qn("w:p")):
        paragraph_is_rtl = False

        for r in p.iter(qn("w:r")):
            texts = r.findall(qn("w:t"))
            run_text = "".join(t.text or "" for t in texts)
            if not _has_rtl_text(run_text):
                continue

            paragraph_is_rtl = True
            fixed_runs += 1

            for t in texts:
                if t.text:
                    t.text = _fold_presentation_forms(t.text)

            rPr = r.find(qn("w:rPr"))
            if rPr is None:
                rPr = r.makeelement(qn("w:rPr"), {})
                r.insert(0, rPr)

            rFonts = rPr.find(qn("w:rFonts"))
            if rFonts is None:
                rFonts = rPr.makeelement(qn("w:rFonts"), {})
                rPr.insert(0, rFonts)
            ascii_font = rFonts.get(qn("w:ascii"))
            if ascii_font:
                rFonts.set(qn("w:cs"), ascii_font)

            if rPr.find(qn("w:rtl")) is None:
                rPr.append(rPr.makeelement(qn("w:rtl"), {}))

        if paragraph_is_rtl:
            pPr = p.find(qn("w:pPr"))
            if pPr is None:
                pPr = p.makeelement(qn("w:pPr"), {})
                p.insert(0, pPr)
            _insert_bidi(pPr)

    if fixed_runs:
        doc.save(path)
    print(f"[pdf2docx] fix_rtl_runs: {fixed_runs} right-to-left run(s) fixed")

def pdf_convert():
    """Convert PDF to DOCX with optimized settings. Returns page count."""
    cv = Converter("input.pdf")
    # Get page count from Converter's internal fitz doc (no extra open)
    page_count = len(cv.fitz_doc)
    cv.convert("output.docx", start=0, end=None,
        clip_image_res_ratio=1.0,
        min_svg_gap_dx=5.0,
        min_svg_gap_dy=5.0,
        min_svg_w=2.0,
        min_svg_h=2.0,
        parse_stream_table=False,
    )
    cv.close()
    fix_rtl_runs("output.docx")
    return page_count

def pdf_read_result():
    """Read the DOCX result and clean up."""
    with open("output.docx", "rb") as f:
        docx_bytes = f.read()
    
    if os.path.exists("input.pdf"):
        os.remove("input.pdf")
    if os.path.exists("output.docx"):
        os.remove("output.docx")
    
    return docx_bytes
  `);

  return pyodide;
}

self.onmessage = async (event) => {
  const { type, id, data } = event.data;

  try {
    if (type === 'init') {
      if (!initPromise) initPromise = init();
      await initPromise;
      self.postMessage({ id, type: 'init-complete' });
      return;
    }

    if (type === 'convert') {
      if (!pyodide) {
        if (!initPromise) initPromise = init();
        await initPromise;
      }

      const { file } = data;
      const arrayBuffer = await file.arrayBuffer();
      const inputBytes = new Uint8Array(arrayBuffer);

      // Step 1: Write PDF to virtual filesystem
      self.postMessage({ type: 'progress', message: 'Preparing PDF...', percent: 5 });
      const writeInput = pyodide.globals.get('pdf_write_input');
      writeInput(inputBytes);

      self.postMessage({
        type: 'progress',
        message: 'Converting to DOCX...',
        percent: 10
      });

      // Step 2: Convert PDF to DOCX (returns page count)
      // Using runPythonAsync so the progress message above is flushed to main thread
      const totalPages = await pyodide.runPythonAsync('pdf_convert()');

      self.postMessage({
        type: 'progress',
        message: `Converted ${totalPages} pages successfully`,
        percent: 85
      });

      self.postMessage({
        type: 'progress',
        message: 'Reading result...',
        percent: 90
      });

      // Step 3: Read result
      const readResult = pyodide.globals.get('pdf_read_result');
      const resultProxy = readResult();
      const resultBytes = resultProxy.toJs();
      resultProxy.destroy();

      const resultBlob = new Blob([resultBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      self.postMessage({
        id,
        type: 'convert-complete',
        result: resultBlob
      });
    }

  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({
      id,
      type: 'error',
      error: error.message || String(error)
    });
  }
};
