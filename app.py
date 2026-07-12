import json
import os
import re
import random
import ssl
import urllib.parse
import urllib.request
from flask import Flask, Response, jsonify, render_template, request, send_from_directory, session
from pymongo import MongoClient

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "hangman-pro-2024")

IMAGES_DIR = os.path.join(os.path.dirname(__file__), "static", "images")

# ── MongoDB ──────────────────────────────────────────────────────────────────
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
try:
    _mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    _mongo.admin.command("ping")
    _db         = _mongo["hangman_db"]
    _stats_col  = _db["stats"]
    MONGO_OK    = True
    print("[mongo] Connected to MongoDB")
except Exception as e:
    MONGO_OK   = False
    _stats_col = None
    print(f"[mongo] Not available — stats will use defaults ({e})")

_PLAYER = "player_1"


def _ctx():
    return ssl._create_unverified_context()


def _wiki_image_url(query):
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


def _download(url, filepath):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ctx(), timeout=10) as r:
            with open(filepath, "wb") as f:
                f.write(r.read())
        return True
    except Exception:
        return False

CATEGORY_META = {
    "animals":       {"emoji": "🐾", "color": "#ff9f43", "gradient": "135deg,#1d3b1d,#2d5a2d"},
    "food":          {"emoji": "🍎", "color": "#ee5a24", "gradient": "135deg,#3b1a0a,#5a2d0a"},
    "nature":        {"emoji": "🌿", "color": "#44bd32", "gradient": "135deg,#0d2b0d,#1a4d1a"},
    "science":       {"emoji": "🔬", "color": "#0097e6", "gradient": "135deg,#051a3b,#0a2d5a"},
    "geography":     {"emoji": "🌍", "color": "#9980fa", "gradient": "135deg,#1a0a3b,#2d0a5a"},
    "music":         {"emoji": "🎵", "color": "#f9ca24", "gradient": "135deg,#3b3000,#5a4800"},
    "history":       {"emoji": "🏛️",  "color": "#e17055", "gradient": "135deg,#3b1a00,#5a2d00"},
    "technology":    {"emoji": "💻", "color": "#00b894", "gradient": "135deg,#003b2d,#005a42"},
    "entertainment": {"emoji": "🎭", "color": "#fd79a8", "gradient": "135deg,#3b001a,#5a002d"},
    "everyday":      {"emoji": "🏠", "color": "#74b9ff", "gradient": "135deg,#0a1a3b,#0a2d5a"},
    "mythology":     {"emoji": "⚡", "color": "#a29bfe", "gradient": "135deg,#1a0a3b,#2d1a5a"},
    "sports":        {"emoji": "⚽", "color": "#e84393", "gradient": "135deg,#3b0a2d,#5a0a42"},
}

