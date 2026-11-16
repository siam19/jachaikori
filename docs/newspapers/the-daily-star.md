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
- **Governance (`governance`):** `https://www.thedailystar.net/news/governance`
- **Crime & Justice (`crime-justice`):** `https://www.thedailystar.net/news/crime-justice`
- **Economy (`economy`):** `https://www.thedailystar.net/business/economy`
- **Startups (`startups`):** `https://www.thedailystar.net/business/startups`
- **Accidents & Fires (`accidents-and-fires`):** `https://www.thedailystar.net/news/accidents-and-fires`

---

## 3. Pagination Discovery

The Daily Star uses Drupal 10 with the `views_show_more` module.
**Crucial Finding:** Standard query parameter `?page=N` on full HTML category pages is **ignored** by Drupal 10 (it returns static page 0 indefinitely).

Pagination is exclusively delivered via the Drupal AJAX endpoint:
```http
GET https://www.thedailystar.net/views/ajax?view_name=category_show_more&view_display_id=block_1&view_args=<termId>&page=N&_drupal_ajax=1
X-Requested-With: XMLHttpRequest
Accept: application/json, text/javascript, */*; q=0.01
```

### Discovery Workflow:
1. **Initial Page (`page = 0`):**
   - Fetch category URL (e.g. `https://www.thedailystar.net/news/bangladesh`).
   - Parse top articles from HTML.
   - Extract `view_name`, `view_display_id`, and taxonomy `view_args` from `script[data-drupal-selector="drupal-settings-json"]` (`data.views.ajaxViews`).
2. **Subsequent Pages (`page >= 1`):**
   - Request the `/views/ajax` endpoint with the extracted `view_args`.
   - Parse JSON response array and locate `viewsShowMore` / `insert` command data.
   - Each page yields 20 chronologically paginated articles with clean ISO `time[datetime]`.

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
## 7. Robots.txt & Crawling Policy

- **Robots.txt URL:** `https://www.thedailystar.net/robots.txt`
- **Reviewed On:** 2026-11-15
- **Directives for `User-agent: *`:**
  - `Allow: /`
  - Disallows internal Drupal administration and utility folders (`/core/`, `/admin/`, `/search/`, `/user/*`).
- **Target Paths Permitted:** All public categories (`/news/politics`, `/business/economy`, `/news/*`) and article URLs are fully allowed.
- **Sitemaps:**
  - `https://www.thedailystar.net/sitemap.xml`
  - `https://www.thedailystar.net/googlenews.xml`
- **Recommended Delay:** 1000ms.
