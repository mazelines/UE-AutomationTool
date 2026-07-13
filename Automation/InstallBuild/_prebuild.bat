@echo off
REM ============================================================================
REM AltavaEngine Install Build - Pre-build Script
REM ============================================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\..\"
pushd "%ROOT_DIR%"
set "ROOT_DIR=%CD%"
popd

echo.
echo ============================================================
echo  [PRE-BUILD] AltavaEngine Install Build Pre-processing
echo ============================================================
echo.

REM ----------------------------------------------------------------------------
REM 1. Check required directories
REM ----------------------------------------------------------------------------
echo [1/3] Checking required directories...

if not exist "%ROOT_DIR%\Engine" (
    echo [ERROR] Engine directory not found: %ROOT_DIR%\Engine
    exit /b 1
)

if not exist "%ROOT_DIR%\Engine\Build\BatchFiles\RunUAT.bat" (
    echo [ERROR] RunUAT.bat not found.
    exit /b 1
)

echo       Engine directory: OK

REM ----------------------------------------------------------------------------
REM 2. Copy BuildConfiguration.xml (if exists)
REM ----------------------------------------------------------------------------
echo [2/3] Checking BuildConfiguration.xml...

set "CONFIG_SOURCE=%ROOT_DIR%\BuildConfiguration.xml"
set "CONFIG_TARGET_DIR=%ROOT_DIR%\Engine\Saved\UnrealBuildTool"
set "CONFIG_TARGET=%CONFIG_TARGET_DIR%\BuildConfiguration.xml"

if not exist "%CONFIG_SOURCE%" (
    echo       No custom BuildConfiguration.xml found. Using defaults.
    goto :skip_config
)

REM Create target directory if needed
if not exist "%CONFIG_TARGET_DIR%" (
    mkdir "%CONFIG_TARGET_DIR%"
)

REM Check if files are identical (skip copy if same)
if exist "%CONFIG_TARGET%" (
    fc "%CONFIG_SOURCE%" "%CONFIG_TARGET%" > nul 2>&1
    if !errorlevel! equ 0 (
        echo       BuildConfiguration.xml is up to date.
        goto :skip_config
    )
)

REM Copy using copy command
copy /y "%CONFIG_SOURCE%" "%CONFIG_TARGET%" > nul 2>&1
if !errorlevel! neq 0 (
    echo [WARNING] Failed to copy BuildConfiguration.xml
) else (
    echo       BuildConfiguration.xml copied.
)

:skip_config

REM ----------------------------------------------------------------------------
REM 3. Create log directory
REM ----------------------------------------------------------------------------
echo [3/3] Preparing directories...

set "LOG_DIR=%ROOT_DIR%\LocalBuilds\Logs"
if not exist "%LOG_DIR%" (
    mkdir "%LOG_DIR%"
    echo       Created log directory.
) else (
    echo       Log directory exists.
)

echo.
echo ============================================================
echo  [PRE-BUILD] Completed successfully!
echo ============================================================
echo.

exit /b 0
