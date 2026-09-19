// Cloudflare Pages Function — POST /api/import-url
// Receives a recipe URL from the client, calls Anthropic (with web_search)
// server-side (key never leaves this function), returns the extracted recipe text.

const RECIPE_PROMPT = `Extract this recipe and format it exactly like this:

Recipe Title
Category: Mains
Servings: 4
Ingredients:
- ingredient 1
- ingredient 2
Instructions:
1. Step one
2. Step two

Use one of these categories: Appetizers, Italian, Soups & Stews, Mains, Meats, Fish & Seafood, Vegetables, Sides, Desserts, Breads & Breakfast, Drinks, Other.
Return ONLY the formatted recipe, nothing else.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { url } = await request.json();

    if (!url || !url.trim()) {
      return new Response(JSON.stringify({ error: "No URL provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `Fetch the recipe from this URL and extract it: ${url.trim()}\n\n${RECIPE_PROMPT}`,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: `API error: ${anthropicRes.status}` }), {
        status: anthropicRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await anthropicRes.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    const recipeText = textBlock?.text;

    if (!recipeText) {
      return new Response(JSON.stringify({ error: "No recipe text returned" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ recipeText }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Something went wrong" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
