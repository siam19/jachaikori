# Kaler Kantho (কালের কণ্ঠ) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.kalerkantho.com`
- **Language:** Bangla
- **Platform:** Next.js / React with Cloudflare protection
- **Direct HTTP Accessibility:** ❌ Plain `fetch` returns `403 Forbidden` ("Attention Required! | Cloudflare").
- **Playwright Accessibility:** ✅ Fully accessible via Playwright with `--disable-blink-features=AutomationControlled` and browser headers.

---

## 2. Archive & Listing Mechanism

Kaler Kantho does not offer a standalone date archive. Articles are organized under category listing pages that dynamically append articles when clicking "আরও সংবাদ".

### Target Categories:
- **National (`national`):** `https://www.kalerkantho.com/online/national`
- **Politics (`politics`):** `https://www.kalerkantho.com/online/Politics`
- **Business (`economy`):** `https://www.kalerkantho.com/online/business`
- **Court / Law (`law-courts`):** `https://www.kalerkantho.com/online/Court`
- **Country News (`general`):** `https://www.kalerkantho.com/online/country-news`

---

## 3. DOM Selectors & HTML Structure

On category pages, articles are grouped into:
1. **Featured Top Section:** Top trending items.
2. **Infinite Stream:** Main stream of news items loaded in rows.

```html
<div class="row position-relative">
  <div class="col-12 col-xl-8">
    <img alt="ডিসেম্বর পর্যন্ত গ্যাসের চাহিদা..." ...>
  </div>
  <div class="col-12 col-xl-4">
    <h1>ডিসেম্বর পর্যন্ত গ্যাসের চাহিদা মেটানোর মজুদ আছে : জ্বালানিমন্ত্রী</h1>
    <p class="homeSubDesc">জ্বালানি সংকটের মধ্যেও আগামী ডিসেম্বর পর্যন্ত...</p>
  </div>
  <a class="stretched-link" href="/online/national/2026/11/14/1767603"></a>
</div>
```

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.row.position-relative`, `div:has(> a.stretched-link)` | Card row |
| **Article URL** | `a.stretched-link` (attribute `href`) | e.g. `/online/national/2026/11/14/1767603` |
| **Headline** | `h1, h2, h3, h4` inside card | e.g. `ডিসেম্বর পর্যন্ত গ্যাসের চাহিদা মেটানোর মজুদ আছে : জ্বালানিমন্ত্রী` |
| **Date from URL (Instant)** | URL path: `/<section>/YYYY/MM/DD/<id>` | e.g. `/2026/11/14/` $\rightarrow$ `2026-11-14` |
| **Summary Snippet** | `p.homeSubDesc` | Short summary text |
| **Load More Button** | `button:has-text("আরও সংবাদ")` | Appends more article rows to the stream |

---

## 4. Key Discovery: Date in Article URLs

Just like Bangladesh Pratidin, Kaler Kantho embeds the publication date directly in the article link:
```
/online/<category>/<YYYY>/<MM>/<DD>/<articleId>
```
For example:
- `/online/national/2026/11/14/1767603` $\rightarrow$ Date: `2026-11-14`

This makes date extraction trivial and eliminates the need to fetch the full detail page just to determine article age.

---

## 5. Infinite Loading Behavior

- The initial page load renders top stories.
- Clicking the button labeled **"আরও সংবাদ"** (`button:has-text("আরও সংবাদ")`) loads dozens of additional articles (observed: 69+ articles added per click).
- Playwright can scroll to the button, click it, wait 2–3 seconds for network idle, and re-query `.stretched-link`.

---

## 6. Automation Strategy

1. **Use Playwright:** Launch with `--disable-blink-features=AutomationControlled`.
2. **Category Crawl Loop:**
   - Navigate to `https://www.kalerkantho.com/online/<category>`
   - Harvest all `a.stretched-link` elements
   - Parse dates from `href` (`/YYYY/MM/DD/`)
   - If oldest date is still within range, scroll to `button:has-text("আরও সংবাদ")` and click
   - Repeat until oldest date reaches the cutoff (e.g. 2026-01-01) or button is disabled
## 7. Robots.txt & Crawling Policy

- **Robots.txt URL:** `https://www.kalerkantho.com/robots.txt`
- **Reviewed On:** 2026-11-15
- **Directives for `User-agent: *`:**
  - `Allow: /`
  - `Disallow: /api/`
  - `Disallow: /topic/`
  - `Disallow: /search`
  - `Disallow: /home/printnews/`
  - `Disallow: /cgi-bin/`
- **Target Path Permitted:** Category routes (`/online/*`) and article routes (`/online/<category>/YYYY/MM/DD/<id>`) are fully allowed.
- **Sitemaps:**
  - `https://www.kalerkantho.com/sitemap.xml`
  - `https://www.kalerkantho.com/daily-sitemap/sitemap-section.xml`
  - `https://www.kalerkantho.com/topic.xml`
- **Recommended Delay:** 1000–1500ms.
