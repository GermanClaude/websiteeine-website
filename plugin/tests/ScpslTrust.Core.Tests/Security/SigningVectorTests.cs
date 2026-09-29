using System.Text;
using System.Text.Json;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Security;

/// <summary>Byte-for-byte compatibility with shared/test-vectors/signing.json.</summary>
public sealed class SigningVectorTests
{
    private const string File = "signing.json";

    private static JsonElement Root => TestVectors.Load(File);

    public static IEnumerable<object[]> RequestNames => TestVectors.CaseNames(File, "requests");

    public static IEnumerable<object[]> NegativeNames => TestVectors.CaseNames(File, "negative");

    public static IEnumerable<object[]> PopNegativeNames => TestVectors.CaseNames(File, "pop_negative");

    [Fact]
    public void Version_matches_canonical_prefix()
    {
        Assert.Equal(RequestCanonicalizer.Version, Root.Str("version"));
    }

    [Fact]
    public void Rfc8032_test_1_known_answer()
    {
        var kat = Root.GetProperty("rfc8032_test_1");
        using var pair = Ed25519KeyPair.FromSeed(Hex.Decode(kat.Str("seed_hex")));
        Assert.Equal(kat.Str("public_key_hex"), Hex.Encode(pair.GetPublicKey()));
        var message = Hex.Decode(kat.Str("message_hex"));
        var signature = pair.Sign(message);
        Assert.Equal(kat.Str("signature_hex"), Hex.Encode(signature));
        Assert.True(Ed25519Signer.Verify(pair.GetPublicKey(), message, signature));
    }

    [Theory]
    [InlineData("key")]
    [InlineData("rotation_key")]
    public void Keys_derive_public_key_and_fingerprint(string property)
    {
        var key = Root.GetProperty(property);
        using var pair = Ed25519KeyPair.FromSeed(Hex.Decode(key.Str("seed_hex")));
        Assert.Equal(key.Str("public_key_hex"), Hex.Encode(pair.GetPublicKey()));
        Assert.Equal(key.Str("public_key_b64"), pair.PublicKeyBase64);
        Assert.Equal(key.Str("fingerprint"), pair.Fingerprint);
        Assert.Equal(key.Str("fingerprint"), KeyFingerprint.Compute(pair.GetPublicKey()));
        Assert.True(KeyFingerprint.IsValid(pair.Fingerprint));
    }

    [Theory]
    [MemberData(nameof(RequestNames))]
    public void Signed_request_vector_reproduces_hash_canonical_string_and_signature(string name)
    {
        var vector = TestVectors.Case(File, "requests", name);
        var body = Convert.FromBase64String(vector.Str("body_base64"));
        Assert.Equal(Encoding.UTF8.GetBytes(vector.Str("body")), body);
        Assert.Equal(vector.Str("body_sha256_hex"), Sha256.HashHex(body));

        var canonical = RequestCanonicalizer.Build(
            vector.Str("method"),
            vector.Str("path_with_query"),
            vector.Str("server_id"),
            vector.Str("timestamp"),
            vector.Str("nonce"),
            vector.Str("request_id"),
            vector.Str("body_sha256_hex"));
        Assert.Equal(vector.Str("canonical"), canonical);

        var key = Root.GetProperty("key");
        Assert.True(Ed25519Signer.VerifyBase64(key.Str("public_key_b64"), canonical, vector.Str("signature_b64")));

        using var pair = Ed25519KeyPair.FromSeed(Hex.Decode(key.Str("seed_hex")));
        Assert.Equal(vector.Str("signature_b64"), Ed25519Signer.SignToBase64(pair, canonical));
    }

    [Theory]
    [MemberData(nameof(RequestNames))]
    public void RequestSigner_produces_the_vector_headers(string name)
    {
        var vector = TestVectors.Case(File, "requests", name);
        var key = Root.GetProperty("key");
        using var pair = Ed25519KeyPair.FromSeed(Hex.Decode(key.Str("seed_hex")));
        var identity = new ServerIdentity(vector.Str("server_id"), pair, DateTimeOffset.UnixEpoch);
        var headers = vector.GetProperty("headers");
        var signer = new RequestSigner(new FakeClock(DateTimeOffset.UnixEpoch), headers.Str("X-Plugin-Version"));

        var signed = signer.Sign(
            identity,
            vector.Str("method"),
            vector.Str("path_with_query"),
            Convert.FromBase64String(vector.Str("body_base64")),
            long.Parse(vector.Str("timestamp")),
            vector.Str("nonce"),
            vector.Str("request_id"));

        Assert.Equal(vector.Str("canonical"), signed.CanonicalRequest);
        var produced = signed.ToHeaders().ToDictionary(h => h.Key, h => h.Value);
        foreach (var header in headers.EnumerateObject())
        {
            Assert.Equal(header.Value.GetString(), produced[header.Name]);
        }

        // The plugin always sends the optional fingerprint header; it must be the key's fingerprint.
        Assert.Equal(key.Str("fingerprint"), produced[SigningHeaderNames.KeyFingerprint]);
    }

