using System.Runtime.InteropServices;
using System.Text.Json;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Storage;
using Xunit;

namespace ScpslTrust.Core.Tests.Security;

public sealed class KeyStoreTests : IDisposable
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "stn-keystore-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, recursive: true);
        }
    }

    [Fact]
    public void Missing_identity_loads_as_null()
    {
        Assert.Null(new KeyStore(_dir).LoadCurrent());
    }

    [Fact]
    public void Round_trip_preserves_identity()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        var created = DateTimeOffset.Parse("2026-09-29T15:42:20.123Z");
        store.SaveCurrent(new ServerIdentity(ServerId, pair, created));

        var loaded = store.LoadCurrent()!;
        Assert.Equal(ServerId, loaded.ServerId);
        Assert.Equal(pair.PublicKeyBase64, loaded.KeyPair.PublicKeyBase64);
        Assert.Equal(pair.Fingerprint, loaded.Fingerprint);
        Assert.Equal(created, loaded.CreatedAt);
        Assert.Equal(pair.Sign(new byte[] { 1, 2, 3 }), loaded.KeyPair.Sign(new byte[] { 1, 2, 3 }));
    }

    [Fact]
    public void File_has_exactly_the_documented_fields()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        using var doc = JsonDocument.Parse(File.ReadAllText(store.IdentityPath));
        var names = doc.RootElement.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "created_at", "fingerprint", "private_key_seed_b64", "public_key_b64", "server_id" }, names);
        Assert.Equal(pair.PublicKeyBase64, doc.RootElement.GetProperty("public_key_b64").GetString());
        Assert.Equal(Convert.ToBase64String(pair.ExportSeed()), doc.RootElement.GetProperty("private_key_seed_b64").GetString());
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", doc.RootElement.GetProperty("created_at").GetString()!);
    }

    [Fact]
    public void Identity_file_is_owner_only_on_unix()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        var mode = File.GetUnixFileMode(store.IdentityPath);
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, mode);
    }

    [Fact]
    public void Loading_tightens_loose_permissions_on_unix()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        File.SetUnixFileMode(store.IdentityPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
        store.LoadCurrent();
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(store.IdentityPath));
    }

    [Fact]
    public void Atomic_write_replaces_content_and_leaves_no_temp_files()
    {
        var store = new KeyStore(_dir);
        using var first = Ed25519KeyPair.Generate();
        using var second = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, first, DateTimeOffset.UtcNow));
        store.SaveCurrent(new ServerIdentity(ServerId, second, DateTimeOffset.UtcNow));

        Assert.Equal(second.Fingerprint, store.LoadCurrent()!.Fingerprint);
        Assert.Equal(new[] { KeyStore.IdentityFileName }, Directory.GetFiles(_dir).Select(Path.GetFileName).ToArray());
    }

    [Fact]
    public void Secure_file_write_is_atomic_with_respect_to_readers()
    {
        var path = Path.Combine(_dir, "file.txt");
        SecureFile.WriteAllTextAtomic(path, "old", ownerOnly: true);
        SecureFile.WriteAllTextAtomic(path, "new", ownerOnly: true);
        Assert.Equal("new", File.ReadAllText(path));
        Assert.Single(Directory.GetFiles(_dir));
    }

    [Fact]
    public void Unregistered_identity_cannot_be_saved_as_current()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        Assert.Throws<ArgumentException>(() => store.SaveCurrent(new ServerIdentity(null, pair, DateTimeOffset.UtcNow)));
    }

    [Fact]
    public void Current_without_server_id_is_rejected()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SavePending(new ServerIdentity(null, pair, DateTimeOffset.UtcNow));
        File.Copy(store.PendingPath, store.IdentityPath);
        Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
    }

    [Fact]
    public void Corrupt_json_error_does_not_leak_content()
    {
        Directory.CreateDirectory(_dir);
        var store = new KeyStore(_dir);
        const string secretish = "{\"private_key_seed_b64\": SUPERSECRETVALUE";
        File.WriteAllText(store.IdentityPath, secretish);
        var ex = Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
        Assert.DoesNotContain("SUPERSECRET", ex.Message + ex);
        Assert.Null(ex.InnerException);
    }

    [Fact]
    public void Tampered_public_key_or_fingerprint_is_detected_without_leaking_the_seed()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        using var other = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        var seed = Convert.ToBase64String(pair.ExportSeed());
        var json = File.ReadAllText(store.IdentityPath);

        File.WriteAllText(store.IdentityPath, json.Replace(pair.PublicKeyBase64, other.PublicKeyBase64));
        var publicKeyError = Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
        Assert.Contains("public_key_b64", publicKeyError.Message);
        Assert.DoesNotContain(seed, publicKeyError.ToString());

        File.WriteAllText(store.IdentityPath, json.Replace(pair.Fingerprint, other.Fingerprint));
        var fingerprintError = Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
        Assert.Contains("fingerprint", fingerprintError.Message);
        Assert.DoesNotContain(seed, fingerprintError.ToString());
    }

    [Theory]
    [InlineData("\"private_key_seed_b64\": \"AAAA\"")]
    [InlineData("\"private_key_seed_b64\": null")]
    [InlineData("\"private_key_seed_b64\": \"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!=\"")]
    public void Malformed_seed_is_rejected(string replacement)
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        var seed = Convert.ToBase64String(pair.ExportSeed());
        var json = File.ReadAllText(store.IdentityPath).Replace("\"private_key_seed_b64\": \"" + seed + "\"", replacement);
        File.WriteAllText(store.IdentityPath, json);
        Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
    }

    [Fact]
    public void Malformed_server_id_is_rejected()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SaveCurrent(new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow));
        File.WriteAllText(store.IdentityPath, File.ReadAllText(store.IdentityPath).Replace(ServerId, "srv_../../etc/passwd"));
        Assert.Throws<KeyStoreException>(() => store.LoadCurrent());
    }

    [Fact]
    public void ToString_never_contains_key_material()
    {
        using var pair = Ed25519KeyPair.Generate();
        var seed = pair.ExportSeed();
        var identity = new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow);
        foreach (var text in new[] { pair.ToString(), identity.ToString() })
        {
            Assert.DoesNotContain(Convert.ToBase64String(seed), text);
            Assert.DoesNotContain(Hex.Encode(seed), text);
            Assert.Contains(pair.Fingerprint, text);
        }
    }

    [Fact]
    public void Disposed_key_pair_refuses_to_sign_and_export()
    {
        var pair = Ed25519KeyPair.Generate();
        pair.Dispose();
        Assert.Throws<ObjectDisposedException>(() => pair.Sign(new byte[] { 1 }));
        Assert.Throws<ObjectDisposedException>(() => pair.ExportSeed());
    }

    [Fact]
    public void Rotation_commit_writes_previous_and_current_and_removes_candidate()
    {
        var store = new KeyStore(_dir);
        using var oldKey = Ed25519KeyPair.Generate();
        using var newKey = Ed25519KeyPair.Generate();
        var current = new ServerIdentity(ServerId, oldKey, DateTimeOffset.UtcNow);
        var next = new ServerIdentity(ServerId, newKey, DateTimeOffset.UtcNow);
        store.SaveCurrent(current);
        store.SaveRotationCandidate(next);

        store.CommitRotation(current, next);

        Assert.Equal(newKey.Fingerprint, store.LoadCurrent()!.Fingerprint);
        Assert.Equal(oldKey.Fingerprint, store.LoadPrevious()!.Fingerprint);
        Assert.Null(store.LoadRotationCandidate());
        Assert.True(store.HasPrevious);
        store.DeletePrevious();
        Assert.False(store.HasPrevious);
    }

    [Fact]
    public void Pending_identity_round_trip()
    {
        var store = new KeyStore(_dir);
        using var pair = Ed25519KeyPair.Generate();
        store.SavePending(new ServerIdentity(null, pair, DateTimeOffset.UtcNow));
        var pending = store.LoadPending()!;
        Assert.False(pending.IsRegistered);
        Assert.Equal(pair.Fingerprint, pending.Fingerprint);
        store.DeletePending();
        Assert.Null(store.LoadPending());
    }

    [Fact]
    public void Seeds_are_validated()
    {
        Assert.Throws<ArgumentException>(() => Ed25519KeyPair.FromSeed(new byte[31]));
        Assert.Throws<ArgumentException>(() => Ed25519KeyPair.FromSeed(new byte[33]));
        Assert.Throws<ArgumentNullException>(() => Ed25519KeyPair.FromSeed(null!));
        using var a = Ed25519KeyPair.Generate();
        using var b = Ed25519KeyPair.Generate();
        Assert.NotEqual(a.Fingerprint, b.Fingerprint);
    }
}
