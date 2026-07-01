// engine/intel-shape.js
// ═══════════════════════════════════════════════════════════════════════════
// ONE canonical intel.* shape — the single source of truth for the 📋 card.
// Every capture path (engine parsers, browser live-sync, CSV import) folds its
// findings into a province through mergeIntel(p, patch), so all three feeds
// produce the IDENTICAL shape that enemyIntelHtml() renders.
//
// This file is CommonJS (engine).  The SAME function bodies are mirrored inline
// in warroom.html and warroom-mobile.html as `WRIntel` — keep the three in sync.
//
// mergeIntel(p, patch): folds a normalized `patch` into province `p`, writing
//   • the FLAT header fields the card reads (race/pers/ruler/land/nw/pop/honor/
//     offense/defense/tpa/wpa/mdtpa/mdwpa/stealth/mana/prisoners/warHorses)
//   • the p.intel.* substructure (throne map, econ, military w/ EPA·OSPA·DSPA,
//     science[], survey w/ under-construction, ritual/plague/warWith), and
//   • the p.ops[] op-log + provenance (intelType, lastScout).
// Partial patches NEVER clobber existing data — blank/null/"" fields are skipped
// — so throne + military + science + survey pages accumulate into one full card.
// ═══════════════════════════════════════════════════════════════════════════
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root || (typeof self !== "undefined" ? self : this)).WRIntel = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // Parse a game number: strip commas/spaces, tolerate trailing units ("772,777 gold" / "112%").
  function numI(x) {
    if (x == null) return null;
    if (typeof x === "number") return isFinite(x) ? x : null;
    var v = parseFloat(("" + x).replace(/[, ]/g, "").replace(/[^0-9.\-].*$/, ""));
    return isFinite(v) ? v : null;
  }
  // Assign only when meaningful (allows 0; skips null / NaN / "").
  function setIf(o, k, v) {
    if (v == null) return;
    if (typeof v === "number" && isNaN(v)) return;
    if (typeof v === "string" && v.trim() === "") return;
    o[k] = v;
  }
  function perAcre(n, land) { return (n != null && land) ? Math.round(n / land * 100) / 100 : null; }

  // Provenance rank — a stronger source's label wins; 'throne' is stickiest.
  var TYPE_RANK = { throne: 6, military: 5, survey: 4, science: 3, guild: 2, wizards: 2, econ: 2, defense: 1, exploration: 1, ritual: 1, dragon: 1, "": 0 };

  function mergeIntel(p, patch) {
    if (!p || !patch) return p;
    var it = p.intel || (p.intel = {});
    var now = patch.now || 0, ts = patch.ts || now || 0;

    // ── flat header fields ──
    setIf(p, "race", patch.race);
    setIf(p, "pers", patch.pers);
    setIf(p, "ruler", patch.ruler);
    setIf(p, "land", numI(patch.land));
    setIf(p, "nw", numI(patch.nw));
    setIf(p, "pop", numI(patch.pop));
    setIf(p, "honor", numI(patch.honor));
    setIf(p, "offense", numI(patch.offense));
    setIf(p, "defense", numI(patch.defense));
    setIf(p, "stealth", numI(patch.stealth));
    setIf(p, "mana", numI(patch.mana));
    setIf(p, "prisoners", numI(patch.prisoners));
    setIf(p, "warHorses", numI(patch.warHorses));

    var L = numI(p.land) || numI(patch.land) || 0;

    // ── thieves / wizards → counts + per-acre (tpa/wpa direct, mdtpa/mdwpa modified) ──
    if (patch.thieves != null) { it.thieves = numI(patch.thieves); var t = perAcre(it.thieves, L); if (t != null) p.tpa = t; }
    if (patch.wizards != null) { it.wizards = numI(patch.wizards); var w = perAcre(it.wizards, L); if (w != null) p.wpa = w; }
    if (patch.tpa != null) { p.mdtpa = numI(patch.tpa); if (!Number(p.tpa)) p.tpa = numI(patch.tpa); }
    if (patch.wpa != null) { p.mdwpa = numI(patch.wpa); if (!Number(p.wpa)) p.wpa = numI(patch.wpa); }
    setIf(p, "mdtpa", numI(patch.mdtpa));
    setIf(p, "mdwpa", numI(patch.mdwpa));

    // ── throne econ map (accumulate keys, never wipe) ──
    if (patch.throne && typeof patch.throne === "object") {
      var T = it.throne || (it.throne = {});
      for (var k in patch.throne) { if (patch.throne[k] != null && patch.throne[k] !== "") T[k] = patch.throne[k]; }
      it.throneTs = ts || it.throneTs;
      setIf(it, "throneDate", patch.throneDate);
    }
    // ── discrete economy (pages that give econ without the full throne grid) ──
    if (patch.econ && typeof patch.econ === "object") {
      var E = it.econ || (it.econ = {});
      for (var ek in patch.econ) { var ev = numI(patch.econ[ek]); if (ev != null) E[ek] = ev; }
      it.econTs = ts || it.econTs;
    }

    // ── military (EPA/OSPA/DSPA, generals, units, army-out) ──
    if (patch.military && typeof patch.military === "object") {
      var M = patch.military;
      setIf(it, "ome", numI(M.ome)); setIf(it, "dme", numI(M.dme));
      setIf(it, "generals", numI(M.generals)); setIf(it, "generalsAvail", numI(M.generalsAvail));
      setIf(it, "soldiers", numI(M.soldiers));
      setIf(it, "offSpecs", numI(M.offSpecs)); setIf(it, "defSpecs", numI(M.defSpecs));
      setIf(it, "elites", numI(M.elites)); setIf(it, "warHorses", numI(M.warHorses));
      if (M.units && M.units.length) it.units = M.units;
      if (M.offHome != null) { it.offHome = numI(M.offHome); if (it.offHome != null) p.offense = it.offHome; }
      if (M.defHome != null) { it.defHome = numI(M.defHome); if (it.defHome != null) p.defense = it.defHome; }
      if (M.armyReturnDays && M.armyReturnDays.length) { it.armyReturnDays = M.armyReturnDays; p.armyOut = true; }
      if (M.armyOut != null) p.armyOut = !!M.armyOut;
      if (M.incomingLand != null) p.incomingLand = numI(M.incomingLand);
      if (M.returnTick != null) p.returnTick = numI(M.returnTick);
      if (M.generalsUsed != null) p.generalsUsed = numI(M.generalsUsed);
      if (L) {
        if (it.offSpecs != null) it.ospa = perAcre(it.offSpecs, L);
        if (it.defSpecs != null) it.dspa = perAcre(it.defSpecs, L);
        if (it.elites != null) it.epa = perAcre(it.elites, L);
      }
      it.milTs = ts || it.milTs;
    }

    // ── science ──
    if (patch.science && patch.science.length) { it.science = patch.science; it.sciTs = ts || it.sciTs; }
    if (patch.scientistGen != null) it.scientistGen = numI(patch.scientistGen);
    if (patch.nextCat) it.nextCat = patch.nextCat;

    // ── buildings / survey (+ under-construction) ──
    if (patch.survey && typeof patch.survey === "object") {
      var sv = it.survey || (it.survey = {});
      if (patch.survey.buildings && patch.survey.buildings.length) sv.buildings = patch.survey.buildings;
      if (patch.survey.total != null) sv.total = numI(patch.survey.total);
      if (patch.survey.stats) { sv.stats = sv.stats || {}; for (var sk in patch.survey.stats) if (patch.survey.stats[sk] != null) sv.stats[sk] = patch.survey.stats[sk]; }
      if (patch.survey.underConstruction && patch.survey.underConstruction.length) sv.underConstruction = patch.survey.underConstruction;
      sv.ts = ts || sv.ts;
    }

    // ── spells / flags ──
    if (patch.spells) p.spells = patch.spells;
    if (patch.ritual) it.ritual = patch.ritual;
    if (patch.plague != null) it.plague = !!patch.plague;
    if (patch.warWith) it.warWith = patch.warWith;

    // ── op log (append, capped) ──
    if (patch.op) {
      var ops = p.ops || (p.ops = []);
      ops.push({ op: patch.op.op || "op", ts: ts, detail: patch.op.detail || "" });
      if (ops.length > 50) p.ops = ops.slice(-50);
      p.lastScoutOp = patch.op.op || p.lastScoutOp;
    }

    // ── provenance ──
    if (patch.type) {
      var cur = TYPE_RANK[p.intelType] || 0, inc = TYPE_RANK[patch.type] || 0;
      if (!p.intelType || inc >= cur) p.intelType = patch.type;
    }
    if (now) p.lastScout = Math.max(p.lastScout || 0, now);

    return p;
  }

  return { mergeIntel: mergeIntel, numI: numI };
});
