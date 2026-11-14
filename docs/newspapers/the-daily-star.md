# The Daily Star — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.thedailystar.net`
- **Language:** English
- **Platform:** Drupal 10 with custom frontend theme (`swallow`)
- **Direct HTTP Accessibility:** ✅ Accessible via standard HTTP (`fetch` / Cheerio). Server-side renders initial items and supports standard Drupal query parameters (`?page=N`).
- **Bot Detection:** Standard rate limiting. Respects standard headers.

---

## 2. Archive & Listing Mechanism

The Daily Star does not have a comprehensive public date archive search. Content is browsed by category sections using standard Drupal Views pagination.

### Target Categories:
- **Politics (`politics`):** `https://www.thedailystar.net/news/politics`
- **Governance (`national`):** `https://www.thedailystar.net/news/governance`
- **Crime & Justice (`law-courts`):** `https://www.thedailystar.net/news/crime-justice`
- **Economy (`economy`):** `https://www.thedailystar.net/business/economy`
- **Startups (`economy`):** `https://www.thedailystar.net/business/startups`
- **Accidents & Fires (`general`):** `https://www.thedailystar.net/news/accidents-and-fires`

---

## 3. Pagination Discovery

The UI renders a **"Show More"** link at the bottom of `.view-content`:
```html
<li class="pager__item">
  <a href="?page=1">Show More</a>
</li>
```

### Both Query Param & Drupal AJAX Work:
1. **Plain Query Param (`?page=N`):**
   - Simply navigating or fetching `https://www.thedailystar.net/news/politics?page=1`, `?page=2`, etc., renders the full HTML with the next batch of articles directly!
2. **Drupal Views AJAX Endpoint:**
   - The interactive button calls:
     ```
     GET https://www.thedailystar.net/views/ajax?view_name=category_show_more&view_display_id=block_1&view_args=<termId>&page=1&_drupal_ajax=1
     ```
   - However, since standard `?page=N` returns full HTML, we do not need to parse Drupal AJAX JSON commands! Standard HTTP `fetch(".../news/politics?page=" + page)` is 100% sufficient.

---

## 4. DOM Selectors & HTML Structure

On category pages, the layout includes:
1. **Featured Top Section:** Top 10 highlighted articles.
2. **Main Views Listing (`.view-content`):** The chronologically paginated articles.

```html
<div class="view-content">
  <div class="card ...">
    <h3 class="title">
      <a href="/news/politics/news/she-still-hurting-nation-even-after-fleeing-shafiqur-rahman-4323616">
        ‘She is still hurting nation even after fleeing’: Shafiqur Rahman
      </a>
    </h3>
    <span class="date">Nov 14, 2026</span>
  </div>
</div>
```

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.view-content .card, .view-content article, .view-content > div` | Card wrapper |
| **Headline** | `h3 a, h2 a, .title a, a[href*="/news/"]` text | e.g. `‘She is still hurting nation even after fleeing’: Shafiqur Rahman` |
| **Article URL** | `a[href*="/news/"]` or `h3 a` (attribute `href`) | e.g. `/news/politics/news/...-4323616` |
| **Published Time** | `.date, time, span.date, .time` | Format: `Nov 14, 2026` or relative `1 hour ago` |
| **Pager / Show More** | `li.pager__item a` (has `?page=N`) | Points to next page |

---

## 5. Article URL Structure & Canonicalization

- **URL Pattern:** `https://www.thedailystar.net/<category>/<subcategory>/news/<slug>-<articleId>`
- **Example:** `https://www.thedailystar.net/news/politics/news/11-party-alliance-puts-dhaka-sylhet-long-march-hold-4323571`
- Canonicalization: Strip query params and ensure `https://www.thedailystar.net` prefix.

---

## 6. Automation Strategy

1. **Pure HTTP / Cheerio:**
   - Loop `page = 0, 1, 2, ...` on `https://www.thedailystar.net/<section>?page=N`.
   - Parse `.view-content` cards.
   - Parse English dates (`Nov 14, 2026`) via `parsePublishedDate()`.
   - Stop when consecutive items fall before cutoff date (e.g. 2026-01-01) or page returns 0 articles.
2. **Cursor State:** `{"section": "politics", "page": N}`.
