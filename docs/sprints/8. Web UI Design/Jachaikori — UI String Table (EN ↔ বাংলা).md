# Jachaikori — UI String Table (EN ↔ বাংলা)

*v0.2 · complete EN ↔ বাংলা dictionary (Sections A–I) · 24 Nov 2026*

## How to review

- Every user-facing label, message and tooltip is one row: **Key**, **English**, **বাংলা**. Please comment inline on any Bangla that reads stiff, translated, or ambiguous, and suggest the wording you would actually say.
- `{n}`, `{date}`, `{name}` are placeholders filled by the app. Numerals in our own text appear as ০১২ when the UI is in বাংলা, so write the Bangla with the placeholder, not with digits.
- `{n, plural, one {…} other {…}}` is the English plural rule. Bangla uses a single form.
- **Never translated:** outlet headlines, article snippets, evidence quotes, OCR text. Those stay in their published script.
- Tone: plain, calm, never accusatory. We compare wording and figures; we never say something is true or false. Please flag any Bangla that sounds like a verdict.
- Stage labels 2 and 4 under “Progress” already include the earlier review changes.

## A. App and navigation

| Key | English | বাংলা |
| :-- | :-- | :-- |
| app.name | Jachaikori | যাচাই করি |
| app.tagline | Compare the card to the record. | কার্ডের সঙ্গে প্রকাশিত প্রতিবেদন মিলিয়ে দেখুন। |
| app.about | Jachaikori compares news photo cards with reporting from 8 accredited outlets. It never rules on what is true. | যাচাই করি সংবাদের ফটো কার্ডকে ৮টি স্বীকৃত সংবাদমাধ্যমের প্রতিবেদনের সঙ্গে মিলিয়ে দেখে। কোনটি সত্য, সে রায় এটি দেয় না। |
| nav.home | Front page | প্রথম পাতা |
| nav.check | Check | যাচাই |
| nav.events | Events | ঘটনা |
| nav.people | People & organisations | ব্যক্তি ও প্রতিষ্ঠান |
| nav.people.short | People | ব্যক্তি |
| nav.search | Search | খুঁজুন |
| nav.scrapbook | Scrapbook | স্ক্র্যাপবুক |
| nav.menu | Menu | মেনু |
| nav.close | Close | বন্ধ করুন |
| nav.back | Back | ফিরে যান |
| nav.skip | Skip to content | মূল অংশে যান |
| lang.toggle | EN / বাংলা | EN / বাংলা |
| lang.label | Switch language | ভাষা বদলান |
| theme.label | Appearance | চেহারা |
| theme.morning | Morning | সকাল |
| theme.evening | Evening | সন্ধ্যা |
| theme.auto | Match my device | ডিভাইসের সঙ্গে মিলিয়ে |
| outlets.indexed | Indexed outlets | সূচিভুক্ত সংবাদমাধ্যম |

### Outlet names (from the brief)

| Id | English | বাংলা |
| :-- | :-- | :-- |
| prothom-alo | Prothom Alo | প্রথম আলো |
| daily-star | The Daily Star | দ্য ডেইলি স্টার |
| business-standard | The Business Standard | দ্য বিজনেস স্ট্যান্ডার্ড |
| bdnews24 | bdnews24.com | বিডিনিউজ টোয়েন্টিফোর |
| ittefaq | The Daily Ittefaq | দৈনিক ইত্তেফাক |
| jugantor | Daily Jugantor | দৈনিক যুগান্তর |
| kaler-kantho | Kaler Kantho | কালের কণ্ঠ |
| bangladesh-protidin | Bangladesh Pratidin | বাংলাদেশ প্রতিদিন |
| dhaka-tribune | Dhaka Tribune | ঢাকা ট্রিবিউন |

## B. Capture (Pillar A)

