# Quick Test Guide for Streaming Improvements

## 1. Test Word Spacing

### Setup
1. Open the app
2. Go to Settings (CTRL+SHIFT+C)
3. Set Voice Model to **"llama-stream"**
4. Set Language to **Portuguese (pt-br)**

### Test Cases

#### Test 1: Portuguese Words with Sub-tokens
**Say or type**: "Preciso de uma assinatura digital"

**Expected behavior**:
- Words should be complete: "assinatura" (not "ass in atura")
- Words should have spaces between them
- No extra spaces within words

#### Test 2: English Text
**Say or type**: "What is the application process?"

**Expected behavior**:
- Words like "application" should be complete
- Normal spacing between words

#### Test 3: Punctuation
**Say or type**: "Hello, world! How are you?"

**Expected behavior**:
- No space before punctuation: "Hello," not "Hello ,"
- Normal spacing after punctuation

---

## 2. Test Copy-to-Clipboard

### Test Multiline Code Block

**Say or type**: "Show me a Python function to calculate fibonacci"

**Expected behavior**:
1. LLM should return code in markdown format:
   ````
   ```python
   def fibonacci(n):
       if n <= 1:
           return n
       return fibonacci(n-1) + fibonacci(n-2)
   ```
   ````

2. Code block should appear formatted with syntax highlighting
3. Hover over code block → background should change (darker gray)
4. Click anywhere on the code block → toast should appear
5. Toast should say "Copiado para a área de transferência" (PT-BR)
6. Code should be in clipboard (paste to verify)

### Test Inline Code

**Say or type**: "Explain the print function"

**Expected behavior**:
1. LLM response should contain inline code like: "Use `print()` to output text"
2. Hover over `print()` → background should change
3. Click on `print()` → toast should appear
4. `print()` should be in clipboard

### Test English Toast

1. Go to Settings → Change language to **English (us-en)**
2. Copy any code
3. Toast should say **"Copied to clipboard"**

---

## 3. Verify No Regressions

### Normal Mode (Non-streaming)
1. Set Voice Model to **"llama"** (not llama-stream)
2. Ask a question
3. Response should work normally without streaming
4. Copy functionality should still work

---

## Console Logs to Check

When streaming, you should see logs like:
```
Token recebido: "aplic"
Token recebido: "ação"
Chunk recebido: "aplic" Length: 5
Chunk recebido: "ação" Length: 4
```

The frontend should join them correctly as "aplicação" (no space between).

For word boundaries:
```
Token recebido: "palavra"
Token recebido: " "
Token recebido: "outra"
```

Should result in "palavra outra" (space preserved).

---

## Common Issues & Fixes

### Issue: Extra spaces between words
**Cause**: Backend might be sending tokens with spaces already
**Fix**: Check console logs to see actual tokens received

### Issue: Toast not appearing
**Cause**: Element not in DOM or CSS class not applied
**Fix**: 
1. Open DevTools (F12)
2. Check if `<div id="copy-toast">` exists
3. Verify class changes when clicking code

### Issue: Code not copying
**Cause**: `navigator.clipboard` requires HTTPS or localhost
**Fix**: Should work on localhost, verify in DevTools console

### Issue: Words joined without spaces
**Cause**: Backend might not be sending space tokens
**Fix**: Check regex in `lastCharWasLetterOrNumber` flag logic

---

## DevTools Inspection

### Check Toast Element
```javascript
document.getElementById('copy-toast')
// Should return: <div id="copy-toast" class="copy-toast"></div>
```

### Manual Test Copy
```javascript
navigator.clipboard.writeText('test')
  .then(() => console.log('Copy works!'))
  .catch(err => console.error('Copy failed:', err))
```

### Check Language Setting
```javascript
window.electronAPI.getLanguage()
  .then(lang => console.log('Current language:', lang))
```

---

## Success Criteria

✅ Portuguese words with sub-tokens are joined correctly  
✅ Words have proper spacing between them  
✅ Punctuation has no extra spaces  
✅ Code blocks are clickable and copy to clipboard  
✅ Inline code is clickable and copies  
✅ Toast appears with correct language  
✅ Hover effects work on code elements  
✅ Non-streaming mode still works  

---

**Ready to test!** 🚀
