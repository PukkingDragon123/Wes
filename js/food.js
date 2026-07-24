/* =============================================================================
   food.js — ingredients, recipes, and their pixel icons. Shared by the
   dumpster-dive and cooking mini-games, the HUD, and the kids' wants.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;

  // ---- ingredient art (8x8 pixmaps) -----------------------------------
  const ING = {
    fish: { name: "FISH", pal: { b: "#6fa3c9", B: "#3f6f95", w: "#f4f6ff", t: "#4f83a5", e: "#12202c" }, px: [
      "........", "...bbb..", "..bbbbbt", ".Bbbbbbt", ".wBbbbbt", "..bbbbbt", "...bbb..", "........"] },
    bread: { name: "BREAD", pal: { n: "#d7a86a", N: "#f0c88a", d: "#a9743f" }, px: [
      "........", "..NNNN..", ".NnnnnN.", ".nnnnnn.", ".nnnnnn.", ".dnnnnd.", "..dddd..", "........"] },
    meat: { name: "MEAT", pal: { m: "#8a4a34", M: "#a85a40", d: "#5e3020" }, px: [
      "........", "........", ".mMMMMm.", "mMMMMMMm", "mMMMMMMm", ".dmmmmd.", "........", "........"] },
    cheese: { name: "CHEESE", pal: { y: "#f2c94c", Y: "#ffe08a", o: "#d9a93a" }, px: [
      "........", "....YY..", "..YYYyy.", ".YyyoyyY", ".yyyyyoy", ".yoyyyy.", "..yyyy..", "........"] },
    egg: { name: "EGG", pal: { w: "#f4f4ec", y: "#ffcf5c", o: "#e0a83a" }, px: [
      "........", ".wwwww..", "wwwwwww.", "wwoyoww.", "wwyyyww.", ".wwwww..", "...ww...", "........"] },
    tomato: { name: "TOMATO", pal: { r: "#c8382c", R: "#ff6a5a", g: "#6fae4a", d: "#8f2018" }, px: [
      "...g....", "..ggg...", ".RRRRR..", "RRRRRRR.", "RRrrrRR.", "RrrrrrR.", ".RddrR..", "........"] },
    noodle: { name: "RICE", pal: { p: "#ece6d0", P: "#fff8e0", d: "#c9c0a0" }, px: [
      "........", ".pPpPp..", "pPpdPpp.", ".pdpdp..", "pPpPpdp.", ".pPpPp..", "........", "........"] },
    apple: { name: "APPLE", pal: { r: "#c8382c", R: "#ff5a4a", g: "#6fae4a", s: "#6a4a2a" }, px: [
      "...s....", "..sg....", ".RRRRR..", "RRRRRRR.", "RRrrrRR.", "RrrrrrR.", ".RrrrR..", "........"] },
  };

  const RECIPES = [
    { id: "burger", name: "BURGER", ing: ["bread", "meat", "cheese"] },
    { id: "sushi", name: "SUSHI", ing: ["fish", "noodle"] },
    { id: "omelette", name: "OMELETTE", ing: ["egg", "cheese", "tomato"] },
    { id: "grilled", name: "GRILLED CHEESE", ing: ["bread", "cheese"] },
    { id: "stew", name: "FISH STEW", ing: ["fish", "tomato", "noodle"] },
  ];

  function counts(list) { const c = {}; for (const id of list) c[id] = (c[id] || 0) + 1; return c; }

  const Food = RC.Food = {
    ING, RECIPES,
    ids: Object.keys(ING),
    recipe(id) { return RECIPES.find((r) => r.id === id); },
    name(id) { return ING[id] ? ING[id].name : id; },

    have(inv, recipe) {
      const need = counts(recipe.ing);
      for (const id in need) if ((inv[id] || 0) < need[id]) return false;
      return true;
    },
    consume(inv, recipe) { for (const id of recipe.ing) inv[id] = Math.max(0, (inv[id] || 0) - 1); },
    // list of [id, missing?] for a recipe given inventory
    breakdown(inv, recipe) {
      const need = counts(recipe.ing), got = {};
      return recipe.ing.map((id) => { got[id] = (got[id] || 0) + 1; return { id, missing: (inv[id] || 0) < got[id] }; });
    },

    // draw a single ingredient icon centred at (x,y). scale = pixel size.
    drawIngredient(ctx, x, y, id, scale) {
      const g = ING[id]; if (!g) return;
      const s = scale || 1, rows = g.px, W = rows[0].length, H = rows.length;
      const ox = Math.round(x - W * s / 2), oy = Math.round(y - H * s / 2);
      for (let ry = 0; ry < H; ry++) {
        const row = rows[ry];
        for (let rx = 0; rx < W; rx++) {
          const c = g.pal[row[rx]];
          if (c) { ctx.fillStyle = c; ctx.fillRect(ox + rx * s, oy + ry * s, s, s); }
        }
      }
    },

    // draw a plated dish (a little stack of its ingredients on a plate)
    drawDish(ctx, x, y, recipe, scale) {
      const s = scale || 1;
      // plate
      ctx.fillStyle = "#cfd2e2"; ctx.fillRect(x - 11 * s, y, 22 * s, 2 * s);
      ctx.fillStyle = "#eef0fb"; ctx.fillRect(x - 11 * s, y, 22 * s, 1 * s);
      ctx.fillStyle = "#a9adc4"; ctx.fillRect(x - 9 * s, y + 2 * s, 18 * s, 1 * s);
      // stacked ingredients
      const n = recipe.ing.length;
      for (let i = 0; i < n; i++) {
        this.drawIngredient(ctx, x, y - 2 * s - i * 5 * s, recipe.ing[i], s);
      }
    },
  };

})(window);
