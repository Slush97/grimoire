// Particle render oracle: draws a Source 2 particle system with ValveResourceFormat's own OpenGL
// renderer, offscreen, at fixed frames and a fixed camera, and writes the HDR scene color before
// post processing (raw float32) and the post processed image (PNG). Dev-only reference for the
// Grimoire three.js particle renderer under src/lib/particles/render/.
//
// The simulation is driven exactly as tools/particle-oracle drives it (same seed, dt, control
// points and world time), so the TypeScript runtime replays the same particles.
//
// usage: ParticleRenderOracle --vpk <pak01_dir.vpk> --system <particles/...vpcf> --out <dir>
//        [--capture 64,128] [--dt 0.015625] [--seed N] [--cp N=x,y,z]... [--cp-move N=vx,vy,vz]...
//        [--cp-spin N=degreesPerSecond]... [--size 512x512] [--camera x,y,z|auto] [--target x,y,z]
//        [--fov 60] [--lighting viewer|none]
using System.Globalization;
using System.Numerics;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using OpenTK.Graphics.OpenGL;
using OpenTK.Windowing.Common;
using OpenTK.Windowing.Desktop;
using SkiaSharp;
using ValvePak;
using ValveResourceFormat.CompiledShader;
using ValveResourceFormat.IO;
using ValveResourceFormat.Particles;
using ValveResourceFormat.Renderer;
using ValveResourceFormat.Renderer.SceneNodes;
using ValveResourceFormat.ResourceTypes;
using ValveResourceFormat.Utils;
using RendererType = ValveResourceFormat.Renderer.Renderer;

if (args is ["--export-textures", var vpkPath, var listPath, var exportDir])
{
    ExportTextures(vpkPath, listPath, exportDir);
    return;
}

if (args is ["--list", var listVpk, var extension])
{
    using var listed = new Package();
    listed.Read(listVpk);

    foreach (var entry in listed.Entries?.GetValueOrDefault(extension) ?? [])
    {
        Console.WriteLine(entry.GetFullPath());
    }

    return;
}

if (args is ["--dump-kv", var kvVpk, var kvPath])
{
    using var kvPackage = new Package();
    kvPackage.Read(kvVpk);
    using var kvLoader = new GameFileLoader(kvPackage, kvVpk);
    using var kvResource = kvLoader.LoadFileCompiled(kvPath) ?? throw new FileNotFoundException(kvPath);
    Console.WriteLine(kvResource.DataBlock!.ToString());
    return;
}

if (args is ["--gradient-test", var stopsText])
{
    // stops as "position:r,g,b;..." ; prints the 64 texels VRF's gradient texture holds
    var stops = stopsText.Split(';').Select(stop =>
    {
        var parts = stop.Split(':');
        var rgb = parts[1].Split(',').Select(v => byte.Parse(v, CultureInfo.InvariantCulture)).ToArray();
        return (Math.Clamp(float.Parse(parts[0], CultureInfo.InvariantCulture), 0f, 1f), new ValveResourceFormat.Utils.Color32(rgb[0], rgb[1], rgb[2]));
    }).OrderBy(stop => stop.Item1).ToArray();
    var sample = typeof(ValveResourceFormat.Renderer.Materials.MaterialLoader).GetMethod("SampleGradient", BindingFlags.Static | BindingFlags.NonPublic)!;
    for (var x = 0; x < 64; x++)
    {
        var color = (ValveResourceFormat.Utils.Color32)sample.Invoke(null, [stops, x / 64f])!;
        Console.Write($"{color.R},{color.G},{color.B} ");
    }
    Console.WriteLine();
    return;
}

var options = Options.Parse(args);
Directory.CreateDirectory(options.Out);

var settings = new NativeWindowSettings
{
    APIVersion = GLEnvironment.RequiredVersion,
    ClientSize = new(64, 64),
    StartVisible = false,
    Title = "Particle render oracle",
    Flags = ContextFlags.ForwardCompatible | ContextFlags.Offscreen,
    Profile = ContextProfile.Core,
};

