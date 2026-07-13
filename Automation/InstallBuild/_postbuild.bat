@echo off
REM ============================================================================
REM AltavaEngine Install Build - Post-build Script
REM 빌드 후처리: PDB 정리, 로그 저장, 결과 요약
REM ============================================================================

setlocal enabledelayedexpansion

REM 스크립트 경로 설정
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\..\"
pushd "%ROOT_DIR%"
set "ROOT_DIR=%CD%"
popd

echo.
echo ============================================================
echo  [POST-BUILD] AltavaEngine Install Build Post-processing
echo ============================================================
echo.

REM 환경변수 확인
if "%BUILD_OUTPUT_DIR%"=="" set "BUILD_OUTPUT_DIR=LocalBuilds\Engine"
if "%BUILD_LOG_DIR%"=="" set "BUILD_LOG_DIR=LocalBuilds\Logs"
if "%DISTRIBUTION_TYPE%"=="" set "DISTRIBUTION_TYPE=Developer"
if "%BUILD_RESULT%"=="" set "BUILD_RESULT=0"

REM BUILT_DIRECTORY가 설정되어 있으면 사용, 없으면 기본값 사용
if not "%BUILT_DIRECTORY%"=="" (
    set "BUILT_DIRECTORY=%BUILT_DIRECTORY%"
    set "WINDOWS_BUILD_DIR=%BUILT_DIRECTORY%\Windows"
    set "FINAL_ENGINE_DIR=%BUILT_DIRECTORY%\Engine"
) else (
    set "OUTPUT_DIR=%ROOT_DIR%\%BUILD_OUTPUT_DIR%"
    set "WINDOWS_BUILD_DIR=%OUTPUT_DIR%\Windows"
    set "FINAL_ENGINE_DIR=%OUTPUT_DIR%\Windows"
)
set "LOG_DIR=%ROOT_DIR%\%BUILD_LOG_DIR%"

REM ----------------------------------------------------------------------------
REM 1. 빌드 결과 확인
REM ----------------------------------------------------------------------------
echo [1/4] Checking build result...

if "%BUILD_RESULT%" neq "0" (
    echo [ERROR] Build failed with error code: %BUILD_RESULT%
    echo         Check the log file for details.
    goto :save_summary
)

REM 빌드 출력 확인 (Windows 디렉토리 또는 Engine 디렉토리)
REM 주의: 괄호 블록 안에서 set한 변수를 같은 블록에서 %VAR%로 읽으면 파싱 시점에 미리 확장되어 빈 값이 됨.
REM       블록 밖(한 줄 if)에서 설정해야 이후 블록에서 %VAR%가 올바로 확장됨.
set "SOURCE_ENGINE_DIR="
set "TARGET_ENGINE_DIR="
set "WINDOWS_DIR="
if not "%BUILT_DIRECTORY%"=="" set "SOURCE_ENGINE_DIR=%BUILT_DIRECTORY%\Windows\Engine"
if not "%BUILT_DIRECTORY%"=="" set "TARGET_ENGINE_DIR=%BUILT_DIRECTORY%\Engine"
if not "%BUILT_DIRECTORY%"=="" set "WINDOWS_DIR=%BUILT_DIRECTORY%\Windows"

set "BUILD_CHECK_DIR=%WINDOWS_BUILD_DIR%"
if not "%SOURCE_ENGINE_DIR%"=="" if exist "%SOURCE_ENGINE_DIR%" set "BUILD_CHECK_DIR=%SOURCE_ENGINE_DIR%"

if not exist "%BUILD_CHECK_DIR%" (
    echo [ERROR] Build output not found: %BUILD_CHECK_DIR%
    set "BUILD_RESULT=1"
    goto :save_summary
)

echo       Build completed successfully!

REM ----------------------------------------------------------------------------
REM 2. 설치형 빌드 이동 (Windows\* -> BUILT_DIRECTORY\)
REM    Engine만 옮기면 FeaturePacks/Templates가 Windows\에 남아 레이아웃이 쪼개짐.
REM    Windows\ 전체 콘텐츠를 최종 위치로 이동해야 등록 가능한 엔진 루트가 됨.
REM ----------------------------------------------------------------------------
if not "%BUILT_DIRECTORY%"=="" (
    echo [2/5] Moving installed build to final location...

    if exist "%WINDOWS_DIR%" (
        REM 이전 빌드 산출물이 있으면 삭제
        if exist "%TARGET_ENGINE_DIR%" (
            echo       Removing previous Engine directory...
            rmdir /s /q "%TARGET_ENGINE_DIR%"
        )
        if exist "%BUILT_DIRECTORY%\FeaturePacks" rmdir /s /q "%BUILT_DIRECTORY%\FeaturePacks"
        if exist "%BUILT_DIRECTORY%\Templates" rmdir /s /q "%BUILT_DIRECTORY%\Templates"

        echo       Moving %WINDOWS_DIR% contents to %BUILT_DIRECTORY%...
        REM move = 같은 볼륨에서 rename이라 즉시 완료됨 (robocopy /MOVE는 수백 GB를 복사 후 삭제하므로 금지)
        for /d %%D in ("%WINDOWS_DIR%\*") do move /y "%%~fD" "%BUILT_DIRECTORY%\" >nul
        for %%F in ("%WINDOWS_DIR%\*") do move /y "%%~fF" "%BUILT_DIRECTORY%\" >nul
        rmdir "%WINDOWS_DIR%" 2>nul

        if exist "%TARGET_ENGINE_DIR%" (
            echo       Installed build moved successfully.
        ) else (
            echo [ERROR] Failed to move installed build. Check %WINDOWS_DIR% manually.
            set "BUILD_RESULT=1"
        )
    ) else (
        echo [WARNING] Source directory not found: %WINDOWS_DIR%
        if exist "%TARGET_ENGINE_DIR%" echo           Installed build already at final location.
    )
    echo.
) else (
    echo [2/5] Skipping installed build move ^(BUILT_DIRECTORY not set^).
    echo.
)

