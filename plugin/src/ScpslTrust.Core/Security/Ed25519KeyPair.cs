using System;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Security;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// Ed25519 key pair backed by BouncyCastle. The 32-byte private seed never leaves this
    /// object except through <see cref="ExportSeed"/> (used only by <see cref="KeyStore"/>).
    /// <see cref="ToString"/> exposes the public fingerprint only.
    /// </summary>
    public sealed class Ed25519KeyPair : IDisposable
    {
        public const int SeedLength = 32;
        public const int PublicKeyLength = 32;
        public const int SignatureLength = 64;

        private readonly byte[] _seed;
        private readonly byte[] _publicKey;
        private readonly Ed25519PrivateKeyParameters _privateKey;
        private bool _disposed;

        private Ed25519KeyPair(byte[] seed)
        {
            _seed = seed;
            _privateKey = new Ed25519PrivateKeyParameters(seed, 0);
            _publicKey = _privateKey.GeneratePublicKey().GetEncoded();
            PublicKeyBase64 = Convert.ToBase64String(_publicKey);
            Fingerprint = KeyFingerprint.Compute(_publicKey);
        }

        /// <summary>Standard padded base64 of the 32 raw public-key bytes (wire encoding).</summary>
        public string PublicKeyBase64 { get; }

        /// <summary><c>SHA256:&lt;hex&gt;</c> fingerprint of the public key.</summary>
        public string Fingerprint { get; }

        /// <summary>Copy of the 32 raw public-key bytes.</summary>
        public byte[] GetPublicKey() => (byte[])_publicKey.Clone();

        /// <summary>Generates a new key pair with BouncyCastle's Ed25519 key generator (CSPRNG).</summary>
        public static Ed25519KeyPair Generate()
        {
            var generator = new Ed25519KeyPairGenerator();
            generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
            var pair = generator.GenerateKeyPair();
            var seed = ((Ed25519PrivateKeyParameters)pair.Private).GetEncoded();
            return new Ed25519KeyPair(seed);
        }

        /// <summary>Restores a key pair from its 32-byte seed (the input array is copied).</summary>
        public static Ed25519KeyPair FromSeed(byte[] seed)
        {
            if (seed == null)
            {
                throw new ArgumentNullException(nameof(seed));
            }

            if (seed.Length != SeedLength)
            {
                throw new ArgumentException("Ed25519 seeds are 32 bytes.", nameof(seed));
            }

            return new Ed25519KeyPair((byte[])seed.Clone());
        }

        /// <summary>Signs <paramref name="message"/>; Ed25519 signatures are deterministic.</summary>
        public byte[] Sign(byte[] message)
        {
            ThrowIfDisposed();
            if (message == null)
            {
                throw new ArgumentNullException(nameof(message));
            }

            var signer = new Org.BouncyCastle.Crypto.Signers.Ed25519Signer();
            signer.Init(true, _privateKey);
            signer.BlockUpdate(message, 0, message.Length);
            return signer.GenerateSignature();
        }

        /// <summary>Copy of the private seed. Only for persisting the identity file.</summary>
        public byte[] ExportSeed()
        {
            ThrowIfDisposed();
            return (byte[])_seed.Clone();
        }

        /// <summary>Best-effort wipe of the seed copy held by this object.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            Array.Clear(_seed, 0, _seed.Length);
            _disposed = true;
        }

        public override string ToString() => "Ed25519KeyPair(" + Fingerprint + ")";

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(Ed25519KeyPair));
            }
        }
    }
}
