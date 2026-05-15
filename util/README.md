# Trench Photo Analyzer

CLI that sends a trench-installation photo to Google Gemini and prints a
JSON verdict on whether the image contains a trench, vertical measuring
stick, address sheet, and sand bedding.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate    # fish: source .venv/bin/activate.fish
pip install -r requirements.txt
```

Get a Gemini API key at <https://aistudio.google.com/apikey>, then either
export it or copy `.env.example` to `.env` and source it:

```bash
export GEMINI_API_KEY=your-api-key-here
```

## Run

```bash
python analyze_image.py path/to/photo.jpg
```

Options:

- `-f, --prompt-file PATH` — use a custom prompt file (default: `prompts/default.txt`)
- `-p, --prompt TEXT` — inline prompt, overrides `--prompt-file`
- `-m, --model NAME` — Gemini model (default: `gemini-2.5-flash`)

Example with the stricter prompt:

```bash
python analyze_image.py ../CLP20417A-P1-B00__*/some_photo.jpg -f prompts/v1.txt
```

Supported image formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.heic`, `.heif`.
