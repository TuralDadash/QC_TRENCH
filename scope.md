Hackathon Challenge: KI-gestützte Prüfung von Baudokumentationsfotos
Martin Fuhrmann
Challenge: Wie können wir mit Computer Vision bestehende Baustellenfotos automatisiert darauf prüfen, ob sie den Dokumentationsrichtlinien entsprechen, Manipulationen oder Mehrfachverwendungen erkennen und daraus einen belastbaren Mängelreport auf Projekt- und Baulos-Ebene erzeugen?
Entwickelt einen Prototypen, der bestehende, georeferenzierte Baudokumentationsfotos automatisch auf Vollständigkeit und Richtlinienkonformität prüft. Ziel ist es, doppelt verwendete, ungeeignete oder unzureichende Bilder zu erkennen und pro Objekt, Baulos oder Projekt zu bewerten, ob die erforderliche Dokumentation vorliegt. Auf Basis definierter Kriterien — etwa Sichtbarkeit von Warnband, Sandbettung, Seitenansicht und Grabentiefe — soll das System fehlende oder mangelhafte Nachweise identifizieren und in einem klaren Report ausweisen. Der Output soll als Grundlage dienen, um Generalunternehmern dokumentierte Mängel und fehlende Nachweise nachvollziehbar aufzuzeigen.
Beschreibung der Challenge:
Martin haben wir hier einen Prozess oder eine Visualisierung?
Die TeilnehmerInnen müssen den Prozess verstehen können (was wird getriggert?).
Englische Beschreibung
Daten: 
Martin bereitet die Daten vor und übergibt Sie an Alin
Fotoanzahl (klären Alin und Martin (in den Graben rein)
Filter rein, selektieren und herausnehmen (in der Doku sollen nicht personenbezogene Fotos drinnen sein)
Alin prüft die Daten
Time Commitment: 
Martin am 15.5. ab 15.00 Uhr bis zirka 20.00 Uhr
Samstag eventl. KollegIn
Sonntag 17.5. ab 10.00 Uhr 10.30 Uhr -> Pitchen bis 13.30 Uhr

Challenge — Austrian Power Grid AI-Powered Construction Photo Audit
Can AI automatically verify that construction photos meet documentation standards — and catch the ones that don't?
Challenge Partner: Austrian Power Grid (APG) · Contact: Martin Fuhrmann · Domain: Energy Infrastructure & Critical Grid Operations
Background
Austrian Power Grid operates and maintains Austria's high-voltage electricity transmission network. Every construction project on or near the grid — cable trenching, underground works, civil infrastructure that requires contractors to submit photo documentation as proof that the work meets defined standards.
Right now, engineers review these photos manually. They scroll through hundreds of images per project, cross-reference documentation guidelines, and compile deficiency reports by hand. This takes significant time, introduces human error, and creates legal grey zones when contractors reuse or manipulate photos across different job lots.
APG wants to automate this verification layer, not to replace human judgment, but to handle the routine checking at scale, and surface only the real issues for expert review.
The Challenge
Build an AI-powered prototype that takes a batch of geo-referenced construction site photos and automatically checks whether they comply with APG's documentation requirements. The system should identify which photos pass, which fail, and which are duplicates or otherwise suspect and summarise all findings in a clear, actionable deficiency report at project and lot level.
The six criteria your system needs to check:
Warning tape visible in the image
Sand bedding documented before backfilling
Side view / trench profile present
Trench depth confirmed with visible reference
Duplicate or reused photo detected across lots
GPS location consistent with declared project site
What to Build
An upload and ingestion interface — Users can upload a batch of photos with basic metadata: project name, lot ID, GPS coordinates if available.
A computer vision pipeline that checks each photo — For each image: does it show warning tape? Sand bedding? A side view? Visible trench depth? Mark each criterion as pass, fail, or undetectable.
A duplicate and manipulation detection module — Flag photos that appear more than once across different lots, or where the GPS metadata doesn't match the declared project location.
A completeness summary per project and lot — Given the set of submitted photos, what documentation is still missing? Which objects or lots are underdocumented?
A deficiency report output — A structured, human-readable summary that APG can hand to a contractor: what's missing, what's flagged, what passed.
You don't need real APG data to start. Synthetic or publicly available construction site photos work fine for the prototype. The jury will evaluate your approach and architecture — not whether you have access to proprietary datasets.
Business Case — What the Jury Wants to See
A working demo is necessary but not sufficient. APG needs to understand why this is worth deploying. Your pitch should answer: how many engineer hours does this save per project? What's the cost of a missed defect today versus the cost of running your system? How does this integrate into APG's existing contractor submission workflow?
Think about the downstream value too: faster approvals, legal defensibility of documentation, and a clear audit trail in case of disputes with contractors. The more concretely you can quantify the impact, the stronger your pitch.


Security: 
Doku-Richtlinie - Kriterien einhalten checkliste 
Aufgabenstellung
Anzahl der Fotos: 424.000 Grabungsfotos - Trenches - NIS2 - Filter für KI keine personenbezogene Daten
geo-getagged I Meta Infos
Am Foto mit Subtext
mit der App gemacht: GPS
Kärntner Projekt ohne App
NDA - IT Security notwendig - trassenverlauf - georeferncierte Trassen 
NDA - kommt von Legal kollegen


