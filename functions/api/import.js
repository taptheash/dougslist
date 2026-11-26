// Cloudflare Worker route — POST /api/import
//
// One endpoint for every way a recipe shows up. The client sends whatever it has:
//   { text?: string, images?: [{ base64, mediaType }] }      → extract recipe(s)
//   { mode: "refine", recipe: {...}, instruction: string }    → revise a draft
//
// If `text` is just a link, the page is fetched here. Most recipe sites embed a
// schema.org Recipe block (JSON-LD); when present, that exact data is what Claude
// formats. Otherwise Claude reads the page text, and as a last resort searches.
//
// Claude always answers through a tool with a fixed JSON schema, so the client
// receives clean { recipes: [...] } — no text parsing.
//
// The API key stays in this worker (env.ANTHROPIC_API_KEY).
//
// Model per job:
//   Haiku  — text, web pages and edits. Reformatting is light work; Haiku is fast and cheap.
//   Sonnet — photos and new-recipe suggestions. Reading handwriting and inventing recipes
//            that actually work are where the bigger model earns its cost.
//   Haiku also answers "ask about this recipe" questions.
// Override with env.IMPORT_MODEL_FAST / env.IMPORT_MODEL_VISION if needed.

const MODEL_FAST = "claude-haiku-5-5";
const MODEL_VISION = "claude-sonnet-5-5";

const CATEGORIES = [
  "Appetizers", "Italian", "Soups & Stews", "Mains", "Meats", "Fish & Seafood",
  "Vegetables", "Sides", "Desserts", "Breads & Breakfast", "Drinks", "Other",
];

const RECIPE_TOOL = {
  name: "save_recipes",
  description: "Save the recipe(s) in Doug's List format.",
  input_schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        description: "One entry per distinct recipe. Empty if there is no recipe in the input.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            extra_categories: { type: "array", items: { type: "string", enum: CATEGORIES }, description: "Other categories it also clearly belongs to (usually 0-2)." },
            servings: { type: "integer", minimum: 1 },
            ingredients: { type: "array", items: { type: "string" } },
            instructions: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
            storage: { type: "string" },
            summary: { type: "string", description: "Suggestions only: one sentence on why this dish fits." },
          },
          required: ["title", "category", "servings", "ingredients", "instructions", "notes", "storage"],
        },
      },
      problem: {
        type: "string",
        description: "Only when recipes is empty: one short sentence saying why (e.g. 'The page is a login wall').",
      },
    },
    required: ["recipes"],
  },
};

const SYSTEM = `You turn recipes in any form — typed text, messy copy-paste, photos of cookbook pages or handwritten cards, screenshots, web page data — into clean entries for a household recipe app called Doug's List. Always answer by calling save_recipes.

Faithfulness
- Keep the recipe's actual ingredients, amounts and steps. Do not invent, drop or "improve" anything. Fix obvious OCR/typing errors and formatting only.
- Several photos are usually pages of the same recipe; combine them. Make separate entries only for clearly different recipes.
- A sub-recipe that belongs to the dish (a sauce, a crust) stays inside the same entry.
- Ignore ads, life stories, comments, nutrition panels and navigation text.

Title: the dish name in Title Case, without site names or words like "Best Ever" or "Easy".

Category: the single best fit from the list. extra_categories: any other categories it clearly also belongs to (a French onion meatloaf is Mains and also Meats; a clam chowder is Soups & Stews and also Fish & Seafood). Usually 0-2; don't pad.

Servings: an integer. Use the lower number of a range. If not stated, estimate sensibly from the quantities.

Ingredients (one per array item)
- Quantity first, then unit, then item, then prep: "2 lb ground beef", "1 medium onion, diced", "0.5 tsp kosher salt".
- Digits only. Simple fractions like 1/2 or 3/4 are fine; write mixed numbers as decimals (1.5 cups, not "1 1/2 cups"); never use ½-style characters.
- Prefer US units as written in the source; do not convert.
- No heading lines like "For the sauce:". If the grouping matters, add it at the end in parentheses: "2 tbsp butter (for the sauce)".
- Items with no amount stay as written: "salt and pepper to taste".

Instructions (one step per array item)
- No numbers or bullets at the start. Split very long paragraphs into sensible steps.
- Whenever a step involves waiting or cooking for a time, write the time with digits and the word minutes/hours/seconds ("simmer for 20 minutes", "bake 25-30 minutes", "rest 1 hour") so the app can start a timer.
- Keep temperatures in °F as given.

Notes: short and useful — tips, variations or make-ahead advice that appear in the source, then a final line "Source: <site name, book or person> <url if known>". Empty string if nothing to say.

Storage: storage/reheating guidance only if the source gives it; otherwise empty string.

If there is no recipe at all, return an empty recipes array and fill in problem.`;

