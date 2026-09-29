using System;
using System.Text;
using Org.BouncyCastle.Crypto.Parameters;
using BcEd25519Signer = Org.BouncyCastle.Crypto.Signers.Ed25519Signer;

namespace ScpslTrust.Core.Security
{
    /// <summary>Ed25519 signing and verification (BouncyCastle). Verification never throws.</summary>
    public static class Ed25519Signer
    {
        public static byte[] Sign(Ed25519KeyPair keyPair, byte[] message)
        {
            if (keyPair == null)
            {
                throw new ArgumentNullException(nameof(keyPair));
            }

            return keyPair.Sign(message);
        }

        /// <summary>Signs the UTF-8 bytes of <paramref name="message"/> and returns standard base64.</summary>
        public static string SignToBase64(Ed25519KeyPair keyPair, string message)
        {
            if (message == null)
            {
                throw new ArgumentNullException(nameof(message));
            }

            return Convert.ToBase64String(Sign(keyPair, Encoding.UTF8.GetBytes(message)));
        }

        /// <summary>Verifies a raw signature. Returns false for malformed keys or signatures.</summary>
        public static bool Verify(byte[]? publicKey, byte[]? message, byte[]? signature)
        {
            if (publicKey == null || message == null || signature == null
                || publicKey.Length != Ed25519KeyPair.PublicKeyLength
                || signature.Length != Ed25519KeyPair.SignatureLength)
            {
                return false;
            }

            try
            {
                var verifier = new BcEd25519Signer();
                verifier.Init(false, new Ed25519PublicKeyParameters(publicKey, 0));
                verifier.BlockUpdate(message, 0, message.Length);
                return verifier.VerifySignature(signature);
            }
            catch (ArgumentException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        /// <summary>Verifies a base64 signature over the UTF-8 bytes of <paramref name="message"/>.</summary>
        public static bool VerifyBase64(string? publicKeyBase64, string? message, string? signatureBase64)
        {
            if (message == null
                || !StrictBase64.TryDecode(publicKeyBase64, Ed25519KeyPair.PublicKeyLength, out var publicKey)
                || !StrictBase64.TryDecode(signatureBase64, Ed25519KeyPair.SignatureLength, out var signature))
            {
                return false;
            }

            return Verify(publicKey, Encoding.UTF8.GetBytes(message), signature);
        }
    }
}
