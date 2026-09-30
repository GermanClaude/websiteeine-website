# Game reference assemblies

`ScpslTrust.Plugin` compiles against the assemblies that ship with the SCP:SL dedicated
server. They are **never committed** to this repository (this folder is git-ignored except
for this file) and never copied into the build output — the game provides them at runtime.

Two ways to make them available to the build:

1. **Point the build at an installed server** (preferred; no copying):

   ```sh
   dotnet build ScpslTrust.sln -c Release -p:SCPSL_MANAGED_DIR=/path/to/server/SCPSL_Data/Managed
   # or: export SCPSL_MANAGED_DIR=/path/to/server/SCPSL_Data/Managed
   ```

   In this container the server lives at `/opt/scpsl`, so the value is
   `/opt/scpsl/SCPSL_Data/Managed`.

2. **Copy the DLLs into this folder** (`plugin/lib/`), which is the default value of
   `SCPSL_MANAGED_DIR`. Copy at least:

   - `LabApi.dll`
   - `Assembly-CSharp.dll`
   - `Assembly-CSharp-firstpass.dll` (contains MEC `Timing`)
   - `CommandSystem.Core.dll`
   - `Mirror.dll`
   - `NorthwoodLib.dll`
   - `UnityEngine.CoreModule.dll`

The path is normalized in `Directory.Build.props` (property `GameManagedDir`); the plugin
project fails with a clear error when `LabApi.dll` cannot be found. `ScpslTrust.Core`, the
tests and the DevClient build without any game assemblies; in the solution the plugin
project is built only in the `Release` configuration, so `dotnet test` (Debug) works on
machines without a server installation.