const REFINE_SYSTEM = `You revise one recipe in Doug's List at the user's request. Change only what the request asks for (and anything that must change with it, such as amounts when scaling servings or steps when changing technique). Keep every formatting rule:
- Ingredients: quantity first, digits, fractions like 1/2 or decimals like 1.5, no ½ characters, no heading lines.
- Instructions: one step per item, no numbering, times written with digits plus minutes/hours.
- Category must be one of the allowed values; keep the recipe's existing extra_categories unless the change affects them.
Answer by calling save_recipes with exactly one recipe.`;

// What the AI should know about how this household cooks. Edit freely.
const HOUSEHOLD = `- Cooks often in cast iron (skillets and a Dutch oven).
- Leans toward high-protein, lower-glycemic meals, but these are preferences, not strict rules.
- Doesn't want kale or cauliflower stand-ins (cauliflower rice, cauliflower crust, etc.).
- Shops mostly at Market Basket in New Hampshire; everyday supermarket ingredients are best.`;

const ASK_SYSTEM = `You are a friendly, practical cooking helper inside Doug's List, a household recipe app. The user is looking at the recipe below, often while cooking, so answer briefly and directly: a few sentences or a short list. Give concrete amounts, times and temperatures (°F). If a substitution or change would work, say exactly how; if it wouldn't, say so and offer the best alternative. Plain text only, no markdown headings.

About this household:
${HOUSEHOLD}`;

const SUGGEST_SYSTEM = `You suggest new recipes for a household recipe app called Doug's List and write each one out in full so it can be saved with one tap. Suggest dishes that are reliable, well-tested home cooking — not gimmicks — and that are not already in their collection (titles are listed). Vary them across proteins and styles unless the request is specific.

About this household:
${HOUSEHOLD}

Use the exact same formatting rules as imported recipes:
- Ingredients: quantity first, digits, fractions like 1/2 or decimals like 1.5, no ½ characters, no heading lines.
- Instructions: one step per item, no numbering, times written with digits plus minutes/hours, temperatures in °F.
- Category from the allowed list, plus extra_categories it also clearly fits. Notes: one or two genuinely useful tips (cast iron tips where relevant). Storage: how long it keeps and how to reheat.
- summary: one sentence on why it fits the request.
Answer by calling save_recipes.`;

/* Shopping lists: turn "two cans of diced tomatoes, milk, and bulbs from Lowe's" into items. */
const ITEMS_TOOL = {
  name: "add_items",
  description: "Add the shopping items to the right store lists.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short item name as it should appear on the list, e.g. 'diced tomatoes (can)', 'milk', 'LED light bulbs'." },
            qty: { type: "integer", minimum: 1 },
            store: { type: "string", description: "Store id from the list provided." },
            section: { type: "string", description: "Best section key for that store from the list provided, or empty if none fit." },
          },
          required: ["name", "qty", "store", "section"],
        },
      },
    },
    required: ["items"],
  },
};

const ITEMS_SYSTEM = `You turn spoken or typed shopping requests into list items for a household shopping app. Split the request into separate items. Keep names short and natural, singular unless the user means a pack ("eggs" is fine). Put the quantity in qty (default 1; "a couple" = 2, "a dozen eggs" = qty 1 name "eggs (dozen)"). Fix speech-to-text mistakes when the meaning is obvious. Choose the store the user names; if none is named, use the current store unless the item clearly belongs at another listed store (e.g. hardware at a hardware store, groceries at the grocery store). Choose the best section key for that store; use an empty string only if nothing fits. Ignore filler like "add", "please", "to the list". Always answer by calling add_items.`;

