#!/usr/bin/env python3
"""
Doug's List — weekly dinner planner for the Raspberry Pi.

Run by cron every Sunday morning. It:
  1. signs in to the app's Firebase project (anonymously, like the app does),
  2. reads your recipes and last week's plan,
  3. asks Claude (Haiku) to pick this week's dinners, the same way the app does,
  4. saves the plan to app/mbSettings.mealPlan with apply=true
     (the app puts the meals on the Market Basket list the next time it opens),
  5. sends a notification to your phone through ntfy.

Only the Python standard library is used — nothing to pip install.

Settings come from planner.env next to this file:
  ANTHROPIC_API_KEY=sk-ant-...
  NTFY_TOPIC=dougslist-xxxxxxxx        (the topic you subscribed to in the ntfy app)
  NTFY_SERVER=https://ntfy.sh          (optional)
  APP_URL=https://dougslist.taptheash.us (optional, opened when you tap the notification)

Usage:
  python3 plan_week.py            plan this week if it isn't planned yet
  python3 plan_week.py --dry-run  show what it would pick; change nothing, send nothing
  python3 plan_week.py --force    re-plan even if this week already has a plan
"""

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

# The app's public Firebase web config (same values as src/firebase.js; not a secret).
FIREBASE_API_KEY = "AIzaSyAI7q0TX9kC9YSGxbmsRyfoYu2QOwof4lo"
PROJECT_ID = "dougs-cookbook"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents"
MODEL = "claude-haiku-5-5"

HOUSEHOLD = """- Cooks often in cast iron (skillets and a Dutch oven).
- Leans toward high-protein, lower-glycemic meals, but these are preferences, not strict rules.
- Doesn't want kale or cauliflower stand-ins (cauliflower rice, cauliflower crust, etc.).
- Shops mostly at Market Basket in New Hampshire; everyday supermarket ingredients are best."""

HERE = os.path.dirname(os.path.abspath(__file__))


# ── small helpers ──────────────────────────────────────────────────────────

def load_env(path):
    env = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http(method, url, body=None, headers=None):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if body is not None and not isinstance(body, bytes):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"{method} {url.split('?')[0]} -> {e.code}: {detail}") from None


