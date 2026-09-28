const FDA_BASE_URL = "https://api.fda.gov/drug/label.json";
const RXNAV_BASE_URL = "https://rxnav.nlm.nih.gov/REST";

const FOOD_ALIASES = {
  grapefruit: ["grapefruit", "grapefruit juice"],
  alcohol: ["alcohol", "ethanol", "alcoholic"],
  caffeine: ["caffeine"],
  dairy: ["milk", "dairy", "calcium"],
  "vitamin k": ["vitamin k"],
  tyramine: ["tyramine"],
  potassium: ["potassium"],
  sodium: ["sodium"]
};

const MAX_INPUT_LENGTH = 100;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(clean))];
}

function containsTerm(text, term) {
  const haystack = clean(text).toLowerCase();
  const needle = clean(term).toLowerCase();

  if (!needle) return false;
  if (needle.includes(" ")) return haystack.includes(needle);

  return new RegExp(
    "(^|[^a-z0-9])" +
      needle.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&") +
      "([^a-z0-9]|$)",
    "i"
  ).test(haystack);
}

function snippets(text, terms) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .filter((part) => terms.some((term) => containsTerm(part, term)))
    .slice(0, 3);
}

function foodTerms(input) {
  const value = clean(input).toLowerCase();
  return FOOD_ALIASES[value] || [value];
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {}

    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeDrug(input) {
  const value = clean(input);

  const url = new URL(RXNAV_BASE_URL + "/approximateTerm.json");
  url.searchParams.set("term", value);
  url.searchParams.set("maxEntries", "8");
  url.searchParams.set("option", "1");

  const response = await fetchJson(url.toString());
  const candidates = response.data?.approximateGroup?.candidate || [];

  const candidate =
    candidates.find(
      (item) => String(item.source || "").toUpperCase() === "RXNORM"
    ) || candidates[0];

  if (!candidate?.rxcui) {
    return {
      kind: "unknown",
      input: value,
      displayName: null,
      terms: foodTerms(value)
    };
  }

  const relatedUrl =
    RXNAV_BASE_URL +
    "/rxcui/" +
    encodeURIComponent(candidate.rxcui) +
    "/allrelated.json";

  const related = await fetchJson(relatedUrl);
  const terms = [];

  (related.data?.allRelatedGroup?.conceptGroup || []).forEach((group) => {
    if (!["IN", "PIN", "MIN"].includes(String(group.tty || ""))) return;

    (group.conceptProperties || []).forEach((concept) => {
      if (concept.name) terms.push(concept.name);
    });
  });

  return {
    kind: "drug",
    input: value,
    displayName: candidate.name || value,
    rxcui: String(candidate.rxcui),
    terms: unique(terms.concat([candidate.name || value, value])).slice(0, 12)
  };
}

function fdaUrl(field, term) {
  const query = field + ':"' + String(term).replaceAll('"', "") + '"';
  const url = new URL(FDA_BASE_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "20");
  return url.toString();
}

async function getLabels(info) {
  const terms = unique((info.terms || []).slice(0, 6).concat([info.input]));
  const results = [];
  const seen = new Set();

  for (const term of terms) {
    if (!term) continue;

    for (const field of [
      "openfda.generic_name",
      "openfda.substance_name",
      "openfda.brand_name"
    ]) {
      const url = fdaUrl(field, term);
      const response = await fetchJson(url);

      if (!response.ok || !response.data?.results) continue;

      for (const record of response.data.results) {
        const id =
          record.id ||
          record.openfda?.spl_set_id?.[0] ||
          field + "-" + term + "-" + results.length;

        if (seen.has(id)) continue;

        seen.add(id);
        results.push({ record, url });

        if (results.length >= 20) return results;
      }
    }
  }

  return results;
}

function interactionEvidence(labels, targetTerms) {
  const evidence = [];

  labels.forEach((item) => {
    const sections = [
      ...(item.record.drug_interactions || []),
      ...(item.record.drug_interactions_table || [])
    ].map(String);

    sections.forEach((section) => {
      if (!targetTerms.some((term) => containsTerm(section, term))) return;

      evidence.push({
        snippets: snippets(section, targetTerms),
        url: item.url
      });
    });
  });

  return evidence.slice(0, 8);
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300"
    }
  });
}

export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const firstInput = clean(requestUrl.searchParams.get("first"));
  const secondInput = clean(requestUrl.searchParams.get("second"));

  if (!firstInput || !secondInput) {
    return json({ error: "Both first and second items are required." }, 400);
  }

  if (
    firstInput.length > MAX_INPUT_LENGTH ||
    secondInput.length > MAX_INPUT_LENGTH
  ) {
    return json({ error: "Each input must be 100 characters or fewer." }, 400);
  }

  try {
    const first = await normalizeDrug(firstInput);
    const second = await normalizeDrug(secondInput);

    if (first.kind !== "drug") {
      return json(
        {
          error: "First item was not recognized as a medicine.",
          code: "FIRST_NOT_RECOGNIZED"
        },
        422
      );
    }

    const firstLabels = await getLabels(first);

    if (!firstLabels.length) {
      return json({
        first,
        second,
        evidence: [],
        status: "no_fda_label"
      });
    }

    const secondIsDrug = second.kind === "drug";
    const secondTerms = secondIsDrug
      ? unique((second.terms || []).concat([secondInput]))
      : foodTerms(secondInput);

    let evidence = interactionEvidence(firstLabels, secondTerms);

    if (secondIsDrug) {
      const secondLabels = await getLabels(second);
      const reverseTerms = unique((first.terms || []).concat([firstInput]));
      evidence = evidence
        .concat(interactionEvidence(secondLabels, reverseTerms))
        .slice(0, 8);
    }

    return json({
      first,
      second,
      evidence,
      status: evidence.length ? "label_mention" : "no_label_mention"
    });
  } catch (error) {
    console.error("Interaction lookup failed", error);
    return json(
      {
        error: "The drug-information services could not complete the lookup.",
        code: "LOOKUP_FAILED"
      },
      502
    );
  }
}
