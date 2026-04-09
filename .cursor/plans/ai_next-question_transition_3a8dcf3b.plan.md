---
name: AI next-question transition
overview: "Thay template cố định \"Cảm ơn em. Tiếp theo...\" bằng một lần gọi Bedrock (`converseWithSystem`) dùng prompt chuyên biệt: ghép ngữ cảnh đoạn vừa trao đổi (thread câu hiện tại) với **nội dung câu hỏi kế từ bank** thành **một** lời thoại liền mạch; giữ fallback template nếu AI lỗi/rỗng."
todos:
  - id: add-transition-prompt
    content: Thêm `chat-next-question-transition.prompt.ts` với system prompt + quy tắc ngôn ngữ / một câu hỏi bank
    status: completed
  - id: wire-ai-transition
    content: Thêm `buildTransitionToNextQuestion` trong `chat.service.ts`, gọi `converseWithSystem`, fallback `buildAckAndAskNext`
    status: completed
  - id: replace-advance-branch
    content: Thay chỗ `buildAckAndAskNext` trong nhánh advance+còn nextQ bằng await transition AI; build backend
    status: completed
isProject: false
---

# Chuyển cảnh sang câu tiếp theo bằng AI (không đứt mạch)

## Bối cảnh code

Trong `[interview-prep-backend/src/modules/chat/chat.service.ts](d:\NCKH\interview-prep-backend\src\modules\chat\chat.service.ts)`, nhánh `shouldAdvance === true` và còn `nextQ` hiện gọi `buildAckAndAskNext` (dòng ~340–343) rồi lưu `kind: 'question'`. Cần thay phần sinh `text` bằng AI, vẫn lưu metadata (`stage`, `category`, `difficulty`) như cũ.

## Thiết kế

1. **Prompt mới** (file mới, ví dụ `[chat-next-question-transition.prompt.ts](d:\NCKH\interview-prep-backend\src\modules\chat\chat-next-question-transition.prompt.ts)`)
  - System prompt: vai trò người phỏng vấn; nhiệm vụ tạo **một** đoạn thoại duy nhất (plain text, không JSON).
  - Phải: (a) bám ngắn vào phần vừa trao đổi (ack / cầu nối tự nhiên); (b) đưa vào **câu hỏi tiếp theo từ bank** sao cho giữ nguyên ý/độ phủ của câu bank (được phép diễn đạt lại tự nhiên, không thêm câu hỏi thứ hai).
  - Ngôn ngữ: theo `language` (Vietnamese vs English) giống các prompt khác.
  - User message: JSON string hóa payload gồm:
    - `priorThread`: transcript đã format (có thể tái dùng `formatThreadForClassifier` hoặc tách helper `formatThreadPlain` để tránh trùng logic).
    - `previousBankQuestion`: `currentQ?.question_text` (câu bank vừa xong).
    - `nextBankQuestion`: `nextQ.question_text`.
    - `nextMeta` tối thiểu: `stage`, `category` (optional) để AI hiểu chuyển giai đoạn nếu cần.
2. **Private method trong `ChatService`** (ví dụ `buildTransitionToNextQuestion`)
  - Gọi `this.ai.converseWithSystem({ systemPrompts: [NEXT_QUESTION_TRANSITION_PROMPT], userText: JSON.stringify(payload), maxTokens: 768 })`.
  - `trim()` kết quả; nếu rỗng hoặc throw → **fallback** `buildAckAndAskNext(...)` hiện có.
3. **Chỗ gọi**
  - Trong block `if (nextQ?.question_text?.trim())` sau `setActiveQuestionOrder`, thay `const text = buildAckAndAskNext(...)` bằng `const text = await this.buildTransitionToNextQuestion({ ... })`.
  - Truyền đủ: `language`, `thread` (đã có), `currentQ`, `nextQ`.
4. **Không đổi** luồng classifier, `active_question_order`, hay FE; chỉ đổi nội dung bubble “câu mới” sau advance.

## Kiểm tra

- `npm run build` trong `interview-prep-backend`.

