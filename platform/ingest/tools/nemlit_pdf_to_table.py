"""Turn the national essential medicines list PDF (scanned pages with a ruled table) into the table text file the
pipeline reads: one line per table row, tab-separated: section, molecule, forms, level, note.

    python tools/nemlit_pdf_to_table.py NEMLIT-2026.pdf nemlit_2026_table.txt

Needs poppler (pdftoppm), tesseract and opencv-python-headless. Not part of the worker image: run it once per new
edition of the list, check the printed summary, then upload the .txt in Admin > Data updates as the essential list.

How it works: every page is rendered at 300 dpi; the table's ruled lines give the rows and the three columns; each
cell is read on its own (so a level letter is never confused with the end of a dosage line). Level letters are only
ever A, B, C, D or S in one font, so they are classified by shape against templates built from the letters OCR read
with certainty; a cell with a note ("B (Level A for STI only)") keeps its leading letter and the note.
"""
import collections
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
from multiprocessing import Pool

import cv2
import numpy as np

COLS_MIN = 4   # left edge, name | forms, forms | level, right edge


def grid(g):
    bw = cv2.adaptiveThreshold(255 - g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2)
    h, w = bw.shape
    hor = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (w // 12, 1)))
    ver = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, h // 60)))

    def lines(mask, axis):
        idx = np.where(mask.sum(axis=axis) > 0)[0]
        out, start, prev = [], None, None
        for v in idx:
            if start is None:
                start = prev = v
            elif v - prev > 2:
                out.append((start + prev) // 2)
                start = v
            prev = v
        if start is not None:
            out.append((start + prev) // 2)
        return out
    return hor, ver, lines(hor, 1), lines(ver, 0)


def ocr(img, psm=6, whitelist=None):
    ok, buf = cv2.imencode(".png", img)
    cmd = ["tesseract", "stdin", "stdout", "--psm", str(psm), "-l", "eng"]
    if whitelist:
        cmd += ["-c", f"tessedit_char_whitelist={whitelist}"]
    out = subprocess.run(cmd, input=buf.tobytes(), capture_output=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout
    return re.sub(r"\s+", " ", out.decode()).strip()


def covered(mask, y, x0, x1, frac=0.8):
    band = mask[max(0, y - 3):y + 4, x0:x1].max(axis=0)
    return (band > 0).mean() >= frac


def letter_glyphs(cell):
    bw = (cell < 140).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    comps = sorted((stats[i] for i in range(1, n) if stats[i][4] > 40 and stats[i][3] > 20), key=lambda s: s[0])
    return [cv2.resize(bw[y:y + h, x:x + w].astype(np.float32), (24, 32)) for x, y, w, h, _ in comps]


def read_page(path):
    g = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    hor, ver, ys, xs = grid(g)
    if len(xs) < COLS_MIN:
        return []
    xl, xn, xf, xr = xs[0], xs[1], xs[-2], xs[-1]
    rows, pad = [], 6
    for top, bot in zip(ys, ys[1:]):
        if bot - top < 25:
            continue
        full_width = (ver[top + 6:bot - 6, xn - 4:xn + 5].max(axis=1) > 0).mean() < 0.5
        if full_width:   # a section heading spans the whole table
            rows.append({"type": "section", "text": ocr(g[top + pad:bot - pad, xl + pad:xr - pad], 7)})
            continue
        level_cell = g[top + 8:bot - 8, xf + 8:xr - 8]
        rows.append({"type": "row", "top": int(top), "bot": int(bot), "name_line": covered(hor, top, xl + 10, xn - 10),
                     "form": ocr(g[top + pad:bot - pad, xn + pad:xf - pad]),
                     "level_ocr": ocr(cv2.resize(g[top + pad:bot - pad, xf + pad:xr - pad], None, fx=1.5, fy=1.5), 6, "ABCDS,&"),
                     "level_raw": ocr(g[top + pad:bot - pad, xf + pad:xr - pad]),
                     "glyphs": [x.tolist() for x in letter_glyphs(level_cell)]})
    # a name cell can span several rows (one medicine, several forms with their own levels)
    group = None
    for r in rows:
        if r["type"] != "row":
            group = None
            continue
        if group is None or r["name_line"]:
            group = [r]
            r["_group"] = group
        else:
            group.append(r)
    for r in rows:
        if "_group" in r:
            grp = r.pop("_group")
            name = ocr(g[grp[0]["top"] + pad:grp[-1]["bot"] - pad, xl + pad:xn - pad])
            for x in grp:
                x["name"] = name
    return rows


def clean_letter(t):
    t = t.replace(" ", "")
    if re.fullmatch(r"S+s*|s+", t):
        return "S"
    if re.fullmatch(r"C+c*|c+", t):
        return "C"
    return t if len(t) == 1 and t in "ABCDS" else None


def fix_name(t):
    t = re.sub(r"\s+", " ", t).strip(" ,.;|")
    t = re.sub(r"\bl(?=[bcdfghjklmnpqrstvwxz]|od)", "I", t)   # OCR reads capital I as l: 'lsoflurane', 'lodized'
    for a, b in (("|", "l"), ("§-", "5-"), ("5 —-", "5-"), ("—", "-"), ("Dolutearavir", "Dolutegravir")):
        t = t.replace(a, b)
    return t


def main(pdf, out_path):
    work = tempfile.mkdtemp(prefix="nemlit-")
    subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", pdf, os.path.join(work, "p")], check=True)
    with Pool(max(1, os.cpu_count() or 1)) as p:
        pages = p.map(read_page, sorted(glob.glob(os.path.join(work, "p-*.png"))))
    rows = [r for page in pages for r in page]

    # level letters: templates from cells OCR read with certainty, then every cell classified by shape
    tmpl = collections.defaultdict(list)
    for r in rows:
        if r["type"] == "row" and len(r["glyphs"]) == 1:
            lab = clean_letter(r["level_ocr"]) or clean_letter(r["level_raw"])
            if lab:
                tmpl[lab].append(np.array(r["glyphs"][0]))
    templates = {k: np.mean(v, axis=0) for k, v in tmpl.items()}

    def classify(gl):
        gl = np.array(gl).ravel()
        return max(templates, key=lambda k: float(np.corrcoef(gl, templates[k].ravel())[0, 1]) if gl.std() else -1)

    out, section = [], None
    for r in rows:
        if r["type"] == "section":
            m = re.match(r"^(\d{1,2})\.(\d*)\s", r["text"])
            if m and 1 <= int(m.group(1)) <= 34 and (section is None or int(m.group(1)) >= section):
                section = int(m.group(1))
            continue
        if section is None or r["name"].lower().startswith("name of medicine"):
            continue
        raw = r["level_raw"].strip()
        if len(r["glyphs"]) == 1:
            level, note = classify(r["glyphs"][0]), ""
        elif r["glyphs"]:
            lead = re.match(r"^\s*([ABCDS])", raw.replace("Ss", "S").replace("Cc", "C").upper())
            level = lead.group(1) if lead else classify(r["glyphs"][0])
            note = re.sub(r"^[A-Za-z]{1,2}\s*\(?|\)$", "", raw).strip()
        else:
            level, note = "", ""
        out.append((section, fix_name(r["name"]), r["form"].replace("\t", " "), level, note))

    with open(out_path, "w") as f:
        f.write("section\tmolecule\tforms\tlevel\tnote\n")
        for row in out:
            f.write("\t".join(str(v) for v in row) + "\n")
    levels = collections.Counter(o[3] or "blank" for o in out)
    print(json.dumps({"rows": len(out), "sections": len({o[0] for o in out}), "levels": levels,
                      "templates": {k: len(v) for k, v in tmpl.items()},
                      "blank_level": [o[1] for o in out if not o[3]]}, indent=1))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