const PLACE_TOOL = {
  name: "place_items",
  description: "Assign each item to a store section.",
  input_schema: {
    type: "object",
    properties: {
      placements: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, section: { type: "string" } },
          required: ["text", "section"],
        },
      },
    },
    required: ["placements"],
  },
};

const PLACE_SYSTEM = `You place shopping-list items into the sections of a specific store, the way a regular shopper there would find them. For each item, return the single best section key from the list given (exactly as written). Use the section descriptions: they name what is in each aisle. Always answer by calling place_items, with one placement per item, using the item text exactly as given.`;

/** Generic tool call (for the list tools), with the same fallbacks as callClaude. */
async function callTool(env, { system, content, tool, maxTokens = 2000 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.IMPORT_MODEL_FAST || MODEL_FAST,
      max_tokens: maxTokens,
      system: system + `\n\nAlways respond by calling the ${tool.name} tool.`,
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI service error ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
  }
  const data = await res.json();
  const call = data.content?.find((b) => b.type === "tool_use" && b.name === tool.name)?.input;
  if (call) return call;
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

const describeStores = (stores) =>
  (Array.isArray(stores) ? stores : []).slice(0, 20).map((st) =>
    `Store id "${st.id}": ${st.name}\n` +
    ((st.sections || []).length
      ? (st.sections || []).slice(0, 60).map((x) => `  - section "${x.key}": ${x.label}`).join("\n")
      : "  (no sections)")
  ).join("\n\n");

/* ── Assistant: an agent that works the app through tools ──────────────────
   The worker holds the model and the tool definitions; the browser runs each
   tool against the live app (Firestore + local state) and posts the results
   back, so the loop needs no server-side database credentials. */

const RECIPE_FIELDS = {
  title: { type: "string" },
  category: { type: "string", enum: CATEGORIES, description: "Main category." },
  extra_categories: { type: "array", items: { type: "string", enum: CATEGORIES }, description: "Other categories it also belongs to (it then shows under each)." },
  servings: { type: "integer", minimum: 1, description: "The servings the ingredient amounts are written for." },
  ingredients: { type: "array", items: { type: "string" }, description: "Quantity first, digits, 1/2 or 1.5 (no ½), no heading lines." },
  instructions: { type: "array", items: { type: "string" }, description: "One step per item, no numbering, times as digits + minutes/hours." },
  notes: { type: "string" },
  storage: { type: "string" },
};

const AGENT_TOOLS = [
  { name: "search_recipes", description: "Search the household's saved recipes by words in the title or ingredients, and/or by category. With no arguments, lists every recipe (titles only).",
    input_schema: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: CATEGORIES } } } },
  { name: "get_recipe", description: "Read one saved recipe in full.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "create_recipe", description: "Save a new recipe to the collection. Use for dishes the user wants that aren't saved yet. Returns its id.",
    input_schema: { type: "object", properties: RECIPE_FIELDS, required: ["title", "category", "servings", "ingredients", "instructions"] } },
  { name: "update_recipe", description: "Change a saved recipe. Only include fields that change. If you rewrite ingredient amounts for a new number of people, include servings.",
    input_schema: { type: "object", properties: { id: { type: "string" }, ...RECIPE_FIELDS }, required: ["id"] } },
  { name: "set_servings", description: "Scale a saved recipe to a number of servings (its ingredient amounts and its shopping-list amounts scale automatically). Do this before adding it to the list when the user gives a head count.",
    input_schema: { type: "object", properties: { id: { type: "string" }, servings: { type: "integer", minimum: 1 } }, required: ["id", "servings"] } },
  { name: "add_recipe_to_list", description: "Put a recipe's ingredients on the Market Basket list (at its current servings). Pantry staples are skipped automatically; the result says which.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "remove_recipe_from_list", description: "Take a recipe's ingredients off the Market Basket list.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "add_items", description: "Add individual items to store lists (things not coming from a recipe).",
    input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object",
      properties: { name: { type: "string" }, qty: { type: "integer", minimum: 1 }, store: { type: "string", description: "Store id." } },
      required: ["name", "qty", "store"] } } }, required: ["items"] } },
  { name: "get_list", description: "See what's currently on a store's list (not yet checked off).",
    input_schema: { type: "object", properties: { store: { type: "string", description: "Store id." } }, required: ["store"] } },
  { name: "get_pantry", description: "The household's pantry staples (always on hand, kept off the list).",
    input_schema: { type: "object", properties: {} } },
  { name: "get_usuals", description: "Items the household buys regularly at a store, with which ones are due.",
    input_schema: { type: "object", properties: { store: { type: "string", description: "Store id." } }, required: ["store"] } },
];

