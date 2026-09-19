import { onRequestPost as importPhoto } from "./functions/api/import-photo.js";
import { onRequestPost as importUrl } from "./functions/api/import-url.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/import-photo" && request.method === "POST") {
      return importPhoto({ request, env, ctx });
    }
    if (url.pathname === "/api/import-url" && request.method === "POST") {
      return importUrl({ request, env, ctx });
    }

    return env.ASSETS.fetch(request);
  },
};
