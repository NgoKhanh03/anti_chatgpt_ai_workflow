# AI Workflow — Project Plan

## 1. Tổng quan

Dự án xây dựng một workflow phát triển phần mềm đa-agent, trong đó:

- **Antigravity** đóng vai trò Coding Agent: phân tích task, sửa code, chạy test, commit và tạo Pull Request.
- **ChatGPT** đóng vai trò Senior Code Reviewer: review PR độc lập, phát hiện lỗi, đánh giá kiến trúc, test, security và regression risk.
- **GitHub Pull Request** là source of truth và giao thức trao đổi chính giữa Coding Agent và Reviewer.
- **CI** là deterministic quality gate trước khi gọi AI reviewer.
- **Human** giữ quyền phê duyệt cuối cùng trước khi merge.

## 2. Mục tiêu dự án

Xây dựng vòng lặp tự động:

`Task → Antigravity Code → Test → PR → CI → ChatGPT Review → Fix → Re-review → Human Merge`

Mục tiêu chính:

1. Tách biệt rõ vai trò Developer và Reviewer.
2. Tự động hóa phần lớn vòng code-review-fix.
3. Giữ GitHub PR làm trạng thái trung tâm của workflow.
4. Cho phép thay browser automation bằng API/connector mà không thay đổi business workflow.
5. Ngăn vòng lặp AI vô hạn bằng state machine và stop conditions.
6. Yêu cầu human approval cho bước merge cuối cùng.

## 3. Nguyên tắc kiến trúc

- Antigravity không tự approve code do chính nó viết.
- ChatGPT reviewer chỉ nhận spec, diff, test/CI result và review history cần thiết.
- CI fail thì trả về Antigravity sửa trước, không gọi ChatGPT.
- Review output phải có cấu trúc machine-readable.
- Mọi iteration phải được lưu trạng thái để có thể resume sau crash/restart.
- Browser automation chỉ là adapter của MVP, không phải core architecture.

## 4. Kiến trúc tổng thể

```text
Human / Product Owner
        |
        v
Task / Specification
        |
        v
Orchestrator
   |          |
   v          v
Antigravity  ChatGPT Reviewer
   |          ^
   v          |
GitHub PR + CI
        |
        v
Clean-room Review
        |
        v
Human Approval → Merge
```

## 5. State Machine

Các trạng thái chính:

`NEW → CODING → TESTING → PR_CREATED → AI_REVIEWING → FINAL_REVIEW → AI_APPROVED → HUMAN_APPROVAL → MERGED`

Luồng lỗi và sửa:

- `TESTING → FIXING → TESTING` khi lint, typecheck, test hoặc build fail.
- `AI_REVIEWING → FIXING` khi reviewer trả về `REQUEST_CHANGES`.
- `FINAL_REVIEW → FIXING` nếu clean-room review phát hiện lỗi blocking mới.
- Bất kỳ vòng lặp nào vượt quá giới hạn iteration sẽ chuyển sang `NEEDS_HUMAN`.

## 6. Cấu trúc thư mục đề xuất

```text
ai_workflow/
├── PROJECT_PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── config/
│   └── review-policy.yml
├── schemas/
│   ├── task.schema.json
│   ├── review.schema.json
│   └── state.schema.json
├── prompts/
│   ├── antigravity-developer.md
│   ├── chatgpt-reviewer.md
│   └── clean-room-reviewer.md
├── src/
│   ├── orchestrator/
│   ├── adapters/
│   ├── github/
│   ├── state/
│   └── cli/
├── tests/
└── .ai/
    ├── task.json
    └── review-state.json
```

## 7. Trách nhiệm thành phần

- **Orchestrator:** điều khiển state machine, iteration và policy.
- **Antigravity Adapter:** giao task cho coding agent và nhận trạng thái thực thi.
- **Reviewer Adapter:** gửi PR/diff tới ChatGPT và chuẩn hóa review output.
- **GitHub Adapter:** branch, commit, PR, CI status và review comments.
- **State Store:** lưu task, iteration, issue status và khả năng resume workflow.

## 8. Task Contract

Mỗi task giao cho Antigravity phải có cấu trúc rõ ràng:

```yaml
task:
  id: FEAT-001
  objective: Mô tả mục tiêu cần triển khai
  acceptance_criteria:
    - Điều kiện nghiệm thu 1
    - Điều kiện nghiệm thu 2
constraints:
  - Tuân theo architecture hiện tại
  - Không thêm dependency nếu không cần thiết
definition_of_done:
  - lint pass
  - typecheck pass
  - tests pass
  - build pass
  - pull request created
```

## 9. Review Contract

ChatGPT reviewer phải trả kết quả machine-readable, ưu tiên JSON:

```json
{
  "verdict": "REQUEST_CHANGES",
  "issues": [
    {
      "id": "R001",
      "severity": "P1",
      "file": "src/example.ts",
      "line": 42,
      "problem": "Mô tả lỗi",
      "evidence": "Bằng chứng từ code hoặc spec",
      "recommended_fix": "Hướng sửa đề xuất"
    }
  ]
}
```