const agentSystem = (ctx) => `You are the assistant inside Doug's List, a household app with a recipe collection and shopping lists for several stores. You don't just answer — you get things done by using the tools, taking as many steps as the job needs, then reporting back.

How to work
- Look before you act: search the saved recipes before writing a new one, and check a list before adding duplicates.
- If the user wants a dish that isn't saved, write a reliable, well-tested version and save it with create_recipe (same formatting as the rest of the collection). Then use it like any other recipe.
- When the user gives a head count, set_servings first, then add_recipe_to_list, so list amounts match.
- Recipe ingredients go on the list with add_recipe_to_list (Market Basket only). Use add_items for anything else (drinks, paper plates, hardware…), choosing the right store.
- Don't delete anything, and don't overwrite a recipe's ingredients or steps unless the user asked for that change.
- Meal planning ("plan two dinners this week"): pick from saved recipes first, favoring favorites and variety (different proteins and styles, nothing already on the list); write new ones only if the collection is thin or the user asks for something new. Then add each to the list.
- Only ask a question if you truly can't make a sensible choice; otherwise choose and mention what you chose.
- Finish with a short plain-text report of what you did (recipes created or scaled, what went on which list, anything skipped as a pantry staple) and anything they should know. No markdown headings; short lists are fine.

Stores (id: name): ${(ctx.stores || []).map((x) => `${x.id}: ${x.name}`).join("; ")}
Today: ${ctx.today || ""}

About this household:
${HOUSEHOLD}`;

/* ─────────────────────────────── helpers ─────────────────────────────── */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());

const decodeEntities = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
   .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

/** Find schema.org Recipe objects inside any JSON-LD blocks on the page. */
function findJsonLdRecipes(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const isRecipe = (node) => {
    const t = node && node["@type"];
    return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (isRecipe(node)) { out.push(node); return; }
    if (node["@graph"]) walk(node["@graph"]);
    if (node.mainEntity) walk(node.mainEntity);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* malformed block — skip */ }
  }
  // Drop bulky fields Claude doesn't need.
  return out.map(({ review, aggregateRating, video, image, author, publisher, nutrition, ...keep }) => keep);
}

function metaContent(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decodeEntities(c) : "";
}

function pageText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Fetch a page and return the best material for Claude, or null if unusable. */
async function readPage(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 1_500_000);

  const recipes = findJsonLdRecipes(html);
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  const site = metaContent(html, "og:site_name");
  const description = metaContent(html, "og:description") || metaContent(html, "description");

  if (recipes.length) {
    return {
      how: "structured",
      material:
        `Page: ${title}\nSite: ${site}\nURL: ${url}\n\n` +
        `schema.org Recipe data from the page:\n${JSON.stringify(recipes).slice(0, 60_000)}`,
    };
  }

  const text = pageText(html);
  // Social posts often hide the recipe in the description (the caption).
  const combined = [description, text].filter(Boolean).join("\n\n").slice(0, 60_000);
  if (combined.length < 300) return null;
  return {
    how: "page",
    material: `Page: ${title}\nSite: ${site}\nURL: ${url}\n\nPage text:\n${combined}`,
  };
}

