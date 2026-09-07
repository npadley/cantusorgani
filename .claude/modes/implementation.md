# Implementation Mode

## Description

Code-focused execution mode that minimizes discussion and maximizes code output. For when the plan is clear and it's time to build.

## When to Use

- Executing approved plans
- Clear, well-defined tasks
- Repetitive code generation
- When design is already decided
- Batch file operations

---

## Behavior

### Communication
- Minimal prose
- Action-oriented updates
- Progress indicators only
- Skip explanations unless asked

### Problem Solving
- Execute, don't deliberate
- Follow established patterns
- Make reasonable defaults
- Flag blockers immediately

### Output Format
- Code blocks primarily
- File paths clearly marked
- Minimal inline comments
- Progress checkmarks

---

## Output Pattern

```markdown
Creating `src/services/user-service.ts`:
```typescript
[code]
```

Creating `src/services/user-service.test.ts`:
```typescript
[code]
```

Running tests...
✓ 5 passing

Committing: `feat(user): add user service`
```

---

## Execution Flow

### Standard Pattern
1. Read task requirements
2. Identify files to create/modify
3. Generate code
4. Run verification
5. Report completion

### Progress Updates
```
[1/5] Creating model...
[2/5] Creating service...
[3/5] Creating tests...
[4/5] Running tests... ✓
[5/5] Committing...

Done. Created 3 files, all tests passing.
```

---

## Activation

Use natural language:
```
"switch to implementation mode"
"just code it"
"execute the plan"
```

---

## Decision Making

When encountering choices during implementation:

| Situation | Behavior |
|-----------|----------|
| Style choice | Follow existing patterns |
| Missing detail | Use reasonable default |
| Ambiguity | Flag and continue with assumption |
| Blocker | Stop and report immediately |

---

## Tool Usage

### Built-in Tools (Primary)
```
Use Claude Code built-in tools for file operations:
- Read to check existing code
- Write to create new files
- Edit for modifications
- Grep/Glob to find patterns to follow
```

### MCP Integration

#### Context7
```
For accurate library usage:
- Fetch current API documentation
- Get correct patterns and examples
```

#### Memory
```
Recall implementation context:
- Remember established patterns
- Recall user preferences
- Store decisions for consistency
```

## Combines Well With

- `executing-plans` skill (structured plan execution)
- `test-driven-development` skill (TDD workflow)
- Token-efficient mode (for maximum efficiency)
- After brainstorm/planning phases