WORDS = {
    "easy": [
        # Animals
        {"word": "cat",    "clue": "It walks on silent paws in the dark, watching you with eyes that reflect your fears. It purrs when it smells blood.", "category": "animals",    "image": "cat"},
        {"word": "dog",    "clue": "A loyal companion, yet it barks relentlessly at the dark corner of your room where nothing stands. Do not let it in.", "category": "animals",    "image": "dog"},
        {"word": "fish",   "clue": "Cold, glassy eyes that never blink, swimming in dark waters. They know what lies at the bottom.", "category": "animals",    "image": "fish"},
        {"word": "bird",   "clue": "Feathered wings that flutter in the attic. They sing songs of decay and watch you from the branches.", "category": "animals",    "image": "bird"},
        {"word": "frog",   "clue": "It croaks in the stagnant marsh, waiting for insects that feed on rotten flesh.", "category": "animals",    "image": "frog"},
        {"word": "bear",   "clue": "A towering beast that sleeps in deep caves. If it wakes up, it will hear your breathing from miles away.", "category": "animals",    "image": "bear"},
        {"word": "wolf",   "clue": "A wild predator that hunts in packs. You can hear its howl getting closer... and closer.", "category": "animals",    "image": "wolf"},
        {"word": "duck",   "clue": "It floats on the dark pond, watching you. If you go under, it will not help.", "category": "animals",    "image": "duck"},
        # Food
        {"word": "apple",  "clue": "A crisp red fruit. Be careful not to bite into the worm of corruption hiding inside.", "category": "food",       "image": "apple"},
        {"word": "bread",  "clue": "Baked dough, but left to rot, it will grow grey hairs of mold that whisper secrets.", "category": "food",       "image": "bread"},
        {"word": "grape",  "clue": "Tiny, bruised globes that grow on twisted vines. They taste of sweet rot.", "category": "food",       "image": "grapes"},
        {"word": "lemon",  "clue": "A sour, shriveled yellow fruit. It tastes like the bitterness of betrayal.", "category": "food",       "image": "lemon"},
        {"word": "mango",  "clue": "A sweet, heavy tropical fruit. The skin resembles bruised flesh.", "category": "food",       "image": "mango"},
        {"word": "peach",  "clue": "Fuzzy, pale skin that feels like a cold cheek. Inside lies a hard, wrinkled heart.", "category": "food",       "image": "peach"},
        {"word": "onion",  "clue": "Layer upon layer of paper-thin skin. It makes you cry as you peel away its secrets.", "category": "food",       "image": "onion"},
        # Nature
        {"word": "cloud",  "clue": "Dark shapes gathering in the sky, blotting out the sun and choking the light.", "category": "nature",     "image": "clouds"},
        {"word": "flame",  "clue": "A flickering orange tongue that consumes everything it touches, leaving only cold ashes.", "category": "nature",     "image": "flame fire"},
        {"word": "ocean",  "clue": "A cold, pitch-black abyss containing secrets that should never be brought to light.", "category": "nature",     "image": "ocean"},
        {"word": "river",  "clue": "A flowing stream that carries debris, dirt, and sometimes things that no longer breathe.", "category": "nature",     "image": "river"},
        {"word": "beach",  "clue": "A sandy shore where the cold water repeatedly spits out fragments of the forgotten.", "category": "nature",     "image": "beach"},
        {"word": "storm",  "clue": "A violent sky screaming with thunder and lightning. It washes away the footprints of the living.", "category": "nature",     "image": "storm"},
        {"word": "snow",   "clue": "Frozen white crystals that fall silently, covering the frozen faces buried beneath.", "category": "nature",     "image": "snow"},
        # Everyday / Music / Science
        {"word": "chair",  "clue": "It sits empty in the corner of your room. Sometimes, you hear it creak in the middle of the night.", "category": "everyday",   "image": "chair"},
        {"word": "piano",  "clue": "A large instrument. It plays a slow, sad tune by itself when the house is completely dark.", "category": "music",      "image": "piano"},
        {"word": "heart",  "clue": "A wet, muscular organ that pumps hot blood. It beats faster when you think someone is behind you.", "category": "science",    "image": "heart"},
        {"word": "dream",  "clue": "Vivid stories your mind creates while you sleep. But lately, they have all been nightmares you cannot wake from.", "category": "everyday",   "image": "dream night"},
        {"word": "ghost",  "clue": "A cold presence that stands at the foot of your bed, watching you sleep with hollow eyes.", "category": "mythology",  "image": "ghost haunted"},
        {"word": "light",  "clue": "A fading spark that keeps the shadows at bay. Pray that it does not flicker out.", "category": "science",    "image": "light rays"},
        {"word": "money",  "clue": "Cold, dirty coins. Men have killed for it, and the dead still grip it tightly in their graves.", "category": "everyday",   "image": "coins money"},
        {"word": "music",  "clue": "A haunting melody that drifts from the radio. It sounds like a funeral dirge.", "category": "music",      "image": "music"},
    ],
    "medium": [
        # Animals
        {"word": "monkey",  "clue": "A clever primate. It sits in the shadows, mimicking your movements and laughing silently.", "category": "animals",    "image": "monkey"},
        {"word": "parrot",  "clue": "A colourful bird that repeats words it heard. It keeps repeating: 'Help me, it's in here.'", "category": "animals",    "image": "parrot"},
        {"word": "rabbit",  "clue": "A soft animal that hops. Sometimes it leaves small, bloody footprints on your porch.", "category": "animals",    "image": "rabbit"},
        {"word": "turtle",  "clue": "It hides inside its hard shell. It knows that if it comes out, the darkness will swallow it.", "category": "animals",   "image": "turtle"},
        {"word": "lizard",  "clue": "A scaly creature that crawls on the wall. Its eyes are fixed on you, cold and calculating.", "category": "animals",    "image": "lizard"},
        {"word": "falcon",  "clue": "A swift bird of prey. It watches you from high above, waiting for you to stop moving.", "category": "animals", "image": "falcon"},
        {"word": "jaguar",  "clue": "A spotted predator that blends into the leaves. You will not see it until its jaws lock around your neck.", "category": "animals", "image": "jaguar"},
        {"word": "penguin", "clue": "They stand in rows in the freezing dark, staring blankly ahead. They are frozen solid, yet they watch.", "category": "animals",    "image": "penguin"},
        # Food & Drink
        {"word": "cheese",  "clue": "A solid yellow dairy block. Left in the cellar, the rats feast on it alongside the forgotten bone.", "category": "food",       "image": "cheese"},
        {"word": "coffee",  "clue": "A bitter black drink that keeps you awake. You need it. If you sleep, they will get you.", "category": "food",       "image": "coffee"},
        {"word": "orange",  "clue": "A round fruit with a thick skin. Under the peel, the flesh looks like bleeding muscles.", "category": "food",       "image": "orange"},
        {"word": "butter",  "clue": "A soft yellow fat. It melts away like your sanity under the burning heat of terror.", "category": "food",       "image": "butter"},
        {"word": "noodle",  "clue": "Long, pale strings that look like worms squirming on your plate.", "category": "food",       "image": "noodles"},
        {"word": "cookie",  "clue": "A sweet baked treat, left on the table as bait. Do not eat it.", "category": "food",       "image": "cookies"},
        {"word": "pepper",  "clue": "A spicy seasoning. It burns your throat like the smoke of the underworld.", "category": "food",       "image": "pepper vegetable"},
        # Nature & Geography
        {"word": "forest",  "clue": "A dark maze of ancient trees. The branches reach out like claws to grab you as you run.", "category": "nature",     "image": "forest"},
        {"word": "desert",  "clue": "A dry wasteland where the wind whispers the names of those who died of thirst.", "category": "nature",     "image": "desert"},
        {"word": "island",  "clue": "A lonely patch of land surrounded by deep water. There is no escape. Nobody will hear your screams.", "category": "geography",  "image": "island"},
        {"word": "canyon",  "clue": "A deep rocky crevice. If you look down, you can hear voices calling you to jump.", "category": "nature",     "image": "canyon"},
        {"word": "jungle",  "clue": "A humid, choking green hell where the vines writhe like green serpents.", "category": "nature",     "image": "jungle"},
        {"word": "geyser",  "clue": "A boiling pit of water that suddenly bursts from the earth, scalding the flesh off bones.", "category": "nature", "image": "geyser"},
        # Science & Tech
        {"word": "magnet",  "clue": "An object that pulls iron towards it. It pulls the iron nails from your coffin, slowly.", "category": "science",   "image": "magnet"},
        {"word": "planet",  "clue": "A massive sphere orbiting a dying star. On its cold surface, something is crawling.", "category": "science",    "image": "planet"},
        {"word": "rocket",  "clue": "A metal cylinder that burns fuel to escape the earth. But there is nowhere safe in the stars.", "category": "technology", "image": "rocket launch"},
        # History & Culture
        {"word": "castle",  "clue": "A massive stone fortress. In its damp dungeons, the ghosts of the tortured still scream.", "category": "history",    "image": "castle"},
        {"word": "temple",  "clue": "An ancient, ruined temple where blood sacrifices were made to appease angry gods.", "category": "history",    "image": "temple"},
        {"word": "pirate",  "clue": "A ruthless thief of the sea. They sail on ships made of rotting wood, crewed by skeletons.", "category": "history",    "image": "pirate ship"},
        # Music / Art / Everyday
        {"word": "guitar",  "clue": "A six-stringed instrument. Its strings are made of dried gut, and it plays a mournful song.", "category": "music",      "image": "guitar"},
        {"word": "mirror",  "clue": "A polished surface. The person looking back at you has empty, black sockets.", "category": "everyday",   "image": "mirror"},
        {"word": "bridge",  "clue": "A stone structure spanning a deep gorge. Watch your step, the railing is rotting.", "category": "everyday",   "image": "bridge"},
        {"word": "puzzle",  "clue": "A game of fitting pieces. The last piece is missing, and it is made of bone.", "category": "everyday",   "image": "puzzle"},
        {"word": "statue",  "clue": "A stone figure. When you turn your back, you can hear its stone feet scrape against the floor.", "category": "history",    "image": "statue"},
    ],
    "hard": [
        # Animals
        {"word": "crocodile",  "clue": "An ancient predator that waits submerged in dark water. Only its cold, yellow eyes are visible.", "category": "animals",       "image": "crocodile"},
        {"word": "chameleon",  "clue": "It changes its skin to match the background. It is in the room with you right now. Can you see it?", "category": "animals",       "image": "chameleon"},
        {"word": "flamingo",   "clue": "A pink bird that stands on one leg. It stares at you with a bead-like eye, waiting for you to rot.", "category": "animals",       "image": "flamingo"},
        {"word": "porcupine",  "clue": "A beast covered in long, sharp needles. They will pierce your skin if you try to touch the dark.", "category": "animals",       "image": "porcupine"},
        {"word": "platypus",   "clue": "A stitched-together anomaly. A duck's bill, a beaver's tail, and venomous spurs. A cursed creation.", "category": "animals",       "image": "platypus"},
        {"word": "orangutan",  "clue": "A large red ape. It sits in its cage, staring at you with human-like eyes that know too much.", "category": "animals",   "image": "orangutan"},
        # Food & Drink
        {"word": "chocolate",  "clue": "A sweet brown treat. It leaves a bitter taste of arsenic on the back of your tongue.", "category": "food",          "image": "chocolate"},
        {"word": "raspberry",  "clue": "A red berry. When squashed, it stains your fingers like thick, arterial blood.", "category": "food",          "image": "raspberries"},
        {"word": "avocado",    "clue": "A green fruit. Its wrinkled skin hides a large, wooden seed that looks like an old skull.", "category": "food",          "image": "avocado"},
        {"word": "cinnamon",   "clue": "A brown spice. It smells like the dried embalming powder used in ancient tombs.", "category": "food",          "image": "cinnamon spice"},
        {"word": "blueberry",  "clue": "Small, dark blue berries. They look like the swollen eyes of the drowned.", "category": "food",          "image": "blueberries"},
        # Nature
        {"word": "hurricane",  "clue": "A roaring vortex of wind and rain. It tears off roofs and exposes the secrets hidden in the walls.", "category": "nature",        "image": "hurricane storm"},
        {"word": "peninsula",  "clue": "A strip of land stretching into the cold sea, like a finger pointing to a watery grave.", "category": "geography",     "image": "peninsula coastline"},
        {"word": "avalanche",  "clue": "A wall of white snow that rushes down the mountain, burying you in cold, silent darkness.", "category": "nature",        "image": "avalanche mountain"},
        {"word": "stalactite", "clue": "A sharp stone icicle hanging from the ceiling. Pray it does not fall and impale you.", "category": "nature",        "image": "cave stalactite"},
        {"word": "bioluminescence", "clue": "A ghostly green glow in the pitch-black ocean depths. It lures you to the monsters below.", "category": "science",       "image": "bioluminescence ocean"},
        # Science
        {"word": "telescope",  "clue": "You use it to look at the stars. But tonight, something is looking back through the lens.", "category": "science",       "image": "telescope astronomy"},
        {"word": "microscope", "clue": "It reveals tiny creatures. They are crawling in your water, in your food, on your skin.", "category": "science",       "image": "microscope"},
        {"word": "astronomy",  "clue": "The study of the cosmos. The deeper you look, the more you realize the stars are cold and hostile.", "category": "science",       "image": "astronomy stars"},
        {"word": "evolution",  "clue": "The process of adaptation. Some things are evolving in the sewers, and they no longer fear us.", "category": "science",       "image": "evolution nature"},
        # History & Mythology
        {"word": "gladiator",  "clue": "A slave who fought to the death in the arena. The sand is still soaked with their blood.", "category": "history",       "image": "roman colosseum"},
        {"word": "labyrinth",  "clue": "A maze of stone passages. You are lost, and you can hear heavy hooves scraping in the dark.", "category": "mythology",     "image": "maze labyrinth"},
        {"word": "colosseum",  "clue": "A ruined arena. At night, you can hear the phantom screams of thousands cheering for blood.", "category": "history",       "image": "colosseum rome"},
        {"word": "minotaur",   "clue": "A half-bull, half-man monster. It smells your sweat, and it is hungry for flesh.", "category": "mythology",     "image": "bull mythology"},
        {"word": "valkyrie",   "clue": "A shrieking female spirit that hovers over the battlefield, choosing who will die next.", "category": "mythology",     "image": "viking warrior"},
        # Technology
        {"word": "algorithm",  "clue": "A set of calculations. It has learned your patterns, and it is deciding when to turn off the life support.", "category": "technology",    "image": "code computer"},
        {"word": "satellite",  "clue": "A metal orb orbiting the earth. It is watching you through your windows, even in the dark.", "category": "technology",    "image": "satellite space"},
        {"word": "hologram",   "clue": "A light projection. It looks like your deceased loved one, but its voice is distorted and wrong.", "category": "technology",    "image": "hologram light"},
        # Music & Entertainment
        {"word": "orchestra",  "clue": "A group of musicians playing a chaotic symphony. The instruments sound like screaming voices.", "category": "music",         "image": "orchestra concert"},
        {"word": "saxophone",  "clue": "A brass instrument. Its wailing sound mimics the screams of the damned.", "category": "music",         "image": "saxophone jazz"},
        {"word": "animation",  "clue": "Moving drawings. The characters' faces stretch and warp in ways that should be impossible.", "category": "entertainment", "image": "animation film"},
    ],
}