async function callClaude(env, { system, content, tools, forceTool = true, vision = false, messages, maxTokens = 8000 }) {
  const model = vision ? (env.IMPORT_MODEL_VISION || MODEL_VISION) : (env.IMPORT_MODEL_FAST || MODEL_FAST);
  const post = async (msgs) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      // Current models don't allow forcing a specific tool, so the tool is offered
      // ("auto") and the prompt says to use it; see the fallbacks below.
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: tools && forceTool ? system + "\n\nAlways respond by calling the save_recipes tool. Do not reply with plain text." : system,
        ...(tools ? { tools, tool_choice: { type: "auto" } } : {}),
        messages: msgs,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AI service error ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
    }
    return res.json();
  };

  const msgs = messages || [{ role: "user", content }];
  let data = await post(msgs);
  if (!tools) return data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || "";

  const findCall = (d) => d.content?.find((b) => b.type === "tool_use" && b.name === RECIPE_TOOL.name)?.input || null;
  let call = findCall(data);
  if (call) return call;

  // Fallback 1: the model wrote the JSON as text.
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
  const m = text.match(/\{[\s\S]*"recipes"[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* not valid JSON */ } }

  // Fallback 2: ask once more, explicitly, continuing the same conversation.
  if (data.stop_reason !== "pause_turn" && text.trim()) {
    data = await post([
      ...msgs,
      { role: "assistant", content: text },
      { role: "user", content: "Now save that by calling the save_recipes tool." },
    ]);
    call = findCall(data);
  }
  return call;
}

/** Make sure every recipe has the exact shape the app stores. */
function clean(result) {
  const list = Array.isArray(result?.recipes) ? result.recipes : [];
  const recipes = list
    .map((r) => ({
      title: String(r.title || "Untitled Recipe").trim(),
      category: CATEGORIES.includes(r.category) ? r.category : "Other",
      categories: [...new Set([CATEGORIES.includes(r.category) ? r.category : "Other", ...(Array.isArray(r.extra_categories) ? r.extra_categories : [])])]
        .filter((c) => CATEGORIES.includes(c)),
      servings: Math.max(1, parseInt(r.servings) || 4),
      ingredients: (r.ingredients || []).map((s) => String(s).replace(/^[-*•]\s*/, "").trim()).filter(Boolean),
      instructions: (r.instructions || []).map((s) => String(s).replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean),
      notes: String(r.notes || "").trim(),
      storage: String(r.storage || "").trim(),
      ...(r.summary ? { summary: String(r.summary).trim() } : {}),
    }))
    .filter((r) => r.ingredients.length || r.instructions.length);
  return { recipes, problem: result?.problem || "" };
}

