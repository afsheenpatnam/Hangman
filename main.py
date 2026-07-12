import json
import os
import ssl
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from app import app

PORT = 5050
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "static", "images")

# Wikipedia article titles per category — each has multiple fallbacks
CATEGORY_WIKI = {
    "animals":       ["Wolf",       "Tiger",         "Eagle"],
    "food":          ["Chocolate",  "Pizza",         "Sushi"],
    "nature":        ["Amazon rainforest","Waterfall","Aurora borealis"],
    "science":       ["Milky Way",  "DNA",           "Lightning"],
    "geography":     ["Mount Everest","Grand Canyon", "Sahara"],
    "music":         ["Violin",     "Guitar",        "Piano"],
    "history":       ["Ancient Egypt","Roman Empire","Colosseum"],
    "technology":    ["Robot",      "Rocket",        "Satellite"],
    "entertainment": ["Circus",     "Festival",      "Carnival"],
    "everyday":      ["City",       "Architecture",  "Bridge"],
    "mythology":     ["Zeus",       "Dragon",        "Thunderstorm"],
    "sports":        ["Football",   "Olympics",      "Basketball"],
}


def _ctx():
    """SSL context with cert verification disabled (local/offline use)."""
    ctx = ssl._create_unverified_context()
    return ctx


def wiki_image_url(query):
    """Return the Wikipedia thumbnail URL for a query, or ''."""
    api = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&titles={urllib.parse.quote(query)}"
        "&prop=pageimages&format=json&pithumbsize=1280"
    )
    try:
        req = urllib.request.Request(api, headers={"User-Agent": "HangmanGame/1.0"})
        with urllib.request.urlopen(req, context=_ctx(), timeout=8) as r:
            data = json.loads(r.read())
        for page in data.get("query", {}).get("pages", {}).values():
            src = page.get("thumbnail", {}).get("source", "")
            if src:
                return src
    except Exception:
        pass
    return ""


def download_image(url, filepath):
    """Download an image to filepath; returns True on success."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ctx(), timeout=10) as r:
            data = r.read()
        with open(filepath, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"  Download failed: {e}")
        return False


def prefetch_category_images():
    """Download one background image per category (runs in background thread)."""
    os.makedirs(IMAGES_DIR, exist_ok=True)
    for cat, queries in CATEGORY_WIKI.items():
        path = os.path.join(IMAGES_DIR, f"{cat}.jpg")
        if os.path.exists(path):
            continue
        print(f"[img] Fetching '{cat}' background…")
        saved = False
        for query in queries:
            time.sleep(0.4)          # be polite to Wikipedia API
            url = wiki_image_url(query)
            if url:
                saved = download_image(url, path)
                if saved:
                    break
        print(f"  {'saved' if saved else 'failed'}: {cat}.jpg")


def wait_for_server():
    for _ in range(30):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def open_browser():
    """Wait for Flask to come up, then open the game in the default web browser."""
    url = f"http://127.0.0.1:{PORT}"
    if wait_for_server():
        print(f"\n  Hangman is running — open it here: {url}\n")
        webbrowser.open(url)


if __name__ == "__main__":
    os.makedirs(IMAGES_DIR, exist_ok=True)

    # Download category images in the background (doesn't block startup)
    threading.Thread(target=prefetch_category_images, daemon=True).start()

    # Open the browser once the server is ready, then run Flask on the main thread
    threading.Thread(target=open_browser, daemon=True).start()
    app.run(port=PORT, debug=False, use_reloader=False)
