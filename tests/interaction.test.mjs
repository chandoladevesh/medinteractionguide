import test from "node:test";
import assert from "node:assert/strict";
import {
  containsTerm,
  foodTerms,
  rxNormCandidate,
  collectRxNormTerms,
  pharmacologicClassTerms,
  interactionEvidence
} from "../functions/_lib/interaction.mjs";

test("containsTerm handles exact word boundaries", () => {
  assert.equal(containsTerm("Warfarin increases bleeding risk.", "warfarin"), true);
  assert.equal(containsTerm("warfarin-like", "warfarin"), true);
  assert.equal(containsTerm("warfarinization", "warfarin"), false);
});

test("food aliases expand common inputs", () => {
  assert.deepEqual(foodTerms("grapefruit"), ["grapefruit", "grapefruit juice"]);
  assert.deepEqual(foodTerms("mango"), ["mango"]);
});

test("RxNorm candidate chooses the highest-ranked RXNORM candidate", () => {
  const candidate = rxNormCandidate([
    { source: "RXNORM", rank: "2", score: "15", rxcui: "2" },
    { source: "RXNORM", rank: "1", score: "12", rxcui: "1" },
    { source: "RXNORM", rank: "1", score: "18", rxcui: "3" },
    { source: "GS", rank: "1", score: "20", rxcui: "4" }
  ]);

  assert.equal(candidate.rxcui, "3");
});

test("RxNorm term collection includes ingredient and product concepts", () => {
  const terms = collectRxNormTerms([
    { tty: "IN", conceptProperties: [{ name: "warfarin" }] },
    { tty: "SBD", conceptProperties: [{ name: "Coumadin 5 MG Oral Tablet" }] },
    { tty: "SY", conceptProperties: [{ name: "warfarin sodium" }] }
  ], "warfarin");

  assert.deepEqual(terms, [
    "warfarin",
    "Coumadin 5 MG Oral Tablet"
  ]);
});

test("FDA pharmacologic class fields become searchable target terms", () => {
  const terms = pharmacologicClassTerms({
    openfda: {
      pharm_class_epc: ["Anticoagulants"],
      pharm_class_moa: ["Vitamin K Antagonists"]
    }
  });

  assert.deepEqual(terms, [
    "Anticoagulants",
    "Vitamin K Antagonists"
  ]);
});

test("interaction evidence distinguishes direct and class-level matches", () => {
  const direct = interactionEvidence(
    [{ url: "https://example.test", record: { drug_interactions: ["Avoid concomitant use with ibuprofen."] } }],
    ["ibuprofen"],
    []
  );

  const classLevel = interactionEvidence(
    [{ url: "https://example.test", record: { drug_interactions: ["Use caution with anticoagulants."] } }],
    ["apixaban"],
    ["anticoagulants"]
  );

  assert.equal(direct[0].matchType, "direct");
  assert.equal(classLevel[0].matchType, "class");
});