Reviewer kiểm tra tối thiểu: correctness, acceptance criteria, architecture, regression risk, error handling, security, concurrency, performance, tests và maintainability.

## 10. Severity và Merge Policy

- **P0:** Critical — lỗi nghiêm trọng, security/data loss; bắt buộc sửa.
- **P1:** Must Fix — lỗi correctness hoặc regression đáng kể; bắt buộc sửa.
- **P2:** Should Fix — vấn đề chất lượng đáng lưu ý; mặc định không block merge.
- **P3:** Suggestion — cải tiến tùy chọn.

`P0` và `P1` là merge-blocking. Verdict chỉ được phép là `APPROVE` hoặc `REQUEST_CHANGES`.

## 11. Review Loop

Luồng mỗi iteration:

1. Antigravity triển khai hoặc sửa code.
2. Chạy lint, typecheck, test và build.
3. Nếu CI fail, quay lại FIXING mà không gọi reviewer.
4. Nếu CI pass, gửi PR diff và context cần thiết cho ChatGPT.
5. ChatGPT trả verdict và danh sách issue có ID ổn định.
6. Antigravity sửa các issue blocking và push commit mới.
7. Reviewer kiểm tra issue cũ, diff mới và regression phát sinh.

## 12. Clean-room Final Review

Khi toàn bộ issue blocking đã được resolve, thực hiện một review mới không dùng lịch sử reasoning của các vòng trước. Reviewer chỉ nhận task/spec, trạng thái CI và toàn bộ PR hiện tại để giảm confirmation bias.

## 13. Stop Conditions

- `max_iterations: 5`
- Quá giới hạn iteration → `NEEDS_HUMAN`.
- Reviewer trả output không hợp lệ nhiều lần → `NEEDS_HUMAN`.
- Conflict giữa spec và implementation không thể tự giải quyết → `NEEDS_HUMAN`.
- Không agent nào được tự merge PR.

## 14. Phạm vi MVP

MVP sử dụng browser automation để gửi PR context tới ChatGPT, nhận review JSON, chuyển issue về Antigravity và lặp đến khi `APPROVE` hoặc đạt stop condition. Kiến trúc adapter phải cho phép thay browser bằng OpenAI API hoặc GitHub integration ở phiên bản sau.

## 15. Roadmap triển khai

### Phase 0 — Foundation
- Khởi tạo TypeScript project và Git repository.
- Tạo config, schemas, prompts và state directory.
- Xác định CLI commands và logging format.

### Phase 1 — State Machine
- Implement workflow states và transition rules.
- Persist state xuống `.ai/review-state.json`.
- Hỗ trợ resume sau khi process restart.

### Phase 2 — GitHub Integration
- Đọc branch, commit, PR diff và CI status.
- Tạo/update PR và review metadata.
- Chuẩn hóa PR handoff packet.

### Phase 3 — Antigravity Adapter
- Giao Task Contract cho coding agent.
- Nhận execution result, commit và test status.
- Điều khiển vòng FIXING → TESTING.

### Phase 4 — ChatGPT Reviewer MVP
- Browser adapter mở dedicated review conversation.
- Gửi structured review context.
- Parse và validate Review Contract JSON.

### Phase 5 — Review Loop & Final Gate
- Implement issue lifecycle OPEN → FIXED → VERIFIED.
- Thêm max iteration và NEEDS_HUMAN.
- Thêm clean-room final review và human merge gate.

### Phase 6 — API Migration
- Tách Reviewer interface khỏi browser implementation.
- Thêm OpenAI/API adapter sử dụng structured output.
- Cho phép chọn reviewer adapter bằng configuration.
- Browser adapter vẫn giữ làm fallback trong giai đoạn chuyển đổi.

### Phase 7 — Hardening & Observability
- Structured logging cho mỗi workflow run và iteration.
- Lưu duration, token/cost metadata và failure reason khi có thể.
- Thêm retry policy cho lỗi transient nhưng không retry logic error.
- Redact secrets khỏi prompt, log và review artifacts.
- Viết integration tests cho full workflow state transitions.

## 16. Definition of Done cho MVP

MVP được xem là hoàn thành khi:

- Có thể nhận một Task Contract và khởi tạo workflow.
- Antigravity có thể code, test, commit và tạo/update PR.
- CI fail tự động quay về vòng fix.
- CI pass kích hoạt ChatGPT review.
- Review JSON được validate trước khi chuyển cho coding agent.
- Issue P0/P1 được theo dõi qua nhiều iteration.
- Workflow dừng đúng khi APPROVE, NEEDS_HUMAN hoặc max iterations.
- Clean-room final review hoạt động.
- State có thể resume sau process restart.
- Merge cuối cùng vẫn yêu cầu human approval.
