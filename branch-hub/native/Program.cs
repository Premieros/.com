using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const int MaxBytes = 2 * 1024 * 1024;
    private static bool attempted;
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("WINDOWS_REQUIRED");
            if (args.Length == 1 && args[0] == "service") return ServiceHost.Run();
            if (args.Length == 2 && args[0] == "install-service") { Console.Out.Write(JsonSerializer.Serialize(ServiceHost.Install(args[1]), Json)); return 0; }
            if (args.Length != 1) throw new InvalidOperationException("INVALID_COMMAND");
            var input = Console.In.ReadToEnd();
            if (input.Length > 4 * 1024 * 1024) throw new InvalidOperationException("REQUEST_TOO_LARGE");
            using var document = JsonDocument.Parse(input.Length == 0 ? "{}" : input);
            object response = args[0] switch
            {
                "printers" => new { ok = true, printers = PrinterNames() },
                "print" => Print(document.RootElement),
                "render" => Render(document.RootElement),
                "protect" => new { ok = true, @protected = MachineVault.Protect(document.RootElement.GetProperty("value").GetString() ?? "") },
                "unprotect" => new { ok = true, value = MachineVault.Unprotect(document.RootElement.GetProperty("protected").GetString() ?? "") },
                _ => throw new InvalidOperationException("INVALID_COMMAND")
            };
            Console.Out.Write(JsonSerializer.Serialize(response, Json));
            return 0;
        }
        catch (Exception error)
        {
            var code = error is InvalidOperationException ? error.Message : "WINDOWS_PRINTER_FAILED";
            Console.Out.Write(JsonSerializer.Serialize(new { ok = false, error = code, uncertain = attempted,
                nativeCode = error is Win32Exception native ? native.NativeErrorCode : 0 }, Json));
            return 1;
        }
    }

    private static string[] PrinterNames()
    {
        Native.EnumPrinters(6, null, 4, IntPtr.Zero, 0, out var size, out _);
        if (size == 0) return Array.Empty<string>();
        if (size > 16 * 1024 * 1024) throw new InvalidOperationException("PRINTER_LIST_TOO_LARGE");
        var memory = Marshal.AllocHGlobal((int)size);
        try
        {
            if (!Native.EnumPrinters(6, null, 4, memory, size, out _, out var count)) throw new Win32Exception();
            if (count > 1000) throw new InvalidOperationException("PRINTER_LIST_TOO_LARGE");
            var names = new List<string>();
            for (var i = 0; i < count; i++)
            {
                var row = Marshal.PtrToStructure<Native.PrinterInfo4>(IntPtr.Add(memory, i * Marshal.SizeOf<Native.PrinterInfo4>()));
                var name = Marshal.PtrToStringUni(row.Name);
                if (name is { Length: > 0 and <= 256 }) names.Add(name);
            }
            return names.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private static object Print(JsonElement input)
    {
        var name = input.GetProperty("name").GetString() ?? "";
        if (name.Length is < 1 or > 256 || name.Any(char.IsControl) || !PrinterNames().Contains(name, StringComparer.Ordinal))
            throw new InvalidOperationException("WINDOWS_PRINTER_NOT_FOUND");
        var bytes = Convert.FromBase64String(input.GetProperty("bytes").GetString() ?? "");
        if (bytes.Length is < 2 or > MaxBytes || bytes[0] != 27 || bytes[1] != 64)
            throw new InvalidOperationException("INVALID_PRINT_BYTES");
        if (!Native.OpenPrinter(name, out var printer, IntPtr.Zero)) throw new Win32Exception();
        var started = false;
        try
        {
            var info = new Native.DocInfo1 { Document = "Premier receipt", DataType = "RAW" };
            var jobId = Native.StartDocPrinter(printer, 1, ref info);
            if (jobId == 0) throw new Win32Exception();
            started = true;
            if (!Native.StartPagePrinter(printer)) throw new Win32Exception();
            var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try
            {
                var offset = 0;
                while (offset < bytes.Length)
                {
                    attempted = true;
                    if (!Native.WritePrinter(printer, IntPtr.Add(handle.AddrOfPinnedObject(), offset), bytes.Length - offset, out var written))
                        throw new Win32Exception();
                    if (written <= 0) throw new InvalidOperationException("WINDOWS_PRINT_SHORT_WRITE");
                    offset += written;
                }
            }
            finally { handle.Free(); }
            if (!Native.EndPagePrinter(printer) || !Native.EndDocPrinter(printer)) throw new Win32Exception();
            started = false;
            return new { ok = true, jobId, submitted = true, paperConfirmed = false };
        }
        finally
        {
            // Never blindly resubmit a job after WritePrinter may have accepted bytes.
            if (started && !attempted) Native.AbortPrinter(printer);
            Native.ClosePrinter(printer);
        }
    }

    private static object Render(JsonElement input)
    {
        var width = input.GetProperty("dots").GetInt32();
        if (width != 384 && width != 512 && width != 576) throw new InvalidOperationException("INVALID_PRINTER_DOTS");
        var receipt = input.GetProperty("receipt");
        var lines = receipt.GetProperty("lines");
        if (lines.GetArrayLength() is < 1 or > 100) throw new InvalidOperationException("INVALID_RASTER_RECEIPT");
        var total = receipt.GetProperty("totalMinor").GetInt64();
        long verified = 0;
        using var font = new Font("Tahoma", 17, GraphicsUnit.Pixel);
        using var heading = new Font("Tahoma", 25, FontStyle.Bold, GraphicsUnit.Pixel);
        using var bitmap = new Bitmap(width, 16000, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.Clear(Color.White);
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using var rtl = new StringFormat(StringFormatFlags.DirectionRightToLeft) { Alignment = StringAlignment.Near };
        var y = 12f;
        void Text(string value, Font selected)
        {
            var height = graphics.MeasureString(value, selected, width - 24, rtl).Height + 8;
            if (y + height > 15920) throw new InvalidOperationException("RECEIPT_TOO_TALL");
            graphics.DrawString(value, selected, Brushes.Black, new RectangleF(12, y, width - 24, height), rtl);
            y += height;
        }
        Text("Premier", heading);
        Text("إيصال بيع محلي", heading);
        foreach (var line in lines.EnumerateArray())
        {
            var label = line.GetProperty("label").GetString() ?? "";
            var quantity = line.GetProperty("quantity").GetInt64();
            var price = line.GetProperty("priceMinor").GetInt64();
            if (label.Length is < 1 or > 320 || quantity <= 0 || price <= 0) throw new InvalidOperationException("INVALID_RASTER_RECEIPT");
            verified = checked(verified + checked(quantity * price));
            Text(label, font);
            Text($"{quantity} × {price / 100m:0.00} = {quantity * price / 100m:0.00}", font);
        }
        if (verified != total || total <= 0) throw new InvalidOperationException("INVALID_RASTER_RECEIPT");
        Text($"الإجمالي: {total / 100m:0.00}", heading);
        Text("شكرًا لزيارتكم", font);
        var heightPixels = (int)Math.Ceiling(y + 12);
        var stride = width / 8;
        using var output = new MemoryStream();
        output.Write(new byte[] { 27, 64 });
        for (var start = 0; start < heightPixels; start += 256)
        {
            var rows = Math.Min(256, heightPixels - start);
            output.Write(new byte[] { 29, 118, 48, 0, (byte)(stride & 255), (byte)(stride >> 8), (byte)(rows & 255), (byte)(rows >> 8) });
            var block = new byte[stride * rows];
            for (var row = 0; row < rows; row++)
                for (var x = 0; x < width; x++)
                {
                    var color = bitmap.GetPixel(x, start + row);
                    if ((color.R + color.G + color.B) / 3 < 160) block[row * stride + (x >> 3)] |= (byte)(0x80 >> (x & 7));
                }
            output.Write(block);
        }
        output.Write(new byte[] { 10, 10, 10, 29, 86, 0 });
        return new { ok = true, bytes = Convert.ToBase64String(output.ToArray()), width, height = heightPixels };
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)] public struct PrinterInfo4 { public IntPtr Name; public IntPtr Server; public uint Attributes; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct DocInfo1 { public string Document; public string? Output; public string DataType; }
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr data, uint size, out uint needed, out uint returned);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint StartDocPrinter(IntPtr printer, int level, ref DocInfo1 doc);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool StartPagePrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool WritePrinter(IntPtr printer, IntPtr bytes, int length, out int written);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EndPagePrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EndDocPrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AbortPrinter(IntPtr printer);
        [DllImport("winspool.drv", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ClosePrinter(IntPtr printer);
    }
}
