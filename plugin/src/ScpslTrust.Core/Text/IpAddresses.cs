using System.Net;
using System.Net.Sockets;

namespace ScpslTrust.Core.Text
{
    /// <summary>IP address normalization and log-safe masking. Full addresses are never logged.</summary>
    public static class IpAddresses
    {
        /// <summary>Canonical text form (IPv4-mapped IPv6 → IPv4, IPv6 scope removed); null for invalid input.</summary>
        public static string? Normalize(string? value)
        {
            if (string.IsNullOrWhiteSpace(value) || !IPAddress.TryParse(value!.Trim(), out var address))
            {
                return null;
            }

            if (address.AddressFamily == AddressFamily.InterNetworkV6 && IsIPv4Mapped(address))
            {
                address = MapToIPv4(address);
            }

            if (address.AddressFamily == AddressFamily.InterNetworkV6)
            {
                address.ScopeId = 0;
            }

            return address.AddressFamily == AddressFamily.InterNetwork || address.AddressFamily == AddressFamily.InterNetworkV6
                ? address.ToString()
                : null;
        }

        /// <summary>Log-safe form: IPv4 /24 (<c>203.0.113.x</c>) or IPv6 /48 (<c>2001:db8:1::/48</c>).</summary>
        public static string Mask(string? value)
        {
            var normalized = Normalize(value);
            if (normalized == null)
            {
                return "invalid-ip";
            }

            var address = IPAddress.Parse(normalized);
            var bytes = address.GetAddressBytes();
            if (address.AddressFamily == AddressFamily.InterNetwork)
            {
                return bytes[0] + "." + bytes[1] + "." + bytes[2] + ".x";
            }

            return ((bytes[0] << 8) | bytes[1]).ToString("x") + ":" + ((bytes[2] << 8) | bytes[3]).ToString("x") + ":" + ((bytes[4] << 8) | bytes[5]).ToString("x") + "::/48";
        }

        private static bool IsIPv4Mapped(IPAddress address)
        {
            var bytes = address.GetAddressBytes();
            for (var i = 0; i < 10; i++)
            {
                if (bytes[i] != 0)
                {
                    return false;
                }
            }

            return bytes[10] == 0xff && bytes[11] == 0xff;
        }

        private static IPAddress MapToIPv4(IPAddress address)
        {
            var bytes = address.GetAddressBytes();
            return new IPAddress(new[] { bytes[12], bytes[13], bytes[14], bytes[15] });
        }
    }
}
