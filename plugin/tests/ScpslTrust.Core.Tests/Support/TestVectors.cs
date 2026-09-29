using System.Text.Json;

namespace ScpslTrust.Core.Tests.Support;

/// <summary>
/// Loads shared/test-vectors/*.json: from the test output folder (copied at build time) or, as a
/// fallback, by walking up from the output folder to the repository's shared/test-vectors directory.
/// </summary>
public static class TestVectors
{
    private static readonly Dictionary<string, JsonDocument> Cache = new();

    public static JsonElement Load(string fileName)
    {
        lock (Cache)
        {
            if (!Cache.TryGetValue(fileName, out var document))
            {
                document = JsonDocument.Parse(File.ReadAllText(Resolve(fileName)));
                Cache[fileName] = document;
            }

            return document.RootElement;
        }
    }

    public static string Resolve(string fileName)
    {
        var copied = Path.Combine(AppContext.BaseDirectory, "test-vectors", fileName);
        if (File.Exists(copied))
        {
            return copied;
        }

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "shared", "test-vectors", fileName);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException("Test vector file not found (expected shared/test-vectors/" + fileName + ").", fileName);
    }

    public static IEnumerable<object[]> CaseNames(string fileName, string arrayProperty)
    {
        return Load(fileName).GetProperty(arrayProperty).EnumerateArray().Select(e => new object[] { e.GetProperty("name").GetString()! });
    }

    public static JsonElement Case(string fileName, string arrayProperty, string name)
    {
        return Load(fileName).GetProperty(arrayProperty).EnumerateArray().Single(e => e.GetProperty("name").GetString() == name);
    }

    public static string Str(this JsonElement element, string property) => element.GetProperty(property).GetString()!;

    public static string? NullableStr(this JsonElement element, string property)
    {
        var value = element.GetProperty(property);
        return value.ValueKind == JsonValueKind.Null ? null : value.GetString();
    }

    /// <summary>Structural JSON equality (object key order ignored, numbers compared as decimals).</summary>
    public static bool JsonEquals(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind)
        {
            return false;
        }

        switch (a.ValueKind)
        {
            case JsonValueKind.Object:
                var aProps = a.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
                var bProps = b.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
                return aProps.Count == bProps.Count && aProps.All(p => bProps.TryGetValue(p.Key, out var other) && JsonEquals(p.Value, other));
            case JsonValueKind.Array:
                var aItems = a.EnumerateArray().ToList();
                var bItems = b.EnumerateArray().ToList();
                return aItems.Count == bItems.Count && aItems.Zip(bItems).All(pair => JsonEquals(pair.First, pair.Second));
            case JsonValueKind.Number:
                return a.GetDecimal() == b.GetDecimal();
            case JsonValueKind.String:
                return a.GetString() == b.GetString();
            default:
                return true;
        }
    }
}
