# Prothom Alo (প্রথম আলো) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://www.prothomalo.com`
- **Language:** Bangla
- **Platform:** React / Next.js on Quintype (Bold CMS)
- **Direct HTTP Accessibility:** ✅ Accessible via standard HTTP (`fetch` / Cheerio). Server-side renders initial items and embeds JSON state in `<script id="__NEXT_DATA__">`.
- **Bot Detection:** Standard rate limiting, but allows polite browser-like HTTP headers (`User-Agent`, `Accept-Language: bn-BD`).

---

## 2. Archive & Listing Mechanism

Prothom Alo does not offer a traditional `/archive/YYYY/MM/DD` date archive. Instead, it features a search endpoint with date range and category filtering:

- **Base Search URL:**
  ```
  https://www.prothomalo.com/search?sort=latest-published
  ```

### A. Date Range Filtering
The `#datepicker-input` UI updates the URL parameters with Unix timestamps in milliseconds (Asia/Dhaka timezone):
- Parameter `published-after`: Unix timestamp (ms) start of range
- Parameter `published-before`: Unix timestamp (ms) end of range
- Example (13 Nov 2026 to 14 Nov 2026):
  ```
  https://www.prothomalo.com/search?published-after=1794506400000&published-before=1794679199999&sort=latest-published
  ```

### B. Category Filtering (`section-id`)
Sections can be comma-separated IDs via the `section-id` parameter:
- **Bangladesh (`bangladesh`):**
  `section-id=17533%2C17535%2C17536%2C17538%2C22321%2C22236`
- **Politics (`politics`):**
  `section-id=22237`
- **Commerce / Economy (`economy`):**
  `section-id=17552%2C17553%2C22324%2C22325%2C22326%2C26653%2C17556%2C17555%2C23382%2C23383%2C17560`

Combined Date + Section example:
```
https://www.prothomalo.com/search?published-after=1794333600000&published-before=1794679199999&sort=latest-published&section-id=17533%2C17535%2C17536%2C17538%2C22321%2C22236
```

---

## 3. Pagination & Infinite Loading

- **Button in UI:** Button with class `.load-more-content` or `button:has-text("আরও")`.
- **Underlying API:** Prothom Alo uses Quintype's API:
  - Header data endpoint: `https://services.prothomalo.com/qt-api/fetch-data/...`
  - Next.js initial payload: `<script id="__NEXT_DATA__">` contains `props.pageProps` with initial story cards and pagination tokens.
- **Automation Strategy:**
  1. **Playwright Mode:** Navigate to the search URL, wait for `.news_item_content`, click `button.load-more-content` repeatedly until the cutoff is reached.
  2. **Direct Extraction:** Parse the initial 15 items from HTML, or parse the embedded JSON in `#__NEXT_DATA__`.

---

## 4. DOM Selectors & HTML Structure

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.news_item_content` | Container holding headline, link, thumbnail, and time |
| **Headline** | `h3.headline-title a.title-link`, `.tilte-no-link-parent` | e.g. `টাকার প্রশ্ন নয়, সিনেমাটা শেষ করতে চাই: তানজিন তিশা` |
| **Article URL** | `a.title-link` (attribute `href`) | e.g. `https://www.prothomalo.com/entertainment/dhallywood/xxfoogs3az` |
| **Published Time** | `time.published-time` | Relative format: `১৫ মিনিট আগে`, `১ ঘণ্টা আগে`, or date string |
| **Category** | URL path segment or section slug | e.g. `/entertainment/dhallywood/`, `/bangladesh/district/` |

---

## 5. Article URL Structure & Normalization

- **Pattern:** `https://www.prothomalo.com/<section>/<sub-section>/<slug-or-id>`
- **Normalization:**
  - Standardize protocol to `https://`
  - Strip query params (`?sort=...`, tracking `utm_*`)
  - Strip fragments (`#...`)

---

## 6. Implementation Notes & Gotchas

1. **Relative Date Parsing:** List items frequently use relative timestamps in Bangla numerals (`১৫ মিনিট আগে`, `৩ ঘণ্টা আগে`). The date parser converts Bangla digits to ASCII and computes the ISO timestamp in `Asia/Dhaka` (+06:00).
2. **Next.js Hydration:** If driving with Playwright, allow 1–2 seconds for client-side hydration before clicking the "আরও" button.
3. **Cutoff Strategy:** Step backward in fixed 1-day or 3-day windows using the `published-after` and `published-before` timestamp parameters.
