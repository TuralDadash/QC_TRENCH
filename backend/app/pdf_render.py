"""Customer-facing PDF report renderer.

Mirrors `Mock Summary.docx` at the repo root. Colors and layout follow the
Word doc; the per-photo appendix lives in `app.pdf_appendix`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

EM_DASH = "—"

NAVY = HexColor("#1F3864")
BLUE_LIGHT = HexColor("#D9E2F3")
GREEN_LIGHT = HexColor("#C6EFCE")
YELLOW_LIGHT = HexColor("#FFEB9C")
RED_LIGHT = HexColor("#FFC7CE")
GRAY_LIGHT = HexColor("#D9D9D9")
GREEN_TEXT = HexColor("#1E7E34")
ORANGE_TEXT = HexColor("#9C5700")
RED_TEXT = HexColor("#9C0006")
GRAY_TEXT = HexColor("#404040")
MUTED = HexColor("#595959")

CAT_COLORS = {
    1: (GREEN_LIGHT, GREEN_TEXT),
    2: (YELLOW_LIGHT, ORANGE_TEXT),
    3: (RED_LIGHT, RED_TEXT),
    4: (GRAY_LIGHT, GRAY_TEXT),
}
CAT_LABELS = {
    1: "Cat 1 — Complete pass",
    2: "Cat 2 — Partial pass (duct only)",
    3: "Cat 3 — Lowest acceptable (depth only)",
    4: "Cat 4 — Unusable",
}
CAT_DESCRIPTIONS = {
    1: "Both duct (Schutzrohr) and trench depth visible and verifiable. Full compliance.",
    2: "Duct visible but trench depth cannot be verified.",
    3: "Trench depth verifiable but duct not visible. Minimum acceptable evidence.",
    4: "Neither duct nor depth verifiable; or rejected (duplicate, GPS mismatch, manipulation).",
}


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "company": ParagraphStyle(
            "company", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, leading=11, textColor=MUTED,
        ),
        "ogig": ParagraphStyle(
            "ogig", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=11, leading=14, textColor=NAVY,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=20, leading=24, textColor=NAVY, alignment=0,
        ),
        "h1_big": ParagraphStyle(
            "h1_big", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=24, leading=28, textColor=NAVY, alignment=0,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=13, leading=16, spaceBefore=14, spaceAfter=6,
            textColor=NAVY,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontName="Helvetica-Bold",
            fontSize=10, leading=13, spaceBefore=4, spaceAfter=4,
            textColor=NAVY,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontName="Helvetica",
            fontSize=10, leading=13,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=base["Normal"], fontName="Helvetica-Oblique",
            fontSize=10, leading=13, textColor=MUTED,
        ),
        "footnote": ParagraphStyle(
            "footnote", parent=base["Normal"], fontName="Helvetica-Oblique",
            fontSize=8, leading=10, textColor=MUTED,
        ),
        "cell": ParagraphStyle(
            "cell", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, leading=11,
        ),
        "cell_bold": ParagraphStyle(
            "cell_bold", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, leading=11,
        ),
    }


def _fmt(value: Any) -> str:
    if value is None or value == "":
        return EM_DASH
    return str(value)


def _pct(part: int, total: int) -> str:
    if not total:
        return EM_DASH
    return f"{100 * part / total:.1f}%"


def _hr(weight: float = 1.0, color=NAVY) -> HRFlowable:
    return HRFlowable(width="100%", thickness=weight, color=color,
                      spaceBefore=2, spaceAfter=2)


def _header(meta: dict, styles: dict) -> list:
    company = meta.get("company_name") or "Ohsome Compliance"
    return [
        Paragraph(company, styles["company"]),
        _hr(0.5),
        Spacer(1, 2 * mm),
        Paragraph("ÖGIG — Österreichische Glasfaser Infrastruktur Gesellschaft",
                  styles["ogig"]),
        Spacer(1, 6 * mm),
        Paragraph("Photo Audit of Dug Trenches", styles["h1"]),
        Spacer(1, 1 * mm),
        Paragraph("Deficiency Report for Trench Pictures", styles["h1_big"]),
        Spacer(1, 3 * mm),
        _hr(1.0),
        Spacer(1, 4 * mm),
    ]


def _project_meta(meta: dict, db_data: dict, styles: dict) -> list:
    subtitle = meta.get(
        "project_subtitle",
        "Trenches Picture Review for Project X by Construction company Y",
    )
    rows = [
        ["Project ID", _fmt(meta.get("project_id"))],
        ["Contractor", _fmt(meta.get("contractor"))],
        ["Region", _fmt(meta.get("region"))],
        ["Photos submitted", str(db_data["total_photos"])],
        ["Submission date", _fmt(meta.get("submission_date"))],
        ["Audit date", _fmt(meta.get("audit_date"))],
        ["Audited by", _fmt(meta.get("audited_by"))],
    ]
    t = Table(rows, colWidths=[5 * cm, 12 * cm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DDDDDD")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [
        Paragraph(subtitle, styles["subtitle"]),
        Spacer(1, 3 * mm),
        t,
    ]


def _exec_summary(db_data: dict, length_m: float | None, styles: dict) -> list:
    counts = db_data["category_counts"]
    total = db_data["total_photos"]

    rows: list[list[Any]] = [["", "Category", "Description", "Photos", "Share"]]
    for cat in (1, 2, 3, 4):
        _, text_color = CAT_COLORS[cat]
        label_style = ParagraphStyle(
            f"cat{cat}", parent=styles["cell_bold"], textColor=text_color
        )
        rows.append([
            "",
            Paragraph(CAT_LABELS[cat], label_style),
            Paragraph(CAT_DESCRIPTIONS[cat], styles["cell"]),
            Paragraph(f"<b>{counts[cat]}</b>", styles["cell"]),
            Paragraph(f"<b>{_pct(counts[cat], total)}</b>", styles["cell"]),
        ])
    rows.append([
        "",
        Paragraph("<b>Total</b>", ParagraphStyle("tot", parent=styles["cell_bold"], textColor=NAVY)),
        Paragraph("All photos submitted", ParagraphStyle("tot_desc", parent=styles["cell"], textColor=MUTED)),
        Paragraph(f"<b>{total}</b>", ParagraphStyle("tot_n", parent=styles["cell_bold"], textColor=NAVY)),
        Paragraph("<b>100.0%</b>", ParagraphStyle("tot_p", parent=styles["cell_bold"], textColor=NAVY)),
    ])
    col_widths = [0.6 * cm, 5 * cm, 7.4 * cm, 2 * cm, 2 * cm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, -1), (-1, -1), BLUE_LIGHT),
    ]
    for i, cat in enumerate((1, 2, 3, 4), start=1):
        fill, _ = CAT_COLORS[cat]
        style.append(("BACKGROUND", (0, i), (0, i), fill))
    t.setStyle(TableStyle(style))

    supplied = counts[1] + counts[2] + counts[3]
    if length_m is not None and length_m > 0:
        expected = int(round(length_m / 5))
        missing = max(0, expected - supplied)
        length_str = f"{length_m:,.0f} m".replace(",", ".")
        missing_para = Paragraph(
            f'<b><font color="#9C0006">{missing} missing</font></b>',
            styles["cell"],
        )
        length_rows = [
            ["Length", "Expected photos (÷5 m)", "Supplied photos (Cat 1–3)", "Pictures missing"],
            [
                Paragraph(f"<b>{length_str}</b>", ParagraphStyle("ln", parent=styles["cell_bold"], textColor=NAVY)),
                Paragraph(f"<b>{expected}</b>", ParagraphStyle("le", parent=styles["cell_bold"], textColor=NAVY)),
                Paragraph(f"<b>{supplied}</b>", styles["cell_bold"]),
                missing_para,
            ],
        ]
    else:
        length_rows = [
            ["Length", "Expected photos (÷5 m)", "Supplied photos (Cat 1–3)", "Pictures missing"],
            [EM_DASH, EM_DASH, Paragraph(f"<b>{supplied}</b>", styles["cell_bold"]), EM_DASH],
        ]
    lt = Table(length_rows, colWidths=[4 * cm, 4.5 * cm, 4.5 * cm, 4 * cm])
    lt.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 1), (-1, 1), BLUE_LIGHT),
        ("ALIGN", (0, 1), (-1, 1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    return [
        Paragraph("1. Executive Summary", styles["h2"]),
        Paragraph("Submitted photos by category", styles["h3"]),
        t,
        Spacer(1, 5 * mm),
        Paragraph("Total length of trenches and estimated pictures", styles["h3"]),
        lt,
        Spacer(1, 2 * mm),
        Paragraph(
            "Required rate: 1 photo per 5 m of trench (APG documentation guideline §4.1). "
            "Only Cat 1–3 photos count toward coverage; Cat 4 (unusable) photos are excluded.",
            styles["footnote"],
        ),
    ]


def _cat4_breakdown(db_data: dict, overrides: dict, styles: dict) -> list:
    breakdown = dict(db_data["cat4_breakdown"])
    breakdown.update({k: v for k, v in overrides.items() if v is not None})

    cat4_total = db_data["category_counts"][4]
    total_photos = db_data["total_photos"]

    def share(n: int | None) -> str:
        if n is None or not cat4_total:
            return EM_DASH
        return f"{100 * n / cat4_total:.1f}%"

    def bold_num(n: Any) -> Paragraph:
        if n is None:
            return Paragraph(EM_DASH, styles["cell"])
        return Paragraph(f"<b>{n}</b>", styles["cell"])

    cat4_photos = [p for p in db_data.get("photos", []) if p.get("category") == 4]
    derived = {"no_useful_evidence": 0, "other": 0}
    for p in cat4_photos:
        if p.get("has_duplicate"):
            continue
        if p.get("has_tape") is True and p.get("has_trench") is not True and p.get("depth_cm") is None:
            continue  # counted in warning_tape_only
        if p.get("has_trench") is not True and p.get("depth_cm") is None:
            derived["no_useful_evidence"] += 1
        else:
            derived["other"] += 1

    reasons = [
        ("Duplicate across lots", breakdown.get("duplicate"),
         "Near-duplicate image submitted for multiple baulosen (pHash + metadata match)."),
        ("No useful evidence", derived["no_useful_evidence"] or None,
         "Neither duct nor a readable depth measurement detected by the VLM."),
        ("GPS coordinates inconsistent", breakdown.get("gps_inconsistent") or 0,
         "EXIF coordinates fall outside declared lot boundary (pipeline knows this but does not persist it yet)."),
        ("Only warning tape visible", breakdown.get("warning_tape_only"),
         "Duct and depth both missing, only warning tape shown."),
    ]
    rows: list[list[Any]] = [["Rejection reason", "Photos", "Share of Cat 4", "Notes"]]
    for label, count, note in reasons:
        rows.append([
            Paragraph(label, styles["cell"]),
            bold_num(count),
            Paragraph(f"<b>{share(count)}</b>", styles["cell"]) if count is not None else Paragraph(EM_DASH, styles["cell"]),
            Paragraph(note, ParagraphStyle("note", parent=styles["cell"], textColor=MUTED)),
        ])
    rows.append([
        Paragraph("<b>Total — Category 4</b>", ParagraphStyle("t1", parent=styles["cell_bold"], textColor=NAVY)),
        Paragraph(f"<b>{cat4_total}</b>", ParagraphStyle("t2", parent=styles["cell_bold"], textColor=NAVY)),
        Paragraph("<b>100.0%</b>" if cat4_total else EM_DASH, ParagraphStyle("t3", parent=styles["cell_bold"], textColor=NAVY)),
        "",
    ])
    t = Table(rows, colWidths=[4.5 * cm, 2 * cm, 2.7 * cm, 7.8 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 1), (2, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, -1), (-1, -1), BLUE_LIGHT),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    intro = (
        f"Category 4 contains {cat4_total} photos "
        f"({_pct(cat4_total, total_photos)} of all submissions) that cannot be used."
    )
    footnote = "GPS mismatch is shown as 0 when no dedicated DB value is available."
    return [
        Paragraph("2. Category 4 Breakdown: Why Photos Are Unusable", styles["h2"]),
        Paragraph(intro, styles["body"]),
        Spacer(1, 2 * mm),
        t,
        Spacer(1, 2 * mm),
        Paragraph(footnote, styles["footnote"]),
    ]


def _addresses(db_data: dict, styles: dict) -> list:
    addrs = db_data["addresses"]
    intro = (
        "Housing information extracted only from physical white paper notes visible "
        "in the photos. The table preserves the note text, including installation "
        "codes written on the same paper."
    )
    if not addrs:
        return [
            Paragraph("3. House Addresses Extracted from Photos", styles["h2"]),
            Paragraph(intro, styles["body"]),
            Spacer(1, 2 * mm),
            Paragraph("No addresses detected.", styles["footnote"]),
        ]
    rows: list[list[Any]] = [["#", "White paper note text", "Source photo"]]
    for i, a in enumerate(addrs, 1):
        rows.append([
            str(i),
            Paragraph(a["address"] or EM_DASH, styles["cell"]),
            Paragraph(a["filename"] or EM_DASH, styles["cell"]),
        ])
    rows.append([
        Paragraph("<b>Total</b>", ParagraphStyle("at", parent=styles["cell_bold"], textColor=NAVY)),
        Paragraph(f"<b>{len(addrs)}</b>", ParagraphStyle("an", parent=styles["cell_bold"], textColor=NAVY)),
        "",
    ])
    t = Table(rows, colWidths=[1.5 * cm, 9 * cm, 6.5 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), BLUE_LIGHT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [
        Paragraph("3. House Addresses Extracted from Photos", styles["h2"]),
        Paragraph(intro, styles["body"]),
        Spacer(1, 2 * mm),
        t,
    ]


def _map_placeholder(styles: dict) -> list:
    return [
        Paragraph("4. Extracted Map", styles["h2"]),
        Paragraph(
            "Map export pending — render of photo locations on the trench network "
            "will be added once the static-map exporter is in place.",
            styles["footnote"],
        ),
    ]


class _NumberedCanvas:
    """Two-pass canvas so the footer can render 'Page N of M'."""

    def __init__(self, canvas_cls):
        self._canvas_cls = canvas_cls

    def make_wrapper(self):
        canvas_cls = self._canvas_cls

        class NumberedCanvas(canvas_cls):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self._saved_states = []

            def showPage(self):
                self._saved_states.append(dict(self.__dict__))
                self._startPage()

            def save(self):
                num_pages = len(self._saved_states)
                for state in self._saved_states:
                    self.__dict__.update(state)
                    self._draw_footer(num_pages)
                    canvas_cls.showPage(self)
                canvas_cls.save(self)

            def _draw_footer(self, total_pages):
                project = getattr(self, "_report_project_id", "") or ""
                self.saveState()
                self.setFont("Helvetica", 8)
                self.setFillColor(MUTED)
                if project:
                    self.drawString(2 * cm, 1.2 * cm, f"Project {project}")
                self.drawRightString(
                    A4[0] - 2 * cm, 1.2 * cm,
                    f"Page {self._pageNumber} of {total_pages}",
                )
                self.restoreState()

        return NumberedCanvas


def _attach_project_id(canvas, doc):
    canvas._report_project_id = getattr(doc, "_report_project_id", None)


def build_pdf(
    out_path: Path,
    db_data: dict,
    meta: dict | None = None,
    length_m: float | None = None,
    cat4_overrides: dict | None = None,
) -> None:
    meta = meta or {}
    cat4_overrides = cat4_overrides or {}
    styles = _styles()

    doc = BaseDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.5 * cm, bottomMargin=2 * cm,
        title="Trench Audit Report",
    )
    doc._report_project_id = meta.get("project_id")
    frame = Frame(
        doc.leftMargin, doc.bottomMargin,
        doc.width, doc.height, id="body",
    )
    doc.addPageTemplates([
        PageTemplate(id="main", frames=[frame], onPage=_attach_project_id),
    ])

    story: list = []
    story += _header(meta, styles)
    story += _project_meta(meta, db_data, styles)
    story += _exec_summary(db_data, length_m, styles)
    story += _cat4_breakdown(db_data, cat4_overrides, styles)
    story += _addresses(db_data, styles)
    story += _map_placeholder(styles)

    from reportlab.pdfgen.canvas import Canvas
    doc.build(story, canvasmaker=_NumberedCanvas(Canvas).make_wrapper())
