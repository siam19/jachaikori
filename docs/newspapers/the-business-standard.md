# The Business Standard (TBS) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.tbsnews.net`
- **Language:** English (and some Bangla sections)
- **Platform:** Drupal / Custom CMS with theme `sloth`
- **Direct HTTP Accessibility:** ✅ Fully accessible via standard HTTP (`fetch` / Cheerio). Zero bot wall blocks, fast responses.
- **Status:** ✅ Fully implemented and tested in `@jachaikori/outlets` (`outlets/business-standard.ts`).

---

## 2. Archive & Listing Mechanism

The Business Standard provides an archive endpoint that publishes all articles for any calendar day on a single page:

- **Daily Archive URL:**
  ```
  https://www.tbsnews.net/archive/<year>/<month>/<date>
  ```
- **Example:**
  `https://www.tbsnews.net/archive/2026/10/30`

### Key Properties:
- Single page contains **all** articles published that day (typically 120–160 articles per day).
- No pagination parameters or infinite scroll clicking required.
- Walking backwards in time is accomplished by decrementing the date day by day.

---

## 3. DOM Selectors & HTML Structure

The archive page wraps articles inside `.archive-contents`:

```html
<div class="card relative card-list align-middle pt-5 pb-5 pr-10 strip-bg-white">
  <div class="card-image relative">
    <a href="/bangladesh/leftist-alliance-demands-scrapping-us-trade-deal-nct-lease-dp-world-1588076">
      <img ... />
    </a>
  </div>
  <div class="card-section">
    <h4 class="card-title">
      <a href="/bangladesh/leftist-alliance-demands-scrapping-us-trade-deal-nct-lease-dp-world-1588076">
        Leftist alliance demands scrapping of US trade deal, NCT lease to DP World
      </a>
    </h4>
    <div class="date">
      <a href="/bangladesh">Bangladesh</a>
    </div>
  </div>
</div>
```

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.card-list, .archive-contents .card` | Card wrapper |
| **Headline** | `.card-title a, h4 a, h3 a` text | e.g. `Leftist alliance demands scrapping of US trade deal...` |
| **Article URL** | `.card-title a` (attribute `href`) | e.g. `/bangladesh/leftist-alliance-demands-scrapping-...-1588076` |
| **Category** | `.date a, .category` | e.g. `Bangladesh`, `Economy`, `World` |
| **Published Date** | Derived from the `/archive/YYYY/MM/DD` URL | e.g. `2026-10-30T12:00:00+06:00` |

---

## 4. Article URL Structure & Canonicalization

- **URL Pattern:** `https://www.tbsnews.net/<category>/<subcategory-optional>/<slug>-<articleId>`
- **Canonicalization:**
  - Standardize protocol to `https://www.tbsnews.net`
  - Strip query params (`?utm_*`, `?amp`, etc.)
  - Strip fragments (`#...`)

---

## 5. Automation Strategy

1. **Pure HTTP / Cheerio Generator:**
   - Start from current date (or cursor date).
   - Formulate URL: `https://www.tbsnews.net/archive/${year}/${month}/${day}`.
   - Fetch text and parse listing with Cheerio.
   - Yield items batch with next cursor: `{"date": "YYYY-MM-DD"}` (previous day).
   - Stop when cutoff date is reached.
2. **Performance:**
   - 1 single HTTP request per day crawls 100+ articles.
   - Tested rate: ~140 articles per second.
