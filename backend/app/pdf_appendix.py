"""Per-photo classification appendix PDF.

Mirrors `Mock Appendix Reasoning behind the pictures.docx`: one table per
category (1–4) with Photo ID, Category, AI reasoning, Est. depth, Sand
bedding, AI confidence. AI reasoning is composed from the available
photo_analyses signals.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.pdf_render import (
    EM_DASH,
    NAVY,
    CAT_COLORS,
    MUTED,
    _NumberedCanvas,
    _styles,
)
from reportlab.pdfgen.canvas import Canvas

CAT_HEADINGS = {
    1: "Category 1 — Complete pass (duct + depth visible)",
    2: "Category 2 — Partial pass (duct only)",
    3: "Category 3 — Lowest acceptable (depth only)",
    4: "Category 4 — Unusable",
}


def _reasoning(photo: dict) -> str:
    cat = photo["category"]
    if cat == 2 and photo.get("has_measuring_stick") is False:
        return "No depth reference in frame."
    if cat == 4:
        if photo.get("has_duplicate"):
            return "Duplicate (pHash + metadata match)."
        return "Neither duct nor depth verifiable."
    return ""


def _category_table(cat: int, photos: list[dict], styles: dict) -> Table:
    fill, text_color = CAT_COLORS[cat]
    include_reasoning = cat == 4
    header = ["Photo ID", "Category"]
    if include_reasoning:
        header.append("AI reasoning")
    header.append("Est. depth")
    rows: list[list[Any]] = [header]
    for p in photos:
        depth = p["depth_cm"]
        row: list[Any] = [
            Paragraph(p["filename"] or EM_DASH, styles["cell"]),
            Paragraph(f"Cat {cat}", styles["cell_bold"]),
        ]
        if include_reasoning:
            row.append(Paragraph(_reasoning(p), styles["cell"]))
        row.append(f"{depth:.0f} cm" if depth is not None else EM_DASH)
        rows.append(row)

    col_widths = (
        [3.8 * cm, 2.0 * cm, 8.4 * cm, 2.8 * cm]
        if include_reasoning
        else [6.0 * cm, 3.0 * cm, 8.0 * cm]
    )
    t = Table(
        rows,
        colWidths=col_widths,
        repeatRows=1,
    )
    depth_col = 3 if include_reasoning else 2
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (depth_col, 1), (depth_col, -1), "RIGHT"),
        ("BACKGROUND", (1, 1), (1, -1), fill),
        ("TEXTCOLOR", (1, 1), (1, -1), text_color),
    ]
    t.setStyle(TableStyle(style))
    return t


def build_appendix_pdf(out_path: Path, db_data: dict, meta: dict | None = None) -> None:
    meta = meta or {}
    styles = _styles()
    photos = db_data["photos"]
    project = meta.get("project_id") or ""

    grouped: dict[int, list[dict]] = {1: [], 2: [], 3: [], 4: []}
    for p in photos:
        cat = p.get("category")
        if cat in grouped:
            grouped[cat].append(p)

    doc = SimpleDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.8 * cm, bottomMargin=2 * cm,
        title="Trench Audit Appendix",
    )

    title = "Appendix: Photo-by-Photo Classification Details"
    note = f"Project {project}." if project else ""

    story: list = [
        Paragraph(title, styles["h2"]),
        Spacer(1, 4),
    ]
    for cat in (1, 2, 3, 4):
        story.append(Paragraph(CAT_HEADINGS[cat], styles["h3"]))
        if grouped[cat]:
            story.append(_category_table(cat, grouped[cat], styles))
        else:
            story.append(Paragraph("No photos in this category.", styles["footnote"]))
        story.append(Spacer(1, 6))
    if note:
        story.append(Spacer(1, 4))
        story.append(Paragraph(note, styles["footnote"]))

    canvas_cls = _NumberedCanvas(Canvas).make_wrapper()

    class _AppendixCanvas(canvas_cls):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._report_project_id = project

    doc.build(story, canvasmaker=_AppendixCanvas)