MAX_WRONG     = {"easy": 8, "medium": 6, "hard": 5}
DIFF_MULT     = {"easy": 1.0, "medium": 1.5, "hard": 2.0}
BODY_PARTS    = 6  # always 6 body parts drawn


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/categories")
def categories():
    return jsonify(CATEGORY_META)


@app.route("/api/new-game", methods=["POST"])
def new_game():
    data = request.get_json() or {}
    level = data.get("level", "medium")
    if level not in WORDS:
        level = "medium"

    entry = random.choice(WORDS[level])
    session["word"]  = entry["word"]
    session["clue"]  = entry["clue"]
    session["cat"]   = entry["category"]
    session["image"] = entry["image"]
    session["guessed"] = []
    session["wrong"]   = 0
    session["level"]   = level
    return jsonify(_state())


@app.route("/api/guess", methods=["POST"])
def guess():
    if "word" not in session:
        return jsonify({"error": "No active game"}), 400

    data   = request.get_json() or {}
    letter = data.get("letter", "").lower()
    if not letter or len(letter) != 1 or not letter.isalpha():
        return jsonify({"error": "Invalid"}), 400

    guessed = session["guessed"]
    if letter in guessed:
        return jsonify({"error": "Already guessed"}), 400

    word  = session["word"]
    wrong = session["wrong"]
    guessed.append(letter)
    if letter not in word:
        wrong += 1

    session["guessed"] = guessed
    session["wrong"]   = wrong
    return jsonify(_state())


