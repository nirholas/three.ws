"""Prompt -> semantic class, physical material and real-world size.

A Forge model arrives as a GLB plus the words someone typed. A simulator needs
three things the mesh cannot say about itself: what the object is (the semantic
class label Isaac Sim and Replicator segment by), how big it really is
(generative lanes fit everything into a one or two unit box), and how heavy it
is (mass = volume x density, so density has to come from somewhere).

This module answers all three from the prompt, deterministically, with a
keyword table. The earliest phrase in the prompt that names a known object
wins, because prompts lead with the head noun ("upholstered dining chair, dark
wood frame" is a chair, not wood). When nothing matches, the creation's stored
`model_category` decides, and when that is absent too the asset is a generic
object at its native size.

Densities are EFFECTIVE bulk densities in kg/m^3: the mass of the real object
divided by the volume its closed outer surface encloses. A car is a steel shell
around air, so its effective density is ~150, not steel's 7850; a sword is
solid metal, so it is close to steel. Every value is recorded in the exported
asset's metadata (`threews:physics`) next to the method, so a downstream user
can see exactly where a mass came from and override it.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Optional


@dataclass(frozen=True)
class ObjectClass:
    label: str            # semantic class label, e.g. "chair"
    group: str            # coarser category, e.g. "furniture"
    material: str         # human-readable material, e.g. "wood"
    density: float        # effective bulk density, kg/m^3
    size_m: Optional[float]  # typical longest dimension in meters; None keeps native size
    static_friction: float = 0.6
    dynamic_friction: float = 0.5
    restitution: float = 0.1
    static_body: bool = False  # True: a collider with no rigid body (buildings, trees, terrain)

    def to_dict(self) -> dict:
        return asdict(self)


def _c(label, group, material, density, size_m, sf=0.6, df=0.5, rest=0.1, static=False):
    return ObjectClass(label, group, material, float(density), size_m, sf, df, rest, static)


# keyword phrases -> class. Order inside one entry does not matter; matching is
# by earliest position in the prompt across all entries, longest phrase first
# at a tie.
_TABLE: list[tuple[tuple[str, ...], ObjectClass]] = [
    # furniture
    (("chair", "armchair", "stool", "throne", "bench"), _c("chair", "furniture", "wood", 500, 0.95)),
    (("sofa", "couch", "loveseat"), _c("sofa", "furniture", "upholstered wood", 250, 2.0, 0.8, 0.7, 0.05)),
    (("table", "desk", "workbench"), _c("table", "furniture", "wood", 600, 1.4)),
    (("bed",), _c("bed", "furniture", "upholstered wood", 200, 2.1, 0.8, 0.7, 0.05)),
    (("bookcase", "bookshelf", "shelf", "cabinet", "wardrobe", "dresser", "cupboard"),
     _c("cabinet", "furniture", "wood", 400, 1.8)),
    (("lamp", "lantern", "chandelier"), _c("lamp", "lighting", "metal and glass", 900, 0.6, 0.5, 0.4, 0.1)),
    # containers and tableware
    (("vase", "urn", "amphora"), _c("vase", "container", "ceramic", 900, 0.35, 0.7, 0.6, 0.05)),
    (("mug", "cup", "teacup", "goblet", "glass"), _c("cup", "tableware", "ceramic", 900, 0.11, 0.7, 0.6, 0.05)),
    (("bottle", "flask", "jar"), _c("bottle", "container", "glass", 500, 0.28, 0.6, 0.5, 0.05)),
    (("bowl", "plate", "dish"), _c("bowl", "tableware", "ceramic", 900, 0.22, 0.7, 0.6, 0.05)),
    (("teapot", "kettle", "pot", "pan"), _c("pot", "kitchenware", "metal", 700, 0.3, 0.5, 0.4, 0.1)),
    (("box", "crate", "chest", "case"), _c("box", "container", "wood", 300, 0.6)),
    (("barrel", "keg", "bucket"), _c("barrel", "container", "wood", 250, 0.9)),
    (("bag", "backpack", "handbag", "purse", "suitcase", "luggage"),
     _c("bag", "accessory", "fabric", 200, 0.5, 0.8, 0.7, 0.05)),
    # vehicles
    (("car", "truck", "van", "jeep", "suv", "taxi", "racecar", "sedan", "pickup"),
     _c("car", "vehicle", "steel shell", 150, 4.5, 0.9, 0.8, 0.1)),
    # Open-frame small vehicles: about 1.8 m long, ~90 kg over the volume of their convex hulls.
    (("go-kart", "go kart", "gokart", "kart", "buggy", "dune buggy", "atv", "quad bike", "golf cart"),
     _c("kart", "vehicle", "steel frame", 180, 1.8, 0.9, 0.8, 0.1)),
    (("bus", "tram", "train", "locomotive"), _c("bus", "vehicle", "steel shell", 120, 12.0, 0.9, 0.8, 0.1)),
    (("motorcycle", "motorbike", "scooter"), _c("motorcycle", "vehicle", "steel", 300, 2.1, 0.9, 0.8, 0.1)),
    (("bicycle", "bike"), _c("bicycle", "vehicle", "aluminium", 150, 1.75, 0.8, 0.7, 0.1)),
    (("boat", "ship", "yacht", "canoe", "kayak"), _c("boat", "vehicle", "hull shell", 150, 6.0)),
    (("airplane", "aeroplane", "plane", "jet", "aircraft", "helicopter"),
     _c("aircraft", "vehicle", "aluminium shell", 60, 12.0)),
    (("spaceship", "spacecraft", "rocket", "starship"), _c("spacecraft", "vehicle", "metal shell", 80, 10.0)),
    (("drone", "quadcopter"), _c("drone", "vehicle", "plastic", 300, 0.4)),
    (("tank",), _c("tank", "vehicle", "steel", 1500, 7.0, 0.9, 0.8, 0.05)),
    # electronics and devices
    (("headphones", "headphone", "headset", "earbuds", "earphones"),
     _c("headphones", "electronics", "plastic", 500, 0.2, 0.7, 0.6, 0.1)),
    (("phone", "smartphone", "iphone"), _c("phone", "electronics", "glass and aluminium", 1300, 0.15, 0.5, 0.4, 0.1)),
    (("laptop", "notebook"), _c("laptop", "electronics", "aluminium", 1100, 0.35)),
    (("monitor", "television", "tv", "screen", "computer"), _c("monitor", "electronics", "plastic and glass", 600, 0.8)),
    (("keyboard",), _c("keyboard", "electronics", "plastic", 700, 0.45)),
    (("camera",), _c("camera", "electronics", "metal and plastic", 900, 0.14)),
    (("speaker", "radio", "boombox"), _c("speaker", "electronics", "plastic", 600, 0.3)),
    (("controller", "gamepad", "joystick", "console"), _c("game controller", "electronics", "plastic", 900, 0.16)),
    (("robot", "android", "mech", "cyborg"), _c("robot", "machine", "metal", 900, 1.5)),
    (("core", "device", "gadget", "machine", "engine", "generator", "reactor", "sensor"),
     _c("device", "machine", "metal and plastic", 800, 0.4)),
    # wearables
    (("sneaker", "sneakers", "shoe", "shoes", "boot", "boots", "sandal", "sandals", "heels"),
     _c("shoe", "footwear", "rubber and fabric", 400, 0.3, 0.9, 0.8, 0.2)),
    (("helmet",), _c("helmet", "headwear", "plastic", 350, 0.3)),
    (("hat", "cap", "crown"), _c("hat", "headwear", "fabric", 250, 0.3)),
    (("glasses", "sunglasses", "goggles"), _c("glasses", "accessory", "plastic", 900, 0.15)),
    (("watch", "ring", "necklace", "bracelet", "amulet"), _c("jewelry", "accessory", "metal", 3000, 0.05)),
    (("jacket", "shirt", "dress", "coat", "hoodie", "gown"), _c("garment", "apparel", "fabric", 150, 0.8, 0.9, 0.8, 0.0)),
    # tools and gear
    (("shield",), _c("shield", "equipment", "wood and metal", 700, 0.9)),
    (("sword", "blade", "katana", "dagger", "knife", "spear"), _c("sword", "equipment", "steel", 7800, 1.0, 0.4, 0.3, 0.2)),
    (("axe", "hammer", "mallet", "pickaxe"), _c("hammer", "tool", "steel and wood", 2500, 0.6, 0.5, 0.4, 0.2)),
    (("wrench", "screwdriver", "pliers", "tool", "drill", "saw"), _c("tool", "tool", "steel", 4000, 0.3, 0.5, 0.4, 0.2)),
    (("gun", "blaster", "pistol", "rifle"), _c("gun", "equipment", "metal and polymer", 1500, 0.8)),
    (("staff", "wand", "cane", "rod"), _c("staff", "equipment", "wood", 700, 1.5)),
    (("guitar", "violin", "piano", "drum", "trumpet", "instrument"), _c("musical instrument", "instrument", "wood", 400, 1.0)),
    (("book", "notebook", "journal", "scroll"), _c("book", "stationery", "paper", 700, 0.24)),
    (("ball", "football", "basketball", "soccer"), _c("ball", "sports", "rubber shell", 100, 0.22, 0.8, 0.7, 0.7)),
    (("toy", "plush", "teddy", "doll", "figurine", "action figure"), _c("toy", "toy", "plastic", 300, 0.3, 0.8, 0.7, 0.3)),
    # nature
    (("tree", "palm"), _c("tree", "plant", "wood", 500, 5.0, 0.8, 0.7, 0.05, True)),
    (("plant", "flower", "bush", "cactus", "bonsai", "succulent"), _c("plant", "plant", "soil and foliage", 400, 0.6)),
    (("rock", "stone", "boulder", "pebble"), _c("rock", "nature", "stone", 2600, 0.5, 0.8, 0.7, 0.05)),
    (("crystal", "gem", "diamond", "gemstone"), _c("crystal", "nature", "quartz", 2650, 0.1, 0.4, 0.3, 0.2)),
    (("mushroom",), _c("mushroom", "plant", "organic", 400, 0.15)),
    # food
    (("apple", "orange", "banana", "fruit", "pear", "lemon"), _c("fruit", "food", "organic", 900, 0.08, 0.7, 0.6, 0.2)),
    (("burger", "sandwich", "pizza", "cake", "donut", "bread", "cookie"),
     _c("food", "food", "organic", 500, 0.2, 0.8, 0.7, 0.05)),
    # creatures
    (("duck", "bird", "chicken", "owl", "parrot", "penguin"), _c("bird", "animal", "organic", 950, 0.4, 0.8, 0.7, 0.1)),
    (("dog", "puppy", "wolf", "fox"), _c("dog", "animal", "organic", 985, 0.8, 0.8, 0.7, 0.1)),
    (("cat", "kitten", "tiger", "lion"), _c("cat", "animal", "organic", 985, 0.5, 0.8, 0.7, 0.1)),
    (("horse", "pony", "unicorn", "deer"), _c("horse", "animal", "organic", 985, 2.4, 0.8, 0.7, 0.1)),
    (("squirrel", "rabbit", "bunny", "mouse", "hamster", "rat"), _c("rodent", "animal", "organic", 985, 0.4, 0.8, 0.7, 0.1)),
    (("fish", "shark", "whale", "dolphin"), _c("fish", "animal", "organic", 1000, 0.5, 0.6, 0.5, 0.1)),
    (("dragon", "dinosaur", "monster"), _c("creature", "animal", "organic", 985, 6.0, 0.8, 0.7, 0.1)),
    (("frog", "turtle", "lizard", "snake"), _c("reptile", "animal", "organic", 1000, 0.3, 0.8, 0.7, 0.1)),
    # people
    (("person", "man", "woman", "boy", "girl", "human", "character", "avatar", "knight", "warrior",
      "wizard", "witch", "elf", "dwarf", "soldier", "astronaut", "hero", "heroine", "princess", "prince",
      "king", "queen", "student", "graduate", "chef", "doctor", "pirate", "ninja", "samurai", "druid"),
     _c("person", "character", "organic", 985, 1.75, 0.8, 0.7, 0.05)),
    # architecture
    (("house", "building", "tower", "castle", "cabin", "shop", "temple", "church", "skyscraper"),
     _c("building", "architecture", "masonry", 300, 8.0, 0.8, 0.7, 0.05, True)),
    (("terrain", "landscape", "island", "mountain", "diorama", "room", "scene"),
     _c("environment", "environment", "mixed", 1500, None, 0.8, 0.7, 0.05, True)),
]

# Fallbacks keyed by the forge creation's stored model_category.
_CATEGORY_FALLBACK: dict[str, ObjectClass] = {
    "avatar": _c("person", "character", "organic", 985, 1.75, 0.8, 0.7, 0.05),
    "creature": _c("creature", "animal", "organic", 985, 1.0, 0.8, 0.7, 0.1),
    "vehicle": _c("vehicle", "vehicle", "steel shell", 150, 4.5, 0.9, 0.8, 0.1),
    "accessory": _c("accessory", "accessory", "mixed", 600, 0.3),
    "scene": _c("environment", "environment", "mixed", 1500, None, 0.8, 0.7, 0.05, True),
}
GENERIC = _c("object", "object", "mixed", 700, None)

# Prompts that are a pipeline marker rather than words a person typed.
_PIPELINE_PROMPTS = {"auto-rig", "image-to-3d", "text-to-3d", "rig", "upload"}


def _phrase_patterns():
    pats = []
    for phrases, cls in _TABLE:
        for phrase in phrases:
            # Whole words, optional plural suffix, so "chairs" and "boxes" match.
            words = r"\s+".join(re.escape(w) for w in phrase.split())
            pats.append((re.compile(rf"\b{words}(?:s|es)?\b"), len(phrase), cls))
    return pats


_PATTERNS = _phrase_patterns()


@dataclass(frozen=True)
class Classification:
    cls: ObjectClass
    source: str            # "prompt", "category" or "default"
    matched: Optional[str]  # the phrase that decided it

    def to_dict(self) -> dict:
        return {"source": self.source, "matched": self.matched, **self.cls.to_dict()}


# Clause boundaries: punctuation and the prepositions that start a modifier
# phrase ("chair with armrests", "sneakers in black", "shield inspired by").
_CLAUSE_SPLIT = re.compile(r"[,;:.!?()\n]|\b(?:with|in|on|for|from|of|by|featuring|made|and|that|which)\b")


def _head_match(text: str):
    """The class of the noun phrase's head word.

    The first clause that names any known object decides, and inside it the
    last match wins: English puts the head noun last ("basketball sneakers" is
    footwear, "dining chair" is a chair), while later clauses only describe it.
    Longer phrases win ties at the same position.
    """
    pos = 0
    for m in list(_CLAUSE_SPLIT.finditer(text)) + [None]:
        end = m.start() if m else len(text)
        clause = text[pos:end]
        best = None
        for pat, length, cls in _PATTERNS:
            for hit in pat.finditer(clause):
                key = (hit.end(), length)
                if best is None or key > best[0]:
                    best = (key, cls, hit.group(0))
        if best is not None:
            return best
        pos = m.end() if m else len(text)
    return None


def classify(prompt: Optional[str], category: Optional[str] = None, *, rigged: bool = False) -> Classification:
    """Pick the object class for a prompt (and stored category) deterministically."""
    text = (prompt or "").strip().lower()
    best = None
    if text and text not in _PIPELINE_PROMPTS:
        best = _head_match(text)
    if best is not None:
        result = Classification(best[1], "prompt", best[2])
    elif category and category.lower() in _CATEGORY_FALLBACK:
        result = Classification(_CATEGORY_FALLBACK[category.lower()], "category", category.lower())
    else:
        result = Classification(GENERIC, "default", None)

    # A skinned mesh is a character or a creature whatever the words said: the
    # rig worker only rigs bodies, and an animated body is never a static prop.
    if rigged and result.cls.group not in ("character", "animal"):
        result = Classification(_CATEGORY_FALLBACK["avatar"], "rig", "skinned mesh")
    return result


def asset_name(prompt: Optional[str], label: str) -> str:
    """A valid USD prim identifier for the asset's root prim, from the prompt."""
    text = (prompt or "").strip().lower()
    if not text or text in _PIPELINE_PROMPTS:
        text = label
    words = re.findall(r"[a-z0-9]+", text)[:6] or ["model"]
    name = "".join(w.capitalize() for w in words)
    if name[0].isdigit():
        name = "Asset" + name
    return name[:64]