| Key | English | বাংলা |
| :-- | :-- | :-- |
| cap.title | Check a photo card | ফটো কার্ড যাচাই করুন |
| cap.drop | Drop a photo card here, or paste it | এখানে ফটো কার্ড ফেলুন, অথবা পেস্ট করুন |
| cap.add | Add a photo card | ফটো কার্ড যোগ করুন |
| cap.tab.photo | Photo | ছবি |
| cap.tab.paste | Paste | পেস্ট |
| cap.tab.text | Text | লেখা |
| cap.paste.hint | Press Ctrl+V (⌘V on Mac) to paste an image | ছবি পেস্ট করতে Ctrl+V (Mac-এ ⌘V) চাপুন |
| cap.paste.button | Paste from clipboard | ক্লিপবোর্ড থেকে পেস্ট করুন |
| cap.paste.empty | No image found on the clipboard | ক্লিপবোর্ডে কোনো ছবি পাওয়া যায়নি |
| cap.text.label | Paste a quote or claim | কোনো উক্তি বা দাবি পেস্ট করুন |
| cap.text.placeholder | Paste the text from the card… | কার্ডের লেখাটি এখানে পেস্ট করুন… |
| cap.text.submit | Check this text | লেখাটি যাচাই করুন |
| cap.formats | JPEG, PNG or WebP, up to 8 MB | JPEG, PNG বা WebP, সর্বোচ্চ ৮ এমবি |
| cap.notice | Cards you check are saved and can be opened by anyone with the link. Please avoid uploading private photos. | আপনি যে কার্ড যাচাই করেন তা সংরক্ষিত থাকে এবং লিংক থাকলে যে কেউ খুলতে পারবে। ব্যক্তিগত ছবি আপলোড করা থেকে বিরত থাকুন। |
| cap.cache.hit | Seen before, so this result is instant. | আগে যাচাই করা হয়েছে, তাই ফলাফল সঙ্গে সঙ্গে দেখানো হচ্ছে। |
| cap.cache.recheck | Re-check from scratch | নতুন করে যাচাই করুন |
| cap.remove | Remove image | ছবি সরান |
| cap.shared | Image received from share | শেয়ার করা ছবি পাওয়া গেছে |
| cap.preview.alt | The card you added | আপনার যোগ করা কার্ড |

## C. Progress (the press run)

| Key | English | বাংলা |
| :-- | :-- | :-- |
| run.title | Checking… | যাচাই চলছে… |
| run.stage.read | Reading the card | কার্ড পড়া হচ্ছে |
| run.stage.who | Identifying the people and organisations mentioned | উল্লিখিত ব্যক্তি ও প্রতিষ্ঠান শনাক্ত করা হচ্ছে |
| run.stage.search | Searching the archive | আর্কাইভে খোঁজা হচ্ছে |
| run.stage.rank | Choosing the most relevant reports | সবচেয়ে প্রাসঙ্গিক প্রতিবেদন বাছাই হচ্ছে |
| run.stage.compare | Comparing claim by claim | দাবি ধরে ধরে তুলনা হচ্ছে |
| run.slow | This is taking longer than usual. | এবার একটু বেশি সময় লাগছে। |
| run.cancel | Cancel | বাতিল করুন |
| run.done | Done | শেষ |
| trace.title | Pipeline trace | প্রক্রিয়ার ধাপ |
| trace.hint | How long each step took. | প্রতিটি ধাপে কত সময় লেগেছে। |
| trace.cache | Cache lookup | ক্যাশ খোঁজা |
| trace.extract | Reading the card | কার্ড পড়া |
| trace.entities | Entity matching | নাম ও প্রতিষ্ঠান শনাক্তকরণ |
| trace.retrieval | Archive search | আর্কাইভ অনুসন্ধান |
| trace.rerank | Ranking | ক্রমানুসারে সাজানো |
| trace.diff | Claim comparison | দাবি তুলনা |
| trace.persist | Saving | সংরক্ষণ |
| trace.total | Total | মোট |
| trace.ms | {n} ms | {n} মি.সে. |

## D. Result page

