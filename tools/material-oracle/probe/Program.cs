// Material oracle probe. Commands:
//   stats <vpk> <entry.vtex_c>...        per-channel mean/min/max of the decoded top mip (<=1024)
//   raw <vpk> <entry.vtex_c> <maxEdge>   width,height (int32 LE), reflectivity (4 x float32), then RGBA8 bytes, to stdout
//   vmat <vpk> <entry.vmat_c>            material params as JSON
// Textures are decoded with no codec post-processing (raw stored channels), the
// same values the shader samples.
using System.Text.Json;
using SkiaSharp;
using ValvePak;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;
using ValveResourceFormat.TextureDecoders;

var cmd = args[0];
using var pak = new Package();
pak.Read(args[1]);

Resource Load(string entryPath)
{
    var entry = pak.FindEntry(entryPath) ?? throw new FileNotFoundException(entryPath);
    pak.ReadEntry(entry, out var bytes);
    var res = new Resource { FileName = entryPath };
    res.Read(new MemoryStream(bytes));
    return res;
}

SKBitmap Decode(string entryPath, int maxEdge)
{
    var res = Load(entryPath);
    var tex = (Texture)res.DataBlock!;
    uint mip = 0;
    while (mip + 1 < tex.NumMipLevels && Math.Max(tex.Width >> (int)mip, tex.Height >> (int)mip) > maxEdge) mip++;
    return tex.GenerateBitmap(mipLevel: mip, decodeFlags: TextureCodec.None);
}

switch (cmd)
{
    case "stats":
        foreach (var p in args.Skip(2))
        {
            using var bmp = Decode(p, 1024);
            var px = bmp.Pixels;
            double[] sum = new double[4]; int[] mn = [255, 255, 255, 255]; int[] mx = new int[4];
            foreach (var c in px)
            {
                int[] v = [c.Red, c.Green, c.Blue, c.Alpha];
                for (var i = 0; i < 4; i++) { sum[i] += v[i]; mn[i] = Math.Min(mn[i], v[i]); mx[i] = Math.Max(mx[i], v[i]); }
            }
            Console.WriteLine($"{p} {bmp.Width}x{bmp.Height} mean {string.Join(",", sum.Select(s => (s / px.Length / 255).ToString("F3")))} min {string.Join(",", mn)} max {string.Join(",", mx)}");
        }
        break;
    case "raw":
    {
        var tex = (Texture)Load(args[2]).DataBlock!;
        using var bmp = Decode(args[2], int.Parse(args[3]));
        using var stdout = Console.OpenStandardOutput();
        stdout.Write(BitConverter.GetBytes(bmp.Width));
        stdout.Write(BitConverter.GetBytes(bmp.Height));
        // Compiled header average (linear), the pivot the engine's color correction uses.
        foreach (var r in new[] { tex.Reflectivity[0], tex.Reflectivity[1], tex.Reflectivity[2], tex.Reflectivity[3] }) stdout.Write(BitConverter.GetBytes(r));
        var buf = new byte[bmp.Width * bmp.Height * 4];
        var i = 0;
        foreach (var c in bmp.Pixels) { buf[i++] = c.Red; buf[i++] = c.Green; buf[i++] = c.Blue; buf[i++] = c.Alpha; }
        stdout.Write(buf);
        break;
    }
    case "vmat":
    {
        var mat = (Material)Load(args[2]).DataBlock!;
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            shader = mat.ShaderName,
            ints = mat.IntParams,
            floats = mat.FloatParams,
            vectors = mat.VectorParams.ToDictionary(kv => kv.Key, kv => new[] { kv.Value.X, kv.Value.Y, kv.Value.Z, kv.Value.W }),
            textures = mat.TextureParams,
        }, new JsonSerializerOptions { WriteIndented = true }));
        break;
    }
}
