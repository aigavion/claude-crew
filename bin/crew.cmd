@echo off
REM crew - launch Claude Code as a named crew member.
REM   crew Bob              join as "Bob" in the current repo
REM   crew Bob --resume     extra args pass through to claude
REM Set CREW_PLUGIN_DIR to a local checkout to load crew without installing it.
setlocal EnableDelayedExpansion
if "%~1"=="" (echo usage: crew ^<name^> [claude args...] & exit /b 1)
set "CREW_NAME=%~1"
shift
set "ARGS="
:loop
if "%~1"=="" goto run
set "ARGS=!ARGS! %~1"
shift
goto loop
:run
if defined CREW_PLUGIN_DIR (
  claude --plugin-dir "%CREW_PLUGIN_DIR%"!ARGS!
) else (
  claude!ARGS!
)
