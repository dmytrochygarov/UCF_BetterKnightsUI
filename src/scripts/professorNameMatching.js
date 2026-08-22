// ---------- Normalization ----------
function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
const STOP = new Set([
  "dr",
  "prof",
  "prof.",
  "professor",
  "mr",
  "mrs",
  "ms",
  "ms.",
  "phd",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
]);
function tokenize(raw) {
  if (!raw) return [];
  let s = stripAccents(String(raw).toLowerCase());
  s = s
    .replace(/[-.,']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = s.split(" ").filter((t) => t && !STOP.has(t));
  return tokens;
}

// ---------- Jaro-Winkler (0..1) ----------
function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDist = Math.max(
    0,
    Math.floor(Math.max(a.length, b.length) / 2) - 1
  );
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);

  let matches = 0,
    transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (aMatch[i]) {
      while (!bMatch[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ---------- Helpers ----------
function joinRange(tokens, i, j) {
  return tokens.slice(i, j + 1).join(" ");
}
function surnameCandidates(tokens) {
  const n = tokens.length;
  const cands = [];
  for (let k = 1; k <= 3; k++) {
    if (n - k >= 0)
      cands.push({
        start: n - k,
        end: n - 1,
        str: joinRange(tokens, n - k, n - 1),
        where: "suffix",
      });
  }
  for (let k = 1; k <= Math.min(3, n); k++) {
    cands.push({
      start: 0,
      end: k - 1,
      str: joinRange(tokens, 0, k - 1),
      where: "prefix",
    });
  }
  const key = new Set(),
    out = [];
  for (const c of cands) {
    const k = `${c.start}-${c.end}`;
    if (!key.has(k)) {
      key.add(k);
      out.push(c);
    }
  }
  return out;
}

// expectedIdx is the conventional given-name position for the chosen surname
// range: token 0 when the surname is a suffix ("First Last"), the token right
// after the surname when it is a prefix ("Last First"). A token anywhere else
// (a middle name, say) is capped below 1.0 so "David Alan Cohen" cannot be a
// perfect match for an RMP "Alan Cohen" — only the conventional position may
// produce the perfect score the >= 1 threshold demands.
function bestGivenSim(targetFirst, tokens, usedRange, expectedIdx) {
  if (!targetFirst) return { score: 0, token: null, reason: null };
  const { start, end } = usedRange;
  let best = { score: 0, token: null, reason: null };

  // Compare the whole non-surname remainder first, so multi-token first
  // names ("jean luc", "anna maria") can reach an exact 1.0 — individual
  // tokens alone never can. Non-equal remainders stay below 1 by JW's
  // definition, so this cannot loosen the threshold.
  const outside = tokens.filter((t, i) => i < start || i > end);
  const remainder = outside.join(" ");
  if (remainder && outside.length > 1) {
    const s =
      remainder === targetFirst ? 1 : jaroWinkler(targetFirst, remainder);
    if (s > best.score) best = { score: s, token: remainder, reason: "remainder" };
  }

  for (let i = 0; i < tokens.length; i++) {
    if (i >= start && i <= end) continue; // skip chosen surname tokens
    const t = tokens[i];
    let s, reason;
    if (t === targetFirst) {
      // exact equality must win even for single-letter first names, which
      // the "initial" branch below would otherwise cap at 0.95
      s = 1;
      reason = "exact";
    } else if (t.length === 1 && t[0] === targetFirst[0]) {
      s = 0.95;
      reason = "initial";
    } else {
      s = jaroWinkler(targetFirst, t);
      reason = "jw";
    }
    if (i !== expectedIdx) s = Math.min(s, 0.98);
    if (s > best.score) best = { score: s, token: t, reason };
  }
  return best;
}

// ---------- Main (with logs) ----------
/**
 * professors: [{ id, firstName, lastName }]
 * rawName: string from the other site
 * opts: { minSurname?: number, minScore?: number, verbose?: boolean, logger?: fn }
 * returns id or null
 */
function getMatchingProfessorId(rawName, professors) {
  const SURNAME_W = 0.7;
  const GIVEN_W = 0.3;

  const inputTokens = tokenize(rawName);
  if (!inputTokens.length) return null;

  const candRanges = surnameCandidates(inputTokens);

  for (const p of professors) {
    const first = tokenize(p.firstName).join(" ");
    const last = tokenize(p.lastName).join(" ");

    if (!last) continue;

    // score all surname candidates against this professor's last name (for transparency)
    const surnameScores = candRanges
      .map((r, i) => ({
        idx: i,
        where: r.where,
        range: [r.start, r.end],
        cand: r.str,
        sim: jaroWinkler(last, r.str),
      }))
      .sort((a, b) => b.sim - a.sim);

    const picked = surnameScores[0];
    const pickedRange = candRanges[picked.idx];
    const given = bestGivenSim(
      first,
      inputTokens,
      { start: pickedRange.start, end: pickedRange.end },
      pickedRange.where === "suffix" ? 0 : pickedRange.end + 1
    );

    const surnameSim = picked.sim;
    const givenSim = given.score;
    let score = SURNAME_W * surnameSim + GIVEN_W * givenSim;

    p.score = score;
    p.matchWhere = picked.where;
  }

  // LOGIC EXPLANATION
  // - only take seriously perfect scores (1.00)
  // - prefer the conventional "First Last" orientation over a reversed
  //   ("Last First") one: for input "Ali Hassan", both RMP "Ali Hassan"
  //   (suffix surname) and RMP "Hassan Ali" (prefix surname) score 1.0,
  //   and only orientation tells the two humans apart
  // - then return based on whoever has more ratings
  // - if zero ratings, ignore also

  const sortedProfessors = professors
    .filter((p) => p.score >= 1)
    .sort(
      (a, b) =>
        (a.matchWhere === "suffix" ? 0 : 1) -
          (b.matchWhere === "suffix" ? 0 : 1) ||
        b.numRatings - a.numRatings
    );

  if (!sortedProfessors || sortedProfessors.length === 0) return null;
  return sortedProfessors[0].id;
}

function getMatchingProfessor(rawName, professors) {
  const professorId = getMatchingProfessorId(rawName, professors);
  if (!professorId) return null;
  return professors.find((p) => p.id === professorId);
}