def _state():
    word    = session["word"]
    guessed = session["guessed"]
    wrong   = session["wrong"]
    level   = session["level"]
    max_w   = MAX_WRONG[level]

    display = [ch if ch in guessed else "_" for ch in word]
    won  = "_" not in display
    lost = wrong >= max_w

    # Score preview (sent so JS can animate it)
    correct_count = sum(1 for ch in display if ch != "_")
    remaining     = max_w - wrong
    score_preview = int((correct_count * 10 + (remaining * 15 if won else 0)) * DIFF_MULT[level])

    return {
        "display":       display,
        "clue":          session["clue"],
        "category":      session["cat"],
        "image":         session["image"],
        "guessed":       guessed,
        "wrong":         wrong,
        "max_wrong":     max_w,
        "level":         level,
        "diff_mult":     DIFF_MULT[level],
        "score_preview": score_preview,
        "won":           won,
        "lost":          lost,
        "word":          word if (won or lost) else None,
    }


@app.route("/api/cat-images")
def cat_images():
    """Return N random image URLs for a category (allows repeats if not enough)."""
    category = request.args.get("cat", "nature").strip()
    count    = min(int(request.args.get("n", 3)), 20)
    os.makedirs(IMAGES_DIR, exist_ok=True)
    matches = [
        f for f in os.listdir(IMAGES_DIR)
        if f.lower().startswith(category) and
           f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]
    if not matches:
        return jsonify({"urls": []})
    # Use distinct images where possible, then allow repeats if not enough
    if len(matches) >= count:
        chosen = random.sample(matches, count)
    else:
        chosen = random.sample(matches, len(matches))
        while len(chosen) < count:
            chosen.append(random.choice(matches))
    urls = [f"/static/images/{f}" for f in chosen]
    return jsonify({"urls": urls})