using var window = new NativeWindow(settings);
window.MakeCurrent();

using var package = new Package();
package.Read(options.Vpk);
using var loader = new GameFileLoader(package, options.Vpk);
using var rendererContext = new RendererContext(loader, NullLogger.Instance);

rendererContext.Device.CreateContext().Begin();
GLEnvironment.Initialize(rendererContext.Logger);
GLEnvironment.SetDefaultRenderState();

if (Environment.GetEnvironmentVariable("ORACLE_MAX_ANISOTROPY") is { } anisotropy)
{
    ValveResourceFormat.Renderer.Materials.MaterialLoader.MaxTextureMaxAnisotropy = float.Parse(anisotropy, CultureInfo.InvariantCulture);
}

var renderer = new RendererType(rendererContext);
var scene = renderer.Scene;

// One sample, so the image carries no antialiasing the three.js side would have to reproduce
var framebuffer = Framebuffer.Prepare("OracleScene", options.Width, options.Height, 1, ImageFormat.RGBA16161616F, ImageFormat.D32);
framebuffer.Initialize();
var output = Framebuffer.Prepare("OracleOutput", options.Width, options.Height, 0, ImageFormat.RGBA8888, null);
output.Initialize();

renderer.Initialize();
renderer.MainFramebuffer = framebuffer;
renderer.Postprocess.Load(framebuffer.NumSamples);
renderer.LoadRendererResources();
renderer.Postprocess.AnimateDither = false;
renderer.ParallelSimulation = false;

// No background: the scene clears to black
renderer.Skybox2D = null;

if (options.Lighting == "viewer")
{
    // What GLSceneViewer.LoadDefaultLighting gives the particle viewer, less the environment map,
    // which no particle renderer reads
    var sunForward = EntityTransformHelper.EulerAnglesToForwardDirection(new Vector3(RendererType.DefaultSunAngles.X, RendererType.DefaultSunAngles.Y, 0f));
    var lighting = scene.LightingInfo.LightingData;
    lighting.SunDirection = new Vector4(-sunForward, scene.LightingInfo.GetSunMinRoughness());
    lighting.SunColor = new Vector4(RendererType.DefaultSunColor.AsVector3() * RendererType.DefaultSunColor.W, 1f);
    scene.LightingInfo.LightingData = lighting;
}

var resource = loader.LoadFileCompiled(options.System)
    ?? throw new FileNotFoundException($"Particle system not found: {options.System}");
var definition = resource.DataBlock as ParticleSystem
    ?? throw new InvalidDataException($"Not a particle system: {options.System}");

var node = new ParticleSceneNode(scene, definition, null, preview: false, playedByEntity: true)
{
    Transform = Matrix4x4.Identity,
    IsPaused = true,
};
scene.Add(node, true);

foreach (var initializing in renderer.Scenes)
{
    initializing.Initialize();
}

var (cameraPosition, cameraTarget) = options.AutoCamera
    ? FrameParticles(definition, loader, options)
    : (options.CameraPosition, options.CameraTarget);

var camera = renderer.Camera;
camera.FieldOfView = options.Fov;
camera.SetViewportSize(options.Width, options.Height);
camera.SetLocation(cameraPosition);
camera.LookAt(cameraTarget);
camera.RecalculateMatrices();

void UpdateScene()
{
    renderer.Update(new Scene.UpdateContext
    {
        Camera = camera,
        TextRenderer = null!,
        Timestep = 0f,
    });
}

// The paused node seeds itself from its placement on its first update, before anything runs
UpdateScene();

var simulation = node.ParticleSimulation;

