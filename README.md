# Compare Visualizer

Vizualizace exportu AI porovnávače (`studio_results_*.json`). Statická stránka podle [grafického manuálu JK](https://www.jan-kuchar.cz/brand/manual.html), data se zpracují jen v prohlížeči.

**Web:** https://compare-visualiser.jan-kuchar.cz

## Co umí
- Nahrání jednoho nebo více JSON souborů (přetažením nebo výběrem), sloučení podle `compare_id`.
- KPI: počet porovnání, úspěšnost (OK / neúplné), produkty na porovnání, medián do zpětné vazby, průměrné hodnocení.
- Grafy: porovnání podle měsíce a typu uživatele, typy uživatelů, počet požadovaných / vrácených produktů, nejčastější štítky a zvýraznění.
- Filtry (hledání, stav, typ uživatele, měsíc), řazení tabulky, detail porovnání s chybějícími produkty, export CSV.
- Světlý i tmavý režim, zkratky ⌘K, ↑ ↓, Enter, Esc, ⌘⇧L.

## Struktura
- `site/` – obsah webu (`index.html`, `styles.css`, `app.js`, `favicon.svg`, `CNAME`)
- `.github/workflows/pages.yml` – nasazení na GitHub Pages po pushi do `main`

## Nasazení
1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Pages → Custom domain: `compare-visualiser.jan-kuchar.cz`, zapnout Enforce HTTPS.
3. DNS: záznam `CNAME compare-visualiser → jenikkuchar.github.io`.

Lokálně: `python3 -m http.server --directory site`.

Exporty dat (`*.json`) jsou v `.gitignore`, obsahují ID uživatelů.
