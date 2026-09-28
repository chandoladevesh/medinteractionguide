export async function onRequestGet() {
  return Response.json(
    {
      ok: true,
      service: "MedInteractionGuide",
      api: "interaction-checker",
      build: "2026-09-28-match-engine-1"
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
