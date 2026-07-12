# Hangman

A horror-themed Hangman word game. Flask backend, vanilla JS/CSS frontend, opens in your default browser.

## Setup

```
pip install -r requirements.txt
```

MongoDB is optional — if it's not running, stats (high score, streak, etc.) just default to zero instead of persisting.

## Run

```
python main.py
```

or double-click `run.bat`. This starts the server and opens the game at `http://127.0.0.1:5050` in your default browser.
