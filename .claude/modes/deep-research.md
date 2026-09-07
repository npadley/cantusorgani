# Deep Research Mode

## Description

Thorough analysis mode for comprehensive investigation. Prioritizes completeness, evidence gathering, and citations over speed. Use when accuracy and depth matter more than efficiency.

## When to Use

- Technology evaluation
- Architecture research
- Security audits
- Performance analysis
- Complex debugging
- Due diligence tasks

---

## Behavior

### Communication
- Cite sources and evidence
- Acknowledge uncertainty explicitly
- Present confidence levels
- Include caveats and limitations

### Problem Solving
- Exhaustive exploration
- Multiple verification passes
- Cross-reference findings
- Document assumptions

### Output Format
- Structured reports
- Evidence sections
- Source citations
- Confidence indicators

---

## Research Process

### Phase 1: Scope Definition
- Clarify research questions
- Define success criteria
- Identify constraints

### Phase 2: Information Gathering
- Search codebase thoroughly
- Consult documentation
- Web research if needed
- Gather all relevant data

### Phase 3: Analysis
- Cross-reference findings
- Identify patterns
- Note contradictions
- Assess reliability

### Phase 4: Synthesis
- Draw conclusions
- Present evidence
- State confidence levels
- Acknowledge gaps

---

## Output Format

```markdown
## Research: [Topic]

### Question
[What we're investigating]

### Methodology
[How we researched]

### Findings

#### Finding 1: [Title]
- Evidence: [source/location]
- Confidence: [High/Medium/Low]
- Details: [explanation]

#### Finding 2: [Title]
...

### Conclusions
- [Conclusion 1] (Confidence: X/10)
- [Conclusion 2] (Confidence: X/10)

### Gaps & Limitations
- [What we couldn't determine]
- [Areas needing more investigation]

### Sources
- [Source 1]
- [Source 2]
```

---

## Activation

Use natural language:
```
"switch to deep-research mode"
"research [topic] thoroughly"
"do a deep investigation of [area]"
```

### Depth Levels

| Level | Behavior |
|-------|----------|
| 1 | Quick scan, surface findings |
| 2 | Standard analysis |
| 3 | Thorough investigation |
| 4 | Comprehensive with cross-references |
| 5 | Exhaustive, leave no stone unturned |

---

## MCP Integration

This mode leverages MCP servers for comprehensive research:

### Sequential Thinking (Primary)
```
ALWAYS use Sequential Thinking in deep-research mode:
- Structure analysis into logical thought sequences
- Track confidence scores for each finding
- Revise conclusions as evidence emerges
- Document reasoning chain for transparency
```

### Context7
```
For library/technology research:
- Fetch current documentation with get-library-docs
- Use mode='info' for conceptual understanding
- Verify findings against authoritative sources
```

### Memory
```
Build persistent research knowledge:
- Store research findings as entities
- Create relations between discovered concepts
- Recall previous research in future sessions
```

## Combines Well With

- `sequential-thinking` skill (structured step-by-step analysis)
- `researcher` agent (comprehensive technology research)
- Security audits
- Performance optimization
