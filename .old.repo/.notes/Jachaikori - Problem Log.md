Jachaikori: Research & Problem Log (Conceptual History)

This document tracks the conceptual evolution of the Jachaikori project, logging key problems as they were identified and the architectural solutions designed to address them. This serves as a unified history of our design decisions.

A. Core Problem Definition & Initial Flaws

Initial Problem: How do we model the information in a news article?

Initial Flaw (Event Mapping): Attempting to model news as a simple "Event Map" (e.g., Protest -> Shantipur) fails because articles package many claims, statements, and statistics that aren't single events.

Solution: Transition to a "Proposition-Centric Universe." The smallest information unit is the Proposition (fact, statement, or statistic), allowing us to model complexity and nuance.

Initial Problem: How to model multi-party, complex relationships (e.g., three entities involved in one event)?

Initial Flaw (Traditional Graphs): Using traditional graph databases required creating "middle-man nodes," resulting in a clunky, difficult-to-query structure.

Solution (Conceptual): The Proposition atom IS the conceptual hyperedge. The atom itself is a structured object that links any number of arguments (participants[], about_ids[], predicate, speaker_id, etc.) in one unit, accurately representing complex relationships.

B. Architecture and Data Linkage

Problem: How do we link related claims when they use different language (e.g., "The bridge report" vs. "Delta's leaked file")?

Solution: The Canonical Entity Database and Entity Linking. Propositions are linked to unique entity IDs (e.g., E:REPORT:DELTA_INTERNAL_2025), not text strings. This connects all related information automatically.

Problem: How to extract structured propositions from unstructured Bangla/English text, a notoriously difficult NLP task?

Solution: A Fine-Tuned LLM as the "Proposition Extractor." We will fine-tune a powerful LLM to ingest raw text and reliably output our structured Proposition JSON. This replaces brittle, multi-stage traditional NLP pipelines.

Problem: How to prevent the LLM Extractor from hallucinating or linking to incorrect entities?

Solution: The "Guardrailed, Two-Pass" design. The LLM is constrained by only being allowed to choose from a pre-fetched "menu" of candidate Canonical Entity IDs.

Problem: How to handle new entities (people, organizations) not yet in our database without corrupting the clean data?

Solution: The PROVISIONAL ID System. When the LLM is uncertain, it creates a temporary PROVISIONAL ID. This ensures the data is ingested without polluting the canonical database and flags the new entity for future admin review (the "do-no-harm" principle).

Problem: How to track the evolution of a story over time?

Solution: Dual Timestamps. Every proposition is recorded with both time_about (when the event happened) and time_asserted (when the article was published). This enables powerful time-based snapshots.

C. Display and Query Flow

Problem: How to handle competing narratives without imposing editorial judgment (e.g., labeling a narrative as "Bias")?

Solution: "Label-Free Statement Clustering." We cluster semantically similar statement propositions and use the most central quote (the "exemplar") as the cluster's title, allowing the user to infer the narrative.

Problem: Defining the technical pipelines for continuous background work and user interaction.

Solution: A clear Dual-Flow System.

Continuous Internal Flow: Ingests articles, extracts propositions, links entities, and stores embeddings in a vector database.

User Flow: Analyzes a query (via vector embedding + NER), searches the knowledge base, and synthesizes the most relevant "information atom chain" for display.

D. Open Decisions & Future Research Agenda

These items define the next phase of research and implementation work.

D.1. Consensus & Metrics Model

Consensus Scoring Formula: The exact mathematical formula for a proposition's "strength" needs definition: Strength = f(w1·source_count, w2·publisher_diversity, w3·publisher_independence, w4·recency_decay, w5·avg_confidence_score, ...)

Thresholds: Define the minimum Strength score required for a fact to be elevated, and the similarity threshold (τ_link) for clustering statement propositions.

D.2. Vector Database & Search Strategy

Embedding Content: Determine what specific data is embedded for the Internal Flow (e.g., the full quote_span vs. normalized predicate + arguments).

Ranking Formula: Define how to combine the Vector Search (semantic similarity) and the Structured Search (entity links) results to generate the final ranking for the user.

D.3. Data Governance & Entity Lifecycle

Canonical Entity Database Governance: Establish who authorizes the promotion of PROVISIONAL entities to CANONICAL and define the audit policy for these merges.

Temporal Relations: Define the updates, replaces, and part_of relationships between propositions to track corrections and story lineage.

D.4. Pre-Implementation Task (Immediate Priority)

The "Golden Dataset": Finalize the v1.0 schema for the Proposition JSON and immediately begin creating the "golden" dataset of (Raw Article Text) -> (Target Proposition[] JSON) pairs to fine-tune the LLM Extractor.