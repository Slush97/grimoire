// Particle oracle: runs a Source 2 particle system through VRF's simulation and dumps
// every particle's core attributes, every frame, as JSON. Dev-only reference for the
// Grimoire TypeScript runtime.
//
// usage: ParticleOracle --vpk <pak01_dir.vpk> --system <particles/...vpcf> [--frames 192]
//        [--dt 0.015625] [--seed N] [--cp N=x,y,z]... [--cp-move N=vx,vy,vz]...
//        [--cp-spin N=degreesPerSecond]... [--stop-frame N] [--out file.json]
//        [--model models/...vmdl [--model-cp N] [--model-move vx,vy,vz] [--model-motion]]
//        ParticleOracle --numerics-cases <out.json>
//        ParticleOracle --trig-case <float input bits in hex>
//
// --cp-move moves a control point from its --cp position at a constant velocity, and --cp-spin turns
// its forward axis about +Z, both set before every update from the world time. Each frame lists the
// writes it made as "inputs", so a replay can take the exact values.
//
// --model binds a model to a control point (0 by default) as the object the model functions read, as
// VRF's particle preview binds its preview model. The output describes the model as VRF read it
// (skeleton, hitbox sets, render bounds, bind pose) and every snapshot the tree loaded. --model-move
// moves the model's placement at a constant velocity, and --model-motion poses its bones away from
// the bind pose: even bones by one rigid motion and odd bones by another, both a function of the
// frame index that a replay recomputes (see ModelMotion).
using System.Globalization;
using System.Numerics;
using System.Reflection;
using System.Text.Json;
using ValvePak;
using ValveResourceFormat;
using ValveResourceFormat.IO;
using ValveResourceFormat.Serialization.KeyValues;
using ValveResourceFormat.Particles;
using ValveResourceFormat.ResourceTypes;

if (args is ["--numerics-cases", var casesPath])
{
    NumericsCases.Write(casesPath);
    return;
}

if (args is ["--trig-case", var inputBits])
{
    var bits = uint.Parse(inputBits, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
    var input = BitConverter.UInt32BitsToSingle(bits);
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        inputBits = $"0x{bits:x8}",
        input,
        sinBits = $"0x{BitConverter.SingleToUInt32Bits(MathF.Sin(input)):x8}",
        cosBits = $"0x{BitConverter.SingleToUInt32Bits(MathF.Cos(input)):x8}",
    }));
    return;
}

var options = Options.Parse(args);

using var package = new Package();
package.Read(options.Vpk);
using var loader = new GameFileLoader(package, options.Vpk);

var resource = loader.LoadFileCompiled(options.System)
    ?? throw new FileNotFoundException($"Particle system not found: {options.System}");
var definition = resource.DataBlock as ParticleSystem
    ?? throw new InvalidDataException($"Not a particle system: {options.System}");

var simulation = new ParticleSystemSimulation(definition, loader);
if (options.Seed is int seed)
{
    typeof(ParticleSystemSimulation)
        .GetMethod("SeedRandom", BindingFlags.Instance | BindingFlags.NonPublic)!
        .Invoke(simulation, [seed]);
}

foreach (var (cp, position) in options.ControlPoints)
{
    simulation.RenderState.SetControlPointValue(cp, position);
}

OracleModelObject? modelObject = null;
if (options.Model is { } modelPath)
{
    var modelResource = loader.LoadFileCompiled(modelPath)
        ?? throw new FileNotFoundException($"Model not found: {modelPath}");
    var model = modelResource.DataBlock as Model ?? throw new InvalidDataException($"Not a model: {modelPath}");

    // As ModelSceneNode.LoadMeshes, a model's referenced meshes supply hitbox sets it lacks
    foreach (var reference in model.GetReferenceMeshNamesAndLoD())
    {
        if (loader.LoadFileCompiled(reference.MeshName)?.DataBlock is Mesh mesh)
        {
            model.SetExternalMeshData(mesh);
        }
    }

    modelObject = new OracleModelObject(model);
    simulation.GetControlPoint(options.ModelControlPoint).ModelObject = modelObject;
}

simulation.Start();

