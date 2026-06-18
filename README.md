# 마음기록 — 진료실 밖에서도 이어지는 정신과 케어 (21팀 MVP)

퇴원 환자가 평소 AI와 일상 대화를 나누면, 그 내용에서 의사에게 필요한 임상 신호를 정리해
**진료 전 요약 리포트**로 전달하는 데모.

> ⚠️ 데모/연구용. 진단·치료가 아닌 **기록·요약·전달** 도구. 의학적 판단은 의사가 합니다.
> 데모 데이터는 모두 **가상 환자**입니다.

## 구조
```
index.html          # 프론트(환자 채팅 + 의사 대시보드). 단일 파일, 더블클릭하면 실행
backend/            # Solar(Upstage) 프록시 — Render 배포용 (API 키 숨김)
  server.js
  package.json
  README_배포.md     # Render 배포 가이드
준비물_체크리스트.md
```

## 실행 (데모)
- `index.html` 을 더블클릭하거나 VSCode Live Server로 열기.
- "▶ 데모 시나리오 재생" 클릭 → 환자 잡담이 의사 리포트 + Red Flag로 정리되는 흐름 확인.
- API/DB 없이 **목업 모드**로 바로 동작.

## 실제 연동
1. `backend/` 를 Render에 배포 (backend/README_배포.md 참고).
2. Render 환경변수: `UPSTAGE_API_KEY`, `SOLAR_MODEL`.
3. `index.html` 상단 `BACKEND_URL` 에 Render 주소 입력 → Solar 실제 추출.
4. Solar 실패 시 자동 목업 폴백 → 데모는 안 깨짐.

## 배포 (프론트)
- GitHub Pages: Settings → Pages → Branch `main` / `(root)` → 저장.
- 또는 Cloudflare Pages + 개인 도메인.

## 안전 설계
- 위험 키워드(자살 사고 등) 감지는 **규칙 기반(프론트)** 으로 항상 동작 — API 의존 안 함.
- 위험 시: 위로로 덮지 않고 위기 자원(자살예방상담 109) 안내 + 의사에게 Red Flag.
