#!/usr/bin/env bash
# Builds the netstandard2.1 SDK and copies it, with the System.Text.Json DLLs Unity does not ship,
# into a Unity project's Assets/Plugins/ThreeWs. Usage: ./export-plugins.sh [path/to/UnityProject]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
project="${1:-$here}"
dest="$project/Assets/Plugins/ThreeWs"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

dotnet publish "$here/../../src/ThreeWs.Sdk/ThreeWs.Sdk.csproj" -f netstandard2.1 -c Release -o "$stage" >/dev/null

mkdir -p "$dest"
# Unity's .NET Standard 2.1 profile already provides System.Memory, System.Buffers,
# System.Numerics.Vectors and System.Threading.Tasks.Extensions; copying them causes duplicate-assembly errors.
for dll in ThreeWs.Sdk System.Text.Json System.Text.Encodings.Web Microsoft.Bcl.AsyncInterfaces System.Runtime.CompilerServices.Unsafe; do
  cp "$stage/$dll.dll" "$dest/"
done
cp "$stage/ThreeWs.Sdk.xml" "$dest/"
echo "Copied the three.ws SDK into $dest"
ls -1 "$dest"
