import { onRequestGet } from "./functions/api/check.js";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "MedInteractionGuide",
        api: "interaction-checker",
        build: "2026-09-28-worker-1"
      });
    }

    if (url.pathname === "/api/check") {
      return onRequestGet({
        request,
        env,
        params: {}
      });
    }

    return env.ASSETS.fetch(request);
  }
};
