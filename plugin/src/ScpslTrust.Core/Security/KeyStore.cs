using System;
using System.Globalization;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using ScpslTrust.Core.Storage;

namespace ScpslTrust.Core.Security
{
    /// <summary>Raised for unreadable or inconsistent identity files. Messages never contain key material.</summary>
    public sealed class KeyStoreException : Exception
    {
        public KeyStoreException(string message)
            : base(message)
        {
        }
    }

    /// <summary>
    /// Persists the server identity in <c>&lt;config dir&gt;/identity.json</c>
    /// (<c>{ server_id, private_key_seed_b64, public_key_b64, fingerprint, created_at }</c>, mode 0600,
    /// atomic writes). Companion files:
    /// <list type="bullet">
    /// <item><c>identity.pending.json</c> — key generated for a registration that has not succeeded yet.</item>
    /// <item><c>identity.rotating.json</c> — new key of a rotation in flight (crash recovery).</item>
    /// <item><c>identity.previous.json</c> — previous key after a rotation, kept until the new key worked once.</item>
    /// </list>
    /// </summary>
    public sealed class KeyStore
    {
        public const string IdentityFileName = "identity.json";
        public const string PendingFileName = "identity.pending.json";
        public const string RotatingFileName = "identity.rotating.json";
        public const string PreviousFileName = "identity.previous.json";

        public KeyStore(string directory)
        {
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new ArgumentException("Key store directory is required.", nameof(directory));
            }

            Directory = Path.GetFullPath(directory);
        }

        public string Directory { get; }

        public string IdentityPath => Path.Combine(Directory, IdentityFileName);

        public string PendingPath => Path.Combine(Directory, PendingFileName);

        public string RotatingPath => Path.Combine(Directory, RotatingFileName);

        public string PreviousPath => Path.Combine(Directory, PreviousFileName);

        /// <summary>Registered identity, or null when identity.json does not exist.</summary>
        public ServerIdentity? LoadCurrent()
        {
            var identity = Load(IdentityPath);
            if (identity != null && !identity.IsRegistered)
            {
                throw new KeyStoreException(IdentityFileName + " has no server_id.");
            }

            return identity;
        }

        public void SaveCurrent(ServerIdentity identity)
        {
            if (identity == null)
            {
                throw new ArgumentNullException(nameof(identity));
            }

            if (!identity.IsRegistered)
            {
                throw new ArgumentException("Only registered identities are stored in " + IdentityFileName + ".", nameof(identity));
            }

            Save(IdentityPath, identity);
        }

        public ServerIdentity? LoadPending() => Load(PendingPath);

        public void SavePending(ServerIdentity identity) => Save(PendingPath, identity);

        public void DeletePending() => SecureFile.TryDelete(PendingPath);

        public ServerIdentity? LoadRotationCandidate() => Load(RotatingPath);

        public void SaveRotationCandidate(ServerIdentity identity) => Save(RotatingPath, identity);

        public void DeleteRotationCandidate() => SecureFile.TryDelete(RotatingPath);

        public bool HasPrevious => File.Exists(PreviousPath);

        public ServerIdentity? LoadPrevious() => Load(PreviousPath);

        public void DeletePrevious() => SecureFile.TryDelete(PreviousPath);

        /// <summary>
        /// Completes a rotation: previous key → identity.previous.json, new key → identity.json
        /// (each written atomically), then removes the rotation candidate.
        /// </summary>
        public void CommitRotation(ServerIdentity previous, ServerIdentity next)
        {
            if (previous == null)
            {
                throw new ArgumentNullException(nameof(previous));
            }

            if (next == null)
            {
                throw new ArgumentNullException(nameof(next));
            }

            Save(PreviousPath, previous);
            SaveCurrent(next);
            DeleteRotationCandidate();
        }

        /// <summary>Serializes an identity to the identity-file JSON format.</summary>
        public static string Serialize(ServerIdentity identity)
        {
            var seed = identity.KeyPair.ExportSeed();
            try
            {
                var document = new IdentityDocument
                {
                    ServerId = identity.ServerId,
                    PrivateKeySeedB64 = Convert.ToBase64String(seed),
                    PublicKeyB64 = identity.KeyPair.PublicKeyBase64,
                    Fingerprint = identity.KeyPair.Fingerprint,
                    CreatedAt = identity.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                };
                return JsonSerializer.Serialize(document, IdentityJson.Options);
            }
            finally
            {
                Array.Clear(seed, 0, seed.Length);
            }
        }

