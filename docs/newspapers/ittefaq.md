# The Daily Ittefaq (দৈনিক ইত্তেফাক) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.ittefaq.com.bd`
- **Language:** Bangla
- **Platform:** Custom PHP / Theme Engine (JadeWits)
- **Direct HTTP Accessibility:** ✅ Initial archive page is accessible via standard HTTP (`fetch` / Cheerio).
- **Direct AJAX API Endpoint:** ✅ Underneath the "আরও" button lies a direct HTTP GET endpoint that returns article snippets without needing Playwright DOM clicks!

---

## 2. Archive & Listing Mechanism

Ittefaq provides a dedicated daily archive endpoint:
- **Daily Archive URL:**
  ```
  https://www.ittefaq.com.bd/archive/<YYYY-MM-DD>
  ```
  Example: `https://www.ittefaq.com.bd/archive/2026-11-12`

The page displays initial 20 articles published on that calendar day across all sections.

---

## 3. Direct AJAX API Discovery (No Playwright Needed!)

When clicking the "আরও" button in the UI (`#ajax_load_more_565_btn`), the frontend calls a public AJAX endpoint:

### Endpoint:
```
GET https://www.ittefaq.com.bd/api/theme_engine/get_ajax_contents
```

### Query Parameters:
| Parameter | Value / Role | Example |
| :--- | :--- | :--- |
| `widget` | Widget ID (obtained from `#ajax_load_more_565`) | `565` |
| `start` | Starting offset index | `20`, `40`, `60`, `80` |
| `count` | Number of items to retrieve | `20` |
| `archive_time` | Target date in `YYYY-MM-DD` | `2026-11-12` |
| `page_id` | Page ID | `0` |
| `subpage_id` | Subpage ID | `0` |
| `author` | Author filter | `0` |
| `tags` | Tags filter | (empty) |
| `filter` | Filter | (empty) |

### Full Request Example:
```
https://www.ittefaq.com.bd/api/theme_engine/get_ajax_contents?widget=565&start=20&count=20&page_id=0&subpage_id=0&author=0&tags=&archive_time=2026-11-12&filter=
```

This returns the next batch of article HTML cards. It is fast, lightweight, and requires zero headless browser overhead!

---

## 4. DOM Selectors & HTML Structure

Initial page and AJAX responses render article card containers:

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.archive_post, .news_item, .each_news` | Card wrapping the story |
| **Article URL** | `a[href*="/"]` matching `//www.ittefaq.com.bd/\d+/...` | e.g. `//www.ittefaq.com.bd/820654/পুলিশের-মামলার-পর-জানা-গেল` |
| **Headline** | `h3, h2, a` inside the card | e.g. `পুলিশের মামলার পর জানা গেল পলাতক সাবেক এমপি সিলেটে গোপনে সভা করেছেন` |
| **Category** | `.category, .sec_title` | Section tag (e.g. `রাজনীতি`, `জাতীয়`, `অর্থনীতি`) |
| **Published Date** | Inherited from `archive_time` parameter | e.g. `2026-11-12` |

---

## 5. Article URL Structure & Canonicalization

- **URL Pattern:** `https://www.ittefaq.com.bd/<articleId>/<slug>`
- Note that links often begin with protocol-relative `//www.ittefaq.com.bd/...`. Standardize to `https://www.ittefaq.com.bd/...`.

---

## 6. Automation Strategy

1. **Step by Calendar Day:**
   - Loop `currentDate` backward day-by-day (e.g. `2026-11-14`, `2026-11-13`, ...).
2. **Fetch Base Day:**
   - `fetchText("https://www.ittefaq.com.bd/archive/" + dateStr)`
   - Parse initial 20 items using Cheerio.
3. **Paginate via AJAX:**
   - Call `/api/theme_engine/get_ajax_contents` with `start=20`, `start=40`, etc., until the response returns empty or fewer than 20 items.
## 7. Robots.txt & Crawling Policy

- **Robots.txt URL:** `https://www.ittefaq.com.bd/robots.txt`
- **Reviewed On:** 2026-11-15
- **Directives for `User-agent: *`:**
  - `Allow: /`
  - `Disallow: /api/`
  - `Disallow: /register/`
  - `Disallow: /login/`
  - `Disallow: /cgi-bin/`
- **Target Path Permitted:** `/archive/*` and all article URLs are allowed.
- **Note on `/api/`:** While generic `/api/` is blocked for search engine indexers, `/archive/YYYY-MM-DD` is fully allowed. If strict robots.txt compliance is desired without touching `/api/theme_engine/get_ajax_contents`, the crawler can automate the archive page via Playwright or fetch the archive HTML directly.
- **Sitemaps:**
  - `https://www.ittefaq.com.bd/sitemap.xml`
  - `https://www.ittefaq.com.bd/news-sitemap.xml`
- **Recommended Delay:** 1000ms.
