# TODO: Fix OpenRouter SDK Validation Error

## Steps:
- [x] 1. Edit src/App.jsx: Wrap all chat params (model, messages, stream, temperature, maxTokens) inside single `chatGenerationParams` object in `openrouter.chat.send()`.
- [x] 2. Test: Run `npm run dev`, send a chat message, verify no "Input validation failed" error.
- [x] 3. Confirm streaming works and agent phases display correctly.
- [ ] 4. Remove this TODO.md file.
- [ ] 5. attempt_completion
