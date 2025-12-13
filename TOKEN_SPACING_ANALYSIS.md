# Token Spacing Fix - Word Length Heuristic

## Problem Analysis

From the logs, we can see the LLM sends tokens without spaces:

```
Token: "respons" + "ável" = should be "responsável" (NO space)
Token: "método" + "principal" = should be "método principal" (space needed)
Token: "aplic" + "ação" = should be "aplicação" (NO space)
Token: "execut" + "ar" = should be "executar" (NO space)
Token: "ass" + "in" + "atura" = should be "assinatura" (NO spaces)
```

## Previous Attempts

### Attempt 1: Add space between all letter+letter tokens
❌ **Result**: Added spaces EVERYWHERE, breaking sub-word tokens
- "aplicação" became "aplic ação"

### Attempt 2: Only add space if token starts with uppercase
❌ **Result**: Didn't work because most Portuguese words start with lowercase
- "método" starts with "m" (lowercase)
- Would not add space after "O"

## Current Solution: Word Length Heuristic

### Logic
```javascript
const likelyNewWord = token.length > 4; // >= 5 chars

if (prevEndsWithLetter && currStartsWithLetter && likelyNewWord) {
    processedToken = ' ' + token;
}
```

### Why It Works

**Observation**: Sub-word tokens (suffixes/continuations) are typically **4 chars or less**:
- "ável" = 4 chars (suffix)
- "ação" = 4 chars (suffix)  
- "ar" = 2 chars (suffix)
- "in" = 2 chars (middle part)
- "ado" = 3 chars (suffix)
- "ida" = 3 chars (suffix)

**But full words are typically **5+ chars**:
- "método" = 6 chars ✓ (full word → add space)
- "principal" = 9 chars ✓ (full word → add space)
- "quando" = 6 chars ✓ (full word → add space)
- "representa" = 10 chars ✓ (full word → add space)

### Test Cases with Threshold = 5

| Previous | Current | Length | Length >= 5? | Add Space? | Result |
|----------|---------|--------|--------------|------------|---------|
| "respons" | "ável" | 4 | ❌ No | ❌ No | "responsável" ✓ |
| "método" | "principal" | 9 | ✅ Yes | ✅ Yes | "método principal" ✓ |
| "aplic" | "ação" | 4 | ❌ No | ❌ No | "aplicação" ✓ |
| "execut" | "ar" | 2 | ❌ No | ❌ No | "executar" ✓ |
| "ass" | "in" | 2 | ❌ No | ❌ No | "assin..." ✓ |
| "assin" | "atura" | 5 | ✅ Yes | ⚠️ Hmm... | "assin atura" ❌ |

**Edge Case Found**: "atura" is 5 chars, so it would get a space!

### Refined Solution

Let me check actual suffix lengths in Portuguese:
- **2 chars**: ar, er, ir, or, ez, im, al, el
- **3 chars**: ado, ada, ção, dor, eza, ico, ica, oso
- **4 chars**: ável, ação, ente, ismo, ista, mente
- **5 chars**: adura, atura, ência, ância

So even **"atura" is a suffix** (5 chars)! The threshold approach won't work perfectly.

## Better Solution: Check Both Tokens

Instead of just checking current token length, check if **previous token is also short**:

```javascript
const prevIsShort = previousToken.length <= 6;  // Likely incomplete word
const currIsShort = token.length <= 4;          // Likely suffix

// If BOTH are short fragments, don't add space (they're parts of same word)
// If previous is short but current is long, might be new word
// If previous is long and current is long, definitely new word

if (prevEndsWithLetter && currStartsWithLetter) {
    if (prevIsShort && currIsShort) {
        // Both short → probably same word being built
        // Don't add space
    } else if (!prevIsShort && !currIsShort) {
        // Both long → definitely separate words
        processedToken = ' ' + token;
    } else {
        // Mixed → need more logic
        // If current is very short (<=3), likely suffix
        if (token.length > 3) {
            processedToken = ' ' + token;
        }
    }
}
```

Actually, this is getting too complex. Let me use a simpler heuristic:

**Just check if token length >= 6** (most full words are 6+ chars):
- "método" = 6 ✓
- "principal" = 9 ✓
- "quando" = 6 ✓
- "ável" = 4 ✗
- "ação" = 4 ✗
- "atura" = 5 ✗

