#!/usr/bin/env pwsh
# crew — launch Claude Code as a named crew member.
#   crew Bob                 # join as "Bob" in the current repo
#   crew Bob --resume        # any extra args pass straight through to claude
# Set $env:CREW_PLUGIN_DIR to a local checkout to load crew without installing it.
param([Parameter(Mandatory = $true, Position = 0)][string]$Name)
$Rest = $args
$env:CREW_NAME = $Name
if ($env:CREW_PLUGIN_DIR) {
  claude --plugin-dir $env:CREW_PLUGIN_DIR @Rest
} else {
  claude @Rest
}
