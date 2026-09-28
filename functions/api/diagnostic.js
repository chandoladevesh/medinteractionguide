const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const FDA = "https://api.fda.gov/drug/label.json";

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      json: !!json,
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 12) : []
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: String(error && error.message || error)
    };
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const term = String(url.searchParams.get("term") || "warfarin").trim().slice(0, 100);

  const rxnormUrl = new URL(RXNAV + "/approximateTerm.json");
  rxnormUrl.searchParams.set("term", term);
  rxnormUrl.searchParams.set("maxEntries", "4");
  rxnormUrl.searchParams.set("option", "1");

  const fdaUrl = new URL(FDA);
  fdaUrl.searchParams.set("search", 'openfda.generic_name:"' + term.replaceAll('"', "") + '"');
  fdaUrl.searchParams.set("limit", "1");

  const [rxnorm, fda] = await Promise.all([
    probe(rxnormUrl.toString()),
    probe(fdaUrl.toString())
  ]);

  return Response.json({
    ok: rxnorm.ok && fda.ok,
    term,
    rxnorm,
    openfda: fda
  }, {
    headers: { "Cache-Control": "no-store" }
  });
}