| Key | English | বাংলা |
| :-- | :-- | :-- |
| res.exhibit | Exhibit · your card | নমুনা · আপনার কার্ড |
| res.headline | Headline on the card | কার্ডের শিরোনাম |
| res.speaker | Quoted speaker | উদ্ধৃত বক্তা |
| res.numbers | Numbers on the card | কার্ডের সংখ্যা |
| res.dates | Dates on the card | কার্ডের তারিখ |
| res.publisher | Publisher logo on the card | কার্ডে থাকা প্রকাশকের লোগো |
| res.people | People and organisations mentioned | উল্লিখিত ব্যক্তি ও প্রতিষ্ঠান |
| res.none | None found | কিছু পাওয়া যায়নি |
| res.found | What we found | যা পাওয়া গেছে |
| res.compared | {n, plural, one {# accredited report compared} other {# accredited reports compared}} | {n}টি স্বীকৃত প্রতিবেদন তুলনা করা হয়েছে |
| res.tally.differ | {n, plural, one {# detail differs} other {# details differ}} | {n}টি বিষয়ে পার্থক্য |
| res.tally.align | {n} align | {n}টি মিলেছে |
| res.status.aligned | Details align | বিবরণ মিলেছে |
| res.status.minor | Minor differences | সামান্য পার্থক্য |
| res.status.significant | Notable differences | উল্লেখযোগ্য পার্থক্য |
| res.status.insufficient | Not enough checkable details | যাচাইযোগ্য বিবরণ যথেষ্ট নয় |
| res.status.nocoverage | No matching coverage | মিলে যাওয়া কোনো প্রতিবেদন নেই |
| res.status.nonclaim | No checkable claim | যাচাইযোগ্য কোনো দাবি নেই |
| res.note | This compares wording and figures. It is not a ruling on what is true. | এটি শব্দ ও সংখ্যার তুলনা মাত্র; কোনটি সত্য তার রায় নয়। |
| res.sources | Sources | সূত্র |
| res.filter.all | All | সব |
| res.filter.diff | Only differences | শুধু পার্থক্য |
| res.copyLink | Copy link | লিংক কপি করুন |
| res.copied | Link copied | লিংক কপি হয়েছে |
| res.share | Share | শেয়ার করুন |
| res.checkedOn | Checked {date} | যাচাই করা হয়েছে {date} |
| res.hits | {n, plural, one {Checked # time} other {Checked # times}} | {n} বার যাচাই করা হয়েছে |

## E. Sources and the diff view

| Key | English | বাংলা |
| :-- | :-- | :-- |
| src.published | Published {date} | প্রকাশিত {date} |
| src.open | Read the original | মূল প্রতিবেদন পড়ুন |
| src.coverage | Covered by {n} outlets | {n}টি সংবাদমাধ্যমে প্রকাশিত |
| src.compare | Compare coverage | কভারেজ তুলনা করুন |
| src.relevance | Relevance | প্রাসঙ্গিকতা |
| src.relevance.tip | How closely this report matches the card. It is not a measure of accuracy. | প্রতিবেদনটি কার্ডের সঙ্গে কতটা মেলে তা দেখায়; নির্ভুলতার মাপ নয়। |
| flag.match | Aligned | মিলেছে |
| flag.number | Number differs | সংখ্যায় পার্থক্য |
| flag.date | Date differs | তারিখে পার্থক্য |
| flag.speaker | Different speaker | ভিন্ন বক্তা |
| flag.quote | Quote wording differs | উদ্ধৃতির ভাষা ভিন্ন |
| flag.hedge | Certainty shifted | নিশ্চয়তার মাত্রা বদলেছে |
| flag.context | Context omitted | প্রসঙ্গ বাদ পড়েছে |
| flag.match.tip | The card and the report agree on this detail. | এই বিষয়ে কার্ড ও প্রতিবেদনের মিল আছে। |
| flag.number.tip | A figure on the card differs from the report. | কার্ডের একটি সংখ্যা প্রতিবেদনের সঙ্গে মেলেনি। |
| flag.date.tip | A date on the card differs from the report. | কার্ডের একটি তারিখ প্রতিবেদনের সঙ্গে মেলেনি। |
| flag.speaker.tip | The report attributes the quote to someone else. | প্রতিবেদনে উক্তিটি অন্য কারও বলে উল্লেখ আছে। |
| flag.quote.tip | The quoted wording differs from the report. | উদ্ধৃত শব্দবিন্যাস প্রতিবেদনের সঙ্গে ভিন্ন। |
| flag.hedge.tip | The report is more cautious, or more certain, than the card. | প্রতিবেদনের সুর কার্ডের চেয়ে বেশি সতর্ক অথবা বেশি নিশ্চিত। |
| flag.context.tip | The report includes context that the card leaves out. | প্রতিবেদনের গুরুত্বপূর্ণ প্রসঙ্গ কার্ডে নেই। |
| method.rule | Checked by rule | নিয়ম অনুযায়ী যাচাই |
| method.model | Judged by model | মডেলের মূল্যায়ন |
| method.rule.tip | Compared with a fixed rule, not an AI’s judgement. | নির্দিষ্ট নিয়মে তুলনা, এআইয়ের বিচারে নয়। |
| method.model.tip | An AI model compared the meaning, and it can be wrong. | এআই মডেল অর্থ তুলনা করেছে; ভুলও হতে পারে। |
| strip.caption | Card wording, with the outlet’s figure | কার্ডের ভাষায়, সংবাদমাধ্যমের উল্লেখ করা সংখ্যাসহ |
| strip.asCard | As on the card | কার্ডে যেমন আছে |
| strip.asReported | As reported | প্রতিবেদনে যেমন আছে |
| strip.scrub | Slide between the card’s wording and the report’s | কার্ড ও প্রতিবেদনের ভাষার মধ্যে সরান |
| strip.notOnCard | Not on the card | কার্ডে নেই |
| strip.unplaced | Couldn’t place this difference in the sentence | বাক্যে এই পার্থক্যের জায়গা চিহ্নিত করা যায়নি |
| rec.title | Receipt | সূত্রসহ বিবরণ |
| rec.show | Show details | বিস্তারিত দেখুন |
| rec.hide | Hide details | বিস্তারিত লুকান |
| rec.cardSays | The card says | কার্ডে বলা হয়েছে |
| rec.articleSays | The article says | প্রতিবেদনে বলা হয়েছে |
| rec.alsoMatched | Also matched | আরও যা মিলেছে |
| rec.confidence | Model confidence | মডেলের নিশ্চয়তা |
| rec.original | Original text | মূল পাঠ |
| rec.ours | Our note | আমাদের মন্তব্য |
| lineup.title | Where this figure sits | সংখ্যাটি কোথায় আছে |
| lineup.card | Card | কার্ড |
| lineup.reports | Reports | প্রতিবেদন |
| date.gap | {n, plural, one {# day apart} other {# days apart}} | {n} দিনের ব্যবধান |
| date.framing | Date framing | তারিখের উপস্থাপন |
| gauge.cautious | Cautious | সতর্ক |
| gauge.stated | States plainly | সরাসরি বলা |
| gauge.certain | Certain | নিশ্চিত |

## F. Entities, dossier & lens (Pillar B)

| Key | English | বাংলা |
| :-- | :-- | :-- |
| ent.dir.title | People, organisations & places | ব্যক্তি, প্রতিষ্ঠান ও স্থান |
| ent.dir.subtitle | Bilingual profiles built strictly from accredited reporting. | স্বীকৃত সংবাদমাধ্যমের প্রতিবেদন থেকে তৈরি দ্বিভাষিক প্রোফাইল। |
| ent.dir.search | Filter by name or alias… | নাম বা উপনাম দিয়ে খুঁজুন… |
| ent.type.all | All types | সব ধরন |
| ent.type.person | Person | ব্যক্তি |
| ent.type.org | Organisation | প্রতিষ্ঠান |
| ent.type.location | Place | স্থান |
| ent.type.role | Office | পদবি |
| ent.type.event_topic | Topic | বিষয় |
| ent.hub.badge | High-frequency hub | বহুল উল্লিখিত |
| ent.hub.toggle | Include background hubs | বহুল উল্লিখিত নাম দেখান |
| ent.hub.tip | Includes ubiquitous names like Bangladesh, Dhaka, or Police. | বাংলাদেশ, ঢাকা বা পুলিশের মতো বহুল উল্লিখিত নাম অন্তর্ভুক্ত করে। |
| ent.bio.sources | Grounded in {n} accredited reports | {n}টি স্বীকৃত প্রতিবেদনের ভিত্তিতে |
| ent.aliases | Also known as | অন্যান্য নাম |
| ent.tenure | Office record | দায়িত্বের সময়কাল |
| ent.tenure.present | Present | বর্তমান |
| ent.stats.articles | Articles | প্রতিবেদন |
| ent.stats.events | Events | ঘটনা |
| ent.stats.relations | Relationships | সম্পর্ক |
| ent.stats.span | In archive {from} – {to} | আর্কাইভে {from} – {to} |
| ent.sec.relations | Relationships | সম্পর্কসমূহ |
| ent.sec.activity | Coverage over time | সময়ের সঙ্গে প্রচার |
| ent.sec.associated | Closely associated | ঘনিষ্ঠভাবে যুক্ত |
| ent.sec.articles | Articles mentioning {name} | {name}-এর উল্লেখ থাকা প্রতিবেদন |
| ent.rel.all | All | সব |
| ent.rel.cat.structure | Roles & ties | পদ ও সংযোগ |
| ent.rel.cat.stance | Speech & stance | বক্তব্য ও অবস্থান |
| ent.rel.cat.economy | Economy & policy | অর্থনীতি ও নীতি |
| ent.rel.cat.law | Law & courts | আইন ও আদালত |
| ent.rel.cat.diplomacy | Diplomacy & events | কূটনীতি ও ঘটনা |
| ent.rel.evidence | {n, plural, one {# citation} other {# citations}} | {n}টি উদ্ধৃতি |
| ent.assoc.list | List | তালিকা |
| ent.assoc.orbit | Orbit | বৃত্তাকার |
| ent.assoc.shared | {n} shared events | {n}টি যৌথ ঘটনা |
| ent.art.sort.recent | Most recent | সাম্প্রতিক |
| ent.art.sort.salience | Most central | সবচেয়ে প্রাসঙ্গিক |
| ent.art.role.all | Any role | যেকোনো ভূমিকা |
| ent.art.role.quoted_speaker | Quoted speaker | উদ্ধৃত বক্তা |
| ent.art.role.actor | Main actor | মূল ভূমিকা |
| ent.art.role.subject | Subject | মূল বিষয় |
| ent.art.loadMore | Show more articles | আরও প্রতিবেদন দেখুন |
| ent.surprise | Surprise me | অজানা একটি দেখুন |
| lens.label | Lens | ফিল্টার |
| lens.with | With {name} | {name}-এর সঙ্গে |
| lens.dates | {from} – {to} | {from} – {to} |
| lens.clear | Clear filters | ফিল্টার সরান |
| lens.brushHint | Drag across bars to focus a date range | নির্দিষ্ট সময় বেছে নিতে বারের ওপর টানুন |

## G. Events, lanes & coverage comparison (Pillar C)

| Key | English | বাংলা |
| :-- | :-- | :-- |
| evt.list.title | Multi-outlet events | একাধিক সংবাদমাধ্যমের ঘটনা |
| evt.list.subtitle | Compare how accredited outlets covered the same story and who published first. | একই ঘটনা বিভিন্ন সংবাদমাধ্যম কীভাবে ও কখন প্রকাশ করেছে তা তুলনা করুন। |
| evt.list.divergent | Where outlets differ | যেখানে প্রতিবেদনে ভিন্নতা |
| evt.list.recent | Recent multi-outlet events | সাম্প্রতিক ঘটনাপ্রবাহ |
| evt.outletsCount | {n} of 8 outlets | ৮টির মধ্যে {n}টি সংবাদমাধ্যম |
| evt.articlesCount | {n, plural, one {# article} other {# articles}} | {n}টি প্রতিবেদন |
| evt.firstToPublish | First in index | প্রথম প্রকাশিত |
| lanes.title | Coverage timeline | প্রকাশের সময়রেখা |
| lanes.first | First | প্রথম |
| lanes.none | No matching article in our index | আমাদের সূচিতে মিল থাকা প্রতিবেদন নেই |
| lanes.noTime | Time unavailable | সময় পাওয়া যায়নি |
| lanes.more | +{n} more | আরও +{n}টি |
| cmp.agree | Where outlets agree | যেখানে মিল আছে |
| cmp.differ | Where outlets differ | যেখানে ভিন্নতা আছে |
| cmp.kind.consensus | Shared figure | অভিন্ন সংখ্যা |
| cmp.kind.number | Different figures | সংখ্যায় ভিন্নতা |
| cmp.kind.hedging | Certainty differs | নিশ্চয়তার মাত্রায় ভিন্নতা |
| cmp.kind.date | Date differs | তারিখে ভিন্নতা |
| cmp.claimsTitle | Claims by outlet | সংবাদমাধ্যমভেদে দাবি |
| cmp.claimsEmpty | No structured claims extracted for this outlet yet. | এই সংবাদমাধ্যমের জন্য এখনো নির্দিষ্ট দাবি সংকলিত হয়নি। |
| cmp.graphToggle | View entity connections | সংশ্লিষ্ট ব্যক্তি ও প্রতিষ্ঠানের সংযোগ দেখুন |

## H. Search, omnibox & front-page rails (Pillar D)

| Key | English | বাংলা |
| :-- | :-- | :-- |
| front.mostChecked | Most checked | সবচেয়ে বেশি যাচাইকৃত |
| front.seeAll | See all | সব দেখুন |
| front.whereDiffer | Where outlets differ | যেখানে সংবাদমাধ্যমে ভিন্নতা |
| front.inTheNews | In the news | আলোচনায় যারা |
| front.recentEvents | Recent multi-outlet events | সাম্প্রতিক ঘটনা |
| search.placeholder | Search people, events or headlines… | ব্যক্তি, ঘটনা বা শিরোনাম খুঁজুন… |
| search.shortcut | Press / to search | খুঁজতে / চাপুন |
| search.alsoSearched | Also searched | আরও যা খোঁজা হয়েছে |
| search.group.entities | People & organisations | ব্যক্তি ও প্রতিষ্ঠান |
| search.group.articles | Articles | প্রতিবেদন |
| search.filters | Filters | ফিল্টার |
| search.outlet.all | All outlets | সব সংবাদমাধ্যম |
| search.from | From | শুরু |
| search.to | To | শেষ |
| search.noResults | No matching articles found for “{q}”. | “{q}”-এর জন্য মিল থাকা কোনো প্রতিবেদন পাওয়া যায়নি। |
| rail.sameEvent | Same event, other outlets | একই ঘটনা, অন্যান্য সংবাদমাধ্যম |
| rail.peopleInStory | People in this story | এই ঘটনায় সংশ্লিষ্টরা |
| rail.thatDay | Also in the news that day | সেদিনের আরও খবর |

## I. Errors, empty states, redirects, peeks, trail & scrapbook

| Key | English | বাংলা |
| :-- | :-- | :-- |
| err.badFormat.title | Unsupported image format | এই ছবির ফরম্যাট সমর্থিত নয় |
| err.badFormat.body | Please upload a JPEG, PNG or WebP image, or paste the text directly. | অনুগ্রহ করে JPEG, PNG বা WebP ছবি দিন, অথবা লেখাটি সরাসরি পেস্ট করুন। |
| err.badFormat.action | Choose another image | অন্য ছবি বেছে নিন |
| err.tooLarge.title | Image is too large | ছবিটি বেশ বড় |
| err.tooLarge.body | Even after resizing, this file is over 8 MB. A screenshot usually works better. | ছোট করার পরও ফাইলটি ৮ এমবির বেশি। এর বদলে একটি স্ক্রিনশট দিয়ে চেষ্টা করুন। |
| err.tooLarge.action | Try another image | অন্য ছবি দিন |
| err.upstream.title | Reading service didn’t respond | বিশ্লেষণ সেবা থেকে সাড়া মেলেনি |
| err.upstream.body | That is on our side, not your card. Please try again in a moment. | এটি আমাদের দিকের সাময়িক ত্রুটি, আপনার কার্ডের সমস্যা নয়। একটু পরে আবার চেষ্টা করুন। |
| err.upstream.action | Try again | আবার চেষ্টা করুন |
| err.retrying | Trying again ({attempt}/3)… | আবার চেষ্টা চলছে ({attempt}/3)… |
| err.offline.title | You appear to be offline | আপনি সম্ভবত অফলাইনে আছেন |
| err.offline.body | Your card is still here. Retry once your connection is back. | আপনার কার্ডটি এখানেই আছে। ইন্টারনেট সংযোগ ফিরলে আবার চেষ্টা করুন। |
| err.offline.action | Retry | আবার চেষ্টা করুন |
| err.notFound.title | This check couldn’t be found | এই যাচাইয়ের তথ্য পাওয়া যায়নি |
| err.notFound.body | The link may have expired or been mistyped. | লিংকটি মেয়াদোত্তীর্ণ হতে পারে অথবা ভুলভাবে লেখা হয়েছে। |
| err.notFound.action | Check a new card | নতুন কার্ড যাচাই করুন |
| err.unknown.title | Something went wrong | একটি অপ্রত্যাশিত ত্রুটি হয়েছে |
| err.unknown.body | Please try again or paste the text from the card instead. | অনুগ্রহ করে আবার চেষ্টা করুন, অথবা কার্ডের লেখাটি পেস্ট করুন। |
| empty.popular.title | Nothing checked yet | এখনো কোনো কার্ড যাচাই করা হয়নি |
| empty.popular.body | Upload a viral photo card or paste a headline to run the first check. | প্রথম যাচাই শুরু করতে একটি ফটো কার্ড আপলোড করুন বা শিরোনাম পেস্ট করুন। |
| empty.panel | Nothing matches the current filters. | বর্তমান ফিল্টারে কোনো তথ্য পাওয়া যায়নি। |
| redirect.entity | Merged into {name}. You are viewing the canonical profile. | এটি {name}-এর সঙ্গে একীভূত হয়েছে; আপনি মূল প্রোফাইল দেখছেন। |
| redirect.event | This event was merged into an updated cluster. | এই ঘটনাটি হালনাগাদ করা মূল গুচ্ছের সঙ্গে যুক্ত হয়েছে। |
| peek.openFull | Open full page | পুরো পাতা খুলুন |
| trail.label | Reading trail | আপনার পাঠপথ |
| trail.copyLink | Copy trail as link | পাঠপথের লিংক কপি করুন |
| trail.clear | Clear trail | পাঠপথ মুছুন |
| scrap.title | Scrapbook | স্ক্র্যাপবুক |
| scrap.subtitle | Saved locally in this browser. No account required. | এই ব্রাউজারেই সংরক্ষিত; কোনো অ্যাকাউন্টের প্রয়োজন নেই। |
| scrap.pin | Save to scrapbook | স্ক্র্যাপবুকে রাখুন |
| scrap.pinned | Saved | সংরক্ষিত |
| scrap.empty | Pin any check, entity or event to collect clippings here. | যেকোনো যাচাই, ব্যক্তি বা ঘটনা পিন করে এখানে জমিয়ে রাখুন। |
| scrap.clearAll | Clear scrapbook | সব মুছুন |
