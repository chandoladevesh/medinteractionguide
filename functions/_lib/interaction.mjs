export const FOOD_ALIASES = {
  grapefruit: ["grapefruit", "grapefruit juice"],
  alcohol: ["alcohol", "ethanol", "alcoholic"],
  caffeine: ["caffeine"],
  dairy: ["milk", "dairy", "calcium"],
  "vitamin k": ["vitamin k"],
  tyramine: ["tyramine"],
  potassium: ["potassium"],
  sodium: ["sodium"]
};

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean).map(clean))];
}

export function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function containsTerm(text, term) {
  const haystack = clean(text).toLowerCase();
  const needle = clean(term).toLowerCase();

  if (!needle) return false;
  if (needle.includes(" ")) return haystack.includes(needle);

  return new RegExp(
    "(^|[^a-z0-9])" + escapeRegex(needle) + "([^a-z0-9]|$)",
    "i"
  ).test(haystack);
}

export function snippets(text, terms) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .filter((part) => terms.some((term) => containsTerm(part, term)))
    .slice(0, 3);
}

export function foodTerms(input) {
  const value = clean(input).toLowerCase();
  return FOOD_ALIASES[value] || [value];
}

export function rxNormCandidate(candidates = []) {
  const active = candidates.filter((item) => String(item.source || "").toUpperCase() === "RXNORM");
  if (!active.length) return null;

  const ranked = active
    .filter((item) => !item.rank || String(item.rank) === "1")
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  return (ranked[0] || active[0]) || null;
}

export function collectRxNormTerms(groups = [], input = "") {
  const terms = [];
  groups.forEach((group) => {
    if (!["IN", "PIN", "MIN", "SCD", "SBD", "GPCK", "BPCK"].includes(String(group.tty || ""))) return;
    (group.conceptProperties || []).forEach((concept) => {
      if (concept.name) terms.push(concept.name);
    });
  });
  return unique(terms.concat([input])).slice(0, 20);
}

export function labelInteractionText(record = {}) {
  return [
    ...(record.drug_interactions || []),
    ...(record.drug_interactions_table || [])
  ].map(String);
}

export function pharmacologicClassTerms(record = {}) {
  const openfda = record.openfda || {};
  return unique([
    ...(openfda.pharm_class_epc || []),
    ...(openfda.pharm_class_moa || []),
    ...(openfda.pharm_class_cs || []),
    ...(openfda.pharm_class_pe || [])
  ]);
}

export function interactionEvidence(labels, targetTerms, targetClassTerms = []) {
  const directTerms = unique(targetTerms);
  const classTerms = unique(targetClassTerms);
  const allTerms = unique(directTerms.concat(classTerms));
  const evidence = [];

  labels.forEach((item) => {
    labelInteractionText(item.record).forEach((section) => {
      const directHit = directTerms.some((term) => containsTerm(section, term));
      const classHit = classTerms.some((term) => containsTerm(section, term));

      if (!directHit && !classHit) return;

      const matchedTerms = directHit ? directTerms : classTerms;

      evidence.push({
        matchType: directHit ? "direct" : "class",
        snippets: snippets(section, matchedTerms),
        url: item.url
      });
    });
  });

  return evidence.slice(0, 8);
}