using var stream = options.Out is null ? Console.OpenStandardOutput() : File.Create(options.Out);
using var json = new Utf8JsonWriter(stream);
json.WriteStartObject();
json.WriteString("system", options.System);
json.WriteNumber("dt", options.Dt);
json.WriteStartObject("formats");
WriteFormats(json, loader, simulation, "0");
json.WriteEndObject();
json.WriteStartArray("snapshots");
WriteSnapshots(json, loader, simulation, "0");
json.WriteEndArray();
if (modelObject != null)
{
    WriteModel(json, modelObject.Model, loader, options);
}
json.WriteStartArray("frames");

var time = 0f;
for (var frame = 0; frame < options.Frames; frame++)
{
    // Each write is recorded as made, so a runtime replaying the run takes the exact values instead
    // of recomputing them with its own trigonometry
    var inputs = new List<(string Kind, int Cp, Vector3 Value)>();

    foreach (var (cp, velocity) in options.Moves)
    {
        var start = options.ControlPoints.LastOrDefault(point => point.Cp == cp).Position;
        var position = start + (velocity * time);
        simulation.RenderState.SetControlPointValue(cp, position);
        inputs.Add(("position", cp, position));
    }

    foreach (var (cp, degreesPerSecond) in options.Spins)
    {
        var angle = float.DegreesToRadians(degreesPerSecond * time);
        var forward = new Vector3(MathF.Cos(angle), MathF.Sin(angle), 0f);
        simulation.RenderState.SetControlPointOrientation(cp, forward);
        inputs.Add(("orientation", cp, forward));
    }

    if (modelObject != null)
    {
        modelObject.Transform = Matrix4x4.CreateTranslation(options.ModelMove * time);
        (modelObject.EvenMotion, modelObject.OddMotion) = options.ModelMotion ? ModelMotion.At(frame) : (Matrix4x4.Identity, Matrix4x4.Identity);
    }

    if (frame == options.StopFrame)
    {
        simulation.PlayEndCap();
    }

    simulation.Update(options.Dt, time);
    time += options.Dt;

    json.WriteStartObject();
    json.WriteNumber("t", time);
    WriteControlPointInputs(json, inputs);
    if (modelObject != null)
    {
        json.WriteStartObject("model");
        WriteMatrix(json, "transform", modelObject.Transform);
        WriteMatrix(json, "even", modelObject.EvenMotion);
        WriteMatrix(json, "odd", modelObject.OddMotion);
        json.WriteEndObject();
    }
    json.WriteStartArray("systems");
    WriteTree(json, simulation, "0");
    json.WriteEndArray();
    json.WriteEndObject();
}

json.WriteEndArray();
json.WriteEndObject();
json.Flush();

// The stored KV3 format of every system in the tree, by path. VRF replays its upgrade chain from
// there, so a runtime fed the raw definitions needs it too.
static void WriteFormats(Utf8JsonWriter json, GameFileLoader loader, ParticleSystemSimulation system, string path)
{
    var name = system.Name.EndsWith("_c", StringComparison.Ordinal) ? system.Name[..^2] : system.Name;
    var format = (loader.LoadFileCompiled(name)?.DataBlock as ParticleSystem)?.Format;
    json.WriteString(path, FormatName(format));

    for (var i = 0; i < system.Children.Count; i++)
    {
        WriteFormats(json, loader, system.Children[i], $"{path}.{i}");
    }
}