def from_fs(v):
    """Firestore REST value -> Python."""
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return v["doubleValue"]
    if "booleanValue" in v: return v["booleanValue"]
    if "nullValue" in v: return None
    if "timestampValue" in v: return v["timestampValue"]
    if "arrayValue" in v: return [from_fs(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: from_fs(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def to_fs(x):
    """Python -> Firestore REST value."""
    if x is None: return {"nullValue": None}
    if isinstance(x, bool): return {"booleanValue": x}
    if isinstance(x, int): return {"integerValue": str(x)}
    if isinstance(x, float): return {"doubleValue": x}
    if isinstance(x, str): return {"stringValue": x}
    if isinstance(x, (list, tuple)): return {"arrayValue": {"values": [to_fs(i) for i in x]}}
    if isinstance(x, dict): return {"mapValue": {"fields": {k: to_fs(v) for k, v in x.items()}}}
    return {"stringValue": str(x)}


def week_start(today=None):
    """Sunday that starts this week, as YYYY-MM-DD (matches the app)."""
    d = today or dt.date.today()
    return (d - dt.timedelta(days=(d.weekday() + 1) % 7)).isoformat()


# ── Firebase ───────────────────────────────────────────────────────────────

def sign_in():
    r = http("POST", f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_API_KEY}",
             {"returnSecureToken": True})
    return r["idToken"]


def get_doc(token, path):
    try:
        r = http("GET", f"{FS}/{path}", headers={"Authorization": f"Bearer {token}"})
    except RuntimeError as e:
        if "-> 404" in str(e):
            return {}
        raise
    return {k: from_fs(v) for k, v in r.get("fields", {}).items()}


def list_recipes(token):
    out, page = [], None
    while True:
        url = f"{FS}/recipes?pageSize=300" + (f"&pageToken={page}" if page else "")
        r = http("GET", url, headers={"Authorization": f"Bearer {token}"})
        for d in r.get("documents", []):
            fields = {k: from_fs(v) for k, v in d.get("fields", {}).items()}
            fields["id"] = d["name"].rsplit("/", 1)[-1]
            out.append(fields)
        page = r.get("nextPageToken")
        if not page:
            return out


def save_plan(token, plan):
    http("PATCH", f"{FS}/app/mbSettings?updateMask.fieldPaths=mealPlan",
         {"fields": {"mealPlan": to_fs(plan)}},
         headers={"Authorization": f"Bearer {token}"})


# ── Claude ─────────────────────────────────────────────────────────────────

def pick_meals(api_key, recipes, count, recent):
    pool = [{
        "id": r["id"], "title": r.get("title", ""),
        "categories": r.get("categories") or [r.get("category", "Other")],
        "rating": r.get("rating", 0) or 0, "favorite": bool(r.get("favorite")),
        "ingredients": (r.get("ingredients") or [])[:8],
    } for r in recipes]
    tool = {
        "name": "pick_meals",
        "description": "The chosen dinners, best first.",
        "input_schema": {"type": "object", "properties": {"meals": {"type": "array", "items": {
            "type": "object",
            "properties": {"id": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["id", "reason"]}}}, "required": ["meals"]},
    }
    system = (
        "You plan weeknight dinners for a household from their saved recipes. Pick main dishes "
        "(not desserts, drinks, sides or sauces on their own). Favor recipes they rated 4-5 stars and "
        "favorites, but mix in others for variety. Vary the main protein and style across the picks, and "
        "avoid anything they had in recent weeks. Keep it practical for weeknights. Each reason is under "
        "12 words.\n\nAbout this household:\n" + HOUSEHOLD +
        "\n\nAlways respond by calling the pick_meals tool."
    )
    content = f"Pick {count} dinner{'s' if count > 1 else ''}."
    if recent:
        content += "\nHad recently (avoid): " + "; ".join(recent[-20:])
    content += "\n\nSaved recipes:\n" + json.dumps(pool)
    r = http("POST", "https://api.anthropic.com/v1/messages", {
        "model": MODEL, "max_tokens": 1500, "system": system,
        "tools": [tool], "tool_choice": {"type": "auto"},
        "messages": [{"role": "user", "content": content}],
    }, headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"})
    call = next((b for b in r.get("content", []) if b.get("type") == "tool_use"), None)
    ids = {p["id"] for p in pool}
    seen, meals = set(), []
    for m in (call or {}).get("input", {}).get("meals", []):
        if m.get("id") in ids and m["id"] not in seen:
            seen.add(m["id"])
            meals.append({"id": m["id"], "reason": str(m.get("reason", ""))[:120]})
    return meals[:count]


# ── ntfy ───────────────────────────────────────────────────────────────────

def notify(env, title, message):
    topic = env.get("NTFY_TOPIC")
    if not topic:
        print("(no NTFY_TOPIC set — skipping notification)")
        return
    server = env.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    url = env.get("APP_URL", "https://dougslist.taptheash.us")
    req = urllib.request.Request(f"{server}/{topic}", data=message.encode(), method="POST", headers={
        "Title": title.encode("ascii", "ignore").decode(), "Tags": "fork_and_knife", "Click": url,
    })
    urllib.request.urlopen(req, timeout=30).read()


# ── main ───────────────────────────────────────────────────────────────────

def main():
    dry = "--dry-run" in sys.argv
    force = "--force" in sys.argv
    env = {**load_env(os.path.join(HERE, "planner.env")), **{k: v for k, v in os.environ.items() if k in ("ANTHROPIC_API_KEY", "NTFY_TOPIC", "NTFY_SERVER", "APP_URL")}}
    api_key = env.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Missing ANTHROPIC_API_KEY — put it in planner.env next to this script.")

    token = sign_in()
    settings_doc = get_doc(token, "app/mbSettings")
    plan_settings = settings_doc.get("planSettings") or {}
    if plan_settings.get("on") is False and not force:
        print("Automatic planning is turned off in the app. Nothing to do.")
        return
    count = max(1, min(7, int(plan_settings.get("count") or 2)))
    prev = settings_doc.get("mealPlan") or {}
    this_week = week_start()
    if prev.get("weekOf") == this_week and not force:
        print(f"This week ({this_week}) is already planned. Use --force to re-plan.")
        return

    recipes = list_recipes(token)
    if len(recipes) < 3:
        sys.exit("Fewer than 3 recipes saved — nothing sensible to plan from.")
    history = (list(prev.get("history") or []) + [m.get("title", "") for m in prev.get("meals") or []])[-16:]

    picks = pick_meals(api_key, recipes, count, history)
    if not picks:
        sys.exit("Claude didn't return any picks. Try again later.")
    by_id = {r["id"]: r for r in recipes}
    meals = [{"id": p["id"], "title": by_id[p["id"]].get("title", ""), "reason": p["reason"]} for p in picks]

    print(f"Week of {this_week}:")
    for m in meals:
        print(f"  - {m['title']}  ({m['reason']})")
    if dry:
        print("(dry run — nothing saved, no notification)")
        return

    planner_prev = [m["id"] for m in prev.get("meals") or [] if not m.get("mine")]
    save_plan(token, {
        "weekOf": this_week, "meals": meals, "skipped": [], "history": history,
        "madeAt": int(dt.datetime.now().timestamp() * 1000), "fresh": True,
        "apply": True, "prevPlanned": planner_prev, "by": "pi",
    })
    notify(env, "This week's dinners are ready",
           "\n".join("• " + m["title"] for m in meals) + "\nTap to open Doug's List — uncheck one to swap it.")
    print("Saved and notified.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        msg = str(e)
        if "PERMISSION_DENIED" in msg or "-> 403" in msg:
            msg += "\nFirestore refused the request. Your Firestore rules need to allow signed-in (anonymous) users, like the app."
        sys.exit("Error: " + msg)
