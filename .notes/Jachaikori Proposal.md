
### **Jachaikori: A Research Proposal for a National Consensus & Narrative Map**

### **Executive Summary**

"Jachaikori" (meaning "let's verify") is a research project to combat online misinformation by fundamentally changing how we interact with news. The current model of simple "True/False" fact-checking is failing because it is a high-friction process that doesn't address the core problem: modern misinformation isn't just about false facts, but about competing, emotionally-charged narratives that frame those facts.

Jachaikori's vision is to provide a low-friction, high-context solution. It will function as a **"Consensus & Narrative Map"**—a unified knowledge base of all claims, statements, and statistics reported in the nation's media. This system will allow any user to paste a confusing story snippet, URL, or social media post and instantly receive a clear, objective overview that separates:

- **The Factual Consensus:** What core facts are all sources agreeing on?
- **The Competing Narratives:** What are the different "spins" or interpretations of those facts?
- **The Key Statistics:** What are the numbers, and what is their scope?

This approach empowers the user to understand the full context of a story, see all sides, and make an informed decision for themselves. The system will be modeled using an advanced graph structure that allows users to query the map with any story fragment and receive a "best-fit" graphical overview of that event's context as told by various sources.

---

### **The Problem: Why Fact-Checking Is Failing**

- **High Friction:** Expecting a user to stop scrolling, open a new tab, and manually research a story is an unrealistic demand. The verification tool must be as accessible as the misinformation.

- **The "True/False" Binary is Obsolete:** Complex events (like a new construction project, a court verdict, or an economic report) are rarely just "true" or "false." A story can be factually accurate but narratively misleading.

- **Narrative Warfare:** The real battleground is narrative. A user is often not confused about the facts, but about the meaning of those facts. For example, after an internal report is leaked, one side will frame it as a "Public Safety Crisis" while the other frames it as a "Smear Campaign." A simple fact-check cannot resolve this, and by trying, it appears biased.

---

### **The Guiding Philosophy**

We face a moral obligation to combat the misinformation that pollutes our society. This isn't just about false news; it's about protecting the very stories that shape our perception of reality. We live by the stories we tell ourselves, and when those stories are altered by misleading narratives, *we* are altered. Growth, in essence, is just a change in these internal stories.

The current methods of fact-checking are failing because they carry too much friction. Jachaikori is a low-friction, high-context solution to restore integrity to our collective narrative.

---

### **The Solution: A "Consensus & Narrative Map"**

Jachaikori solves this by treating facts, statistics, and narratives as different types of information. When a user submits a query (raw text, URL, opinion piece from Facebook, a photocard), the system searches our internal database, where we have already processed recently published news articles from reputed websites, and returns the best matching event or story. The response page will contain a graphical overview that presents:

**Sample Scenario: The "Meghna-III Bridge" Report**

Imagine a user sees a Facebook post: *"Corruption at the Meghna-III Bridge! Delta Engineering is using cheap steel, the bridge is going to collapse! #PublicSafetyCrisis"*

They paste this into Jachaikori and receive the following "context map":

**Topic:** Meghna-III Bridge (Internal Report Leak, Nov 2025)

**Factual Consensus** (What sources agree on)
- An internal report from the construction firm, Delta Engineering, was leaked to the press.
- The report was authored by an engineer, Mr. Rahman.
- The Govt. Oversight Body, led by Dr. Haque, held a press conference to respond.

**Competing Narratives** (The "Spin")
- **A "Public Safety Crisis" Narrative:** This view is supported by statements from the whistleblower, Mr. Rahman, who claims the report proves a "public safety crisis."
- **A "Preliminary Draft" Narrative:** This view is supported by statements from Dr. Haque (Govt. Oversight Body), who called the report a "preliminary draft" and stated all issues "were rectified."
- **A "Smear Campaign" Narrative:** This view is supported by statements from Delta Engineering, which called the leak a "malicious smear campaign" by a "disgruntled employee."

**Key Statistics**
- ~20% substandard steel (Source: Leaked Internal Report, via 'The Daily News'; Scope: Main Pylons).
- 99.5% compliant (Source: Dr. Haque, Govt. Oversight Body; Scope: Overall Bridge Safety Standards).

This "label-free" approach does not tell the user what to think. It objectively presents the data, allowing the user to see the full context and understand why the conversation is so polarized.

By making these internal connections, we not only give people an easy solution to fact-check or get more context on a particular story, we also create a giant map of entities and their relationships we see on the internet. This map can be explored internally for journalism and investigations.

---

### **The Technical Challenge & Previous Approach**

The primary technical challenge lies in data modeling. How do we create this "giant map" in a way that is queryable and accurately reflects the complex, overlapping nature of news reporting?

My previous experiments to build this map used **traditional graph databases**. In this model, entities (like 'Police' or 'Shantipur') are "nodes," and their relationships are "edges." However, a traditional edge can only connect *two* nodes. This approach proved insufficient.

A single news event is rarely a simple pair; it is a complex, multi-part relationship. For example, an event like "Police lathicharged Protestors at Shantipur" involves at least three entities. Modeling this in a traditional graph forced the creation of artificial "middle-man" nodes, which resulted in the "large networks of graphs" I encountered. This model was clunky, difficult to query, and failed to capture the true, simultaneous nature of a real-world event.

### **A New Proposition: Exploring Hypergraphs**

This proposal's central thesis is that a **hypergraph** model may be the key to solving these limitations. This document serves as the introduction to a future research project to investigate this exact possibility.

A hypergraph, in theory, seems perfectly suited for our needs. Unlike a simple edge, a "hyperedge" can act as a container, grouping *any number of nodes* at once. A single news event can thus be modeled as a single hyperedge that simultaneously contains all its participating entities (`Police`, `Protestors`, `Shantipur`, etc.).

This structure *could* be the solution we are looking for. It might allow us to model the "overlay" of stories cleanly, where each story is a set of hyperedges. It could make querying for "consensus" as simple as finding how many sources report the same hyperedge. It could allow a user's "partial graph" query to "best-fit" against a set of existing, richer hyperedges in the database.

The purpose of this document is to introduce this idea and to frame the next steps. The research will be to conduct a deep investigation into hypergraph data structures, the availability of hypergraph databases, and the advanced Natural Language Processing (NLP) techniques required to extract these multi-part relationships from unstructured Bangla text to populate such a model.
