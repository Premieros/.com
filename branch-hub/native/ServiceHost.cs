using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

internal static class ServiceHost
{
    internal const string Name = "PremierBranchServer";
    private static Process? worker;
    private static IntPtr handle;
    private static readonly Native.MainCallback MainCallback = ServiceMain;
    private static readonly Native.ControlCallback ControlCallback = Control;
    private static string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Premieros", "BranchServer");
    private static int stopping;
    private static string AppRoot()
    {
        var native = Path.GetDirectoryName(Environment.ProcessPath!)!;
        var resources = Directory.GetParent(native);
        if (resources?.Name != "resources" || !File.Exists(Path.Combine(resources.FullName, "app.asar"))) throw new InvalidOperationException("INSTALLED_RUNTIME_REQUIRED");
        var root = resources.Parent!.FullName;
        if (!File.Exists(Path.Combine(root, "PremierOS Branch Hub.exe"))) throw new InvalidOperationException("INSTALLED_RUNTIME_REQUIRED");
        return root;
    }
    internal static int Run()
    {
        var table = new[] { new Native.TableEntry { Name = Name, Main = MainCallback }, new Native.TableEntry() };
        return Native.StartServiceCtrlDispatcher(table) ? 0 : 1;
    }
    private static void Status(uint state, uint error = 0)
    {
        if (handle == IntPtr.Zero) return;
        var status = new Native.Status { Type = 16, State = state, Accepted = state == 4 ? 5u : 0u, Win32ExitCode = error, WaitHint = state is 2 or 3 ? 15000u : 0u };
        Native.SetServiceStatus(handle, ref status);
    }
    private static void ServiceMain(int count, IntPtr arguments)
    {
        handle = Native.RegisterServiceCtrlHandler(Name, ControlCallback); if (handle == IntPtr.Zero) return;
        Status(2);
        try
        {
            var file = Path.Combine(directory, "binding.dat");
            var input = MachineVault.Unprotect(File.ReadAllText(file));
            using var document = JsonDocument.Parse(input); Validate(document.RootElement);
            var root = AppRoot();
            var process = new ProcessStartInfo(Path.Combine(root, "PremierOS Branch Hub.exe")) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = root };
            process.ArgumentList.Add(Path.Combine(root, "resources", "app.asar", "service-runtime.cjs"));
            process.Environment["ELECTRON_RUN_AS_NODE"] = "1";
            worker = Process.Start(process) ?? throw new InvalidOperationException("SERVICE_CHILD_FAILED");
            worker.ErrorDataReceived += (_, _) => { }; worker.BeginErrorReadLine();
            worker.StandardInput.WriteLine(input); worker.StandardInput.Flush();
            var ready = worker.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20)).GetAwaiter().GetResult();
            using var message = JsonDocument.Parse(ready ?? "{}");
            if (!message.RootElement.TryGetProperty("ready", out var ok) || !ok.GetBoolean()) throw new InvalidOperationException("SERVICE_CHILD_NOT_READY");
            Status(4); worker.WaitForExit(); Status(1, Volatile.Read(ref stopping) == 1 ? 0u : 1u);
        }
        catch { if (worker is { HasExited: false }) worker.Kill(true); Status(1, 1); }
        finally { worker?.Dispose(); }
    }
    private static void Control(uint command)
    {
        if (command is not (1 or 5) || Interlocked.Exchange(ref stopping, 1) != 0) return;
        Status(3);
        _ = Task.Run(() => { try { if (worker is { HasExited: false }) { worker.StandardInput.WriteLine("stop"); worker.StandardInput.Flush(); if (!worker.WaitForExit(15000)) worker.Kill(true); } } catch { } });
    }
    private static void Validate(JsonElement input)
    {
        var binding = input.GetProperty("binding");
        if (binding.GetProperty("projectRef").GetString() != "hvqlkapynjfjikqithvd" || !Guid.TryParse(binding.GetProperty("branchId").GetString(), out _) || !Guid.TryParse(binding.GetProperty("organizationId").GetString(), out _) || binding.GetProperty("token").GetString()!.Length < 32) throw new InvalidOperationException("INVALID_SERVICE_BINDING");
        if (!Path.GetFullPath(input.GetProperty("dataDir").GetString()!).StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("INVALID_SERVICE_DIRECTORY");
        if (!string.Equals(Path.GetFullPath(input.GetProperty("vaultFile").GetString()!), Path.Combine(directory, "binding.dat"), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("INVALID_SERVICE_VAULT_PATH");
        if (!Guid.TryParse(binding.GetProperty("hubDeviceId").GetString(), out _) || !System.Text.RegularExpressions.Regex.IsMatch(binding.GetProperty("backupKey").GetString() ?? "", "^[0-9a-f]{64}$")) throw new InvalidOperationException("INVALID_SERVICE_BINDING");
    }
    internal static object Install(string encryptedFile)
    {
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("ADMINISTRATOR_REQUIRED");
        var root = AppRoot();
        if (new FileInfo(encryptedFile).Length > 131072) throw new InvalidOperationException("INVALID_SERVICE_BINDING");
        var encrypted = File.ReadAllText(encryptedFile); var input = MachineVault.Unprotect(encrypted);
        using var document = JsonDocument.Parse(input); Validate(document.RootElement);
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any()) throw new InvalidOperationException("SERVICE_DIRECTORY_EXISTS");
        Directory.CreateDirectory(directory);
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.LocalSystemSid, WellKnownSidType.LocalServiceSid })
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid, null), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(directory).SetAccessControl(acl);
        File.WriteAllText(Path.Combine(directory, "binding.dat"), encrypted);
        var manager = Native.OpenSCManager(null, null, 3); if (manager == IntPtr.Zero) throw new InvalidOperationException("SERVICE_MANAGER_DENIED");
        try
        {
            var service = Native.CreateService(manager, Name, "Premier Branch Server", 0xF01FF, 16, 2, 1, "\"" + Environment.ProcessPath + "\" service", null, IntPtr.Zero, null, @"NT AUTHORITY\LocalService", null);
            if (service == IntPtr.Zero) throw new InvalidOperationException("SERVICE_REGISTRATION_FAILED");
            try
            {
                var actions = Marshal.AllocHGlobal(Marshal.SizeOf<Native.Action>() * 3);
                try
                {
                    for (var i = 0; i < 3; i++) Marshal.StructureToPtr(new Native.Action { Type = 1, Delay = (uint)(5000 * (i + 1)) }, IntPtr.Add(actions, i * Marshal.SizeOf<Native.Action>()), false);
                    var failures = new Native.FailureActions { Reset = 86400, Count = 3, Actions = actions };
                    if (!Native.ChangeServiceConfig2(service, 2, ref failures)) throw new InvalidOperationException("SERVICE_RECOVERY_CONFIGURATION_FAILED");
                }
                finally { Marshal.FreeHGlobal(actions); }
                if (!Native.StartService(service, 0, IntPtr.Zero)) throw new InvalidOperationException("SERVICE_START_FAILED");
            }
            finally { Native.CloseServiceHandle(service); }
        }
        finally { Native.CloseServiceHandle(manager); }
        return new { ok = true, service = Name, automatic = true, account = "LocalService" };
    }
    private static class Native
    {
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate void MainCallback(int argc, IntPtr argv);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate void ControlCallback(uint command);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct TableEntry { [MarshalAs(UnmanagedType.LPWStr)] public string? Name; public MainCallback? Main; }
        [StructLayout(LayoutKind.Sequential)] public struct Status { public uint Type, State, Accepted, Win32ExitCode, ServiceExitCode, Checkpoint, WaitHint; }
        [StructLayout(LayoutKind.Sequential)] public struct Action { public uint Type, Delay; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct FailureActions { public uint Reset; public string? Reboot, Command; public uint Count; public IntPtr Actions; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool StartServiceCtrlDispatcher([In] TableEntry[] table);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr RegisterServiceCtrlHandler(string name, ControlCallback handler);
        [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetServiceStatus(IntPtr handle, ref Status status);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr OpenSCManager(string? machine, string? database, uint access);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateService(IntPtr manager, string name, string display, uint access, uint type, uint start, uint error, string binary, string? group, IntPtr tag, string? dependencies, string account, string? password);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ChangeServiceConfig2(IntPtr service, uint level, ref FailureActions actions);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool StartService(IntPtr service, uint count, IntPtr args);
        [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseServiceHandle(IntPtr handle);
    }
}
