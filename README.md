# AutomationMonitor

Unreal Engine 소스 저장소의 **nightly upstream sync**와 **installed-engine build**를 모니터링·실행·배포하는 웹 대시보드입니다.  
`Automation/SyncAndBuildInstalled.ps1` 파이프라인을 감시하고, Windows 작업 스케줄러 등록, 로그 열람, 디스크·upstream 상태 알림, SMB 배포까지 한 화면에서 처리합니다.

## 주요 기능

| 화면 | 설명 |
|------|------|
| Overview | 파이프라인 상태, 7일 성공률, 디스크·출력 용량, 스케줄 작업, Git/upstream 요약 |
| Run & Pipeline | Run 옵션, `install_build_config.ini` 편집, 즉시 실행·스케줄 등록 |
| Deploy | installed-engine 아티팩트 목록, SMB 타깃 배포, 배포 이력 |
| Logs | 빌드·모니터 로그 tail, 필터, 다운로드 |
| Alerts | 인시던트 피드, 알림 채널 설정, 트리거 규칙 |

## 스크린샷

### Overview

대시보드에서 파이프라인 idle/running 상태, 최근 실행, 디스크 여유, 스케줄 작업, 활성 알림을 한눈에 확인합니다.

![Overview](images/1.png)

### Run & Pipeline — Run Options

Clean/NoClean 실행, 일일 스케줄 시각, upstream/deps/project files/DDC 등 sync 플래그를 설정합니다. 변경 사항은 `workspace.json`에 자동 저장됩니다.

![Run Options](images/2.png)

### Run & Pipeline — Install Build Config

브랜치·버전·타깃 플랫폼, upstream remote, 빌드 타깃(Editor/DDC/Client/Server), 출력·로그 경로를 UI에서 편집하고 `install_build_config.ini`에 반영합니다.

![Install Build Config](images/3.png)

### Deploy

`build_summary_*.txt` 기준 최신 성공 빌드를 CURRENT 아티팩트로 표시하고, SMB 공유 등 배포 타깃으로 `robocopy /MIR` 배포를 실행합니다.

![Deploy](images/4.png)

### Alerts & Notifications

빌드 실패, 디스크 부족, 장시간 빌드, upstream 지연 등 인시던트를 표시합니다. Slack·Email·Windows Toast 채널과 임계값을 설정할 수 있습니다. (채널 전송은 설정 저장만 지원, 실제 발송은 미연결)

![Alerts](images/5.png)

## 요구 사항

