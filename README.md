# Hangman

A horror-themed Hangman word game. Flask backend, vanilla JS/CSS frontend — no build step, no framework.

**Live:** https://hangman-eight-rust.vercel.app/
**Repo:** https://github.com/afsheenpatnam/Hangman

---

## Features

- **Intro sequence** — a "click to enter" gate (required for audio autoplay), then a flickering
  loading screen with rotating horror one-liners and a jump-scare reveal into the level-select screen.
- **Three difficulty levels** — Easy (8 lives, ×1 score), Medium (6 lives, ×1.5 score), Hard (5 lives, ×2 score).
  Each pulls from its own word list with horror-flavored clues instead of plain definitions.
- **Animated gallows** — grows a body part per wrong guess, sways continuously like a noose in the wind,
  with a moon, crows, and ground mist in the background.
- **Rune keyboard** — letters are shown as runic glyphs until hovered, at which point the real letter
  is revealed and a whisper sound plays.
- **Layered sound design** — synthesized SFX (Web Audio oscillators/noise, no external files needed)
  for correct/wrong/win/lose, plus real dropped-in audio files for ambience: an occasional ambient
  "pulse" (not a loop — the source clip is only ~1s long) and an occasional cry on wrong guesses.
- **Persistent stats** — high score, win count, best streak, games played, backed by MongoDB
  (gracefully degrades to all-zero defaults if no database is configured).

## Tech stack

- **Backend:** Flask (Python), MongoDB via `pymongo`
- **Frontend:** vanilla HTML/CSS/JS — no bundler, no npm
- **Fonts:** Nosifer, Creepster, Special Elite (Google Fonts)
- **Hosting:** Vercel (serverless Python function) + MongoDB Atlas

## Project structure

```
app.py              Flask app — routes, word bank, game state (session-based)
main.py             Local desktop-style launcher: starts Flask + opens your browser
                     (not used on Vercel — the serverless function calls app.py's `app` directly)
vercel.json          Routes all requests to app.py as a Python serverless function
requirements.txt     Flask, pymongo, dnspython
run.bat              Windows convenience script — just runs `python main.py`

templates/index.html  All 3 screens (intro, level-select, game) in one page, toggled via CSS class
static/script.js      All client-side logic — screens, audio, gameplay, rendering
static/style.css      All styling
static/images/        Category backgrounds + horror images (used by the intro/level cards/game bg)
static/audio/         ambient-chilling.mp3, cry-1.mp3, cry-4.mp3 — dropped-in sound files
```

## Setup

```
pip install -r requirements.txt
```

MongoDB is optional for local dev — if nothing is running on `mongodb://localhost:27017/`, stats just
default to zero instead of persisting (no crash, no error shown to the player).

## Run locally

```
python main.py
```

or double-click `run.bat`. This starts the Flask server and opens `http://127.0.0.1:5050` in your
default browser automatically.

## Environment variables

Only needed for production (Vercel) or if you want to point local dev at a real database:

| Variable     | Default                          | Purpose                                    |
|--------------|-----------------------------------|---------------------------------------------|
| `MONGO_URI`  | `mongodb://localhost:27017/`      | MongoDB connection string (Atlas SRV URI in prod) |
| `SECRET_KEY` | `hangman-pro-2024`                | Signs the Flask session cookie              |

## Deployment (Vercel)

1. Push to GitHub.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Set `MONGO_URI` (MongoDB Atlas connection string, with `0.0.0.0/0` network access allowed since
   Vercel uses dynamic IPs) and `SECRET_KEY` (any random string) as environment variables.
4. Deploy. `vercel.json` handles routing everything to `app.py` as a serverless function.

**Known constraint:** the filesystem is read-only in production, so `/api/load-bg` (which downloads
a fresh Wikipedia image per word) silently no-ops there and falls back to the pre-committed category
image instead — this is expected, not a bug.

## API reference

| Route                  | Method | Purpose                                                        |
|-------------------------|--------|------------------------------------------------------------------|
| `/`                      | GET    | Serves the page                                                  |
| `/api/categories`        | GET    | Category metadata (emoji, color) for the UI                      |
| `/api/new-game`          | POST   | `{level}` → starts a new round, returns full game state          |
| `/api/guess`             | POST   | `{letter}` → applies a guess, returns updated game state         |
| `/api/cat-image`         | GET    | `?cat=` → one random image URL for a category                    |
| `/api/cat-images`        | GET    | `?cat=&n=` → N random image URLs for a category                  |
| `/api/load-bg`           | GET    | `?q=&cat=` → fetches/caches a word-specific Wikipedia image       |
| `/api/stats`             | GET/POST | Reads/writes persistent player stats (MongoDB-backed)           |
| `/api/images-ready`      | GET    | Which category background images have been downloaded            |

Game state is stored server-side in the Flask **session** (signed cookie) — no per-user database
row for in-progress games, only the final stats (`/api/stats`) are persisted to MongoDB.

## Notes on how a few things work

- **Difficulty tuning** lives in `app.py`: `MAX_WRONG` (lives per level) and `DIFF_MULT` (score
  multiplier per level).
- **Word bank** is the `WORDS` dict in `app.py`, split into `easy`/`medium`/`hard`, each entry has
  `word`, `clue`, `category`, and `image` (a search keyword used for the word-specific background).
- **Sound files must live under `static/audio/`** to be servable — the code tries a real file first
  and falls back to a synthesized version if the file is missing, so the game never plays silent.
- **Avoid spaces/parentheses in filenames under `static/`** — this broke image serving specifically
  on Vercel's deployment (files were listable via `os.listdir` but 404'd when actually requested).
  Stick to `word-word.ext` or `word_word.ext`.