// Every snapshot a system of the tree loads (m_hSnapshot), as VRF read it, by tree path.
static void WriteSnapshots(Utf8JsonWriter json, GameFileLoader loader, ParticleSystemSimulation system, string path)
{
    var name = system.Name.EndsWith("_c", StringComparison.Ordinal) ? system.Name[..^2] : system.Name;
    var data = (loader.LoadFileCompiled(name)?.DataBlock as ParticleSystem)?.Data;
    var snapshotPath = data?.GetStringProperty("m_hSnapshot");

    if (!string.IsNullOrEmpty(snapshotPath)
        && loader.LoadFileCompiled(snapshotPath)?.GetBlockByType(BlockType.SNAP) is ValveResourceFormat.Blocks.ParticleSnapshot snapshot)
    {
        json.WriteStartObject();
        json.WriteString("path", path);
        json.WriteString("snapshot", snapshotPath);
        json.WriteNumber("numParticles", snapshot.NumParticles);
        json.WriteStartArray("columns");

        foreach (var ((attributeName, attributeType), values) in snapshot.AttributeData)
        {
            json.WriteStartObject();
            json.WriteString("name", attributeName);
            json.WriteString("type", attributeType);
            json.WriteStartArray("values");

            foreach (var value in values)
            {
                switch (value)
                {
                    case Vector3 v:
                        json.WriteNumberValue(v.X);
                        json.WriteNumberValue(v.Y);
                        json.WriteNumberValue(v.Z);
                        break;
                    case float f:
                        json.WriteNumberValue(f);
                        break;
                    case int i:
                        json.WriteNumberValue(i);
                        break;
                    case string text:
                        json.WriteStringValue(text);
                        break;
                    case ValveResourceFormat.Blocks.ParticleSnapshot.SkinningData skin:
                        json.WriteStartObject();
                        json.WriteStartArray("jointNames");
                        foreach (var joint in skin.JointNames)
                        {
                            json.WriteStringValue(joint);
                        }
                        json.WriteEndArray();
                        json.WriteStartArray("weights");
                        foreach (var weight in skin.Weights)
                        {
                            json.WriteNumberValue(weight);
                        }
                        json.WriteEndArray();
                        json.WriteEndObject();
                        break;
                }
            }

            json.WriteEndArray();
            json.WriteEndObject();
        }

        json.WriteEndArray();
        json.WriteEndObject();
    }

    for (var i = 0; i < system.Children.Count; i++)
    {
        WriteSnapshots(json, loader, system.Children[i], $"{path}.{i}");
    }
}

