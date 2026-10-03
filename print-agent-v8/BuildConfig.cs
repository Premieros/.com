namespace PremierSmouhaFormPrintAgentV08;

internal static class BuildConfig
{
    internal const string AppName = "Premier Smouha Form Print Agent V8.1 Lite";
    internal const string AppId = "PremierSmouhaFormPrintAgentV08";
    internal const string SupabaseUrl = "https://hvqlkapynjfjikqithvd.supabase.co";
    internal const string PublishableKey = "sb_publishable_9W6651rcdIsyBoegwGe_qw_MvCPRIPK";
    internal const string BranchId = "19c3fd23-d784-455b-8840-f4f2ac619651";
    internal const string BranchName = "فرع نادي سموحة";
    internal const string WakeTable = "cloud_print_wake_state";
    internal const int ClaimBatchSize = 25;

    internal static string RealtimeUrl =>
        SupabaseUrl.Replace("https://", "wss://", StringComparison.OrdinalIgnoreCase)
            .TrimEnd('/') + "/realtime/v1/websocket?apikey=" +
        Uri.EscapeDataString(PublishableKey) + "&vsn=1.0.0";
}
