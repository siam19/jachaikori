# Bangladesh Pratidin (বাংলাদেশ প্রতিদিন) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.bd-pratidin.com`
- **Language:** Bangla
- **Platform:** Custom PHP / CMS with Cloudflare protection
- **Direct HTTP Accessibility:** ❌ Plain `fetch` returns `403 Forbidden` ("Just a moment..." Cloudflare Bot Protection).
- **Playwright Accessibility:** ✅ Fully accessible via Playwright with `--disable-blink-features=AutomationControlled` and standard desktop user agent.

---

## 2. Archive & Listing Mechanism

Bangladesh Pratidin does not have a public date archive page. Articles must be crawled by category section using standard pagination.

### Target Categories:
- **National (`national`):** `https://www.bd-pratidin.com/national`
- **Minister Speech / Politics (`politics`):** `https://www.bd-pratidin.com/minister-speech`
- **Economy (`economy`):** `https://www.bd-pratidin.com/economy`

### Pagination:
- Pagination is handled via the query parameter `?page=N`:
  - `https://www.bd-pratidin.com/national?page=2`
  - `https://www.bd-pratidin.com/economy?page=3`
- The page renders a footer pagination bar: `ul.pagination li a`.

---

## 3. DOM Selectors & HTML Structure

On category listing pages, articles are displayed across three main areas:
1. **Lead Featured Article:** A large highlighted card at the top.
2. **First Article Grid (`.more`):** The primary grid of cards.
3. **Second Article Grid (`.more2`):** Additional lower grid.

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Containers** | `main section .more > div, main section .more2 > div, div:has(> a[href*="/202"])` | Grid card divs |
| **Headline** | `h3, h4, a[href]` text | e.g. `নারীদের জন্য আসছে ১০০ বৈদ্যুতিক বাস, থাকতে পারে পুরুষ আসনও` |
| **Article URL** | `a[href*="/202"]` | e.g. `https://www.bd-pratidin.com/national/2026/11/14/1326217` |
| **Date from URL (Instant)** | URL path: `/<section>/YYYY/MM/DD/<id>` | e.g. `/2026/11/14/` $\rightarrow$ `2026-11-14` |
| **Detail Page Date (Full)** | `span:contains("প্রকাশ:"), .time, .date` | Format: `প্রকাশ: ১২:৪০, রবিবার, ১৫ নভেম্বর, ২০২৬` |

---

## 4. Key Discovery: Date in Article URLs

*Unlike what was initially suspected, visiting the detail page is **not mandatory** for list harvesting!*

All article links on Bangladesh Pratidin follow the explicit pattern:
```
https://www.bd-pratidin.com/<section>/<YYYY>/<MM>/<DD>/<articleId>
```
For example:
- `https://www.bd-pratidin.com/country/2026/11/15/1326245`
- `https://www.bd-pratidin.com/national/2026/11/14/1326217`

The date is encoded directly in the path (`2026/11/14`), allowing instant cutoff checking without making secondary HTTP requests to article detail pages.

---

## 5. Automation Strategy

1. **Use Playwright:** Because Cloudflare blocks raw Node/Bun `fetch`, use `BrowserPool.createPolitePage()` with asset blocking (images, fonts, ads).
2. **Page Loop:**
   - Start at `https://www.bd-pratidin.com/<category>?page=1`
   - Extract all matching `a[href]` matching `/\/\d{4}\/\d{2}\/\d{2}\/\d+/`
   - Extract the date from the URL path
   - When the oldest article on the page is older than the cutoff date (e.g. 2026-01-01), stop.
   - Increment `page` by 1.
## 6. Robots.txt & Crawling Policy

- **Robots.txt URL:** `https://www.bd-pratidin.com/robots.txt`
- **Reviewed On:** 2026-11-15
- **Directives for `User-agent: *`:**
  - `Allow: /`
  - `Disallow: /assets/ckeditor/`
  - `Disallow: /home/printnews/`
  - `Disallow: /cgi-bin/`
  - `Disallow: /home`
  - `Disallow: /index.php`
- **Target Paths Permitted:** All category routes (`/national`, `/economy`, `/minister-speech`) and article paths (`/<section>/YYYY/MM/DD/<id>`) are fully allowed.
- **Sitemap:** `https://www.bd-pratidin.com/sitemap.xml`
- **Recommended Delay:** 1000–1500ms with jitter.