- Windows 10/11
- [Node.js](https://nodejs.org/) 18 이상 (LTS 권장)
- Git, PowerShell 5.1+
- 저장소 루트에 `Automation/` 스크립트 및 (선택) `install_build_config.ini`
- 빌드 로그: `LocalBuilds/AutomationLogs/`
- 모니터 로그·상태: `LocalBuilds/AutomationMonitor/`

## 빠른 시작

### 원클릭 실행 (권장)

| 모드 | 실행 파일 | 접속 URL |
|------|-----------|----------|
| 개발 | `Start-Dev.cmd` 또는 `start-dev.ps1` | http://127.0.0.1:5173 |
| 운영 | `Start-Prod.cmd` 또는 `start-prod.ps1` | http://127.0.0.1:4174 |

개발 모드는 API 서버(`4174`)와 Vite HMR UI(`5173`) 두 프로세스를 띄웁니다. 운영 모드는 `vite build` 후 단일 Node 프로세스가 UI와 API를 함께 제공합니다.

### 수동 실행

```powershell
cd AutomationMonitor
npm install

# 개발: 터미널 1
npm run dev

# 개발: 터미널 2
npm run ui

# 운영
npm run prod
```

### Windows 작업 스케줄러로 상시 구동

저장소 루트에서:

```powershell
.\Automation\Register-MonitorServerTask.ps1
```

기본 포트는 `4174`입니다. 변경 시 환경 변수를 사용합니다.

```powershell
$env:UE6_MONITOR_PORT = "8080"
$env:UE6_MONITOR_HOST = "0.0.0.0"   # 기본값
```

## 아키텍처

```
AutomationMonitor/
├── server/          # Node HTTP API (상태 수집, 실행, 배포)
├── src/             # React UI (Vite)
├── workspace.json   # Run 옵션, deploy 타깃, alert 임계값
├── dist/            # 운영 빌드 산출물 (vite build)
└── start-*.ps1      # 원클릭 런처
```

- **프론트엔드**: React + Vite. 5초마다 `/api/status` 폴링.
- **백엔드**: 순수 Node `http` 서버. PowerShell·`git`·`robocopy` 호출.
- **파이프라인 파싱**: `SyncAndBuildInstalled.ps1` 래퍼 로그의 `START`/`DONE` 단계와 UBT 빌드 로그를 합쳐 진행률 계산.
- **설정**: UI 편집 값은 `workspace.json`과 `install_build_config.ini`에 저장. ACK·배포 이력은 `LocalBuilds/AutomationMonitor/monitor-state.json`.

### 파이프라인 단계

`SyncAndBuildInstalled.ps1`의 `Invoke-LoggedStep` 이름과 1:1 대응합니다.

1. Validate repository state  
2. Configure upstream remote  
3. Fetch origin and upstream  
4. Checkout build branch  
5. Merge upstream into local branch  
6. Push synced branch to fork origin  
7. Sync Unreal dependencies  
8. Generate project files  
9. Install build pre-processing  
10. Build Win64 installed engine  
11. Install build post-processing  

## 설정 파일

### workspace.json

| 섹션 | 용도 |
|------|------|
| `build` | `install_build_config.ini`와 동기화되는 빌드 설정 |
| `runOptions` | Run 탭 플래그·스케줄 시각·출력 디렉터리 |
| `deploy.targets` | SMB/P4 등 배포 타깃 (SMB만 실배포) |
| `alerts.channels` | Slack, Email, Windows Toast on/off |
| `alerts.thresholds` | 디스크 %, upstream 커밋 수, 빌드 시간(h) |

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `UE6_MONITOR_PORT` | `4174` | API·운영 UI 포트 |
| `UE6_MONITOR_HOST` | `0.0.0.0` | 바인드 주소 |

## API 개요

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/status` | 전체 상태 (Git, 파이프라인, 디스크, 알림, 로그 목록) |
| POST | `/api/run-now` | 즉시 빌드 실행 |
| POST | `/api/stop` | 모니터가 시작한 프로세스 트리 종료 |
| POST | `/api/register-task` | 야간 스케줄 작업 등록 |
| POST | `/api/start-task` | 등록된 스케줄 작업 즉시 시작 |
| GET/POST | `/api/install-config` | 빌드 INI 읽기/쓰기 |
| POST | `/api/upstream/register` | upstream remote 추가 및 fetch |
| GET | `/api/logs/:name` | 로그 tail |
| GET | `/api/deploy` | 아티팩트·타깃·이력 |
| POST | `/api/deploy/start` | SMB 배포 시작 |

## UI 동작 메모

- **Run (Clean)**: `-NoClean` 없이 전체 파이프라인 실행.
- **Run (NoClean)**: 증분 빌드용 `-NoClean` 전달.
- **Stop**: `taskkill /T /F`로 PowerShell 하위 UAT·UBT 프로세스까지 종료.
- **Add & Fetch Upstream**: Epic 원격 등록 후 지정 브랜치만 fetch (HTTP/1.1 강제).
- **테마**: 사이드바 하단·상단의 라이트/다크 토글. `localStorage`에 저장.

## 관련 스크립트

저장소 루트 `Automation/`:

- `SyncAndBuildInstalled.ps1` — 실제 sync·build 파이프라인
- `Register-NightlyInstalledBuildTask.ps1` — 야간 빌드 작업 스케줄러 등록
- `Register-MonitorServerTask.ps1` — 모니터 서버 상시 구동 등록

## 라이선스

저장소 루트 `LICENSE`를 따릅니다.
