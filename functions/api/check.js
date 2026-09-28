import {
  clean,
  unique,
  foodTerms,
  rxNormCandidate,
  collectRxNormTerms,
  pharmacologicClassTerms,
  interactionEvidence
} from "../_lib/interaction.mjs";

const FDA_BASE_URL = "https://api.fda.gov/drug/label.json";
const RXNAV_BASE_URL = "https://rxnav.nlm.nih.gov/REST";
const MAX_INPUT_LENGTH = 100;

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
  const candidate = rxNormCandidate(candidates);

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

  return {
    kind: "drug",
    input: value,
    displayName: candidate.name || value,
    rxcui: String(candidate.rxcui),
    matchScore: Number(candidate.score || 0),
    matchRank: String(candidate.rank || ""),
    terms: collectRxNormTerms(
      related.data?.allRelatedGroup?.conceptGroup || [],
      candidate.name || value
    )
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
  const terms = unique((info.terms || []).slice(0, 3).concat([info.input])).slice(0, 4);
  const fields = [
    "openfda.generic_name",
    "openfda.substance_name",
    "openfda.brand_name"
  ];

  const requests = terms.flatMap((term) =>
    fields.map((field) => ({
      term,
      field,
      url: fdaUrl(field, term)
    }))
  );

  const responses = await Promise.all(
    requests.map(async (item) => ({
      ...item,
      response: await fetchJson(item.url)
    }))
  );

  const results = [];
  const seen = new Set();

  for (const item of responses) {
    const response = item.response;

    if (!response.ok || !response.data?.results) continue;

    for (const record of response.data.results) {
      const id =
        record.id ||
        record.openfda?.spl_set_id?.[0] ||
        item.field + "-" + item.term + "-" + results.length;

      if (seen.has(id)) continue;

      seen.add(id);
      results.push({
        record,
        url: item.url
      });

      if (results.length >= 20) return results;
    }
  }

  return results;
}

function resultDetails(info) {
  return {
    input: info.input,
    displayName: info.displayName,
    rxcui: info.rxcui,
    matchScore: info.matchScore,
    matchRank: info.matchRank
  };
}

function collectTargetClassTerms(labels) {
  return unique(
    labels.flatMap((item) => pharmacologicClassTerms(item.record))
  ).slice(0, 30);
}

function classTermsForDrug(labels) {
  return collectTargetClassTerms(labels);
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

  let stage = "input";
  try {
    stage = "rxnorm-first";
    const first = await normalizeDrug(firstInput);
    stage = "rxnorm-second";
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

    stage = "fda-first";
    const firstLabels = await getLabels(first);

    if (!firstLabels.length) {
      return json({
        first: resultDetails(first),
        second: resultDetails(second),
        evidence: [],
        status: "no_fda_label"
      });
    }

    const secondIsDrug = second.kind === "drug";
    let evidence = [];

    if (secondIsDrug) {
      stage = "fda-second";
      const secondLabels = await getLabels(second);

      const secondTerms = unique(
        (second.terms || []).concat([secondInput])
      );

      stage = "evidence-forward";
      const secondClassTerms = classTermsForDrug(secondLabels);
      evidence = interactionEvidence(
        firstLabels,
        secondTerms,
        secondClassTerms
      );

      const reverseTerms = unique(
        (first.terms || []).concat([firstInput])
      );

      stage = "evidence-reverse";
      const firstClassTerms = classTermsForDrug(firstLabels);
      evidence = evidence
        .concat(
          interactionEvidence(
            secondLabels,
            reverseTerms,
            firstClassTerms
          )
        )
        .slice(0, 8);
    } else {
      stage = "evidence-food";
      evidence = interactionEvidence(
        firstLabels,
        foodTerms(secondInput)
      );
    }

    return json({
      first: resultDetails(first),
      second: resultDetails(second),
      evidence,
      status: evidence.length ? "label_mention" : "no_label_mention"
    });
  } catch (error) {
    console.error("Interaction lookup failed", { stage, error });
    const debug = new URL(request.url).searchParams.get("debug") === "1";
    return json(
      {
        error: "The drug-information services could not complete the lookup.",
        code: "LOOKUP_FAILED",
        ...(debug ? {
          stage,
          detail: String(error && error.message || error)
        } : {})
      },
      502
    );
  }
}
