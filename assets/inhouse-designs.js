// In-house designs — several fixed merchant designs on a single product.
//
// A product's shader comes from its `shader-[file]` tag and its *look* used to
// come from that shader snippet's hardcoded `value:` defaults, so one product
// meant one design. A product can now carry a `custom.inhouse_designs` JSON
// metafield — a list of saved value sets, one per value of a "Design" product
// option — letting the merchant add a design by pasting JSON in admin instead
// of editing the theme and redeploying.
//
// Everything here is deliberately pure and DOM-free so it can be unit tested
// directly; the wiring that reads the metafield, walks the option radios and
// drives the shader state lives in sections/main-product.liquid.
//
// Entry shape (see docs/in-house-products.md):
//   { "option": "Chladni Bloom", "shader": "chladni", "values": { ... } }
//
// `values` is the raw window._shaderState.values shape: colors are [r,g,b]
// floats in whatever space the uniform expects (linear for literal colors,
// pass-through for palette coefficients — see snippets/shader-color-utils.liquid)
// and `toRadians` controls are stored in radians. Values are copied verbatim in
// and out of state, so no conversion happens here and none should be added:
// converting through hex would collapse exactly the per-key distinctions that
// shader-color-utils exists to preserve.
(function () {
  'use strict';

  // Returns the design entry for `optionValue`, or null when there isn't a
  // usable one. Null always means "fall back to the shader snippet's own
  // defaults", which is what a product with no metafield at all renders.
  function pickDesign(designs, optionValue, shaderFile) {
    if (!Array.isArray(designs) || optionValue == null) return null;

    for (var i = 0; i < designs.length; i++) {
      var d = designs[i];
      if (!d || typeof d !== 'object') continue;
      if (d.option !== optionValue) continue;
      if (!d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;
      // A design is a value set for one specific shader. Applying it to a
      // different shader would write the handful of keys the two happen to
      // share and leave the rest at their defaults — a hybrid look that is
      // very hard to trace back to a mistyped `shader` field. Skip instead.
      if (d.shader && shaderFile && d.shader !== shaderFile) return null;
      return d;
    }
    return null;
  }

  // Copies `designValues` into `stateValues` in place, returning the number of
  // keys written. Only keys the shader already declared are copied: a control
  // renamed or removed since the metafield was written would otherwise inject
  // a key nothing reads (harmless) or one the shader half-reads (not).
  function mergeDesignValues(stateValues, designValues) {
    if (!stateValues || !designValues) return 0;
    var written = 0;
    Object.keys(designValues).forEach(function (k) {
      if (!(k in stateValues)) return;
      var v = designValues[k];
      // Clone arrays so a later in-place edit of the live state (the GUI writes
      // colors element-wise) can't mutate the design entry it came from.
      stateValues[k] = Array.isArray(v) ? v.slice() : v;
      written++;
    });
    return written;
  }

  // Identifies which product option selects the design, by matching the
  // option's values against the entries' `option` keys rather than looking for
  // a literal "Design" name — so renaming the option in Shopify (to "Style",
  // "Colorway", ...) doesn't silently stop the switcher from working.
  //
  // options: [{ name: 'Size', values: ['S','M'] }, ...]
  function findDesignOption(options, designs) {
    if (!Array.isArray(options) || !Array.isArray(designs) || !designs.length) return null;

    var names = {};
    designs.forEach(function (d) {
      if (d && typeof d.option === 'string') names[d.option] = true;
    });

    var best = null, bestHits = 0;
    options.forEach(function (opt) {
      if (!opt || !Array.isArray(opt.values)) return;
      var hits = 0;
      opt.values.forEach(function (v) { if (names[v]) hits++; });
      // Require every value to be a known design, so a Size option that happens
      // to share one value with a design name can't win. Ties go to the first
      // option, which is the order Shopify renders them in.
      if (hits && hits === opt.values.length && hits > bestHits) {
        best = opt;
        bestHits = hits;
      }
    });
    return best;
  }

  window.InhouseDesigns = {
    pickDesign: pickDesign,
    mergeDesignValues: mergeDesignValues,
    findDesignOption: findDesignOption
  };
}());
