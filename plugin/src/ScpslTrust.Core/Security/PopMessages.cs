using System;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// Proof-of-possession messages (ARCHITECTURE §5.2, §5.5), mirror of
    /// <c>buildRegistrationPopMessage</c> / <c>buildRotationPopMessage</c> in shared/src/signing.ts.
    /// </summary>
    public static class PopMessages
    {
        public const string RegistrationVersion = "SCPSL-TRUST-REGISTER-V1";
        public const string RotationVersion = "SCPSL-TRUST-ROTATE-V1";

        /// <summary><c>SCPSL-TRUST-REGISTER-V1\n&lt;token&gt;\n&lt;public_key b64&gt;\n&lt;timestamp ms&gt;</c>, signed by the key being registered.</summary>
        public static string Registration(string registrationToken, string publicKeyBase64, long timestampMs)
        {
            RequestCanonicalizer.AssertField(nameof(registrationToken), registrationToken);
            RequestCanonicalizer.AssertField("publicKey", publicKeyBase64);
            return string.Join("\n", RegistrationVersion, registrationToken, publicKeyBase64, RequestCanonicalizer.FormatTimestamp(timestampMs));
        }

        /// <summary><c>SCPSL-TRUST-ROTATE-V1\n&lt;server_id&gt;\n&lt;new_public_key b64&gt;\n&lt;timestamp ms&gt;</c>, signed by the NEW key.</summary>
        public static string Rotation(string serverId, string newPublicKeyBase64, long timestampMs)
        {
            RequestCanonicalizer.AssertField(nameof(serverId), serverId);
            RequestCanonicalizer.AssertField("newPublicKey", newPublicKeyBase64);
            return string.Join("\n", RotationVersion, serverId, newPublicKeyBase64, RequestCanonicalizer.FormatTimestamp(timestampMs));
        }

        /// <summary>Base64 signature of the registration PoP by <paramref name="keyPair"/>.</summary>
        public static string SignRegistration(Ed25519KeyPair keyPair, string registrationToken, long timestampMs)
        {
            if (keyPair == null)
            {
                throw new ArgumentNullException(nameof(keyPair));
            }

            return Ed25519Signer.SignToBase64(keyPair, Registration(registrationToken, keyPair.PublicKeyBase64, timestampMs));
        }

        /// <summary>Base64 signature of the rotation PoP by the NEW key pair.</summary>
        public static string SignRotation(Ed25519KeyPair newKeyPair, string serverId, long timestampMs)
        {
            if (newKeyPair == null)
            {
                throw new ArgumentNullException(nameof(newKeyPair));
            }

            return Ed25519Signer.SignToBase64(newKeyPair, Rotation(serverId, newKeyPair.PublicKeyBase64, timestampMs));
        }
    }
}