        /// <summary>Parses and cross-checks an identity file (seed ↔ public key ↔ fingerprint).</summary>
        public static ServerIdentity Deserialize(string json, string sourceName)
        {
            IdentityDocument? document;
            try
            {
                document = JsonSerializer.Deserialize<IdentityDocument>(json, IdentityJson.Options);
            }
            catch (JsonException)
            {
                // The parser message may quote file content; do not propagate it.
                throw new KeyStoreException(sourceName + " is not valid JSON.");
            }

            if (document == null)
            {
                throw new KeyStoreException(sourceName + " is empty.");
            }

            if (!StrictBase64.TryDecode(document.PrivateKeySeedB64, Ed25519KeyPair.SeedLength, out var seed))
            {
                throw new KeyStoreException(sourceName + ": private_key_seed_b64 must be base64 of 32 bytes.");
            }

            Ed25519KeyPair keyPair;
            try
            {
                keyPair = Ed25519KeyPair.FromSeed(seed);
            }
            finally
            {
                Array.Clear(seed, 0, seed.Length);
            }

            if (!string.Equals(keyPair.PublicKeyBase64, document.PublicKeyB64, StringComparison.Ordinal))
            {
                keyPair.Dispose();
                throw new KeyStoreException(sourceName + ": public_key_b64 does not match the private key.");
            }

            if (!string.Equals(keyPair.Fingerprint, document.Fingerprint, StringComparison.Ordinal))
            {
                keyPair.Dispose();
                throw new KeyStoreException(sourceName + ": fingerprint does not match the public key.");
            }

            if (document.ServerId != null && !ServerIds.IsValid(document.ServerId))
            {
                keyPair.Dispose();
                throw new KeyStoreException(sourceName + ": server_id is malformed.");
            }

            var createdAt = DateTimeOffset.MinValue;
            if (document.CreatedAt != null
                && !DateTimeOffset.TryParse(document.CreatedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out createdAt))
            {
                keyPair.Dispose();
                throw new KeyStoreException(sourceName + ": created_at is not an ISO-8601 timestamp.");
            }

            return new ServerIdentity(document.ServerId, keyPair, createdAt);
        }

        private ServerIdentity? Load(string path)
        {
            string json;
            try
            {
                if (!File.Exists(path))
                {
                    return null;
                }

                json = File.ReadAllText(path);
            }
            catch (IOException ex)
            {
                throw new KeyStoreException("Cannot read " + Path.GetFileName(path) + ": " + ex.GetType().Name + ".");
            }
            catch (UnauthorizedAccessException)
            {
                throw new KeyStoreException("Access to " + Path.GetFileName(path) + " was denied.");
            }

            var identity = Deserialize(json, Path.GetFileName(path));
            SecureFile.TryRestrictToOwner(path);
            return identity;
        }

        private static void Save(string path, ServerIdentity identity)
        {
            if (identity == null)
            {
                throw new ArgumentNullException(nameof(identity));
            }

            try
            {
                SecureFile.WriteAllTextAtomic(path, Serialize(identity) + "\n", ownerOnly: true);
            }
            catch (IOException ex)
            {
                throw new KeyStoreException("Cannot write " + Path.GetFileName(path) + ": " + ex.GetType().Name + ".");
            }
            catch (UnauthorizedAccessException)
            {
                throw new KeyStoreException("Access to " + Path.GetFileName(path) + " was denied.");
            }
        }

        private sealed class IdentityDocument
        {
            public string? ServerId { get; set; }

            public string? PrivateKeySeedB64 { get; set; }

            public string? PublicKeyB64 { get; set; }

            public string? Fingerprint { get; set; }

            public string? CreatedAt { get; set; }

            public override string ToString() => "IdentityDocument(" + (ServerId ?? "unregistered") + ")";
        }

        private static class IdentityJson
        {
            public static readonly JsonSerializerOptions Options = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                WriteIndented = true,
                // Keep base64 '+' readable in the file (the default encoder writes \u002B).
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            };
        }
    }
}