// The bound model as the model functions read it: skeleton, hitbox sets, render bounds and bind pose.
static void WriteModel(Utf8JsonWriter json, Model model, GameFileLoader loader, Options options)
{
    json.WriteStartObject("model");
    json.WriteString("path", options.Model);
    json.WriteString("name", model.Name);
    json.WriteNumber("controlPoint", options.ModelControlPoint);
    json.WriteBoolean("motion", options.ModelMotion);
    WriteVector(json, "move", options.ModelMove);

    json.WriteStartArray("bones");
    foreach (var bone in model.Skeleton.Bones)
    {
        json.WriteStartObject();
        json.WriteString("name", bone.Name);
        json.WriteNumber("parent", bone.Parent?.Index ?? -1);
        WriteVector(json, "position", bone.Position);
        json.WriteStartArray("rotation");
        json.WriteNumberValue(bone.Angle.X);
        json.WriteNumberValue(bone.Angle.Y);
        json.WriteNumberValue(bone.Angle.Z);
        json.WriteNumberValue(bone.Angle.W);
        json.WriteEndArray();
        json.WriteEndObject();
    }
    json.WriteEndArray();

    json.WriteStartArray("hitboxSets");
    foreach (var (setName, hitboxes) in model.HitboxSets)
    {
        json.WriteStartObject();
        json.WriteString("name", setName);
        json.WriteStartArray("hitboxes");
        foreach (var hitbox in hitboxes)
        {
            json.WriteStartObject();
            json.WriteString("name", hitbox.Name);
            json.WriteString("boneName", hitbox.BoneName);
            WriteVector(json, "min", hitbox.MinBounds);
            WriteVector(json, "max", hitbox.MaxBounds);
            json.WriteNumber("radius", hitbox.ShapeRadius);
            json.WriteNumber("shape", (int)hitbox.ShapeType);
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteEndObject();
    }
    json.WriteEndArray();

    // ModelElements is internal to VRF; the render bounds are what a hitbox-less model falls back to
    var bounds = (ValveResourceFormat.Utils.AABB)typeof(ParticleSystemSimulation).Assembly
        .GetType("ValveResourceFormat.Particles.Utils.ModelElements")!
        .GetMethod("Bounds", BindingFlags.Static | BindingFlags.Public)!
        .Invoke(null, [model, loader])!;
    json.WriteStartObject("bounds");
    WriteVector(json, "min", bounds.Min);
    WriteVector(json, "max", bounds.Max);
    json.WriteEndObject();

    var bindPose = new Matrix4x4[model.Skeleton.Bones.Length];
    BindPoseModelObject.GetBindPose(model, bindPose);
    json.WriteStartArray("bindPose");
    foreach (var matrix in bindPose)
    {
        WriteMatrixValue(json, matrix);
    }
    json.WriteEndArray();

    json.WriteEndObject();
}

static void WriteVector(Utf8JsonWriter json, string name, Vector3 v)
{
    json.WriteStartArray(name);
    json.WriteNumberValue(v.X);
    json.WriteNumberValue(v.Y);
    json.WriteNumberValue(v.Z);
    json.WriteEndArray();
}

static void WriteMatrix(Utf8JsonWriter json, string name, Matrix4x4 m)
{
    json.WritePropertyName(name);
    WriteMatrixValue(json, m);
}

static void WriteMatrixValue(Utf8JsonWriter json, Matrix4x4 m)
{
    json.WriteStartArray();
    foreach (var value in new[] { m.M11, m.M12, m.M13, m.M14, m.M21, m.M22, m.M23, m.M24, m.M31, m.M32, m.M33, m.M34, m.M41, m.M42, m.M43, m.M44 })
    {
        json.WriteNumberValue(value);
    }
    json.WriteEndArray();
}

static string FormatName(ValveKeyValue.KeyValues3.KV3ID? format)
    => format is not { } id ? "none"
        : ValveResourceFormat.Serialization.KeyValues.KV3IDLookup.Table.FirstOrDefault(entry => entry.Value == id.Id).Key ?? id.Id.ToString();

// The control point writes made before the update, in order.
static void WriteControlPointInputs(Utf8JsonWriter json, List<(string Kind, int Cp, Vector3 Value)> inputs)
{
    if (inputs.Count == 0)
    {
        return;
    }

    json.WriteStartArray("inputs");

    foreach (var (kind, cp, value) in inputs)
    {
        json.WriteStartObject();
        json.WriteString("kind", kind);
        json.WriteNumber("cp", cp);
        json.WriteStartArray("value");
        json.WriteNumberValue(value.X);
        json.WriteNumberValue(value.Y);
        json.WriteNumberValue(value.Z);
        json.WriteEndArray();
        json.WriteEndObject();
    }

    json.WriteEndArray();
}

static void WriteTree(Utf8JsonWriter json, ParticleSystemSimulation system, string path)
{
    var particles = system.Particles.Current;
    json.WriteStartObject();
    json.WriteString("path", path);
    json.WriteString("name", system.Name);
    json.WriteNumber("count", particles.Length);

    foreach (var field in Fields.Vectors)
    {
        json.WriteStartArray(field.ToString());
        for (var i = 0; i < particles.Length; i++)
        {
            var v = particles.ReadVector(field, i);
            json.WriteNumberValue(v.X);
            json.WriteNumberValue(v.Y);
            json.WriteNumberValue(v.Z);
        }
        json.WriteEndArray();
    }

    foreach (var field in Fields.Scalars)
    {
        json.WriteStartArray(field.ToString());
        for (var i = 0; i < particles.Length; i++)
        {
            json.WriteNumberValue(particles.ReadFloat(field, i));
        }
        json.WriteEndArray();
    }

    foreach (var field in Fields.Integers)
    {
        json.WriteStartArray(field.ToString());
        for (var i = 0; i < particles.Length; i++)
        {
            json.WriteNumberValue(particles.ReadInteger(field, i));
        }
        json.WriteEndArray();
    }

    json.WriteEndObject();

    for (var i = 0; i < system.Children.Count; i++)
    {
        WriteTree(json, system.Children[i], $"{path}.{i}");
    }
}

// A model bound to a control point whose bones the oracle poses: each bone's bind pose followed by the
// even or odd motion of the frame, placed by Transform.
sealed class OracleModelObject(Model model) : IParticleModelObject
{
    public Model Model => model;

    public Matrix4x4 Transform { get; set; } = Matrix4x4.Identity;

    public Matrix4x4 EvenMotion { get; set; } = Matrix4x4.Identity;

    public Matrix4x4 OddMotion { get; set; } = Matrix4x4.Identity;

    public void GetBonePose(Span<Matrix4x4> bones)
    {
        BindPoseModelObject.GetBindPose(model, bones);

        for (var i = 0; i < bones.Length; i++)
        {
            bones[i] *= (i & 1) == 0 ? EvenMotion : OddMotion;
        }
    }
}

// The bone motions of --model-motion at a frame: a rotation and a translation that ramp up over 64
// frames and start over, built from float arithmetic, a square root and System.Numerics alone so a
// replay computes the same bits.
static class ModelMotion
{
    public static (Matrix4x4 Even, Matrix4x4 Odd) At(int frame)
    {
        var s = (frame % 64) / 64f;
        var even = Matrix4x4.CreateFromQuaternion(Quaternion.Normalize(new Quaternion(0.1f * s, 0.05f * s, 0.2f * s, 1f)))
            * Matrix4x4.CreateTranslation(3f * s, -2f * s, 1f * s);
        var odd = Matrix4x4.CreateFromQuaternion(Quaternion.Normalize(new Quaternion(-0.15f * s, 0.1f * s, 0.05f * s, 1f)))
            * Matrix4x4.CreateTranslation(-1f * s, 2f * s, 4f * s);
        return (even, odd);
    }
}

static class Fields
{
    public static readonly ParticleField[] Vectors =
    [
        ParticleField.Position, ParticleField.PositionPrevious, ParticleField.Color, ParticleField.Normal,
        ParticleField.HitboxOffsetPosition, ParticleField.ScratchVector, ParticleField.GlowRgb,
        ParticleField.ScratchVector2, ParticleField.BoneWeights, ParticleField.BoxMins,
        ParticleField.BoxMaxs, ParticleField.BoxAngles, ParticleField.RopeSegmentData,
    ];

    public static readonly ParticleField[] Scalars =
    [
        ParticleField.LifeDuration, ParticleField.Radius, ParticleField.Roll, ParticleField.RollSpeed,
        ParticleField.Alpha, ParticleField.CreationTime, ParticleField.SequenceNumber, ParticleField.TrailLength,
        ParticleField.Yaw, ParticleField.Pitch, ParticleField.AlphaAlternate, ParticleField.ScratchFloat,
        ParticleField.SecondSequenceNumber, ParticleField.GlowAlpha, ParticleField.ScratchFloat1,
        ParticleField.ScratchFloat2, ParticleField.ForceScale, ParticleField.ManualAnimationFrame,
        ParticleField.ShaderExtraData1, ParticleField.ShaderExtraData2,
    ];

    public static readonly ParticleField[] Integers = [ParticleField.ParticleId];
}

sealed record Options(string Vpk, string System, int Frames, float Dt, int? Seed, List<(int Cp, Vector3 Position)> ControlPoints,
    List<(int Cp, Vector3 Velocity)> Moves, List<(int Cp, float DegreesPerSecond)> Spins, int? StopFrame, string? Out,
    string? Model, int ModelControlPoint, Vector3 ModelMove, bool ModelMotion)
{
    public static Options Parse(string[] args)
    {
        string? vpk = null, system = null, output = null, model = null;
        var modelControlPoint = 0;
        var modelMove = Vector3.Zero;
        var modelMotion = false;
        int frames = 192;
        float dt = 1f / 64f;
        int? seed = null;
        int? stopFrame = null;
        var cps = new List<(int, Vector3)>();
        var moves = new List<(int, Vector3)>();
        var spins = new List<(int, float)>();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--model-motion")
            {
                modelMotion = true;
                continue;
            }

            var value = i + 1 < args.Length ? args[i + 1] : throw new ArgumentException($"Missing value for {args[i]}");
            switch (args[i])
            {
                case "--vpk": vpk = value; break;
                case "--system": system = value; break;
                case "--frames": frames = int.Parse(value, CultureInfo.InvariantCulture); break;
                case "--dt": dt = float.Parse(value, CultureInfo.InvariantCulture); break;
                case "--seed": seed = int.Parse(value, CultureInfo.InvariantCulture); break;
                case "--stop-frame": stopFrame = int.Parse(value, CultureInfo.InvariantCulture); break;
                case "--out": output = value; break;
                case "--model": model = value; break;
                case "--model-cp": modelControlPoint = int.Parse(value, CultureInfo.InvariantCulture); break;
                case "--model-move":
                    var move = value.Split(',').Select(s => float.Parse(s, CultureInfo.InvariantCulture)).ToArray();
                    modelMove = new Vector3(move[0], move[1], move[2]);
                    break;
                case "--cp":
                    cps.Add(ParseVectorOption(value));
                    break;
                case "--cp-move":
                    moves.Add(ParseVectorOption(value));
                    break;
                case "--cp-spin":
                    var spin = value.Split('=');
                    spins.Add((int.Parse(spin[0], CultureInfo.InvariantCulture), float.Parse(spin[1], CultureInfo.InvariantCulture)));
                    break;
                default: throw new ArgumentException($"Unknown option {args[i]}");
            }
            i++;
        }
        return new Options(vpk ?? throw new ArgumentException("--vpk is required"),
            system ?? throw new ArgumentException("--system is required"), frames, dt, seed, cps, moves, spins, stopFrame, output,
            model, modelControlPoint, modelMove, modelMotion);
    }

    private static (int, Vector3) ParseVectorOption(string value)
    {
        var parts = value.Split('=');
        var xyz = parts[1].Split(',').Select(s => float.Parse(s, CultureInfo.InvariantCulture)).ToArray();
        return (int.Parse(parts[0], CultureInfo.InvariantCulture), new Vector3(xyz[0], xyz[1], xyz[2]));
    }
}