    [Theory]
    [MemberData(nameof(NegativeNames))]
    public void Tampered_request_does_not_verify(string name)
    {
        var vector = TestVectors.Case(File, "negative", name);
        Assert.False(vector.GetProperty("expected_valid").GetBoolean());
        var body = Convert.FromBase64String(vector.Str("body_base64"));
        Assert.Equal(vector.Str("body_sha256_hex"), Sha256.HashHex(body));

        var canonical = RequestCanonicalizer.Build(
            vector.Str("method"),
            vector.Str("path_with_query"),
            vector.Str("server_id"),
            vector.Str("timestamp"),
            vector.Str("nonce"),
            vector.Str("request_id"),
            Sha256.HashHex(body));
        Assert.Equal(vector.Str("canonical"), canonical);
        Assert.False(Ed25519Signer.VerifyBase64(vector.Str("public_key_b64"), canonical, vector.Str("signature_b64")));
    }

    [Fact]
    public void Registration_pop_vector()
    {
        var pop = Root.GetProperty("registration_pop");
        var timestamp = pop.GetProperty("timestamp").GetInt64();
        var message = PopMessages.Registration(pop.Str("registration_token"), pop.Str("public_key_b64"), timestamp);
        Assert.Equal(pop.Str("message"), message);
        Assert.True(Ed25519Signer.VerifyBase64(pop.Str("public_key_b64"), message, pop.Str("signature_b64")));

        using var pair = Ed25519KeyPair.FromSeed(Hex.Decode(Root.GetProperty("key").Str("seed_hex")));
        Assert.Equal(pop.Str("signature_b64"), PopMessages.SignRegistration(pair, pop.Str("registration_token"), timestamp));

        // The DTO serializes to exactly the documented request body.
        var body = pop.GetProperty("request_body");
        var dto = new ServerRegisterRequest
        {
            RegistrationToken = body.Str("registration_token"),
            PublicKey = body.Str("public_key"),
            PluginVersion = body.Str("plugin_version"),
            GameVersion = body.Str("game_version"),
            Timestamp = body.GetProperty("timestamp").GetInt64(),
            PopSignature = body.Str("pop_signature"),
        };
        using var serialized = JsonDocument.Parse(TrustJson.Serialize(dto));
        Assert.True(TestVectors.JsonEquals(body, serialized.RootElement), TrustJson.Serialize(dto));
    }

    [Fact]
    public void Rotation_pop_vector()
    {
        var pop = Root.GetProperty("rotation_pop");
        var timestamp = pop.GetProperty("timestamp").GetInt64();
        var message = PopMessages.Rotation(pop.Str("server_id"), pop.Str("new_public_key_b64"), timestamp);
        Assert.Equal(pop.Str("message"), message);
        Assert.True(Ed25519Signer.VerifyBase64(pop.Str("new_public_key_b64"), message, pop.Str("signature_b64")));

        using var newKey = Ed25519KeyPair.FromSeed(Hex.Decode(Root.GetProperty("rotation_key").Str("seed_hex")));
        Assert.Equal(pop.Str("new_key_fingerprint"), newKey.Fingerprint);
        Assert.Equal(pop.Str("signature_b64"), PopMessages.SignRotation(newKey, pop.Str("server_id"), timestamp));

        var body = pop.GetProperty("request_body");
        var dto = new KeyRotateRequest
        {
            NewPublicKey = body.Str("new_public_key"),
            Timestamp = body.GetProperty("timestamp").GetInt64(),
            PopSignature = body.Str("pop_signature"),
        };
        using var serialized = JsonDocument.Parse(TrustJson.Serialize(dto));
        Assert.True(TestVectors.JsonEquals(body, serialized.RootElement));
    }

    [Fact]
    public void Key_rotate_request_vector_body_is_the_rotation_pop_body()
    {
        var vector = TestVectors.Case(File, "requests", "post_key_rotate");
        using var body = JsonDocument.Parse(vector.Str("body"));
        Assert.True(TestVectors.JsonEquals(Root.GetProperty("rotation_pop").GetProperty("request_body"), body.RootElement));
    }

    [Theory]
    [MemberData(nameof(PopNegativeNames))]
    public void Pop_negative_does_not_verify(string name)
    {
        var vector = TestVectors.Case(File, "pop_negative", name);
        Assert.False(Ed25519Signer.VerifyBase64(vector.Str("public_key_b64"), vector.Str("message"), vector.Str("signature_b64")));
    }
}