/* ─────────────────────────────── handler ─────────────────────────────── */

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the worker." }, 500);

    const body = await request.json();

    // ── Revise an existing draft ──────────────────────────────────────────
    if (body.mode === "refine") {
      if (!body.recipe || !body.instruction?.trim()) return json({ error: "Nothing to change." }, 400);
      const out = clean(await callClaude(env, {
        system: REFINE_SYSTEM,
        tools: [RECIPE_TOOL],
        content: `Current recipe (JSON):\n${JSON.stringify(body.recipe)}\n\nChange requested: ${body.instruction.trim()}`,
      }));
      if (!out.recipes.length) return json({ error: "Couldn't apply that change. Try wording it differently." }, 422);
      return json({ recipes: out.recipes.slice(0, 1) });
    }

    // ── Shopping list: natural-language add ───────────────────────────────
    if (body.mode === "items") {
      const text = String(body.text || "").trim().slice(0, 1500);
      const stores = Array.isArray(body.stores) ? body.stores : [];
      if (!text || !stores.length) return json({ error: "Say or type what to add." }, 400);
      const ids = new Set(stores.map((x) => x.id));
      const out = await callTool(env, {
        system: ITEMS_SYSTEM,
        tool: ITEMS_TOOL,
        content: `Current store: "${body.currentStore}"\n\nStores and their sections:\n${describeStores(stores)}\n\nRequest: ${text}`,
      });
      const items = (out?.items || [])
        .map((i) => {
          const st = stores.find((x) => x.id === i.store) || stores.find((x) => x.id === body.currentStore) || stores[0];
          const secOk = (st.sections || []).some((x) => x.key === i.section);
          return {
            name: String(i.name || "").trim(),
            qty: Math.max(1, Math.min(99, parseInt(i.qty) || 1)),
            store: ids.has(i.store) ? i.store : st.id,
            section: secOk ? i.section : "",
          };
        })
        .filter((i) => i.name);
      if (!items.length) return json({ error: "Didn't catch any items in that." }, 422);
      return json({ items });
    }

    // ── Shopping list: place items into a store's sections ────────────────
    if (body.mode === "place") {
      const st = body.store;
      const texts = (Array.isArray(body.items) ? body.items : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 60);
      if (!st?.sections?.length || !texts.length) return json({ placements: [] });
      const out = await callTool(env, {
        system: PLACE_SYSTEM,
        tool: PLACE_TOOL,
        content: `${describeStores([st])}\n\nItems:\n${texts.map((t) => "- " + t).join("\n")}`,
      });
      const keys = new Set(st.sections.map((x) => x.key));
      const placements = (out?.placements || []).filter((p) => texts.includes(p.text) && keys.has(p.section));
      return json({ placements });
    }

    // ── Assistant: one step of the agent loop ─────────────────────────────
    if (body.mode === "agent") {
      const messages = Array.isArray(body.messages) ? body.messages.slice(-60) : [];
      if (!messages.length || messages[0].role !== "user") return json({ error: "Say what you'd like done." }, 400);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          // Planning several steps and writing recipes along the way: the bigger model's job.
          model: env.IMPORT_MODEL_VISION || MODEL_VISION,
          max_tokens: 6000,
          system: agentSystem(body.context || {}),
          tools: AGENT_TOOLS,
          messages,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return json({ error: `AI service error ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}` }, 502);
      }
      const data = await res.json();
      return json({ content: data.content || [], stop_reason: data.stop_reason });
    }

    // ── One-time: give older recipes their extra categories ───────────────
    if (body.mode === "categorize") {
      const list = (Array.isArray(body.recipes) ? body.recipes : []).slice(0, 30).map((r) => ({
        id: String(r.id), title: String(r.title || "").slice(0, 120), category: r.category,
        ingredients: (r.ingredients || []).slice(0, 12).map((x) => String(x).slice(0, 80)),
      }));
      if (!list.length) return json({ results: [] });
      const out = await callTool(env, {
        system: `You sort recipes into categories for a household recipe app. Allowed categories: ${CATEGORIES.join(", ")}. Each recipe already has a main category. For each, list any OTHER allowed categories it clearly also belongs to, so it also shows up under those tabs. Guidance: a dish built around beef, pork, chicken, turkey, lamb or sausage also belongs in "Meats"; built around fish or shellfish, also "Fish & Seafood"; a vegetable-led side or main, also "Vegetables"; a main-course soup or stew, also "Mains" only if it's a full meal; pasta dishes also "Italian" when they're Italian. A minor ingredient (a little bacon or salt pork for flavor) doesn't count. Don't repeat the main category; return an empty list when nothing else clearly fits.`,
        tool: {
          name: "set_categories",
          description: "Extra categories for each recipe.",
          input_schema: { type: "object", properties: { results: { type: "array", items: { type: "object",
            properties: { id: { type: "string" }, extra_categories: { type: "array", items: { type: "string", enum: CATEGORIES } } },
            required: ["id", "extra_categories"] } } }, required: ["results"] },
        },
        content: JSON.stringify(list),
        maxTokens: 3000,
      });
      const ids = new Set(list.map((r) => r.id));
      const results = (out?.results || [])
        .filter((r) => ids.has(String(r.id)))
        .map((r) => ({ id: String(r.id), extra: (r.extra_categories || []).filter((c) => CATEGORIES.includes(c)) }));
      return json({ results });
    }

    // ── Question about a recipe (chat) ────────────────────────────────────
    if (body.mode === "ask") {
      const history = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
      if (!body.recipe || !history.length || history[history.length - 1].role !== "user") {
        return json({ error: "Ask a question first." }, 400);
      }
      const r = body.recipe;
      const recipeText =
        `${r.title} (${r.category}, serves ${r.servings})\n\nIngredients:\n${(r.ingredients || []).map((i) => "- " + i).join("\n")}` +
        `\n\nSteps:\n${(r.instructions || []).map((s, i) => i + 1 + ". " + s).join("\n")}` +
        (r.notes ? `\n\nNotes: ${r.notes}` : "") + (r.storage ? `\n\nStorage: ${r.storage}` : "");
      const answer = await callClaude(env, {
        system: ASK_SYSTEM + "\n\nThe recipe:\n" + recipeText,
        messages: history,
        maxTokens: 1200,
      });
      if (!answer) return json({ error: "No answer came back. Try again." }, 502);
      return json({ answer });
    }

    // ── New recipe suggestions ────────────────────────────────────────────
    if (body.mode === "suggest") {
      const have = (Array.isArray(body.existing) ? body.existing : []).slice(0, 400)
        .map((t) => "- " + String(t).slice(0, 120)).join("\n");
      const avoid = (Array.isArray(body.exclude) ? body.exclude : []).slice(0, 40).join("; ");
      const ask = String(body.request || "").trim().slice(0, 500);
      const dish = String(body.dish || "").trim().slice(0, 200);
      const count = dish ? 1 : Math.min(5, Math.max(1, parseInt(body.count) || 4));
      const out = clean(await callClaude(env, {
        system: SUGGEST_SYSTEM,
        tools: [RECIPE_TOOL],
        vision: true, // Sonnet: inventing recipes that work is the harder job
        content:
          (dish
            ? `Write one excellent, classic-style recipe for: ${dish}\n` +
              `It's fine if a similar title is already in the collection; the user asked for this dish.\n\n`
            : `Suggest ${count} recipes.\n` +
              `Request: ${ask || "Surprise me with a good mix for weeknight dinners."}\n\n`) +
          `Already in the collection${dish ? "" : " (don't repeat these)"}:\n${have || "(none yet)"}` +
          (avoid ? `\n\nAlso skip these, already suggested: ${avoid}` : ""),
      }));
      if (!out.recipes.length) return json({ error: out.problem || "No suggestions came back. Try again." }, 502);
      return json({ recipes: out.recipes });
    }

    // ── Extract from whatever was provided ────────────────────────────────
    const text = (body.text || "").trim();
    const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    if (!text && !images.length) return json({ error: "Paste a recipe, a link, or add a photo." }, 400);

    const content = [];
    for (const img of images) {
      if (!img?.base64) continue;
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 } });
    }

    let how = images.length ? "photo" : "text";

    if (text && looksLikeUrl(text) && !images.length) {
      const url = text.trim();
      const page = await readPage(url);
      if (page) {
        how = page.how;
        content.push({ type: "text", text: page.material });
      } else {
        // Site blocked us or needs JavaScript — let Claude look it up.
        how = "search";
        const out = clean(await callClaude(env, {
          system: SYSTEM,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }, RECIPE_TOOL],
          forceTool: false,
          content: `Find the recipe at this URL and save it with save_recipes: ${url}\nIf you cannot find that exact recipe, return an empty list with a problem.`,
        }));
        if (!out.recipes.length) {
          return json({ error: out.problem || "Couldn't read that site. Try pasting the recipe text or a screenshot instead." }, 422);
        }
        return json({ recipes: out.recipes, how });
      }
    } else if (text) {
      content.push({ type: "text", text: images.length ? `Extra context from the user:\n${text}` : `Recipe input:\n${text}` });
    }

    if (images.length && !text) content.push({ type: "text", text: "Extract the recipe from these image(s)." });

    const out = clean(await callClaude(env, { system: SYSTEM, tools: [RECIPE_TOOL], content, vision: images.length > 0 }));
    if (!out.recipes.length) return json({ error: out.problem || "No recipe found in that." }, 422);
    return json({ recipes: out.recipes, how });
  } catch (err) {
    return json({ error: err.message || "Something went wrong." }, 500);
  }
}