REM ----------------------------------------------------------------------------
REM 3. PDB 파일 정리
REM ----------------------------------------------------------------------------
echo [3/5] Cleaning PDB files...

REM FINAL_ENGINE_DIR이 설정되어 있으면 사용, 없으면 WINDOWS_BUILD_DIR 사용
set "CLEAN_DIR=%WINDOWS_BUILD_DIR%"
if not "%FINAL_ENGINE_DIR%"=="" (
    if exist "%FINAL_ENGINE_DIR%" (
        set "CLEAN_DIR=%FINAL_ENGINE_DIR%"
    )
)

if /i "%DISTRIBUTION_TYPE%"=="Artist" (
    set "PDB_COUNT=0"
    set "PDB_SIZE=0"
    
    for /r "%CLEAN_DIR%" %%f in (*.pdb) do (
        set /a PDB_COUNT+=1
        del "%%f" 2>nul
    )
    
    if !PDB_COUNT! gtr 0 (
        echo       Deleted !PDB_COUNT! PDB file^(s^).
    ) else (
        echo       No PDB files found.
    )
) else (
    echo       PDB cleanup skipped ^(Developer distribution - PDB preserved^).
)

REM ----------------------------------------------------------------------------
REM 4. 빌드 크기 계산
REM ----------------------------------------------------------------------------
echo [4/5] Calculating build size...

set "TOTAL_SIZE=0"
set "FILE_COUNT=0"

REM FINAL_ENGINE_DIR이 설정되어 있으면 사용, 없으면 WINDOWS_BUILD_DIR 사용
set "SIZE_DIR=%WINDOWS_BUILD_DIR%"
if not "%FINAL_ENGINE_DIR%"=="" (
    if exist "%FINAL_ENGINE_DIR%" (
        set "SIZE_DIR=%FINAL_ENGINE_DIR%"
    )
)

for /r "%SIZE_DIR%" %%f in (*.*) do (
    set /a FILE_COUNT+=1
)

REM PowerShell을 사용하여 정확한 크기 계산
set "SIZE_GB=0"
if exist "%SIZE_DIR%" (
    for /f "usebackq" %%a in (`powershell -NoProfile -Command "try { [math]::Round((Get-ChildItem -Path '%SIZE_DIR%' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB, 2) } catch { 0 }"`) do (
        set "SIZE_GB=%%a"
    )
)

echo       Total files: %FILE_COUNT%
echo       Total size: approximately %SIZE_GB% GB

REM ----------------------------------------------------------------------------
REM 5. 빌드 요약 저장
REM ----------------------------------------------------------------------------
:save_summary
echo [5/5] Saving build summary...

set "SUMMARY_FILE=%LOG_DIR%\build_summary_%BUILD_TIMESTAMP%.txt"

(
    echo ============================================================
    echo  AltavaEngine Install Build Summary
    echo ============================================================
    echo.
    echo Build Information:
    echo   Version: %ENGINE_VERSION%
    echo   Build Number: %BUILD_NUMBER%
    echo   Build Label: %BUILD_LABEL%
    echo   Timestamp: %BUILD_TIMESTAMP%
    echo.
    echo Build Configuration:
    echo   Platform: %TARGET_PLATFORM%
    echo   Game Configurations: %GAME_CONFIGURATIONS%
    echo   Editor Only: %HOST_PLATFORM_EDITOR_ONLY%
    echo   With DDC: %WITH_DDC%
    echo.
    echo Build Result:
    if "%BUILD_RESULT%"=="0" (
        echo   Status: SUCCESS
        if not "%FINAL_ENGINE_DIR%"=="" (
            if exist "%FINAL_ENGINE_DIR%" (
                echo   Output: %FINAL_ENGINE_DIR%
            ) else (
                echo   Output: %WINDOWS_BUILD_DIR%
            )
        ) else (
            echo   Output: %WINDOWS_BUILD_DIR%
        )
        echo   Files: %FILE_COUNT%
        echo   Size: %SIZE_GB% GB
    ) else (
        echo   Status: FAILED
        echo   Error Code: %BUILD_RESULT%
    )
    echo.
    echo ============================================================
) > "%SUMMARY_FILE%"

echo       Summary saved: %SUMMARY_FILE%

REM ----------------------------------------------------------------------------
REM 결과 출력
REM ----------------------------------------------------------------------------
echo.
echo ============================================================
if "%BUILD_RESULT%"=="0" (
    echo  [POST-BUILD] Post-processing completed successfully!
    echo.
    if not "%FINAL_ENGINE_DIR%"=="" (
        if exist "%FINAL_ENGINE_DIR%" (
            echo  Build Output: %FINAL_ENGINE_DIR%
        ) else (
            echo  Build Output: %WINDOWS_BUILD_DIR%
        )
    ) else (
        echo  Build Output: %WINDOWS_BUILD_DIR%
    )
) else (
    echo  [POST-BUILD] Build failed. Check logs for details.
    echo.
    echo  Log Directory: %LOG_DIR%
)
echo ============================================================
echo.

exit /b %BUILD_RESULT%

