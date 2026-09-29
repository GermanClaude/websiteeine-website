using ScpslTrust.Core.Proof;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Proof;

/// <summary>Byte-for-byte compatibility with shared/test-vectors/proof-codes.json.</summary>
public sealed class ProofCodeVectorTests
{
    private const string File = "proof-codes.json";

    public static IEnumerable<object[]> CaseNames => TestVectors.CaseNames(File, "cases");

    [Fact]
    public void Header_matches_constants()
    {
        var root = TestVectors.Load(File);
        Assert.Equal(ProofCodeGenerator.MessageVersion, root.Str("version"));
        Assert.Equal(ProofCodeGenerator.Alphabet, root.Str("alphabet"));
        Assert.True(root.GetProperty("cases").GetArrayLength() >= 18);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Case_reproduces_window_message_mac_and_code(string name)
    {
        var c = TestVectors.Case(File, "cases", name);
        var secret = Convert.FromBase64String(c.Str("secret_b64"));
        Assert.Equal(c.Str("secret_hex"), Hex.Encode(secret));

        var unixSeconds = c.GetProperty("unix_seconds").GetInt64();
        var interval = c.GetProperty("interval_seconds").GetInt32();
        var window = ProofCodeGenerator.Window(unixSeconds, interval);
        Assert.Equal(c.GetProperty("window").GetInt64(), window);

        var message = ProofCodeGenerator.BuildMessage(c.Str("session_id"), c.Str("server_id"), c.Str("target_user_id"), c.Str("spectator_user_id"), window);
        Assert.Equal(c.Str("message"), message);

        var mac = ProofCodeGenerator.ComputeMac(secret, message);
        Assert.Equal(c.Str("mac_hex"), Hex.Encode(mac));
        Assert.Equal(c.Str("code"), ProofCodeGenerator.CodeFromMac(mac));
        Assert.Equal(c.Str("code"), ProofCodeGenerator.Generate(secret, c.Str("session_id"), c.Str("server_id"), c.Str("target_user_id"), c.Str("spectator_user_id"), unixSeconds, interval));
    }

    [Fact]
    public void Code_extremes()
    {
        Assert.Equal("000-000", ProofCodeGenerator.CodeFromMac(new byte[4]));
        Assert.Equal("ZZZ-ZZZ", ProofCodeGenerator.CodeFromMac(new byte[] { 0xff, 0xff, 0xff, 0xff }));
        // Only the top 30 bits count: the two lowest bits of mac[3] never change the code.
        Assert.Equal(ProofCodeGenerator.CodeFromMac(new byte[] { 1, 2, 3, 0 }), ProofCodeGenerator.CodeFromMac(new byte[] { 1, 2, 3, 3 }));
        Assert.NotEqual(ProofCodeGenerator.CodeFromMac(new byte[] { 1, 2, 3, 0 }), ProofCodeGenerator.CodeFromMac(new byte[] { 1, 2, 3, 4 }));
    }

    [Fact]
    public void Window_boundaries()
    {
        Assert.Equal(179000000, ProofCodeGenerator.Window(1790000000, 10));
        Assert.Equal(178999999, ProofCodeGenerator.Window(1789999999, 10));
        Assert.Equal(0, ProofCodeGenerator.Window(0, 5));
    }

    [Theory]
    [InlineData("a|b", "srv_7k4x92m8pq174kf9", "1@steam", "2@steam")]
    [InlineData("session", "srv|x", "1@steam", "2@steam")]
    [InlineData("session", "srv_7k4x92m8pq174kf9", "1@steam\n", "2@steam")]
    [InlineData("session", "srv_7k4x92m8pq174kf9", "1@steam", "")]
    [InlineData("", "srv_7k4x92m8pq174kf9", "1@steam", "2@steam")]
    public void Message_fields_cannot_inject_separators(string session, string server, string target, string spectator)
    {
        Assert.ThrowsAny<ArgumentException>(() => ProofCodeGenerator.BuildMessage(session, server, target, spectator, 1));
    }

    [Fact]
    public void Invalid_ranges_are_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ProofCodeGenerator.Window(10, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => ProofCodeGenerator.Window(-1, 10));
        Assert.Throws<ArgumentOutOfRangeException>(() => ProofCodeGenerator.BuildMessage("s", "srv", "t", "u", -1));
        Assert.ThrowsAny<ArgumentException>(() => ProofCodeGenerator.ComputeMac(Array.Empty<byte>(), "m"));
        Assert.ThrowsAny<ArgumentException>(() => ProofCodeGenerator.CodeFromMac(new byte[3]));
    }

    [Fact]
    public void Overlay_text_format()
    {
        var sessionId = Guid.Parse("5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e");
        var text = ProofOverlay.Format("7K4-X92", DateTimeOffset.Parse("2026-09-29T15:42:20.456Z"), "srv_7k4x92m8pq174kf9", sessionId);
        Assert.Equal("PROOF 7K4-X92 · 15:42:20 UTC · srv_7k4x92m8pq174kf9 · #5b1d7e2a", text);
    }
}
