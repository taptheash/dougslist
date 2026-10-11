// Alexa custom skill endpoint — POST /api/alexa/<ALEXA_PATH_SECRET>
//
// "Alexa, tell Doug's List to add milk"                  -> Market Basket
// "Alexa, tell Doug's List to add two light bulbs to Lowe's"
// "Alexa, tell Doug's List to remove eggs from Market Basket"
// "Alexa, ask Doug's List what's on Target"
//
// Writes Firestore through the REST API using the same anonymous sign-in the
// web app uses, so it is allowed by the same security rules. Items are written
// in exactly the shapes App.jsx writes them, so they show up live in the app.
//
// Every failure is spoken back (briefly) instead of failing silently, and
// logged — view logs with `npx wrangler tail`.

import { classifyTarget, classifyLowes, toShoppingText } from "../../src/config.js";

const PROJECT_ID = "dougs-cookbook";
const FIREBASE_API_KEY = "AIzaSyAI7q0TX9kC9YSGxbmsRyfoYu2QOwof4lo"; // same public key as src/firebase.js
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/* ── Entry point ─────────────────────────────────────────────────────────── */

export async function onRequestAlexa({ request, env }) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","alexa",secret,(health)]
  const secret = parts[2] || "";

  if (!env.ALEXA_PATH_SECRET || secret !== env.ALEXA_PATH_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  // Stage-1/2 test hook: GET /api/alexa/<secret>/health proves the Worker can
  // sign in and read Firestore, without involving Alexa at all.
  if (request.method === "GET" && parts[3] === "health") {
    try {
      const stores = await loadStores();
      return json({ ok: true, stores: stores.map((s) => s.name) });
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Only answer our own skill, and only fresh requests.
  const appId =
    body?.context?.System?.application?.applicationId || body?.session?.application?.applicationId;
  if (env.ALEXA_SKILL_ID && appId !== env.ALEXA_SKILL_ID) {
    console.error("alexa: wrong skill id", appId);
    return new Response("Forbidden", { status: 403 });
  }
  const ts = Date.parse(body?.request?.timestamp || "");
  if (!ts || Math.abs(Date.now() - ts) > 150_000) {
    console.error("alexa: stale or missing timestamp", body?.request?.timestamp);
    return new Response("Forbidden", { status: 403 });
  }

  try {
    return json(await handle(body.request));
  } catch (err) {
    console.error("alexa: handler failed", err?.stack || err);
    return json(say("Sorry, something went wrong. " + shortError(err)));
  }
}

/* ── Request routing ─────────────────────────────────────────────────────── */

async function handle(req) {
  if (req.type === "LaunchRequest") {
    return say("Doug's List here. What should I add?", { keepOpen: true, reprompt: "Try: add milk." });
  }
  if (req.type === "SessionEndedRequest") return { version: "1.0", response: {} };
  if (req.type !== "IntentRequest") return say("Sorry, I didn't get that.");

  const intent = req.intent || {};
  const itemRaw = slotValue(intent, "item");
  const storeSlot = intent.slots?.store;

  switch (intent.name) {
    case "AddItemIntent": {
      if (!itemRaw) return say("Tell me what to add. For example: add milk to Market Basket.");
      const store = await pickStore(storeSlot);
      if (store.error) return say(store.error);
      return say(await addItem(store, itemRaw));
    }
    case "RemoveItemIntent": {
      if (!itemRaw) return say("Tell me what to remove. For example: remove eggs from Market Basket.");
      const store = await pickStore(storeSlot);
      if (store.error) return say(store.error);
      return say(await removeItem(store, itemRaw));
    }
    case "ReadListIntent": {
      const store = await pickStore(storeSlot);
      if (store.error) return say(store.error);
      return say(await readList(store));
    }
    case "AMAZON.HelpIntent":
      return say(
        "You can say: add milk, add light bulbs to Lowe's, remove eggs, or what's on Target. What would you like?",
        { keepOpen: true, reprompt: "What would you like to add?" }
      );
    case "AMAZON.StopIntent":
    case "AMAZON.CancelIntent":
    case "AMAZON.NavigateHomeIntent":
      return say("Okay.");
    case "AMAZON.FallbackIntent":
    default:
      return say("Sorry, I didn't catch that. Try: add milk to Market Basket.");
  }
}

/* ── Stores ──────────────────────────────────────────────────────────────── */

const BUILTIN = [
  { id: "mb", kind: "mb", name: "Market Basket", aliases: ["market basket", "market", "grocery", "groceries", "grocery store", "supermarket", "food"] },
  { id: "target", kind: "target", name: "Target", aliases: ["target"] },
  { id: "lowes", kind: "lowes", name: "Lowe's", aliases: ["lowes", "lowe", "lows", "hardware", "hardware store"] },
];

async function loadStores() {
  const docs = await listDocs("stores");
  const custom = docs
    .filter((d) => d.fields.name)
    .sort((a, b) => (a.fields.createdAt || 0) - (b.fields.createdAt || 0))
    .map((d) => ({ id: d.id, kind: "custom", name: d.fields.name, aliases: [norm(d.fields.name)] }));
  return [...BUILTIN, ...custom];
}

async function pickStore(slot) {
  const spoken = slot?.value;
  // Built-in stores come back resolved to their ids from the slot type.
  const resolvedId = slot?.resolutions?.resolutionsPerAuthority
    ?.find((a) => a.status?.code === "ER_SUCCESS_MATCH")?.values?.[0]?.value?.id;

  if (!spoken || ["", "list", "shopping", "shopping list"].includes(norm(spoken))) {
    return BUILTIN[0]; // no store said ("add milk", "add milk to the list") -> Market Basket
  }
  if (resolvedId && BUILTIN.some((s) => s.id === resolvedId)) {
    return BUILTIN.find((s) => s.id === resolvedId);
  }

  const stores = await loadStores();
  const n = norm(spoken);
  const exact = stores.find((s) => norm(s.name) === n || s.aliases.includes(n));
  const loose = stores.find((s) => s.aliases.some((a) => a && (n.includes(a) || a.includes(n))));
  const store = exact || loose;
  if (!store) return { error: `I couldn't find a store called ${spoken}.` };
  return store;
}

/* ── Add ─────────────────────────────────────────────────────────────────── */

async function addItem(store, spoken) {
  const { qty, name } = parseSpoken(spoken);
  const text = qty > 1 ? `${qty} ${name}` : name;
  const now = Date.now();

  if (store.kind === "mb") {
    return mutate("app/shopping", ["manualItems"], (f) => {
      const manual = f.manualItems || [];
      const removed = new Set(f.removedKeys || []);
      const done = new Set(f.checkedItems || []);
      const dup = manual.find((m) => !removed.has(m.key) && !done.has(m.key) && sameItem(m.text, name));
      if (dup) return { speech: `${name} is already on Market Basket.` };
      manual.push({ key: "m" + now, text, recipe: "Added by Alexa", manual: true });
      return { fields: { manualItems: manual }, speech: `Added ${text} to Market Basket.` };
    });
  }

  if (store.kind === "target" || store.kind === "lowes") {
    const prefix = store.kind === "target" ? "t" : "l";
    const category = store.kind === "target" ? classifyTarget(name) : classifyLowes(name);
    return mutate(`app/${store.kind}`, ["items", "resetAt"], (f) => {
      const items = f.items || [];
      const done = new Set(f.checked || []);
      if (items.some((i) => !done.has(i.key) && sameItem(i.text, name))) {
        return { speech: `${name} is already on ${store.name}.` };
      }
      items.push({ key: prefix + now, text, category });
      // resetAt: null cancels a pending "everything checked, clear in 1 hour"
      // timer, so the item just added can't be wiped by it.
      return { fields: { items, resetAt: null }, speech: `Added ${text} to ${store.name}.` };
    });
  }

  return mutate(`stores/${store.id}`, ["items"], (f) => {
    const items = f.items || [];
    const done = new Set(f.checked || []);
    if (items.some((i) => !done.has(i.key) && sameItem(i.text, name))) {
      return { speech: `${name} is already on ${store.name}.` };
    }
    items.push({ key: "c" + now, text, sectionKey: null });
    return { fields: { items }, speech: `Added ${text} to ${store.name}.` };
  });
}

/* ── Remove ──────────────────────────────────────────────────────────────── */

async function removeItem(store, spoken) {
  const { name } = parseSpoken(spoken);

  if (store.kind === "mb") {
    const recipeItems = await marketBasketRecipeItems();
    return mutate("app/shopping", ["manualItems", "removedKeys", "checkedItems"], (f) => {
      const manual = f.manualItems || [];
      const removed = new Set(f.removedKeys || []);
      const done = new Set(f.checkedItems || []);
      const active = [
        ...manual.filter((m) => !removed.has(m.key)),
        ...recipeItems(f.checkedIds || []).filter((r) => !removed.has(r.key)),
      ];
      const hit = bestMatch(active, name);
      if (!hit) return { speech: `I couldn't find ${name} on Market Basket.` };
      done.delete(hit.key);
      const fields = { checkedItems: [...done] };
      if (hit.manual) fields.manualItems = manual.filter((m) => m.key !== hit.key);
      else fields.removedKeys = [...removed, hit.key]; // same as tapping remove in the app
      return { fields, speech: `Removed ${stripQty(hit.text)} from Market Basket.` };
    });
  }

  const path = store.kind === "custom" ? `stores/${store.id}` : `app/${store.kind}`;
  return mutate(path, ["items", "checked"], (f) => {
    const items = f.items || [];
    const hit = bestMatch(items, name);
    if (!hit) return { speech: `I couldn't find ${name} on ${store.name}.` };
    return {
      fields: {
        items: items.filter((i) => i.key !== hit.key),
        checked: (f.checked || []).filter((k) => k !== hit.key),
      },
      speech: `Removed ${stripQty(hit.text)} from ${store.name}.`,
    };
  });
}

/* ── Read ────────────────────────────────────────────────────────────────── */

async function readList(store) {
  let names;
  if (store.kind === "mb") {
    const doc = await getDoc("app/shopping");
    const f = doc?.fields || {};
    const removed = new Set(f.removedKeys || []);
    const done = new Set(f.checkedItems || []);
    const recipeItems = await marketBasketRecipeItems();
    names = [...(f.manualItems || []), ...recipeItems(f.checkedIds || [])]
      .filter((i) => !removed.has(i.key) && !done.has(i.key))
      .map((i) => i.text);
  } else {
    const doc = await getDoc(store.kind === "custom" ? `stores/${store.id}` : `app/${store.kind}`);
    const f = doc?.fields || {};
    const done = new Set(f.checked || []);
    names = (f.items || []).filter((i) => !done.has(i.key)).map((i) => i.text);
  }

  names = [...new Map(names.map((t) => [norm(stripQty(t)), t])).values()]; // de-dupe
  if (!names.length) return `${store.name} is empty.`;
  const MAX = 15;
  const spoken = names.slice(0, MAX);
  const more = names.length > MAX ? `, and ${names.length - MAX} more` : "";
  const noun = names.length === 1 ? "item" : "items";
  return `${store.name} has ${names.length} ${noun}: ${spoken.join(", ")}${more}.`;
}

/**
 * Market Basket's recipe-driven items are computed in the app from the checked
 * recipes. Rebuild them the same way (same keys) so they can be read and removed.
 */
async function marketBasketRecipeItems() {
  const shop = await getDoc("app/shopping");
  const ids = shop?.fields?.checkedIds || [];
  const recipes = ids.length ? await batchGet(ids.map((id) => `recipes/${id}`)) : [];
  return (checkedIds) => {
    const out = [];
    recipes
      .filter((r) => checkedIds.includes(r.id))
      .forEach((r) => {
        (r.fields.ingredients || []).forEach((ing) => {
          const lower = String(ing).toLowerCase();
          if (lower.includes("salt and pepper") || lower.includes("salt & pepper")) {
            ["salt", "pepper"].forEach((item) => out.push({ key: "r" + r.id + "::" + item, text: item, manual: false }));
          } else {
            out.push({ key: "r" + r.id + "::" + ing, text: toShoppingText(ing), manual: false });
          }
        });
      });
    return out;
  };
}

/* ── Text helpers ────────────────────────────────────────────────────────── */

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, "a dozen": 12, couple: 2, "a couple": 2, "a couple of": 2,
};

/** "two gallons of milk" -> { qty: 2, name: "Gallons of milk" }; "some eggs" -> { qty: 1, name: "Eggs" } */
function parseSpoken(raw) {
  let s = String(raw).trim().replace(/\s+/g, " ").replace(/^(some|more)\s+/i, "");
  let qty = 1;
  const digit = s.match(/^(\d+)\s+(.+)$/);
  if (digit) {
    qty = parseInt(digit[1], 10);
    s = digit[2];
  } else {
    const lower = s.toLowerCase();
    const word = Object.keys(NUMBER_WORDS)
      .sort((a, b) => b.length - a.length)
      .find((w) => lower.startsWith(w + " "));
    if (word) {
      qty = NUMBER_WORDS[word];
      s = s.slice(word.length + 1).replace(/^of\s+/i, "");
    }
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return { qty, name: s };
}

function norm(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|my)\s+/, "")
    .replace(/\s+(list|store)$/, "")
    .trim();
}

