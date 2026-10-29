// Dev-only fixed-camera world reference using the pinned MIT VRF renderer.
using System.Diagnostics;
using System.Numerics;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using OpenTK.Graphics.OpenGL;
using OpenTK.Windowing.Common;
using OpenTK.Windowing.Desktop;
using SkiaSharp;
using ValvePak;
using ValveResourceFormat.IO;
using ValveResourceFormat.CompiledShader;
using ValveResourceFormat.Renderer;
using ValveResourceFormat.Renderer.World;
using ValveResourceFormat.Renderer.Materials;
using ValveResourceFormat.ResourceTypes;
using ValveResourceFormat.Serialization.KeyValues;
using RendererType = ValveResourceFormat.Renderer.Renderer;

if (args is ["--mesh-info", var infoMap, var infoEntry, var infoOutput]) {
    using var infoPackage = new Package(); infoPackage.Read(infoMap);
    using var infoLoader = new GameFileLoader(infoPackage, infoMap);
    using var infoResource = infoLoader.LoadFileCompiled(infoEntry) ?? throw new FileNotFoundException(infoEntry);
    var infoModel = (Model)infoResource.DataBlock!;
    var meshes = infoModel.GetEmbeddedMeshes().Select(mesh => new {
        buffers = mesh.Mesh.VBIB.VertexBuffers.Select(buffer => new { count = buffer.ElementCount,
            fields = buffer.InputLayoutFields.Select(field => new { field.SemanticName, field.SemanticIndex, format = field.Format.ToString() }) }),
        draws = mesh.Mesh.Data.GetArray("m_sceneObjects").SelectMany(obj => obj.GetArray("m_drawCalls")).Select(call => {
            var material = ValveResourceFormat.ResourceTypes.Mesh.GetMaterialName(call)!;
            var signature = ValveResourceFormat.ResourceTypes.Material.LoadInputSignature(infoLoader, material);
            return new { material, lightmap = ValveResourceFormat.ResourceTypes.Mesh.HasBakedLightingFromLightMap(call),
                vertexLighting = ValveResourceFormat.ResourceTypes.Mesh.HasBakedLightingFromVertexStream(call),
                buffers = call.GetArray("m_vertexBuffers").Select(buffer => buffer.GetInt32Property("m_hBuffer")), signature = signature.Elements };
        })
    });
    File.WriteAllText(infoOutput, JsonSerializer.Serialize(meshes, new JsonSerializerOptions { WriteIndented = true }));
    return;
}

