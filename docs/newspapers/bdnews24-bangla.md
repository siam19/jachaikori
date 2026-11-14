# bdnews24 (Bangla) — Crawler & Site Guide

## 1. Overview & Accessibility

- **Domain:** `https://bangla.bdnews24.com`
- **Language:** Bangla
- **Platform:** Custom CMS with direct REST/JSON endpoints
- **Direct HTTP Accessibility:** ✅ Fully accessible via standard HTTP (`fetch` / Cheerio). Zero bot walls or Cloudflare challenge pages encountered.
- **Direct JSON Endpoint:** ✅ Features a clean, public JSON API `/archive/fetch` that returns HTML cards without needing Playwright DOM driving!

---

## 2. Archive & Listing Mechanism

bdnews24 maintains a queryable archive page:
- **Base Archive URL:**
  ```
  https://bangla.bdnews24.com/archive
  ```

### Query Parameters:
- `published_after`: Date in `YYYY-MM-DD` (e.g. `2026-01-01`)
- `published_before`: Date in `YYYY-MM-DD` (e.g. `2026-11-14`)
- `section_id`: Specific category section identifier:
  - **Politics (`politics`):** `section_id=37846`
  - **Bangladesh / National (`national`):** `section_id=39002`
  - **Economics (`economy`):** `section_id=39123`
  - **Commerce / Trade (`economy`):** `section_id=39367`
  - **Court & Law (`law-courts`):** `section_id=107363`

---

## 3. Direct JSON Fetch API (`/archive/fetch`)

When clicking the "আরও" button in the UI, the frontend calls the following public endpoint:

### Endpoint:
```
GET https://bangla.bdnews24.com/archive/fetch
```

### Query Parameters:
| Parameter | Description | Example |
| :--- | :--- | :--- |
| `q` | Search keyword (leave empty for all) | `` |
| `section_id` | Target category section ID | `39002` |
| `published_after` | Start date (`YYYY-MM-DD`) | `2026-01-01` |
| `published_before` | End date (`YYYY-MM-DD`) | `2026-11-14` |
| `limit` | Batch size | `12` |
| `offset` | Pagination offset | `0`, `12`, `24`, `36` ... |

### Example Request:
```
GET https://bangla.bdnews24.com/archive/fetch?q=&section_id=39002&published_after=2026-11-12&published_before=2026-11-14&limit=12&offset=0
```

### JSON Response:
```json
{
  "html": "<div class=\"col-md-3 col-lg-3 col-12 mb-4\">\n <div class=\"SubCat-wrapper h-100\">\n <a href=\"https://bangla.bdnews24.com/bangladesh/n5ug66uhcd\">...</a></div></div>"
}
```
When no more items exist, `html` is empty or returns no card elements.

---

## 4. DOM Selectors & HTML Structure

Inside the returned `html` chunk (or initial page `.data-wrapper`):

```html
<div class="col-md-3 col-lg-3 col-12 mb-4">
  <div class="SubCat-wrapper h-100">
    <a href="https://bangla.bdnews24.com/bangladesh/n5ug66uhcd">
      ... image ...
      <div class="col-12">
        <span>বাংলাদেশ</span>
        <h5>ঢাকায় ইয়ুথ ট্যুরিজম এক্সপো ১৯ নভেম্বর শুরু</h5>
        <div class="date">
          প্রকাশিত : 15 নভেম্বর 2026, 12:26 AM
        </div>
      </div>
    </a>
  </div>
</div>
```

| Field | Selector / Location | Example / Notes |
| :--- | :--- | :--- |
| **Card Container** | `.SubCat-wrapper, .col-md-3` | Grid column container |
| **Article URL** | `a[href]` (attribute `href`) | e.g. `https://bangla.bdnews24.com/bangladesh/n5ug66uhcd` |
| **Headline** | `h5, h6, .news-title` text | e.g. `ঢাকায় ইয়ুথ ট্যুরিজম এক্সপো ১৯ নভেম্বর শুরু` |
| **Published Time** | `.date, span:contains("প্রকাশিত"), time` | Format: `প্রকাশিত : 15 নভেম্বর 2026, 12:26 AM` |
| **Category** | Breadcrumb badge inside card | e.g. `বাংলাদেশ`, `রাজনীতি` |

---

## 5. Date Parsing

The published timestamp in the card follows:
```
প্রকাশিত : 15 নভেম্বর 2026, 12:26 AM
```
- Mix of ASCII/Bangla digits + Bangla month name + 12-hour AM/PM time.
- Fully supported by `@jachaikori/crawler`'s `parsePublishedDate()`.

---

## 6. Automation Strategy

1. **Pure HTTP / Cheerio (No Playwright required):**
   - For each section ID:
     - Formulate date range (`published_after=YYYY-MM-DD`, `published_before=YYYY-MM-DD`).
     - Loop with `offset = 0, 12, 24, 36...` calling `/archive/fetch`.
     - Parse `data.html` with Cheerio.
     - Upsert items into SQLite catalog.
     - When `html` is empty or fewer than `limit` items return, advance date window backward.
2. **Cursor State:** `{"sectionId": 39002, "offset": 24, "before": "YYYY-MM-DD"}`.
