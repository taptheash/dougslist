// Cloudflare Pages Function — POST /api/import-photo
// Receives a base64 image from the client, calls Anthropic server-side
// (key never leaves this function), returns the extracted recipe text.

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
    const { base64, mediaType } = await request.json();

    if (!base64) {
      return new Response(JSON.stringify({ error: "No image data provided" }), {
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
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
              { type: "text", text: RECIPE_PROMPT },
            ],
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
    const recipeText = data.content?.[0]?.text;

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
