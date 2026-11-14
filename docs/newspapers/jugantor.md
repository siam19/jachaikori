# Daily Jugantor (দৈনিক যুগান্তর) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.jugantor.com`
- **Language:** Bangla
- **Platform:** Custom PHP / Laravel with Cloudflare protection
- **Direct HTTP Accessibility:** ❌ Plain `fetch` returns `403 Forbidden` ("Just a moment...").
- **Playwright Accessibility:** ✅ Fully accessible via Playwright with `--disable-blink-features=AutomationControlled` and browser headers.

---

## 2. Archive & Listing Mechanism

Jugantor has a dedicated, queryable date archive page:

- **Base Archive URL:**
  ```
  https://www.jugantor.com/archive
  ```

### Query Parameters:
The archive form submits query parameters allowing precise date/time window queries:
- `search=yes`: Activates search mode
- `dateFrom`: Start timestamp formatted as `YYYY-MM-DD+HH:mm` (e.g. `2026-11-13+00:00`)
- `dateTo`: End timestamp formatted as `YYYY-MM-DD+HH:mm` (e.g. `2026-11-14+23:59`)
- `headline`: Headline keyword filter (leave empty for all news)
- `newsType`: Filter for online vs print edition (leave empty for all)
- `page`: Page index (e.g. `page=2`, `page=3`)

### Example Archive Query:
```
https://www.jugantor.com/archive?search=yes&headline=&dateFrom=2026-11-13+00%3A00&dateTo=2026-11-14+23%3A59&page=1
```

---

## 3. DOM Selectors & HTML Structure

Each article in the archive is cleanly contained inside a `.media` element:

```html
<div class="media positionRelative paddingLR10 hoverZoom">
  <div class="media-left">
    ... image thumbnail ...
  </div>
  <div class="media-body marginL5">
    <h4 class="title10 marginT2">কম ভাত খেয়েও রক্তে শর্করা বেশি: কী করবেন</h4>
    <p class="desktopSummary marginT10 hidden-xs">ডায়াবেটিস রোগীরা অনেক সময়...</p>
    <p class="desktopTime marginT10"><i class="fa fa-regular fa-clock"></i> ১৪ নভেম্বর ২০২৬, ০৩:২৯ পিএম</p>
  </div>
  <a href="https://www.jugantor.com/tp-stay-well/1184072" class="linkOverlay"></a>
</div>
```

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.media.positionRelative`, `.media` | Parent card element |
| **Article URL** | `a.linkOverlay` (attribute `href`) | e.g. `https://www.jugantor.com/national/1184294` |
| **Headline** | `.media-body h4.title10`, `.media-body h4` | e.g. `কম ভাত খেয়েও রক্তে শর্করা বেশি: কী করবেন` |
| **Published Time** | `p.desktopTime` | Exact timestamp: `১৪ নভেম্বর ২০২৬, ০৩:২৯ পিএম` |
| **Summary Snippet** | `p.desktopSummary` | Lead paragraph snippet |
| **Next Page Link** | `nav a:has-text("Next"), a[rel="next"]` | Next pagination link with `&page=N` |

---

## 4. Date Parsing

The timestamp in `p.desktopTime` follows the format:
```
১৪ নভেম্বর ২০২৬, ০৩:২৯ পিএম
```
- Digits: Bangla numerals (`০-৯`)
- Month: Bangla month name (`নভেম্বর`)
- Time: 12-hour format with `এএম` / `পিএম` (AM / PM)
- Handled directly by `@jachaikori/crawler`'s `parsePublishedDate()`.

---

## 5. Automation Strategy

1. **Use Playwright:** Load archive pages with Playwright context.
2. **Date Window Walk:**
   - Step day-by-day backwards: set `dateFrom=YYYY-MM-DD+00:00` and `dateTo=YYYY-MM-DD+23:59`.
   - Iterate through pages: `page=1`, `page=2`, etc. until the "Next" link disappears.
   - Move to the previous calendar day.
3. **Cursor State:** `{"date": "YYYY-MM-DD", "page": N}`.
