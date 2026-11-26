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
//   Sonnet — photos. Reading handwriting and blurry cookbook pages is where the bigger
//            model earns its cost.
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
            servings: { type: "integer", minimum: 1 },
            ingredients: { type: "array", items: { type: "string" } },
            instructions: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
            storage: { type: "string" },
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

Category: the single best fit from the list.

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
- Category must be one of the allowed values.
Answer by calling save_recipes with exactly one recipe.`;

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

async function callClaude(env, { system, content, tools, forceTool = true, vision = false }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: vision ? (env.IMPORT_MODEL_VISION || MODEL_VISION) : (env.IMPORT_MODEL_FAST || MODEL_FAST),
      max_tokens: 8000,
      system,
      tools,
      ...(forceTool ? { tool_choice: { type: "tool", name: RECIPE_TOOL.name } } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI service error ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
  }
  const data = await res.json();
  const call = data.content?.find((b) => b.type === "tool_use" && b.name === RECIPE_TOOL.name);
  return call?.input || null;
}

/** Make sure every recipe has the exact shape the app stores. */
function clean(result) {
  const list = Array.isArray(result?.recipes) ? result.recipes : [];
  const recipes = list
    .map((r) => ({
      title: String(r.title || "Untitled Recipe").trim(),
      category: CATEGORIES.includes(r.category) ? r.category : "Other",
      servings: Math.max(1, parseInt(r.servings) || 4),
      ingredients: (r.ingredients || []).map((s) => String(s).replace(/^[-*•]\s*/, "").trim()).filter(Boolean),
      instructions: (r.instructions || []).map((s) => String(s).replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean),
      notes: String(r.notes || "").trim(),
      storage: String(r.storage || "").trim(),
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
