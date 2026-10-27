# StoryScope research and visual-novel rubric

Source: Jenna Russell, Rishanth Rajendhran, Chau Minh Pham, Mohit Iyyer and John Wieting, **StoryScope: Investigating idiosyncrasies in AI fiction**, COLM 2026, arXiv:2604.03136v6. Paper: https://arxiv.org/abs/2604.03136 ; code/data: https://github.com/jenna-russell/storyscope .

## What the study actually established

Study corpus: 10,272 human short stories and 51,336 model stories from similar reverse-engineered premises, by GPT-5.4, Claude Sonnet 4.6, Gemini 3 Flash, DeepSeek V3.2 and Kimi K2.5. StoryScope extracted 304 labeled features spanning character, event, plot, social, time, revelation, perspective, setting and style dimensions. Narrative-only features reached 93.2% **macro-F1** in this dataset's human-vs-AI classification; 68.4% for six-way source classification. These results are **not an AI detector for Ludory**, a universal accuracy guarantee, or a measure of whether a specific story is good.

Observed dataset tendencies (AI average vs. human, not individual rules):

| Feature | AI | Human |
| --- | ---: | ---: |
| Explicit narrator commentary on theme | 77% | 52% |
| Primarily embodied metaphor for emotion | 81% | 38% |
| No subplots | 79% | 57% |
| Protagonist-choice-driven resolution | 69% | 46% |
| Protagonist framed as morally mixed | 38% | 59% |
| Chronological discontinuity, 1–5 scale | 2.12 | 2.40 |

Humans were more diverse in the study's narrative feature space. The study analyzed fiction, **not** interactive visual novels. Models differed in length, stories were reconstructed from prompts inferred from human originals, and automatic labels received only small-scale human validation. Avoid claims about actual authorship, originality, copyright status or performance on branching games.

## Adaptation to Ludory

For each episode or branch, evaluate against **its brief and existing canon**:

1. **Continuity and causality:** Scene order, chronology, location, world rules, revelations, remembered events and objects agree across the actual path.
2. **Branching choices:** Each advertised consequential choice has an observable downstream consequence; route locks, relationship and trust variables do not collapse unintentionally; Back/save/reload state expectations remain coherent.
3. **Character agency:** Protagonist and love interests make choices from stable motivations, rather than existing to deliver the author's moral or rescue the plot.
4. **Relationships and romance:** Trust, emotional vulnerability, conflict, reconciliations and intimacy are earned at the route's pace; no sudden personality reset.
5. **Narrative texture:** Exposition, dialogue, subplots, sensory detail and theme arise naturally from concrete events. Mark clichés only if repeated or dramatically ineffective.
6. **Disclosure and ending:** Information is revealed when useful to dramatic tension. An ambiguous ending or a flashback is sometimes appropriate, but never a compulsory sign of 'human' writing.
7. **Player experience:** Reading load, scene boundaries and choice timing serve the visual-novel medium; no off-screen crucial consequence without narrative explanation.

P0: canonical contradiction or route/state error rendering a path incoherent. P1: serious missing consequence, characterization, romance or story-fact problem. P2: optional local prose or pacing polish. For each P0/P1: cite exact draft excerpt, scene/location and the matching canon/brief that makes it wrong. Missing canon → `BLOCKED` rather than invention. A response with only P2 may `ACCEPT`.

## How to avoid a new template

- A tightly linear episode can be excellent; a flashback added by quota can damage pacing.
- Physical sensation can show emotion effectively; do not ban sensory descriptions because the study found them more common in AI text.
- Clear resolution and moral statements can be intentional genre choices.
- Prioritize defects that change the reader/player's understanding or decisions. Report at most significant issues, then stop micro-polishing.
