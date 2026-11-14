# Jachaikori: System Architecture & Technical Blueprint

This document outlines the technical architecture for Jachaikori, a system designed to read, understand, and link all information from news articles into a queryable knowledge base.

## 1. Core Concept: The "Proposition-Centric Universe"

The entire system is built on a single, universal atom of information: the **Proposition**. A proposition is the smallest extractable unit of information (a fact, a statement, or a statistic).

By breaking all articles down into this single, structured atom, we create a "Proposition-Centric Universe." This avoids the rigidity of a simple "Event Map" and allows us to model the true complexity of news.

## 2. The Proposition Schema (MVP)

Every proposition atom adheres to a strict schema. This is the fundamental data structure of our entire system.

- **prop_id**: A unique identifier for the atom.
- **kind**: The type of atom. ∈ {fact, statement, statistic}.
- **source_article_id**: Which article it came from.
- **time_about**: The timestamp of the event the proposition describes (e.g., Nov 17, 2025).
- **time_asserted**: The timestamp of when the article was published.
- **quote_span**: The exact text span in the source article.
- **about_ids[]**: An array of Canonical Entity IDs this proposition is about (e.g., `['E:REPORT:DELTA_INTERNAL_2025']`).
- **participants[]**: An array of objects: `[{entity_id: 'E:PERSON:RAHMAN', role: 'author_of'}]`.
- **predicate_norm**: The normalized action (e.g., `was_leaked`).
- **polarity**: `affirm` or `deny`.
- **modality**: `alleged`, `reported`, `confirmed`, `found`.

**Statement-Specific:**
- **speaker_id**: `E:PERSON:HAQUE`.

**Statistic-Specific:**
- **statistic**: `{value: 20, unit: 'percent_substandard_steel', scope_id: 'E:STATDEF:MEGHNA_PYLONS_STEEL'}`.

## 3. The "Glue": The Canonical Entity Database

The "magic" of the system—its ability to connect related information—comes from the **Canonical Entity Database**. This is a central registry of unique concepts, not just text strings.

Each entity has a stable, unique ID (UID) and a list of known aliases.

**Examples:**

- **Entity**: `E:PERSON:RAHMAN`
    - **Type**: Person
    - **Aliases**: "Mr. Rahman", "the Delta engineer", "the whistleblower"

- **Entity**: `E:ORG:DELTA_ENGINEERING`
    - **Type**: Organization
    - **Aliases**: "Delta Engineering", "the construction firm", "Delta"

- **Entity**: `E:PERSON:HAQUE`
    - **Type**: Person
    - **Aliases**: "Dr. Haque", "the Oversight Body head"

- **Entity**: `E:CONSTRUCTION:MEGHNA_III_BRIDGE`
    - **Type**: Infrastructure
    - **Aliases**: "Meghna-III Bridge", "the new bridge"

- **Entity**: `E:REPORT:DELTA_INTERNAL_2025`
    - **Type**: Document
    - **Aliases**: "the internal report", "the leaked report", "Rahman's findings"

This database also stores internal links between entities:

- `E:PERSON:HAQUE` --`head_of`--> `E:ORG:GOVT_OVERSIGHT_BODY`
- `E:PERSON:RAHMAN` --`employee_of`--> `E:ORG:DELTA_ENGINEERING`
- `E:ORG:DELTA_ENGINEERING` --`builder_of`--> `E:CONSTRUCTION:MEGHNA_III_BRIDGE`

## 4. The "Brain": A Guardrailed LLM Extractor

We solve the problem of extracting propositions from unstructured Bangla/English text by using a fine-tuned Large Language Model (LLM). This model is "guardrailed" to prevent hallucination and ensure data integrity.

This is a **"two-pass, retrieval-first" pattern**:

1. **Retrieval-First**: When a new article comes in, our system first queries the Canonical Entity Database for any potential candidate entities mentioned in the text (e.g., "Meghna Bridge" → `E:CONSTRUCTION:MEGHNA_III_BRIDGE`).

2. **Pass 1 (Extraction)**: The LLM is given the article and a "menu" of these candidate IDs. Its first job is to extract all propositions and fill their slots (predicate, polarity, etc.) with text.

3. **Pass 2 (Linking)**: The LLM's second job is to choose the correct ID from the candidate menu for each slot (like `speaker_id` or `about_ids`).

4. **Provisional Links**: If the LLM is uncertain or identifies a new entity not in the menu (e.g., a new subcontractor), it does not invent an ID. It creates a `PROVISIONAL:NewSubcontractor_XYZ` ID. This allows the data to be ingested without corrupting the clean canonical database and flags it for future admin review.

## 5. System Data Flows

There are two distinct flows for handling data: one for ingesting news (Internal) and one for answering queries (User).

### 5.1. Continuous Internal Flow (Data Ingestion)

This is the continuous, background process that populates our knowledge base.

1. **Ingest**: A new article URL is added to the queue.
2. **Extract & Link**: The article is processed by our Guardrailed LLM Extractor (see Section 4).
3. **Store (Proposition DB)**: The LLM's output (an array of structured Proposition atoms) is saved to our primary database.
4. **Store (Vector DB)**: The `quote_span` or a normalized representation of each proposition is embedded and stored in a vector database. This embedding will be used for fast semantic search in the user flow.

### 5.2. User Flow (Data Query)

This flow is triggered when a user visits the platform and enters a query.

1. **Input**: User pastes a story snippet: "Is the new Meghna bridge safe?"

2. **Analyze Query**: The user's query is processed in two ways:
     - **Entity Linking**: A quick NER pass identifies key entities (e.g., "Meghna bridge") and links them to our Canonical Entity Database (`E:CONSTRUCTION:MEGHNA_III_BRIDGE`).
     - **Vector Embedding**: The query text is embedded into a vector.

3. **Search & Retrieve**: The system searches the knowledge base by combining these two methods:
     - **Vector Search**: Finds propositions in our Vector DB that are semantically similar to the user's query ("bridge safety").
     - **Structured Search**: Finds all propositions in our Proposition DB that are linked to the identified entities (e.g., `about_ids` or `participants` contains `E:CONSTRUCTION:MEGHNA_III_BRIDGE`).

4. **Synthesize & Display**: The system retrieves the most relevant "information atom chain" (i.e., the collection of related propositions). It then synthesizes this data and presents a rich, clear overview to the user, showing the agreed-upon facts, competing statements, and relevant statistics.