const stripQty = (t) => String(t).replace(/^\d+\s+/, "").trim();
const singular = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
const words = (t) => norm(stripQty(t)).split(" ").filter(Boolean).map(singular);
const sameItem = (a, b) => words(a).join(" ") === words(b).join(" ");

/** Exact name first, then every spoken word found in the item, then the reverse. */
function bestMatch(items, spoken) {
  const want = words(spoken);
  if (!want.length) return null;
  return (
    items.find((i) => sameItem(i.text, spoken)) ||
    items.find((i) => { const have = words(i.text); return want.every((w) => have.includes(w)); }) ||
    items.find((i) => { const have = words(i.text); return have.length && have.every((w) => want.includes(w)); }) ||
    null
  );
}

function slotValue(intent, name) {
  const v = intent?.slots?.[name]?.value;
  return v && v.trim() ? v.trim() : "";
}

/* ── Alexa response helpers ──────────────────────────────────────────────── */

function say(text, { keepOpen = false, reprompt } = {}) {
  const response = { outputSpeech: { type: "PlainText", text }, shouldEndSession: !keepOpen };
  if (reprompt) response.reprompt = { outputSpeech: { type: "PlainText", text: reprompt } };
  return { version: "1.0", response };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

function shortError(err) {
  const m = String(err?.message || err || "");
  if (/PERMISSION_DENIED|403/.test(m)) return "Firestore said permission denied.";
  if (/sign.?in|identitytoolkit|ADMIN_ONLY|OPERATION_NOT_ALLOWED/i.test(m)) return "I couldn't sign in to Firebase.";
  return "Check the worker logs.";
}

/* ── Firestore REST (anonymous auth, same rules as the web app) ──────────── */

let cachedAuth = null; // { token, exp } — reused while this Worker isolate is warm

async function idToken() {
  if (cachedAuth && cachedAuth.exp > Date.now() + 60_000) return cachedAuth.token;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://dougslist.taptheash.us/" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Anonymous sign-in failed: " + (data?.error?.message || res.status));
  cachedAuth = { token: data.idToken, exp: Date.now() + Number(data.expiresIn || 3600) * 1000 };
  return cachedAuth.token;
}

async function fs(url, init = {}) {
  const token = await idToken();
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function getDoc(path) {
  const { res, data } = await fs(`${DOCS}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore read ${path}: ${data?.error?.status || res.status} ${data?.error?.message || ""}`);
  return { fields: decodeFields(data.fields), updateTime: data.updateTime };
}

async function listDocs(collection) {
  const { res, data } = await fs(`${DOCS}/${collection}?pageSize=300`);
  if (!res.ok) throw new Error(`Firestore list ${collection}: ${data?.error?.status || res.status} ${data?.error?.message || ""}`);
  return (data.documents || []).map((d) => ({ id: d.name.split("/").pop(), fields: decodeFields(d.fields) }));
}

async function batchGet(paths) {
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const { res, data } = await fs(`${DOCS}:batchGet`, {
    method: "POST",
    body: JSON.stringify({ documents: paths.map((p) => `${base}/${p}`) }),
  });
  if (!res.ok) throw new Error(`Firestore batchGet: ${res.status}`);
  return (Array.isArray(data) ? data : [])
    .filter((r) => r.found)
    .map((r) => ({ id: r.found.name.split("/").pop(), fields: decodeFields(r.found.fields) }));
}

/**
 * Read-modify-write with an optimistic-lock precondition, so a change made in
 * the app at the same moment is never overwritten. `fn` gets the current
 * fields and returns { fields?, speech }. Only fields named in `mask` are written.
 */
async function mutate(path, mask, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await getDoc(path);
    const result = fn(doc ? structuredClone(doc.fields) : {});
    if (!result.fields) return result.speech;

    const fields = Object.fromEntries(mask.filter((k) => k in result.fields).map((k) => [k, result.fields[k]]));
    const qs = new URLSearchParams();
    Object.keys(fields).forEach((k) => qs.append("updateMask.fieldPaths", k));
    if (doc) qs.set("currentDocument.updateTime", doc.updateTime);
    else qs.set("currentDocument.exists", "false");

    const { res, data } = await fs(`${DOCS}/${path}?${qs}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFields(fields) }),
    });
    if (res.ok) return result.speech;
    const status = data?.error?.status;
    if (status === "FAILED_PRECONDITION" || status === "ABORTED" || status === "ALREADY_EXISTS") continue; // raced; retry
    throw new Error(`Firestore write ${path}: ${status || res.status} ${data?.error?.message || ""}`);
  }
  throw new Error(`Firestore write ${path}: too many concurrent edits`);
}

function decode(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  return null;
}
const decodeFields = (f = {}) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decode(v)]));

function encode(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "string") return { stringValue: x };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encode) } };
  return { mapValue: { fields: encodeFields(x) } };
}
const encodeFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(v)]));

// Exported for local tests only.
export const _test = { parseSpoken, bestMatch, sameItem, norm, handle, encode, decode };