// Reference cases for src/lib/particles/numerics.ts: System.Numerics results on random inputs, as
// float bit patterns (src/lib/particles/__fixtures__/dotnet_numerics.json).
static class NumericsCases
{
    public static void Write(string path)
    {
        var random = new Random(7);
        float R(float scale = 10f) => (float)((random.NextDouble() * 2 * scale) - scale);
        static uint U(float f) => BitConverter.SingleToUInt32Bits(f);
        static uint[] M(Matrix4x4 m) => [U(m.M11), U(m.M12), U(m.M13), U(m.M14), U(m.M21), U(m.M22), U(m.M23), U(m.M24),
            U(m.M31), U(m.M32), U(m.M33), U(m.M34), U(m.M41), U(m.M42), U(m.M43), U(m.M44)];
        static uint[] V(Vector3 v) => [U(v.X), U(v.Y), U(v.Z)];
        static uint[] Q(Quaternion q) => [U(q.X), U(q.Y), U(q.Z), U(q.W)];
        Matrix4x4 RandomRigid()
        {
            var m = Matrix4x4.CreateFromQuaternion(Quaternion.Normalize(new Quaternion(R(1), R(1), R(1), R(1))));
            m.Translation = new Vector3(R(50), R(50), R(50));
            return m;
        }

        var cases = new List<object>();

        for (var i = 0; i < 40; i++)
        {
            var a = i % 2 == 0 ? RandomRigid() : new Matrix4x4(R(), R(), R(), 0, R(), R(), R(), 0, R(), R(), R(), 0, R(), R(), R(), 1);
            var b = RandomRigid();
            var v = new Vector3(R(), R(), R());
            var w = new Vector3(R(), R(), R());
            Matrix4x4.Invert(a, out var inverse);
            var q1 = Quaternion.Normalize(new Quaternion(R(1), R(1), R(1), R(1)));
            var q2 = Quaternion.Normalize(new Quaternion(R(1), R(1), R(1), R(1)));
            var t = (float)random.NextDouble();
            var angle = R(4);

            cases.Add(new
            {
                a = M(a), b = M(b), v = V(v), w = V(w), q1 = Q(q1), q2 = Q(q2), t = U(t),
                transform = V(Vector3.Transform(v, a)), transformNormal = V(Vector3.TransformNormal(v, a)),
                multiply = M(a * b), invert = M(inverse),
                slerp = Q(Quaternion.Slerp(q1, q2, t)), fromMatrix = Q(Quaternion.CreateFromRotationMatrix(b)), toMatrix = M(Matrix4x4.CreateFromQuaternion(q1)),
                normalize = V(Vector3.Normalize(v)), length = U(v.Length()), cross = V(Vector3.Cross(v, w)),
                lerp = U(float.Lerp(v.X, v.Y, t)), angle = U(angle), toRadians = U(float.DegreesToRadians(angle * 90f)), toDegrees = U(float.RadiansToDegrees(angle)),
            });
        }

        File.WriteAllText(path, JsonSerializer.Serialize(cases));
    }
}
