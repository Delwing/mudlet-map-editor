# Mudlet Map Editor

[English](README.md) | **한국어**

[Mudlet](https://www.mudlet.org/)의 `.dat` 바이너리 지도 파일을 편집하는 브라우저 기반 시각 편집기입니다. 별도 설치 없이 브라우저에서 바로 MUD 지도를 불러오고, 편집하고, 저장할 수 있습니다.

**바로 사용하기:** https://kimdwch.github.io/mudlet-map-editor/
## 기능

- **시각적 편집** — 대화형 캔버스에서 방을 추가, 이동, 삭제
- **출구 관리** — 14개 이상의 방향으로 방 사이에 양방향 또는 단방향 출구 생성
- **라벨** — 사용자 지정 글꼴, 색상, 선택적 이미지를 사용한 텍스트 라벨 배치
- **사용자 지정 선** — 색상과 화살표를 설정할 수 있는 경유점 기반 경로 그리기
- **지역 및 환경 관리** — 방을 지역별로 정리하고 지형 색상 사용자 지정
- **견본 / 칠하기 도구** — 기호+환경 프리셋을 정의하고 클릭 한 번으로 방에 적용
- **실행 취소/다시 실행** — 설명이 붙은 전체 명령 기록
- **바이너리 입출력** — 브라우저에서 Mudlet `.dat` 파일을 직접 불러오고 저장하며, URL에서도 불러오기 가능
- **세션 유지** — 작업 내용이 IndexedDB에 자동 저장되고 다음 방문 시 복원

## 도구

| 키 | 도구 | 설명 |
|-----|------|-------------|
| `1` | 선택 | 방을 클릭해 속성을 보거나 편집하고, 방향키로 미세 이동 |
| `2` | 연결 | 시작 방을 클릭한 다음 대상 방을 클릭해 출구 생성 |
| `3` | 연결 해제 | 출구를 클릭해 해당 출구 제거 |
| `4` | 방 추가 | 빈 격자 칸을 클릭해 방 생성 |
| `5` | 라벨 추가 | 지도에 텍스트 라벨 배치 |
| `6` | 삭제 | 방, 출구 또는 라벨 제거 |
| `7` | 화면 이동 | 드래그해 보기 영역 이동 |
| `8` | 칠하기 | 선택한 견본(기호 + 환경)을 방에 적용 |

**사용자 지정 선** 도구는 도구 모음이 아니라 사이드 패널(선택한 출구)에서 실행합니다. 어떤 도구를 사용 중이든 **Space**를 누르고 있으면 임시로 화면을 이동할 수 있습니다.

## 키보드 단축키

| 단축키 | 동작 |
|----------|--------|
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Y` | 다시 실행 |
| `G` | 격자 맞춤 전환 |
| `F` | 지역을 화면에 맞추기 |
| `Delete` | 선택 항목 제거 |
| `Ctrl+A` | 현재 지역/Z 레벨의 모든 방 선택 |
| `Esc` | 현재 작업 취소 |

## 시작하기

```bash
npm install
npm run dev
```

앱을 연 다음 도구 모음에서 **Load**를 클릭해 `.dat` 파일을 열거나, **New**를 클릭해 새로 시작하세요. 변경 사항은 **Download**로 저장합니다.

## 명령어

```bash
npm run dev       # HMR을 지원하는 Vite 개발 서버
npm run build     # 타입 검사 후 프로덕션용 번들 생성
npm run preview   # 프로덕션 빌드 미리보기
```

## 라이브러리로 사용하기

배포 패키지에는 `dist-lib`만 포함되며, 편집기가 렌더링에 *사용하는* 라이브러리는 번들에 넣지 않고 외부 의존성으로 둡니다. 따라서 호스트 애플리케이션은 각 라이브러리를 하나씩만 불러오고, 편집기는 호스트가 이미 사용하는 것과 같은 React, Konva, 렌더러 인스턴스로 렌더링합니다. 이 라이브러리들은 peer dependency로 선언되어 있으므로 함께 설치해야 합니다.

```bash
npm install mudlet-map-editor \
  react react-dom konva mudlet-map-renderer mudlet-map-binary-reader \
  i18next react-i18next
```

npm 7 이상은 peer dependency를 자동으로 설치하지만 Yarn 1은 그렇지 않으므로, Yarn 1에서는 직접 `dependencies`에 추가하세요. 이 중 하나라도 두 번 로드되면 이 구조로 피하려던 중복 인스턴스 문제가 다시 생깁니다. React가 두 개면 훅이 깨지고, Konva가 두 개면 스테이지 레지스트리가 나뉘며, 렌더러가 두 개면 장면 구조를 서로 다르게 해석합니다.

## 플러그인으로 확장하기

`src/plugins/<name>/index.ts`에 `EditorPlugin`을 구현한 default export 파일을 두면 빌드 시 자동으로 인식됩니다. 플러그인으로 사이드바 탭, 방 패널 섹션, 견본 프리셋, 지도 검사 경고, 생명주기 훅(지도 열기/닫기/저장, 앱 준비 완료, 사용자 지정 오버레이 UI)을 추가할 수 있습니다.

전체 인터페이스 레퍼런스와 예제는 [docs/plugins.md](docs/plugins.md)를 참고하세요.

## 기술 스택

- **React 19** + **TypeScript**
- 번들링: **Vite**
- 캔버스 렌더링: **Konva** ([`mudlet-map-renderer`](https://github.com/Delwing/mudlet-map-renderer) 사용)
- Mudlet `.dat` 파일 파싱 및 직렬화: [`mudlet-map-binary-reader`](https://github.com/Delwing/mudlet-map-binary-reader)

## 아키텍처

```
Binary .dat file
  → mudlet-map-binary-reader  →  MudletMap (in-memory model)
  → EditorMapReader (adapter, Y-flip)
  → MapRenderer (Konva canvas) + LiveEffect overlays
```

모든 지도 변경은 실행 취소/다시 실행을 위해 작업을 기록하는 명령 시스템(`applyCommand`)을 거칩니다. 상태는 하나의 중앙 저장소에서 관리합니다.

대량 작업(여러 방 삭제, 방을 다른 지역으로 이동, 그리고 이 작업들의 실행 취소/다시 실행)은 `EditorMapReader`의 최적화된 경로를 거칩니다. 이 경로는 방마다가 아니라 영향을 받는 지역마다 `rebuildPlanes`/`rebuildExits`를 한 번만 실행하므로, 많은 방을 선택해도 빠르게 반응합니다.