if (options.Only is { } only)
{
    // Keeps only the renderers at these places in draw order, as though the rest were never
    // created: they still declared their fields to the simulation, but neither evaluate nor draw
    var rootRenderer = typeof(ParticleSceneNode).GetField("particleRenderer", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(node)!;
    var place = 0;
    KeepRenderers(rootRenderer, only, ref place);
}
simulation.SeedRandom(options.Seed ?? unchecked((int)StringToken.Get(simulation.Name)));

foreach (var (cp, position) in options.ControlPoints)
{
    simulation.RenderState.SetControlPointValue(cp, position);
}

simulation.Start();

// A post process volume's tonemap and bloom, as ScenePostProcessVolume reads them, without its
// colour correction LUT; and the exposure the viewer pins the tonemap scalar to
ValveResourceFormat.Renderer.SceneEnvironment.PostProcessState? postState = null;

if (options.Post is { } postPath)
{
    using var postResource = loader.LoadFileCompiled(postPath) ?? throw new FileNotFoundException(postPath);
    var post = (PostProcessing)postResource.DataBlock!;
    var tonemap = post.GetTonemapParams();
    var bloom = post.GetBloomParams();

    postState = ValveResourceFormat.Renderer.SceneEnvironment.PostProcessState.Default with
    {
        TonemapSettings = tonemap != null ? new ValveResourceFormat.Renderer.SceneEnvironment.TonemapSettings(tonemap) : new(),
        BloomSettings = bloom != null ? ValveResourceFormat.Renderer.SceneEnvironment.BloomSettings.ParseFromKVObject(bloom) : new(),
        HasBloom = bloom != null,
    };
}

if (options.Exposure is { } exposure)
{
    renderer.Postprocess.CustomExposure = exposure;
}

// The node finishes a step (lights, models) only when it stepped itself
var steppedField = typeof(ParticleSceneNode).GetField("stepped", BindingFlags.Instance | BindingFlags.NonPublic)!;

var time = 0f;
var frames = new List<object>();
var lastCapture = options.Captures.Max();

for (var frame = 0; frame <= lastCapture; frame++)
{
    foreach (var (cp, velocity) in options.Moves)
    {
        var start = options.ControlPoints.LastOrDefault(point => point.Cp == cp).Position;
        simulation.RenderState.SetControlPointValue(cp, start + (velocity * time));
    }

    foreach (var (cp, degreesPerSecond) in options.Spins)
    {
        var angle = float.DegreesToRadians(degreesPerSecond * time);
        simulation.RenderState.SetControlPointOrientation(cp, new Vector3(MathF.Cos(angle), MathF.Sin(angle), 0f));
    }

    simulation.Update(options.Dt, time);
    time += options.Dt;

    steppedField.SetValue(node, true);
    UpdateScene();

    // Every frame is drawn, as a viewer draws them: renderers evaluate their inputs as they draw, and
    // a random input takes its seed from the system's draws the first time it is read
    renderer.Render(framebuffer);

    if (!options.Captures.Contains(frame))
    {
        continue;
    }

    var name = $"frame{frame:D4}";

    if (postState is { } state)
    {
        renderer.Postprocess.State = state;
    }

    renderer.PostprocessRender(framebuffer, output, flipY: false);

    WriteHdr(renderer.ResolvedSceneColor!, Path.Combine(options.Out, name + ".hdr.f32"), options.Width, options.Height);
    WriteLdr(output, Path.Combine(options.Out, name + ".png"), options.Width, options.Height);

    frames.Add(new
    {
        frame,
        time,
        hdr = name + ".hdr.f32",
        png = name + ".png",
        systems = DescribeTree(simulation, "0"),
        lights = DescribeLights(typeof(ParticleSceneNode).GetField("particleRenderer", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(node)!),
    });
}

var meta = new
{
    system = options.System,
    dt = options.Dt,
    seed = options.Seed,
    width = options.Width,
    height = options.Height,
    lighting = options.Lighting,
    controlPoints = options.ControlPoints.Select(point => new { cp = point.Cp, value = ToArray(point.Position) }),
    moves = options.Moves.Select(move => new { cp = move.Cp, value = ToArray(move.Velocity) }),
    spins = options.Spins.Select(spin => new { cp = spin.Cp, value = spin.DegreesPerSecond }),
    camera = new
    {
        position = ToArray(camera.Location),
        target = ToArray(cameraTarget),
        forward = ToArray(camera.Forward),
        right = ToArray(camera.Right),
        up = ToArray(camera.Up),
        fovY = camera.GetFOV(),
        near = camera.NearPlane,
        // Row-vector matrices as System.Numerics stores them, row by row
        view = ToArray(camera.CameraViewMatrix),
        projection = ToArray(camera.ProjectionMatrix),
    },
    sun = new
    {
        direction = ToArray(scene.LightingInfo.LightingData.SunDirection),
        color = ToArray(scene.LightingInfo.LightingData.SunColor),
    },
    tonemapScalar = renderer.Postprocess.TonemapScalar,
    post = options.Post,
    formats = CollectFormats(loader, simulation, "0", []),
    frames,
};

File.WriteAllText(Path.Combine(options.Out, "meta.json"), JsonSerializer.Serialize(meta, new JsonSerializerOptions { WriteIndented = true }));

renderer.Dispose();
return;

// Runs a plain simulation with the same inputs to the last capture, and frames every particle any
// capture shows from the (1, 1, 1) diagonal, as the particle viewer's default camera looks
static (Vector3 Position, Vector3 Target) FrameParticles(ParticleSystem definition, GameFileLoader loader, Options options)
{
    var simulation = new ParticleSystemSimulation(definition, loader);
    simulation.SeedRandom(options.Seed ?? unchecked((int)StringToken.Get(simulation.Name)));

    foreach (var (cp, position) in options.ControlPoints)
    {
        simulation.RenderState.SetControlPointValue(cp, position);
    }

    simulation.Start();

    var min = new Vector3(float.MaxValue);
    var max = new Vector3(float.MinValue);
    var time = 0f;

    for (var frame = 0; frame <= options.Captures.Max(); frame++)
    {
        foreach (var (cp, velocity) in options.Moves)
        {
            var start = options.ControlPoints.LastOrDefault(point => point.Cp == cp).Position;
            simulation.RenderState.SetControlPointValue(cp, start + (velocity * time));
        }

        foreach (var (cp, degreesPerSecond) in options.Spins)
        {
            var angle = float.DegreesToRadians(degreesPerSecond * time);
            simulation.RenderState.SetControlPointOrientation(cp, new Vector3(MathF.Cos(angle), MathF.Sin(angle), 0f));
        }

        simulation.Update(options.Dt, time);
        time += options.Dt;

        if (options.Captures.Contains(frame))
        {
            Extend(simulation, ref min, ref max);
        }
    }

    if (min.X > max.X)
    {
        return (options.CameraPosition, options.CameraTarget);
    }

    var center = (min + max) * 0.5f;
    var radius = MathF.Max(1f, ((max - min) * 0.5f).Length());
    var halfFov = Camera.Calculate4By3Fov(options.Fov) * 0.5f;
    var distance = (radius / MathF.Sin(halfFov)) * 1.05f;

    return (center + (Vector3.Normalize(Vector3.One) * distance), center);

    static void Extend(ParticleSystemSimulation system, ref Vector3 min, ref Vector3 max)
    {
        var particles = system.Particles.Current;

        for (var i = 0; i < particles.Length; i++)
        {
            var position = particles.ReadVector(ParticleField.Position, i);
            var radius = MathF.Abs(particles.ReadFloat(ParticleField.Radius, i));

            if (!float.IsFinite(position.X) || !float.IsFinite(position.Y) || !float.IsFinite(position.Z) || !float.IsFinite(radius))
            {
                continue;
            }

            min = Vector3.Min(min, position - new Vector3(radius));
            max = Vector3.Max(max, position + new Vector3(radius));
        }

        foreach (var child in system.Children)
        {
            Extend(child, ref min, ref max);
        }
    }
}

// The stored KV3 format of every system in the tree, by path, as the simulation oracle writes them
static Dictionary<string, string> CollectFormats(GameFileLoader loader, ParticleSystemSimulation system, string path, Dictionary<string, string> formats)
{
    var name = system.Name.EndsWith("_c", StringComparison.Ordinal) ? system.Name[..^2] : system.Name;
    var format = (loader.LoadFileCompiled(name)?.DataBlock as ParticleSystem)?.Format;
    formats[path] = format is not { } id ? "none"
        : ValveResourceFormat.Serialization.KeyValues.KV3IDLookup.Table.FirstOrDefault(entry => entry.Value == id.Id).Key ?? id.Id.ToString();

    for (var i = 0; i < system.Children.Count; i++)
    {
        CollectFormats(loader, system.Children[i], $"{path}.{i}", formats);
    }

    return formats;
}

static void KeepRenderers(object particleRenderer, HashSet<int> keep, ref int place)
{
    var type = particleRenderer.GetType();
    var renderers = (System.Collections.IList)type.GetField("renderers", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(particleRenderer)!;
    var kept = new List<object>();

    foreach (var renderer in renderers)
    {
        if (keep.Contains(place++))
        {
            kept.Add(renderer!);
        }
    }

    renderers.Clear();
    kept.ForEach(renderer => renderers.Add(renderer));

    foreach (var child in (System.Collections.IList)type.GetField("childRenderers", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(particleRenderer)!)
    {
        KeepRenderers(child!, keep, ref place);
    }
}

// Writes every mip of each texture listed (one vtex path per line) as VRF decodes it, for a replay that
// wants the authored mip chain rather than one built from the top level
static void ExportTextures(string vpkPath, string listPath, string exportDir)
{
    using var package = new Package();
    package.Read(vpkPath);
    using var loader = new GameFileLoader(package, vpkPath);

    foreach (var line in File.ReadAllLines(listPath))
    {
        var name = line.Trim();

        if (name.Length == 0)
        {
            continue;
        }

        using var resource = loader.LoadFileCompiled(name);

        if (resource?.DataBlock is not Texture texture)
        {
            continue;
        }

        var stem = Path.Combine(exportDir, name[..^".vtex".Length]);
        Directory.CreateDirectory(Path.GetDirectoryName(stem)!);

        for (var mip = 0u; mip < texture.NumMipLevels; mip++)
        {
            using var bitmap = texture.GenerateBitmap(mipLevel: mip);
            using var image = SKImage.FromBitmap(bitmap);
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            using var file = File.Create($"{stem}.mip{mip}.png");
            data.SaveTo(file);
        }
    }
}

static float[] ToArray(object value) => value switch
{
    Vector3 v => [v.X, v.Y, v.Z],
    Vector4 v => [v.X, v.Y, v.Z, v.W],
    Matrix4x4 m => [m.M11, m.M12, m.M13, m.M14, m.M21, m.M22, m.M23, m.M24, m.M31, m.M32, m.M33, m.M34, m.M41, m.M42, m.M43, m.M44],
    _ => throw new ArgumentException("Unsupported value", nameof(value)),
};

// The particle count and positions of every system in the tree, so a replay can check that it
// simulated the same particles before it compares pixels
static List<object> DescribeTree(ParticleSystemSimulation system, string path)
{
    var particles = system.Particles.Current;
    var positions = new float[particles.Length * 3];

    for (var i = 0; i < particles.Length; i++)
    {
        var p = particles.ReadVector(ParticleField.Position, i);
        positions[i * 3] = p.X;
        positions[(i * 3) + 1] = p.Y;
        positions[(i * 3) + 2] = p.Z;
    }

    var list = new List<object> { new { path, name = system.Name, count = particles.Length, positions } };

    for (var i = 0; i < system.Children.Count; i++)
    {
        list.AddRange(DescribeTree(system.Children[i], $"{path}.{i}"));
    }

    return list;
}

// The state of every light a light renderer of the tree keeps in use, in draw order, so a replay can
// check the lights it places (the oracle scene has nothing for them to light)
static List<object> DescribeLights(object particleRenderer)
{
    var type = particleRenderer.GetType();
    var list = new List<object>();

    foreach (var renderer in (System.Collections.IList)type.GetField("renderers", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(particleRenderer)!)
    {
        var lightsProperty = renderer!.GetType().GetProperty("Lights", BindingFlags.Instance | BindingFlags.NonPublic);

        if (lightsProperty?.GetValue(renderer) is not { } pool)
        {
            continue;
        }

        foreach (var slot in (System.Collections.IEnumerable)pool.GetType().GetField("slots", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(pool)!)
        {
            var slotType = slot!.GetType();

            if (!(bool)slotType.GetProperty("InUse")!.GetValue(slot)!)
            {
                continue;
            }

            var state = slotType.GetProperty("State")!.GetValue(slot)!;
            object Field(string name) => state.GetType().GetProperty(name)!.GetValue(state)!;
            var transform = (Matrix4x4)Field("Transform");

            list.Add(new
            {
                renderer = renderer.GetType().Name,
                particleId = (int)slotType.GetProperty("ParticleId")!.GetValue(slot)!,
                color = ToArray((Vector3)Field("Color")),
                linearBrightness = (float)Field("LinearBrightness"),
                brightnessScale = (float)Field("BrightnessScale"),
                range = (float)Field("Range"),
                spotInnerAngle = (float)Field("SpotInnerAngle"),
                spotOuterAngle = (float)Field("SpotOuterAngle"),
                fallOff = (float)Field("FallOff"),
                position = ToArray(transform.Translation),
                direction = ToArray(new Vector3(transform.M11, transform.M12, transform.M13)),
            });
        }
    }

    foreach (var child in (System.Collections.IList)type.GetField("childRenderers", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(particleRenderer)!)
    {
        list.AddRange(DescribeLights(child!));
    }

    return list;
}

// RGBA float32, top row first
static void WriteHdr(RenderTexture texture, string path, int width, int height)
{
    var pixels = new float[width * height * 4];
    GL.GetTextureImage(texture.Handle, 0, PixelFormat.Rgba, PixelType.Float, pixels.Length * sizeof(float), pixels);

    var flipped = new float[pixels.Length];
    var row = width * 4;

    for (var y = 0; y < height; y++)
    {
        Array.Copy(pixels, (height - 1 - y) * row, flipped, y * row, row);
    }

    var bytes = new byte[flipped.Length * sizeof(float)];
    System.Buffer.BlockCopy(flipped, 0, bytes, 0, bytes.Length);
    File.WriteAllBytes(path, bytes);
}

static void WriteLdr(Framebuffer framebuffer, string path, int width, int height)
{
    var pixels = new byte[width * height * 4];
    framebuffer.Bind(FramebufferTarget.ReadFramebuffer);
    GL.ReadPixels(0, 0, width, height, PixelFormat.Rgba, PixelType.UnsignedByte, pixels);

    using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
    var row = width * 4;
    var destination = bitmap.GetPixelSpan();

    for (var y = 0; y < height; y++)
    {
        pixels.AsSpan((height - 1 - y) * row, row).CopyTo(destination.Slice(y * row, row));
    }

    // The alpha is whatever the post process left there; the image is opaque
    for (var i = 3; i < destination.Length; i += 4)
    {
        destination[i] = 255;
    }

    using var image = SKImage.FromBitmap(bitmap);
    using var data = image.Encode(SKEncodedImageFormat.Png, 100);
    using var file = File.Create(path);
    data.SaveTo(file);
}

sealed record Options(string Vpk, string System, string Out, int[] Captures, float Dt, int? Seed,
    List<(int Cp, Vector3 Position)> ControlPoints, List<(int Cp, Vector3 Velocity)> Moves,
    List<(int Cp, float DegreesPerSecond)> Spins, int Width, int Height, Vector3 CameraPosition,
    Vector3 CameraTarget, bool AutoCamera, float Fov, string Lighting, HashSet<int>? Only, string? Post, float? Exposure)
{
    public static Options Parse(string[] args)
    {
        string? vpk = null, system = null, output = null;
        int[] captures = [64];
        var dt = 1f / 64f;
        int? seed = null;
        var cps = new List<(int, Vector3)>();
        var moves = new List<(int, Vector3)>();
        var spins = new List<(int, float)>();
        int width = 512, height = 512;
        var cameraPosition = new Vector3(200f, 200f, 200f);
        var cameraTarget = Vector3.Zero;
        var autoCamera = false;
        var fov = 60f;
        var lighting = "viewer";
        HashSet<int>? only = null;
        string? post = null;
        float? exposure = null;

        for (var i = 0; i < args.Length; i++)
        {
            var value = i + 1 < args.Length ? args[i + 1] : throw new ArgumentException($"Missing value for {args[i]}");

            switch (args[i])
            {
                case "--vpk": vpk = value; break;
                case "--system": system = value; break;
                case "--out": output = value; break;
                case "--capture": captures = [.. value.Split(',').Select(v => int.Parse(v, CultureInfo.InvariantCulture))]; break;
                case "--dt": dt = float.Parse(value, CultureInfo.InvariantCulture); break;
                case "--seed": seed = int.Parse(value, CultureInfo.InvariantCulture); break;
                case "--cp": cps.Add(ParseIndexed(value)); break;
                case "--cp-move": moves.Add(ParseIndexed(value)); break;
                case "--cp-spin":
                    {
                        var parts = value.Split('=');
                        spins.Add((int.Parse(parts[0], CultureInfo.InvariantCulture), float.Parse(parts[1], CultureInfo.InvariantCulture)));
                        break;
                    }
                case "--size":
                    {
                        var parts = value.Split('x');
                        width = int.Parse(parts[0], CultureInfo.InvariantCulture);
                        height = int.Parse(parts[1], CultureInfo.InvariantCulture);
                        break;
                    }
                case "--camera":
                    if (value == "auto")
                    {
                        autoCamera = true;
                    }
                    else
                    {
                        cameraPosition = ParseVector(value);
                    }

                    break;
                case "--target": cameraTarget = ParseVector(value); break;
                case "--fov": fov = float.Parse(value, CultureInfo.InvariantCulture); break;
                case "--lighting": lighting = value; break;
                case "--post": post = value; break;
                case "--exposure": exposure = float.Parse(value, CultureInfo.InvariantCulture); break;
                case "--only": only = [.. value.Split(',').Select(v => int.Parse(v, CultureInfo.InvariantCulture))]; break;
                default: throw new ArgumentException($"Unknown option {args[i]}");
            }

            i++;
        }

        return new Options(
            vpk ?? throw new ArgumentException("--vpk is required"),
            system ?? throw new ArgumentException("--system is required"),
            output ?? throw new ArgumentException("--out is required"),
            captures, dt, seed, cps, moves, spins, width, height, cameraPosition, cameraTarget, autoCamera, fov, lighting, only, post, exposure);
    }

    private static (int, Vector3) ParseIndexed(string value)
    {
        var parts = value.Split('=');
        return (int.Parse(parts[0], CultureInfo.InvariantCulture), ParseVector(parts[1]));
    }

    private static Vector3 ParseVector(string value)
    {
        var parts = value.Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray();
        return new Vector3(parts[0], parts[1], parts[2]);
    }
}