// Every draw call of every model in the map package that carries its own tint (m_vTintColor, linear)
// or alpha, with its material.
if (args is ["--draw-tints", var tintMap, var tintOutput]) {
    using var tintPackage = new Package(); tintPackage.Read(tintMap);
    using var tintLoader = new GameFileLoader(tintPackage, tintMap);
    var rows = new List<object>();
    foreach (var file in tintPackage.Entries!.GetValueOrDefault("vmdl_c") ?? []) {
        var path = file.GetFullPath();
        using var res = tintLoader.LoadFileCompiled(path[..^2]);
        if (res?.DataBlock is not Model model) continue;
        var drawIndex = 0;
        foreach (var call in model.GetEmbeddedMeshes().SelectMany(mesh => mesh.Mesh.Data.GetArray("m_sceneObjects")).SelectMany(obj => obj.GetArray("m_drawCalls"))) {
            var tint = call.ContainsKey("m_vTintColor") ? call.GetSubCollection("m_vTintColor").ToVector3() : (Vector3?)null;
            var alpha = call.ContainsKey("m_flAlpha") ? call.GetFloatProperty("m_flAlpha") : (float?)null;
            rows.Add(new { model = path, draw = drawIndex++, material = ValveResourceFormat.ResourceTypes.Mesh.GetMaterialName(call),
                tint = tint is { } t ? new[] { t.X, t.Y, t.Z } : null, alpha });
        }
    }
    File.WriteAllText(tintOutput, JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
    return;
}

if (args is ["--export-mesh", var meshMap, var entry, var meshOutput]) {
    using var meshPackage = new Package(); meshPackage.Read(meshMap);
    using var meshLoader = new GameFileLoader(meshPackage, meshMap);
    using var meshResource = meshLoader.LoadFileCompiled(entry) ?? throw new FileNotFoundException(entry);
    new GltfModelExporter(meshLoader) { ExportMaterials = false, ExportAnimations = false }.Export(meshResource, meshOutput);
    var model = (Model)meshResource.DataBlock!;
    var calls = model.GetEmbeddedMeshes().SelectMany(mesh => mesh.Mesh.Data.GetArray("m_sceneObjects"))
        .SelectMany(obj => obj.GetArray("m_drawCalls"))
        .Select((call, i) => new { primitive = i, baseVertex = call.GetInt32Property("m_nBaseVertex"),
            vertexCount = call.GetInt32Property("m_nVertexCount"), startIndex = call.GetInt32Property("m_nStartIndex"), indexCount = call.GetInt32Property("m_nIndexCount") });
    File.WriteAllText(meshOutput + ".draws.json", JsonSerializer.Serialize(calls, new JsonSerializerOptions { WriteIndented = true }));
    return;
}
var mapPath = args[0];
var outputDir = args[1];
Directory.CreateDirectory(outputDir);
using var window = new NativeWindow(new NativeWindowSettings {
    APIVersion = GLEnvironment.RequiredVersion, ClientSize = new(64, 64),
    StartVisible = false, Title = "Hideout oracle",
    Flags = ContextFlags.ForwardCompatible | ContextFlags.Offscreen, Profile = ContextProfile.Core,
});
window.MakeCurrent();
using var package = new Package();
package.Read(mapPath);
using var loader = new GameFileLoader(package, mapPath);
using var context = new RendererContext(loader, NullLogger.Instance);
context.Device.CreateContext().Begin();
GLEnvironment.Initialize(context.Logger);
GLEnvironment.SetDefaultRenderState();
var renderer = new RendererType(context);
var frame = Framebuffer.Prepare("Hideout", 720, 720, 1, ImageFormat.RGBA16161616F, ImageFormat.D32);
frame.Initialize();
var output = Framebuffer.Prepare("Output", 720, 720, 0, ImageFormat.RGBA8888, null);
output.Initialize();
renderer.Initialize();
renderer.MainFramebuffer = frame;
renderer.Postprocess.Load(frame.NumSamples);
renderer.LoadRendererResources();
renderer.Postprocess.AnimateDither = false;
renderer.ParallelSimulation = false;
renderer.EntitySystem.Enabled = false;
using var resource = loader.LoadFileCompiled("maps/dl_hideout/world.vwrld") ?? throw new FileNotFoundException("world");
var world = new WorldLoader((World)resource.DataBlock!, renderer.Scene, renderer.EntitySystem);
var timer = Stopwatch.StartNew();
world.Load();
renderer.Scene.SetEnabledLayers(world.DefaultEnabledLayers);
foreach (var scene in renderer.Scenes) scene.Initialize();
Console.WriteLine($"Loaded world in {timer.Elapsed.TotalSeconds:F3}s");
var camera = renderer.Camera;
// Debug render modes write display values themselves, so they skip the tonemapper and are
// resolved straight into the output.
byte[] Capture(int width, int height, bool raw = false) {
    var view = Framebuffer.Prepare("View", width, height, 1, ImageFormat.RGBA16161616F, ImageFormat.D32);
    view.Initialize();
    var target = Framebuffer.Prepare("ViewOutput", width, height, 0, ImageFormat.RGBA8888, null);
    target.Initialize();
    renderer.MainFramebuffer = view;
    camera.SetViewportSize(width, height);
    camera.RecalculateMatrices();
    for (var tick = 0; tick < 4; tick++) {
        renderer.Update(new Scene.UpdateContext { Camera = camera, TextRenderer = null!, Timestep = 0 });
        renderer.Render(view);
        if (raw) {
            view.Bind(FramebufferTarget.ReadFramebuffer);
            target.Bind(FramebufferTarget.DrawFramebuffer);
            GL.BlitFramebuffer(0, 0, width, height, 0, 0, width, height, ClearBufferMask.ColorBufferBit, BlitFramebufferFilter.Nearest);
        } else {
            renderer.PostprocessRender(view, target, flipY: false);
        }
    }
    var pixels = new byte[width * height * 4];
    target.Bind(FramebufferTarget.ReadFramebuffer);
    GL.ReadPixels(0, 0, width, height, PixelFormat.Rgba, PixelType.UnsignedByte, pixels);
    view.Delete(); target.Delete();
    renderer.MainFramebuffer = frame;
    return pixels;
}
void Save(byte[] pixels, int width, int height, string path) {
    using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
    for (var y = 0; y < height; y++) pixels.AsSpan((height - 1 - y) * width * 4, width * 4).CopyTo(bitmap.GetPixelSpan().Slice(y * width * 4, width * 4));
    using var image = SKImage.FromBitmap(bitmap);
    using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
    using var file = File.Create(path);
    encoded.SaveTo(file);
}
// Optional third argument: a JSON list of Source cameras, as setpos/setang report them, each
// { "name", "position": [x,y,z], "angles": [pitch,yaw], "fov" (horizontal at 4:3), "width", "height", "mode" }.
if (args.Length > 2) {
    foreach (var view in JsonDocument.Parse(File.ReadAllText(args[2])).RootElement.EnumerateArray()) {
        var p = view.GetProperty("position"); var a = view.GetProperty("angles");
        var eye = new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
        var pitch = float.DegreesToRadians(a[0].GetSingle()); var yaw = float.DegreesToRadians(a[1].GetSingle());
        camera.FieldOfView = view.GetProperty("fov").GetSingle();
        camera.SetLocation(eye);
        camera.LookAt(eye + new Vector3(MathF.Cos(pitch) * MathF.Cos(yaw), MathF.Cos(pitch) * MathF.Sin(yaw), -MathF.Sin(pitch)) * 100);
        var mode = view.TryGetProperty("mode", out var m) ? m.GetString() ?? "Default" : "Default";
        renderer.ViewBuffer!.Data!.RenderMode = RenderModes.GetShaderId(mode);
        int width = view.GetProperty("width").GetInt32(), height = view.GetProperty("height").GetInt32();
        Save(Capture(width, height, mode != "Default"), width, height, Path.Combine(outputDir, view.GetProperty("name").GetString() + ".png"));
        Console.WriteLine($"Rendered {view.GetProperty("name").GetString()} ({mode})");
    }
    renderer.Dispose();
    return;
}
var spawn = world.SpawnCameraMatrix ?? Matrix4x4.Identity;
var anchor = spawn.Translation - new Vector3(0, 0, 64);
var target = anchor + new Vector3(0, 0, 42);
camera.FieldOfView = 60;
camera.SetViewportSize(720, 720);
var captures = new List<object>();
for (var i = 0; i < 4; i++) {
    var angle = i * MathF.PI / 2;
    var position = target + new Vector3(MathF.Cos(angle) * 180, MathF.Sin(angle) * 180, 20);
    camera.SetLocation(position);
    camera.LookAt(target);
    camera.RecalculateMatrices();
    for (var tick = 0; tick < 4; tick++) {
        renderer.Update(new Scene.UpdateContext { Camera = camera, TextRenderer = null!, Timestep = 0 });
        renderer.Render(frame);
        renderer.PostprocessRender(frame, output, flipY: false);
    }
    var pixels = new byte[720 * 720 * 4];
    output.Bind(FramebufferTarget.ReadFramebuffer);
    GL.ReadPixels(0, 0, 720, 720, PixelFormat.Rgba, PixelType.UnsignedByte, pixels);
    using var bitmap = new SKBitmap(new SKImageInfo(720, 720, SKColorType.Rgba8888, SKAlphaType.Unpremul));
    for (var y = 0; y < 720; y++) pixels.AsSpan((719 - y) * 720 * 4, 720 * 4).CopyTo(bitmap.GetPixelSpan().Slice(y * 720 * 4, 720 * 4));
    using var image = SKImage.FromBitmap(bitmap);
    using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
    using var file = File.Create(Path.Combine(outputDir, $"reference-{i}.png"));
    encoded.SaveTo(file);
    captures.Add(new { position = new[] { position.X, position.Y, position.Z }, target = new[] { target.X, target.Y, target.Z }, fov = camera.GetFOV(), exposure = renderer.Postprocess.TonemapScalar });
}
File.WriteAllText(Path.Combine(outputDir, "cameras.json"), JsonSerializer.Serialize(new { anchor = new[] { anchor.X, anchor.Y, anchor.Z }, captures }, new JsonSerializerOptions { WriteIndented = true }));
renderer.Dispose();
