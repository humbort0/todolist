# To-Do-List (TDL)

## Project Overview
- **Name**: To-Do-List (모바일: TDL)
- **Goal**: 부서원(선생님들) 및 관리자 간의 업무를 투명하게 공유하고 진행 상황을 효율적으로 추적하는 할 일 관리 애플리케이션
- **Tech Stack**: Hono + TypeScript + Tailwind CSS + Cloudflare D1

## Features (구현 완료)

### UI/UX
- 민트색(Teal/Mint) 그라데이션 상단 네비게이션 바
- 4개의 파스텔톤 대시보드 요약 카드 (전체, 진행중, 완료대기, 평균 진행률)
- 다크모드 토글
- 모바일 반응형 (768px 이하에서 카드 레이아웃 전환, TDL 표시)

### 인증 및 권한
- 일반 접속: 비밀번호 `0000`
- 관리자 접속: 비밀번호 `1026`
- 자동 로그인 (localStorage 기반)
- 관리자 모드 전환 (톱니바퀴 아이콘)

### 관리자 전용 기능
- **비공개(Private) 토글**: 특정 업무를 비공개로 설정
- **최종 승인**: 100% 완료된 업무의 최종 마감 처리
- **코멘트(피드백)**: 각 할 일에 관리자 피드백 달기 (말풍선 아이콘)
- **인원 관리**: 부서원(선생님) 추가/삭제
- **카테고리 관리**: 업무 구분 동적 생성/삭제 (색상 포함)

### 업무 관리
- **기간별 필터링**: 전체 / 당일 / 주별 / 월별
- **담당자/카테고리 필터**: 드롭다운 선택
- **복합 검색**: 업무명, 담당자, 카테고리 등 통합 검색
- **인라인 편집**: 업무명 클릭 시 즉시 수정
- **진행률 슬라이더**: 0~100% 드래그 조작 (4단계 레이블)
- **엑셀 다운로드**: 현재 필터링 결과를 .xlsx 파일로 내보내기
- **할 일 추가/수정/삭제**: 모달 기반 CRUD

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | 로그인 (password: 0000 or 1026) |
| POST | `/api/auth/admin` | 관리자 인증 |
| GET | `/api/teachers` | 부서원 목록 조회 |
| POST | `/api/teachers` | 부서원 추가 |
| DELETE | `/api/teachers/:id` | 부서원 삭제 |
| GET | `/api/categories` | 카테고리 목록 |
| POST | `/api/categories` | 카테고리 추가 |
| PUT | `/api/categories/:id` | 카테고리 수정 |
| DELETE | `/api/categories/:id` | 카테고리 삭제 |
| GET | `/api/todos` | 할 일 목록 (쿼리: admin, period, search, teacher_id, category_id) |
| POST | `/api/todos` | 할 일 추가 |
| PUT | `/api/todos/:id` | 할 일 수정 (진행률, 비공개, 승인 등) |
| DELETE | `/api/todos/:id` | 할 일 삭제 |
| GET | `/api/todos/:id/comments` | 코멘트 조회 |
| POST | `/api/todos/:id/comments` | 코멘트 추가 |
| DELETE | `/api/comments/:id` | 코멘트 삭제 |
| GET | `/api/stats` | 대시보드 통계 |
| POST | `/api/seed` | 초기 데이터 시드 |

## Data Architecture
- **Database**: Cloudflare D1 (SQLite)
- **Tables**: teachers, categories, todos, comments
- **Storage**: 로컬 개발 시 `.wrangler/state/v3/d1` 자동 생성

## User Guide

### 일반 사용자
1. 비밀번호 `0000` 입력하여 로그인
2. 대시보드에서 전체 업무 현황 확인
3. 기간별 필터(당일/주별/월별)로 업무 조회
4. 슬라이더를 드래그하여 진행률 업데이트
5. 업무명 클릭하여 인라인 편집
6. 엑셀 다운로드 버튼으로 목록 내보내기

### 관리자
1. 비밀번호 `1026` 입력 또는 톱니바퀴 아이콘 클릭 후 인증
2. 비공개 토글: 자물쇠 아이콘 클릭
3. 최종 승인: 100% 완료 항목의 체크 아이콘 클릭
4. 코멘트: 말풍선 아이콘 클릭 후 피드백 입력
5. 관리 버튼: 부서원 및 카테고리 추가/삭제

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Development (Local)
- **Last Updated**: 2026-03-27