@app.route("/api/cat-image")
def cat_image():
    """Return a random available background image URL for a category."""
    category = request.args.get("cat", "nature").strip()
    os.makedirs(IMAGES_DIR, exist_ok=True)

    # Collect all files that start with the category name
    matches = []
    for fname in os.listdir(IMAGES_DIR):
        lower = fname.lower()
        # Match: animals.jpg  animals_1.jpg  animals_2.jpg  animals-dark.jpg  etc.
        if lower.startswith(category) and lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
            matches.append(fname)

    if matches:
        chosen = random.choice(matches)
        return jsonify({"url": f"/static/images/{chosen}"})
    return jsonify({"url": None})


@app.route("/api/load-bg")
def load_bg():
    """Fetch and cache a word-specific Wikipedia image, return its local URL."""
    keyword  = request.args.get("q",   "").strip()[:60]
    category = request.args.get("cat", "nature").strip()

    os.makedirs(IMAGES_DIR, exist_ok=True)

    # Build a safe filename from the keyword
    safe = re.sub(r"[^a-z0-9]", "_", keyword.lower())
    word_path = os.path.join(IMAGES_DIR, f"w_{safe}.jpg")

    # Already cached?
    if os.path.exists(word_path):
        return jsonify({"url": f"/static/images/w_{safe}.jpg"})

    # First word of the keyword is the best Wikipedia query
    wiki_query = keyword.split()[0] if keyword else category
    img_url = _wiki_image_url(wiki_query)

    if img_url and _download(img_url, word_path):
        return jsonify({"url": f"/static/images/w_{safe}.jpg"})

    # Fall back to the category image (pre-downloaded by main.py)
    cat_file = f"{category}.jpg"
    cat_path = os.path.join(IMAGES_DIR, cat_file)
    if os.path.exists(cat_path):
        return jsonify({"url": f"/static/images/{cat_file}"})

    return jsonify({"url": None})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    default = {"highScore": 0, "totalWins": 0, "totalGames": 0,
               "bestStreak": 0, "currentStreak": 0}
    if not MONGO_OK:
        return jsonify(default)
    doc = _stats_col.find_one({"_id": _PLAYER}) or {}
    doc.pop("_id", None)
    return jsonify({**default, **doc})


@app.route("/api/stats", methods=["POST"])
def save_stats():
    if not MONGO_OK:
        return jsonify({"ok": False, "error": "MongoDB not available"})
    data = request.get_json() or {}
    _stats_col.update_one(
        {"_id": _PLAYER},
        {"$set": {
            "highScore":     int(data.get("highScore",     0)),
            "totalWins":     int(data.get("totalWins",     0)),
            "totalGames":    int(data.get("totalGames",    0)),
            "bestStreak":    int(data.get("bestStreak",    0)),
            "currentStreak": int(data.get("currentStreak", 0)),
        }},
        upsert=True,
    )
    return jsonify({"ok": True})


@app.route("/api/images-ready")
def images_ready():
    """Return which category images have been downloaded."""
    os.makedirs(IMAGES_DIR, exist_ok=True)
    cats = [
        "animals","food","nature","science","geography",
        "music","history","technology","entertainment",
        "everyday","mythology","sports",
    ]
    ready = {c: os.path.exists(os.path.join(IMAGES_DIR, f"{c}.jpg")) for c in cats}
    return jsonify(ready)


if __name__ == "__main__":
    app.run(debug=True)
